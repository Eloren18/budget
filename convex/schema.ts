import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per user: the entire budget as a JSON string (arbitrary keys like
  // month names & pool names make a stringified blob safer than nested fields).
  budgets: defineTable({
    email: v.string(), // owner, lowercased
    data: v.string(), // JSON.stringify of the whole budget object
    updatedAt: v.number(), // client clock, last-write-wins
  }).index("by_email", ["email"]),

  // Invite list: one row per approved email (admin is always allowed, no row needed).
  access: defineTable({
    email: v.string(),
    addedAt: v.number(),
  }).index("by_email", ["email"]),

  // Pending sign-in codes (newest wins; hashed, expiring, attempt-capped).
  otps: defineTable({
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    sentAt: v.number(),
  }).index("by_email", ["email"]),


  // Signed-in devices. Token lives in the browser's localStorage.
  sessions: defineTable({
    token: v.string(),
    email: v.string(),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_email", ["email"]),
});
