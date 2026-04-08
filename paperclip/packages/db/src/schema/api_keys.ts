import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyPreview: text("key_preview").notNull(),
    helpUrl: text("help_url"),
    testUrl: text("test_url"),
    testAuthHeader: text("test_auth_header"),
    testAuthPrefix: text("test_auth_prefix"),
    isValid: boolean("is_valid").notNull().default(false),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerUniqueIdx: uniqueIndex("api_keys_provider_unique_idx").on(table.provider),
    userIdx: index("api_keys_user_id_idx").on(table.userId),
  }),
);
