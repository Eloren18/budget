import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sessionOf } from "./lib";

// The signed-in user's budget. Null = not signed in; {data:null} = signed in, no budget yet.
export const get = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await sessionOf(ctx, token);
    if (!s) return null;
    const row = await ctx.db
      .query("budgets")
      .withIndex("by_email", (q) => q.eq("email", s.email))
      .first();
    return row ? { data: row.data, updatedAt: row.updatedAt } : { data: null, updatedAt: 0 };
  },
});

// Whole-blob upsert, last-write-wins by the client's updatedAt stamp.
export const save = mutation({
  args: { token: v.string(), data: v.string(), updatedAt: v.number() },
  handler: async (ctx, { token, data, updatedAt }) => {
    const s = await sessionOf(ctx, token);
    if (!s) throw new Error("Not signed in.");
    if (data.length > 900_000) throw new Error("Budget too large to sync."); // stay under Convex's 1MiB doc limit
    const row = await ctx.db
      .query("budgets")
      .withIndex("by_email", (q) => q.eq("email", s.email))
      .first();
    if (!row) await ctx.db.insert("budgets", { email: s.email, data, updatedAt });
    else if (updatedAt >= row.updatedAt) await ctx.db.patch(row._id, { data, updatedAt });
    // else: stale write from an out-of-date device — ignored; the subscription
    // will hand that device the newer copy.
  },
});
