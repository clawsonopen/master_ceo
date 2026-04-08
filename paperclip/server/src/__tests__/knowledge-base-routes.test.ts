import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeBaseRoutes } from "../routes/knowledge-base.js";
import { errorHandler } from "../middleware/index.js";
import { shutdownKnowledgeBaseRuntime } from "../services/knowledge-base/index.js";
import { resetKbPolicyMetricsForTests } from "../services/knowledge-base/policy-audit.js";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));

type Actor =
  | {
    type: "board";
    source: "local_implicit";
    isInstanceAdmin: true;
    userId: string;
    companyIds: string[];
  }
  | {
    type: "agent";
    agentId: string;
    companyId: string;
    companyIds: string[];
  };

async function createTempKbRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kb-route-"));
}

function buildApp(actor: Actor) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor: Actor }).actor = actor;
    next();
  });
  app.use("/api", knowledgeBaseRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("knowledge base routes", () => {
  let kbRoot = "";

  beforeEach(async () => {
    kbRoot = await createTempKbRoot();
    process.env.PAPERCLIP_KNOWLEDGE_BASE_ROOT = kbRoot;
    mockAgentService.getById.mockReset();
    resetKbPolicyMetricsForTests();
  });

  afterEach(async () => {
    await shutdownKnowledgeBaseRuntime();
    await fs.rm(kbRoot, { recursive: true, force: true });
    delete process.env.PAPERCLIP_KNOWLEDGE_BASE_ROOT;
    vi.restoreAllMocks();
  });

  it("allows board to write/read/list knowledge-base files", async () => {
    const app = buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "board-user",
      companyIds: ["company-1"],
    });

    const write = await request(app)
      .post("/api/knowledge-base/write")
      .send({
        path: "Global_Holding/wiki/ops.md",
        content: "# Ops\n\nBoard-authored content.",
      });
    expect(write.status).toBe(200);
    expect(write.body.ok).toBe(true);

    const read = await request(app).get("/api/knowledge-base/read").query({ path: "Global_Holding/wiki/ops.md" });
    expect(read.status).toBe(200);
    expect(read.body.ok).toBe(true);
    expect(read.body.content).toContain("Board-authored content");

    const list = await request(app).get("/api/knowledge-base/list").query({ directory: "Global_Holding/wiki" });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.documents)).toBe(true);
    expect(list.body.documents.some((doc: { relativePath: string }) => doc.relativePath === "Global_Holding/wiki/ops.md")).toBe(true);
  });

  it("denies agent write/search when scope is not allowed", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      name: "Scoped Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });
    const app = buildApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      companyIds: ["company-1"],
    });

    const deniedWrite = await request(app)
      .post("/api/knowledge-base/write")
      .send({
        path: "Intelligence/wiki/private.md",
        content: "# Private\n\nShould fail.",
      });
    expect(deniedWrite.status).toBe(200);
    expect(deniedWrite.body.ok).toBe(false);
    expect(String(deniedWrite.body.error)).toContain("denied");

    const deniedSearch = await request(app)
      .post("/api/knowledge-base/search")
      .send({
        query: "private",
        scopes: ["intelligence"],
      });
    expect(deniedSearch.status).toBe(200);
    expect(deniedSearch.body.ok).toBe(false);
    expect(String(deniedSearch.body.error)).toContain("denied");
  });

  it("allows agent search within kb_access scopes", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-2",
      name: "Research Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });
    const boardApp = buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "board-user",
      companyIds: ["company-1"],
    });
    await request(boardApp).post("/api/knowledge-base/write").send({
      path: "Global_Holding/wiki/search-target.md",
      content: "# Target\n\nSemantic retrieval should find this policy note.",
    });

    const agentApp = buildApp({
      type: "agent",
      agentId: "agent-2",
      companyId: "company-1",
      companyIds: ["company-1"],
    });
    const search = await request(agentApp).post("/api/knowledge-base/search").send({
      query: "policy note retrieval",
      scopes: ["global"],
      limit: 5,
    });

    expect(search.status).toBe(200);
    expect(search.body.ok).toBe(true);
    expect(Array.isArray(search.body.results)).toBe(true);
    expect(search.body.results.some((result: { filePath: string }) => result.filePath === "Global_Holding/wiki/search-target.md")).toBe(true);
  });

  it("denies agent read when document scope is outside kb_access", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-read-deny",
      name: "Read Restricted Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });
    const boardApp = buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "board-user",
      companyIds: ["company-1"],
    });
    await request(boardApp).post("/api/knowledge-base/write").send({
      path: "Intelligence/wiki/secret.md",
      content: "# Secret\n\nIntelligence-only content.",
    });

    const agentApp = buildApp({
      type: "agent",
      agentId: "agent-read-deny",
      companyId: "company-1",
      companyIds: ["company-1"],
    });
    const read = await request(agentApp).get("/api/knowledge-base/read").query({ path: "Intelligence/wiki/secret.md" });
    expect(read.status).toBe(200);
    expect(read.body.ok).toBe(false);
    expect(String(read.body.error)).toContain("denied");
  });

  it("allows agent read via search scope token and filters list output by allowed scopes", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-read-list",
      name: "Scoped Reader",
      kbAccess: { read: [], write: [], search: ["companies/acme"] },
    });
    const boardApp = buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "board-user",
      companyIds: ["company-1"],
    });
    await request(boardApp).post("/api/knowledge-base/write").send({
      path: "Companies/acme/wiki/roadmap.md",
      content: "# ACME\n\nVisible to scoped reader.",
    });
    await request(boardApp).post("/api/knowledge-base/write").send({
      path: "Global_Holding/wiki/board.md",
      content: "# Board\n\nNot visible to scoped reader.",
    });

    const agentApp = buildApp({
      type: "agent",
      agentId: "agent-read-list",
      companyId: "company-1",
      companyIds: ["company-1"],
    });
    const readAllowed = await request(agentApp).get("/api/knowledge-base/read").query({ path: "Companies/acme/wiki/roadmap.md" });
    expect(readAllowed.status).toBe(200);
    expect(readAllowed.body.ok).toBe(true);
    expect(String(readAllowed.body.content)).toContain("Visible to scoped reader");

    const list = await request(agentApp).get("/api/knowledge-base/list").query({ directory: "" });
    expect(list.status).toBe(200);
    expect(list.body.ok).toBe(true);
    expect(Array.isArray(list.body.documents)).toBe(true);
    expect(list.body.documents.some((doc: { relativePath: string }) => doc.relativePath === "Companies/acme/wiki/roadmap.md")).toBe(true);
    expect(list.body.documents.some((doc: { relativePath: string }) => doc.relativePath === "Global_Holding/wiki/board.md")).toBe(false);
  });

  it("denies agent wiki-entry outside write scope", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-wiki-deny",
      name: "Wiki Restricted Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });
    const app = buildApp({
      type: "agent",
      agentId: "agent-wiki-deny",
      companyId: "company-1",
      companyIds: ["company-1"],
    });

    const create = await request(app).post("/api/knowledge-base/wiki-entry").send({
      scope: "intelligence",
      title: "Hidden Brief",
      content: "Should be denied.",
    });
    expect(create.status).toBe(200);
    expect(create.body.ok).toBe(false);
    expect(String(create.body.error)).toContain("denied");
  });

  it("allows agent wiki-entry within write scope", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-wiki-allow",
      name: "Wiki Writer Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });
    const app = buildApp({
      type: "agent",
      agentId: "agent-wiki-allow",
      companyId: "company-1",
      companyIds: ["company-1"],
    });

    const create = await request(app).post("/api/knowledge-base/wiki-entry").send({
      scope: "global",
      title: "Agent Runbook",
      content: "Scope-valid wiki entry.",
    });
    expect(create.status).toBe(200);
    expect(create.body.ok).toBe(true);

    const read = await request(app).get("/api/knowledge-base/read").query({ path: create.body.path });
    expect(read.status).toBe(200);
    expect(read.body.ok).toBe(true);
    expect(String(read.body.content)).toContain("Scope-valid wiki entry.");
  });

  it("reports knowledge-base health and benchmark payload", async () => {
    const app = buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "board-user",
      companyIds: ["company-1"],
    });
    const health = await request(app).get("/api/knowledge-base/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.stats).toBeTruthy();
    expect(health.body.vector).toBeTruthy();

    const benchmark = await request(app).post("/api/knowledge-base/benchmark").send({
      query: "knowledge base",
      iterations: 2,
      limit: 3,
    });
    expect(benchmark.status).toBe(200);
    expect(benchmark.body.ok).toBe(true);
    expect(typeof benchmark.body.benchmark.avgMs).toBe("number");
    expect(benchmark.body.benchmark.avgMs).toBeLessThan(2_000);
    expect(benchmark.body.benchmark.minMs).toBeGreaterThanOrEqual(0);
  });

  it("denies agent benchmark when no search scopes are allowed", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-3",
      name: "No Search Agent",
      kbAccess: { read: ["global"], write: ["global"], search: [] },
    });
    const app = buildApp({
      type: "agent",
      agentId: "agent-3",
      companyId: "company-1",
      companyIds: ["company-1"],
    });

    const benchmark = await request(app).post("/api/knowledge-base/benchmark").send({
      query: "knowledge base",
      scopes: ["global"],
      iterations: 2,
      limit: 3,
    });
    expect(benchmark.status).toBe(200);
    expect(benchmark.body.ok).toBe(false);
    expect(String(benchmark.body.error)).toContain("denied");
  });

  it("filters benchmark scopes for agents and returns success for allowed scopes", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-4",
      name: "Scoped Benchmark Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });
    const boardApp = buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "board-user",
      companyIds: ["company-1"],
    });
    await request(boardApp).post("/api/knowledge-base/write").send({
      path: "Global_Holding/wiki/bench-target.md",
      content: "# Bench\n\nPerformance sample content for benchmark.",
    });

    const agentApp = buildApp({
      type: "agent",
      agentId: "agent-4",
      companyId: "company-1",
      companyIds: ["company-1"],
    });

    const benchmark = await request(agentApp).post("/api/knowledge-base/benchmark").send({
      query: "performance sample",
      scopes: ["global", "intelligence"],
      iterations: 2,
      limit: 3,
    });

    expect(benchmark.status).toBe(200);
    expect(benchmark.body.ok).toBe(true);
    expect(benchmark.body.benchmark.scopes).toEqual(["global"]);
    expect(typeof benchmark.body.benchmark.avgMs).toBe("number");
  });

  it("exposes policy metrics to board and tracks allow/deny counts", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-5",
      name: "Metrics Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });

    const boardApp = buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "board-user",
      companyIds: ["company-1"],
    });
    await request(boardApp).post("/api/knowledge-base/write").send({
      path: "Global_Holding/wiki/metrics.md",
      content: "# Metrics\n\nPolicy metrics source file.",
    });

    const agentApp = buildApp({
      type: "agent",
      agentId: "agent-5",
      companyId: "company-1",
      companyIds: ["company-1"],
    });
    await request(agentApp).post("/api/knowledge-base/search").send({
      query: "metrics source",
      scopes: ["global"],
    });
    await request(agentApp).post("/api/knowledge-base/search").send({
      query: "denied path",
      scopes: ["intelligence"],
    });

    const metrics = await request(boardApp).get("/api/knowledge-base/policy-metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.body.ok).toBe(true);
    expect(metrics.body.metrics.total).toBeGreaterThanOrEqual(3);
    expect(metrics.body.metrics.allow).toBeGreaterThanOrEqual(2);
    expect(metrics.body.metrics.deny).toBeGreaterThanOrEqual(1);
    expect(metrics.body.metrics.byAction.search.deny).toBeGreaterThanOrEqual(1);
    expect(metrics.body.metrics.byActor.agent.total).toBeGreaterThanOrEqual(2);
  });

  it("denies policy metrics endpoint for agents", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-6",
      name: "Restricted Agent",
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });
    const app = buildApp({
      type: "agent",
      agentId: "agent-6",
      companyId: "company-1",
      companyIds: ["company-1"],
    });

    const metrics = await request(app).get("/api/knowledge-base/policy-metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.body.ok).toBe(false);
    expect(String(metrics.body.error)).toContain("board-only");
  });
});
