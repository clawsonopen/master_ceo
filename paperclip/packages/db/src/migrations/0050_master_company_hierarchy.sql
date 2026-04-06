ALTER TABLE "companies" ADD COLUMN "company_type" text DEFAULT 'regular' NOT NULL;-->statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_deletable" boolean DEFAULT true NOT NULL;-->statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "parent_company_id" uuid;-->statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_parent_company_id_companies_id_fk" FOREIGN KEY ("parent_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;-->statement-breakpoint
CREATE UNIQUE INDEX "companies_master_unique_idx" ON "companies" USING btree ("company_type") WHERE company_type = 'master';-->statement-breakpoint
CREATE INDEX "companies_parent_company_idx" ON "companies" USING btree ("parent_company_id");-->statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "is_protected" boolean DEFAULT false NOT NULL;-->statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "hired_by" uuid;-->statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_hired_by_agents_id_fk" FOREIGN KEY ("hired_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;-->statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "kb_access" jsonb DEFAULT '{"read":[],"write":[],"search":[]}'::jsonb NOT NULL;-->statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "model_preference" jsonb DEFAULT '{"mode":"auto"}'::jsonb NOT NULL;
