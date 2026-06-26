// instant.schema.ts
// Data model for the Budget app (per instantdb/skills SKILL.md).
// The running app (budget.html) defines this same schema inline, so you do NOT
// need a build step. This file is here only if you want to manage the schema
// with the Instant CLI:   npx instant-cli@latest push schema
import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    // System users namespace (magic-code auth populates email).
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    // One row per user holds the entire budget document as JSON.
    budgets: i.entity({
      data: i.json(),
      updatedAt: i.number().indexed(),
    }),
  },
  links: {
    budgetOwner: {
      forward: { on: "budgets", has: "one", label: "owner" },
      reverse: { on: "$users", has: "one", label: "budget" },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
