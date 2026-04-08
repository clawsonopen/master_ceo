import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const providerDiscoverySuggestions = pgTable(
  "provider_discovery_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("suggested"),
    docsUrl: text("docs_url"),
    apiReferenceUrl: text("api_reference_url"),
    testUrl: text("test_url"),
    modelListUrl: text("model_list_url"),
    authMode: text("auth_mode"),
    authHeader: text("auth_header"),
    authPrefix: text("auth_prefix"),
    confidence: text("confidence").notNull().default("low"),
    discoveryNotes: text("discovery_notes"),
    sourceEvidence: jsonb("source_evidence").$type<Array<{ url: string; note?: string }>>().notNull().default([]),
    discoveredBy: text("discovered_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerIdx: index("provider_discovery_suggestions_provider_idx").on(table.provider),
    statusIdx: index("provider_discovery_suggestions_status_idx").on(table.status),
    providerStatusIdx: index("provider_discovery_suggestions_provider_status_idx").on(table.provider, table.status),
  }),
);

