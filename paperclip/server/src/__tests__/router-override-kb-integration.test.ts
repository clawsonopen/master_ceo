import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeys, companies, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { apiKeySettingsRoutes } from "../routes/api-key-settings.js";
import { errorHandler } from "../middleware/index.js";
import { apiKeyService } from "../services/api-keys.js";
import { shutdownKnowledgeBaseRuntime } from "../services/knowledge-base/index.js";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));
vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
}));

describe("router override KB integration", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let kbRoot = "";
  let companyId = "";

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "agent",
        source: "agent_key",
        agentId: "agent-1",
        companyId,
        companyIds: [companyId],
        runId: null,
      } as typeof req.actor;
      next();
    });
    app.use("/api", apiKeySettingsRoutes(db));
    app.use(errorHandler);
    return app;
  }

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-router-override-kb-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(async () => {
    kbRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-router-kb-"));
    process.env.PAPERCLIP_KNOWLEDGE_BASE_ROOT = kbRoot;
    process.env.PAPERCLIP_KB_DISABLE_REMOTE_EMBEDDINGS = "true";

    const [company] = await db
      .insert(companies)
      .values({
        name: "Master Test Company",
        issuePrefix: `RT${Date.now().toString().slice(-5)}`,
        companyType: "master",
        requireBoardApprovalForNewAgents: false,
      })
      .returning({ id: companies.id });
    companyId = company.id;

    await apiKeyService(db).save({
      provider: "openai",
      key: "sk-test-router-override",
    });

    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId,
      role: "ceo",
      permissions: { canCreateAgents: true },
    });
  });

  afterEach(async () => {
    await shutdownKnowledgeBaseRuntime();
    await db.delete(apiKeys);
    await db.delete(companies);
    await fs.rm(kbRoot, { recursive: true, force: true });
    delete process.env.PAPERCLIP_KNOWLEDGE_BASE_ROOT;
    delete process.env.PAPERCLIP_KB_DISABLE_REMOTE_EMBEDDINGS;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await (db as { $client?: { end?: (options?: { timeout?: number }) => Promise<unknown> } }).$client?.end?.({
      timeout: 0,
    });
    await tempDb?.cleanup();
  });

  it("writes router decision report and index entry into KB", async () => {
    const app = buildApp();
    await expect(
      apiKeyService(db).recommendRouterAssignment({ taskSummary: "sanity", preference: "balanced" }),
    ).resolves.toBeTruthy();
    const res = await request(app)
      .post("/api/settings/router-agent/override")
      .send({
        companyId,
        taskSummary: "High quality architecture review",
        preference: "quality",
        selectedProvider: "openai",
        selectedModel: "gpt-4.1",
        rationale: "Master CEO strategic override for quality.",
        expandColumns: ["compliance_notes"],
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.final_decision_by).toBe("master_ceo");
    expect(typeof res.body.report_path).toBe("string");

    const reportPath = String(res.body.report_path);
    const absoluteReportPath = path.resolve(kbRoot, reportPath);
    const reportContent = await fs.readFile(absoluteReportPath, "utf8");
    expect(reportContent).toContain("Router Decision Report");
    expect(reportContent).toContain("Selected: openai / gpt-4.1");

    const indexPath = path.resolve(kbRoot, "Global_Holding/wiki/router_decisions/index.md");
    const indexContent = await fs.readFile(indexPath, "utf8");
    expect(indexContent).toContain(reportPath);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });
});
