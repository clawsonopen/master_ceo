import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, projects, routines, routineTriggers } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import {
  AI_NEWS_AND_RELEASES_AGENT_NAME,
  COST_RESEARCH_AGENT_NAME,
  MASTER_CEO_NAME,
  MASTER_COMPANY_NAME,
  MODEL_RESEARCH_ROUTER_AGENT_NAME,
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
    await db.delete(routineTriggers);
    await db.delete(routines);
    await db.delete(projects);
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
    expect(first.modelResearchRouterAgentCreated).toBe(true);
    expect(first.aiNewsAndReleasesAgentCreated).toBe(true);
    expect(second.masterCompanyCreated).toBe(false);
    expect(second.masterCeoCreated).toBe(false);
    expect(second.costResearchAgentCreated).toBe(false);
    expect(second.modelResearchRouterAgentCreated).toBe(false);
    expect(second.aiNewsAndReleasesAgentCreated).toBe(false);

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

    expect(seededAgents).toHaveLength(4);

    const masterCeo = seededAgents.find((agent) => agent.name === MASTER_CEO_NAME);
    const costResearchAgent = seededAgents.find((agent) => agent.name === COST_RESEARCH_AGENT_NAME);
    const routerAgent = seededAgents.find((agent) => agent.name === MODEL_RESEARCH_ROUTER_AGENT_NAME);
    const aiNewsAgent = seededAgents.find((agent) => agent.name === AI_NEWS_AND_RELEASES_AGENT_NAME);

    expect(masterCeo?.isProtected).toBe(true);
    expect(masterCeo?.role).toBe("ceo");
    expect(masterCeo?.adapterConfig?.instructionsBundleMode).toBe("managed");
    expect(masterCeo?.adapterConfig?.instructionsEntryFile).toBe("AGENTS.md");
    expect(costResearchAgent?.isProtected).toBe(true);
    expect(costResearchAgent?.reportsTo).toBe(masterCeo?.id);
    expect(costResearchAgent?.adapterConfig?.instructionsBundleMode).toBe("managed");
    expect(costResearchAgent?.adapterConfig?.instructionsEntryFile).toBe("AGENTS.md");
    expect(routerAgent?.isProtected).toBe(true);
    expect(routerAgent?.permissions?.canCreateAgents).toBe(true);
    expect(routerAgent?.reportsTo).toBe(masterCeo?.id);
    expect(routerAgent?.adapterConfig?.instructionsBundleMode).toBe("managed");
    expect(routerAgent?.adapterConfig?.instructionsEntryFile).toBe("AGENTS.md");
    expect(aiNewsAgent?.isProtected).toBe(true);
    expect(aiNewsAgent?.permissions?.canCreateAgents).toBe(true);
    expect(aiNewsAgent?.reportsTo).toBe(masterCeo?.id);
    expect(aiNewsAgent?.adapterConfig?.instructionsBundleMode).toBe("managed");
    expect(aiNewsAgent?.adapterConfig?.instructionsEntryFile).toBe("AGENTS.md");

    const seededRoutine = await db
      .select()
      .from(routines)
      .where(eq(routines.assigneeAgentId, aiNewsAgent!.id))
      .then((rows) => rows[0] ?? null);
    expect(seededRoutine?.title).toBe("Daily AI News and Releases Scan");

    const seededTrigger = seededRoutine
      ? await db
        .select()
        .from(routineTriggers)
        .where(eq(routineTriggers.routineId, seededRoutine.id))
        .then((rows) => rows[0] ?? null)
      : null;
    expect(seededTrigger?.kind).toBe("schedule");
    expect(seededTrigger?.cronExpression).toBe("0 9 * * *");
    expect(seededTrigger?.timezone).toBe("UTC");
  });
});
