CREATE TABLE IF NOT EXISTS "provider_discovery_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL,
  "status" text NOT NULL DEFAULT 'suggested',
  "docs_url" text,
  "api_reference_url" text,
  "test_url" text,
  "model_list_url" text,
  "auth_mode" text,
  "auth_header" text,
  "auth_prefix" text,
  "confidence" text NOT NULL DEFAULT 'low',
  "discovery_notes" text,
  "source_evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "discovered_by" text,
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "provider_discovery_suggestions_status_check"
    CHECK ("status" IN ('suggested', 'published', 'rejected')),
  CONSTRAINT "provider_discovery_suggestions_confidence_check"
    CHECK ("confidence" IN ('low', 'medium', 'high'))
);

CREATE INDEX IF NOT EXISTS "provider_discovery_suggestions_provider_idx"
  ON "provider_discovery_suggestions" ("provider");
CREATE INDEX IF NOT EXISTS "provider_discovery_suggestions_status_idx"
  ON "provider_discovery_suggestions" ("status");
CREATE INDEX IF NOT EXISTS "provider_discovery_suggestions_provider_status_idx"
  ON "provider_discovery_suggestions" ("provider", "status");

