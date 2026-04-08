import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.js";
import {
  COST_RESEARCH_AGENT_NAME,
  ensureMasterCompanyHierarchy,
} from "../services/master-company.js";

describe("agent master reporting defaults", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-master-reports-to-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.execute(sql.raw("TRUNCATE TABLE companies RESTART IDENTITY CASCADE"));
  });

  afterAll(async () => {
    await (db as { $client?: { end?: (options?: { timeout?: number }) => Promise<unknown> } }).$client?.end?.({
      timeout: 0,
    });
    await tempDb?.cleanup();
  });

  async function createRegularCompany(name: string, issuePrefix: string) {
    const [company] = await db
      .insert(companies)
      .values({
        name,
        issuePrefix,
        companyType: "regular",
        isDeletable: true,
      })
      .returning();
    return company;
  }

  async function getMasterCeoId() {
    const row = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(companies, eq(companies.id, agents.companyId))
      .where(and(eq(companies.companyType, "master"), eq(agents.role, "ceo")))
      .then((rows) => rows[0] ?? null);
    return row?.id ?? null;
  }

  it("auto-assigns first regular company CEO to report to Master CEO", async () => {
    await ensureMasterCompanyHierarchy(db);
    const company = await createRegularCompany("Regular Company", "REGA");
    const svc = agentService(db);
    const masterCeoId = await getMasterCeoId();

    const ceo = await svc.create(company.id, {
      name: "Regular CEO",
      role: "ceo",
      adapterType: "process",
    } as any);

    expect(masterCeoId).toBeTruthy();
    expect(ceo.reportsTo).toBe(masterCeoId);
  });

  it("does not override reportsTo for subsequent CEOs in the same company", async () => {
    await ensureMasterCompanyHierarchy(db);
    const company = await createRegularCompany("Second Company", "REGB");
    const svc = agentService(db);

    const firstCeo = await svc.create(company.id, {
      name: "First CEO",
      role: "ceo",
      adapterType: "process",
    } as any);
    const secondCeo = await svc.create(company.id, {
      name: "Second CEO",
      role: "ceo",
      adapterType: "process",
    } as any);

    expect(firstCeo.reportsTo).toBeTruthy();
    expect(secondCeo.reportsTo).toBeNull();
  });

  it("allows explicit cross-company reportsTo when target manager is Master CEO", async () => {
    await ensureMasterCompanyHierarchy(db);
    const company = await createRegularCompany("Third Company", "REGC");
    const svc = agentService(db);
    const masterCeoId = await getMasterCeoId();

    const agent = await svc.create(company.id, {
      name: "Ops Agent",
      role: "general",
      adapterType: "process",
      reportsTo: masterCeoId,
    } as any);

    expect(agent.reportsTo).toBe(masterCeoId);
  });

  it("allows explicit cross-company reportsTo when target manager is in master company", async () => {
    await ensureMasterCompanyHierarchy(db);
    const company = await createRegularCompany("Fourth Company", "REGD");
    const svc = agentService(db);
    const masterManagerId = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(companies, eq(companies.id, agents.companyId))
      .where(and(eq(companies.companyType, "master"), eq(agents.name, COST_RESEARCH_AGENT_NAME)))
      .then((rows) => rows[0]?.id ?? null);

    const agent = await svc.create(company.id, {
      name: "Delivery Agent",
      role: "general",
      adapterType: "process",
      reportsTo: masterManagerId,
    } as any);

    expect(agent.reportsTo).toBe(masterManagerId);
  });

  it("keeps first regular-company CEO visible as org root even when reportsTo points to master", async () => {
    await ensureMasterCompanyHierarchy(db);
    const company = await createRegularCompany("Org Visibility Company", "REGE");
    const svc = agentService(db);

    const ceo = await svc.create(company.id, {
      name: "Visible CEO",
      role: "ceo",
      adapterType: "process",
    } as any);

    const org = await svc.orgForCompany(company.id);
    expect(org).toHaveLength(1);
    expect(org[0]?.id).toBe(ceo.id);
  });

  it("preserves CEO -> manager -> contributor layers for regular company org chart", async () => {
    await ensureMasterCompanyHierarchy(db);
    const company = await createRegularCompany("Org Layer Company", "REGF");
    const svc = agentService(db);

    const ceo = await svc.create(company.id, {
      name: "Layer CEO",
      role: "ceo",
      adapterType: "process",
    } as any);
    const manager = await svc.create(company.id, {
      name: "Layer Manager",
      role: "general",
      adapterType: "process",
      reportsTo: ceo.id,
    } as any);
    const contributor = await svc.create(company.id, {
      name: "Layer Contributor",
      role: "general",
      adapterType: "process",
      reportsTo: manager.id,
    } as any);

    const org = await svc.orgForCompany(company.id);
    expect(org).toHaveLength(1);
    expect(org[0]?.id).toBe(ceo.id);
    expect((org[0]?.reports as Array<{ id: string }>)?.[0]?.id).toBe(manager.id);
    expect(
      ((org[0]?.reports as Array<{ reports?: Array<{ id: string }> }>)[0]?.reports ?? [])[0]?.id,
    ).toBe(contributor.id);
  });
});
