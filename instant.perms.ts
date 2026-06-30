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
  // Invite list. Any signed-in user may READ it (so the app can check whether
  // they're approved). Only the admin email may ADD/REMOVE entries.
  access: {
    allow: {
      view: "auth.id != null",
      create: "'keremladkeholland@gmail.com' in auth.ref('$user.email')",
      update: "'keremladkeholland@gmail.com' in auth.ref('$user.email')",
      delete: "'keremladkeholland@gmail.com' in auth.ref('$user.email')",
    },
  },
} satisfies InstantRules;

export default rules;
