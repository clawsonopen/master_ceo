ALTER TABLE "api_keys" ADD COLUMN "help_url" text;
-->statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "test_url" text;
-->statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "test_auth_header" text;
-->statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "test_auth_prefix" text;
