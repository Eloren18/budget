// instant.perms.ts
// Permission rules: every signed-in person can read and write ONLY their own
// budget row. Push with:   npx instant-cli@latest push perms
// (Or paste the equivalent JSON from SETUP-InstantDB.txt into the dashboard's
//  Permissions tab — that's the no-CLI way.)
import type { InstantRules } from "@instantdb/core";

const rules = {
  budgets: {
    allow: {
      view: "auth.id != null && auth.id in data.ref('owner.id')",
      create: "auth.id != null",
      update: "auth.id != null && auth.id in data.ref('owner.id')",
      delete: "auth.id != null && auth.id in data.ref('owner.id')",
    },
  },
} satisfies InstantRules;

export default rules;
