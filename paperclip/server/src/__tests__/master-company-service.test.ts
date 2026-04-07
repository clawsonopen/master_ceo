import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import {
  COST_RESEARCH_AGENT_NAME,
  MASTER_CEO_NAME,
  MASTER_COMPANY_NAME,
  ensureMasterCompanyHierarchy,
} from "../services/master-company.js";

describe("ensureMasterCompanyHierarchy", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-master-company-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await (db as { $client?: { end?: (options?: { timeout?: number }) => Promise<unknown> } }).$client?.end?.({
      timeout: 0,
    });
    await tempDb?.cleanup();
  });

  it("creates the master company and protected seed agents once", async () => {
    const first = await ensureMasterCompanyHierarchy(db);
    const second = await ensureMasterCompanyHierarchy(db);

    expect(first.masterCompanyCreated).toBe(true);
    expect(first.masterCeoCreated).toBe(true);
    expect(first.costResearchAgentCreated).toBe(true);
    expect(second.masterCompanyCreated).toBe(false);
    expect(second.masterCeoCreated).toBe(false);
    expect(second.costResearchAgentCreated).toBe(false);

    const masterCompany = await db
      .select()
      .from(companies)
      .where(eq(companies.companyType, "master"))
      .then((rows) => rows[0] ?? null);

    expect(masterCompany?.name).toBe(MASTER_COMPANY_NAME);
    expect(masterCompany?.isDeletable).toBe(false);
    expect(masterCompany?.parentCompanyId).toBeNull();

    const seededAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.companyId, masterCompany!.id));

    expect(seededAgents).toHaveLength(2);

    const masterCeo = seededAgents.find((agent) => agent.name === MASTER_CEO_NAME);
    const costResearchAgent = seededAgents.find((agent) => agent.name === COST_RESEARCH_AGENT_NAME);

    expect(masterCeo?.isProtected).toBe(true);
    expect(masterCeo?.role).toBe("ceo");
    expect(costResearchAgent?.isProtected).toBe(true);
    expect(costResearchAgent?.reportsTo).toBe(masterCeo?.id);
  });
});
