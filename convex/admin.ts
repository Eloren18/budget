import { internalQuery } from "./_generated/server";

// CLI-only sanity check that never prints budget contents:
//   npx convex run admin:budgetStats --prod
export const budgetStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("budgets").collect();
    const sessions = (await ctx.db.query("sessions").collect()).length;
    const budgets = rows.map((r) => {
      let months: string[] = [];
      try { months = Object.keys(JSON.parse(r.data).months || {}).sort(); } catch {}
      return { email: r.email, updatedAt: new Date(r.updatedAt).toISOString(), bytes: r.data.length, months };
    });
    return { budgets, sessions };
  },
});
