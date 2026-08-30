import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { sessionOf } from "./lib";

/* Market data proxy: the static frontend can't reach Yahoo (CORS + CSP), so the backend
   fetches Yahoo's unofficial endpoints and caches them in the `market` table.
   Keys: quote:SYM (price, 12h) · hist:SYM (monthly closes, 12h) · profile:SYM (PE, sectors, 24h)
         search:QUERY (24h) · yahoo:session (cookie+crumb, 2h). */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HOUR = 3600_000;
const SYM_RE = /^[A-Za-z0-9.^=\-]{1,15}$/;

export const get = query({
  args: { token: v.string(), keys: v.array(v.string()) },
  handler: async (ctx, { token, keys }) => {
    const s = await sessionOf(ctx, token);
    if (!s) return null;
    const out: Record<string, { json: string; fetchedAt: number }> = {};
    for (const key of keys.slice(0, 120)) {
      const row = await ctx.db.query("market").withIndex("by_key", (q) => q.eq("key", key)).first();
      if (row) out[key] = { json: row.json, fetchedAt: row.fetchedAt };
    }
    return out;
  },
});

export const cacheGet = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    await ctx.db.query("market").withIndex("by_key", (q) => q.eq("key", key)).first(),
});

export const cachePut = internalMutation({
  args: { key: v.string(), json: v.string() },
  handler: async (ctx, { key, json }) => {
    const row = await ctx.db.query("market").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (row) await ctx.db.patch(row._id, { json, fetchedAt: Date.now() });
    else await ctx.db.insert("market", { key, json, fetchedAt: Date.now() });
  },
});

export const sessionCheck = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => !!(await sessionOf(ctx, token)),
});

// Yahoo's quoteSummary endpoints need a cookie + crumb pair; keep one cached for ~2h.
async function yahooSession(ctx: any): Promise<{ cookie: string; crumb: string }> {
  const cached = await ctx.runQuery(internal.market.cacheGet, { key: "yahoo:session" });
  if (cached && Date.now() - cached.fetchedAt < 2 * HOUR) return JSON.parse(cached.json);
  const r1 = await fetch("https://fc.yahoo.com/", { redirect: "manual", headers: { "user-agent": UA } });
  const cookie = (r1.headers.get("set-cookie") || "").split(";")[0];
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { cookie, "user-agent": UA } });
  const crumb = (await r2.text()).trim();
  const sess = { cookie, crumb };
  await ctx.runMutation(internal.market.cachePut, { key: "yahoo:session", json: JSON.stringify(sess) });
  return sess;
}

const num = (x: any): number | null => {
  const n = typeof x === "object" && x !== null ? x.raw : x;
  return typeof n === "number" && isFinite(n) ? n : null;
};

// Refresh quotes + monthly history + profile for up to 25 symbols. Skips fresh cache entries unless force.
export const refresh = action({
  args: { token: v.string(), symbols: v.array(v.string()), force: v.optional(v.boolean()) },
  handler: async (ctx, { token, symbols, force }) => {
    if (!(await ctx.runQuery(internal.market.sessionCheck, { token }))) throw new ConvexError("Not signed in.");
    const done: string[] = [];
    const errors: Record<string, string> = {};
    for (const raw of symbols.slice(0, 25)) {
      const sym = raw.trim().toUpperCase();
      if (!SYM_RE.test(sym)) { errors[raw] = "invalid symbol"; continue; }
      try {
        // price + monthly closes come from the chart endpoint (no crumb needed)
        const qKey = "quote:" + sym, hKey = "hist:" + sym;
        const qRow = await ctx.runQuery(internal.market.cacheGet, { key: qKey });
        if (force || !qRow || Date.now() - qRow.fetchedAt > 12 * HOUR) {
          const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo`, { headers: { "user-agent": UA } });
          if (!r.ok) throw new Error("chart HTTP " + r.status);
          const j = await r.json();
          const res = j?.chart?.result?.[0];
          if (!res) throw new Error(j?.chart?.error?.description || "no chart data");
          const meta = res.meta || {};
          await ctx.runMutation(internal.market.cachePut, {
            key: qKey,
            json: JSON.stringify({ price: num(meta.regularMarketPrice), currency: meta.currency || null, name: meta.shortName || meta.longName || null, exchange: meta.exchangeName || null }),
          });
          const ts: number[] = res.timestamp || [];
          const closes: (number | null)[] = res.indicators?.quote?.[0]?.close || [];
          const months: string[] = [], c: number[] = [];
          for (let i = 0; i < ts.length; i++) {
            const cl = closes[i];
            if (typeof cl !== "number" || !isFinite(cl)) continue;
            const d = new Date(ts[i] * 1000);
            months.push(d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"));
            c.push(Math.round(cl * 10000) / 10000);
          }
          await ctx.runMutation(internal.market.cachePut, { key: hKey, json: JSON.stringify({ months, closes: c, currency: meta.currency || null }) });
        }
        // fundamentals + exposures via quoteSummary (crumb needed)
        const pKey = "profile:" + sym;
        const pRow = await ctx.runQuery(internal.market.cacheGet, { key: pKey });
        if (force || !pRow || Date.now() - pRow.fetchedAt > 24 * HOUR) {
          const { cookie, crumb } = await yahooSession(ctx);
          const mods = "price,summaryDetail,defaultKeyStatistics,assetProfile,topHoldings";
          const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${mods}&crumb=${encodeURIComponent(crumb)}`, { headers: { cookie, "user-agent": UA } });
          if (!r.ok) throw new Error("quoteSummary HTTP " + r.status);
          const j = await r.json();
          const q = j?.quoteSummary?.result?.[0];
          if (!q) throw new Error(j?.quoteSummary?.error?.description || "no summary data");
          const price = q.price || {}, sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {}, ap = q.assetProfile || {}, th = q.topHoldings || {};
          const profile = {
            name: price.longName || price.shortName || null,
            type: price.quoteType || null, // EQUITY | ETF | MUTUALFUND ...
            currency: price.currency || null,
            trailingPE: num(sd.trailingPE) ?? num(ks.trailingPE),
            forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
            yield: num(sd.yield) ?? num(sd.dividendYield),
            sector: ap.sector || null,          // stocks
            industry: ap.industry || null,      // stocks
            country: ap.country || null,        // stocks
            sectorWeights: Array.isArray(th.sectorWeightings)
              ? th.sectorWeightings.map((w: any) => { const k = Object.keys(w)[0]; return { sector: k, w: num(w[k]) }; }).filter((x: any) => x.w != null)
              : null,                            // ETFs
            topHoldings: Array.isArray(th.holdings)
              ? th.holdings.slice(0, 10).map((h: any) => ({ symbol: h.symbol || null, name: h.holdingName || null, w: num(h.holdingPercent) }))
              : null,                            // ETFs
          };
          await ctx.runMutation(internal.market.cachePut, { key: pKey, json: JSON.stringify(profile) });
        }
        done.push(sym);
      } catch (e: any) {
        errors[sym] = String(e?.message || e).slice(0, 140);
      }
    }
    return { done, errors };
  },
});

// Ticker search for the pie composer (name -> symbols).
export const search = action({
  args: { token: v.string(), q: v.string() },
  handler: async (ctx, { token, q }) => {
    if (!(await ctx.runQuery(internal.market.sessionCheck, { token }))) throw new ConvexError("Not signed in.");
    const qq = q.trim().slice(0, 40);
    if (qq.length < 2) return [];
    const key = "search:" + qq.toLowerCase();
    const cached = await ctx.runQuery(internal.market.cacheGet, { key });
    if (cached && Date.now() - cached.fetchedAt < 24 * HOUR) return JSON.parse(cached.json);
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(qq)}&quotesCount=8&newsCount=0`, { headers: { "user-agent": UA } });
    if (!r.ok) throw new ConvexError("Search failed — try again.");
    const j = await r.json();
    const rows = (j?.quotes || [])
      .filter((x: any) => x.symbol && (x.quoteType === "EQUITY" || x.quoteType === "ETF" || x.quoteType === "MUTUALFUND"))
      .slice(0, 8)
      .map((x: any) => ({ symbol: x.symbol, name: x.shortname || x.longname || null, type: x.quoteType, exchange: x.exchDisp || x.exchange || null }));
    await ctx.runMutation(internal.market.cachePut, { key, json: JSON.stringify(rows) });
    return rows;
  },
});
