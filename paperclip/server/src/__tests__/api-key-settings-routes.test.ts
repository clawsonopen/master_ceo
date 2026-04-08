import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { apiKeySettingsRoutes } from "../routes/api-key-settings.js";

const mockApiKeyService = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  getValue: vi.fn(),
  listResolvedForRuntime: vi.fn(),
  listProviderCatalog: vi.fn(),
  recommendRouterAssignment: vi.fn(),
  remove: vi.fn(),
  listCompanyIds: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockProviderDiscoveryService = vi.hoisted(() => ({
  list: vi.fn(),
  discover: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("../services/api-keys.js", () => ({
  apiKeyService: () => mockApiKeyService,
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));

vi.mock("../services/provider-discovery.js", () => ({
  providerDiscoveryService: () => mockProviderDiscoveryService,
}));

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
}));

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  const dbMock = {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              companyType: "master",
            },
          ]),
      }),
    }),
  };
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", apiKeySettingsRoutes(dbMock as any));
  app.use(errorHandler);
  return app;
}

describe("api key settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiKeyService.list.mockResolvedValue([
      {
        provider: "openai",
        maskedKey: "****1234",
        isValid: false,
        lastTestedAt: null,
        updatedAt: new Date("2026-04-07T00:00:00.000Z"),
      },
    ]);
    mockApiKeyService.save.mockResolvedValue({
      provider: "openai",
      maskedKey: "****1234",
      helpUrl: null,
      testUrl: null,
      testAuthHeader: null,
      testAuthPrefix: null,
      isValid: false,
      lastTestedAt: null,
      updatedAt: new Date("2026-04-07T00:00:00.000Z"),
    });
    mockApiKeyService.test.mockResolvedValue({
      ok: true,
      status: 200,
      message: "Connection succeeded",
    });
    mockApiKeyService.getValue.mockResolvedValue({
      provider: "openai",
      key: "sk-test-1234",
    });
    mockApiKeyService.listResolvedForRuntime.mockResolvedValue([
      { provider: "openai", key: "sk-test-1234", isValid: false, lastTestedAt: null },
    ]);
    mockApiKeyService.listProviderCatalog.mockResolvedValue([
      { provider: "openai", models: ["gpt-4.1"] },
    ]);
    mockApiKeyService.recommendRouterAssignment.mockResolvedValue({
      provider: "openai",
      model: "gpt-4.1",
      reason: "test",
      confidence: 0.9,
    });
    mockApiKeyService.remove.mockResolvedValue(true);
    mockApiKeyService.listCompanyIds.mockResolvedValue(["company-1", "company-2"]);
    mockProviderDiscoveryService.list.mockResolvedValue([]);
    mockProviderDiscoveryService.discover.mockResolvedValue({
      id: "4f7f5f20-b58e-4180-b7d8-4e52feec9c67",
      provider: "groq",
      status: "suggested",
      docsUrl: "https://console.groq.com/docs",
      apiReferenceUrl: "https://console.groq.com/docs/api-reference",
      testUrl: "https://api.groq.com/openai/v1/models",
      modelListUrl: "https://api.groq.com/openai/v1/models",
      authMode: "bearer_header",
      authHeader: "Authorization",
      authPrefix: "Bearer",
      confidence: "high",
      discoveryNotes: "Known Groq mapping.",
      sourceEvidence: [],
      discoveredBy: "agent-1",
      publishedAt: null,
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
      updatedAt: new Date("2026-04-08T00:00:00.000Z"),
    });
    mockProviderDiscoveryService.publish.mockResolvedValue({
      id: "4f7f5f20-b58e-4180-b7d8-4e52feec9c67",
      provider: "groq",
      status: "published",
      docsUrl: "https://console.groq.com/docs",
      apiReferenceUrl: "https://console.groq.com/docs/api-reference",
      testUrl: "https://api.groq.com/openai/v1/models",
      modelListUrl: "https://api.groq.com/openai/v1/models",
      authMode: "bearer_header",
      authHeader: "Authorization",
      authPrefix: "Bearer",
      confidence: "high",
      discoveryNotes: "Known Groq mapping.",
      sourceEvidence: [],
      discoveredBy: "agent-1",
      publishedAt: new Date("2026-04-08T00:00:00.000Z"),
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
      updatedAt: new Date("2026-04-08T00:00:00.000Z"),
    });
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      role: "ceo",
      permissions: { canCreateAgents: true },
    });
  });

  it("lists keys for board users", async () => {
    const app = createApp({
      type: "board",
      source: "local_implicit",
      userId: "local-board",
      isInstanceAdmin: true,
    });

    const res = await request(app).get("/api/settings/api-keys");
    expect(res.status).toBe(200);
    expect(mockApiKeyService.list).toHaveBeenCalled();
  });

  it("saves key for instance admins", async () => {
    const app = createApp({
      type: "board",
      source: "local_implicit",
      userId: "local-board",
      isInstanceAdmin: true,
    });

    const res = await request(app)
      .post("/api/settings/api-keys")
      .send({ provider: "openai", key: "sk-test-1234" });

    expect(res.status).toBe(201);
    expect(mockApiKeyService.save).toHaveBeenCalledWith({
      provider: "openai",
      key: "sk-test-1234",
      helpUrl: null,
      testUrl: null,
      testAuthHeader: null,
      testAuthPrefix: null,
    }, "local-board");
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
  });

  it("tests and deletes key for instance admins", async () => {
    const app = createApp({
      type: "board",
      source: "local_implicit",
      userId: "local-board",
      isInstanceAdmin: true,
    });

    const testRes = await request(app).post("/api/settings/api-keys/openai/test");
    expect(testRes.status).toBe(200);
    expect(mockApiKeyService.test).toHaveBeenCalledWith("openai");

    const delRes = await request(app).delete("/api/settings/api-keys/openai");
    expect(delRes.status).toBe(200);
    expect(mockApiKeyService.remove).toHaveBeenCalledWith("openai");
  });

  it("returns decrypted value for instance admins", async () => {
    const app = createApp({
      type: "board",
      source: "local_implicit",
      userId: "local-board",
      isInstanceAdmin: true,
    });

    const res = await request(app).get("/api/settings/api-keys/openai/value");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: "openai", key: "sk-test-1234" });
    expect(mockApiKeyService.getValue).toHaveBeenCalledWith("openai");
  });

  it("returns runtime credentials for ceo agents", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "agent-1",
      companyId: "company-1",
    });

    const res = await request(app).get("/api/settings/api-keys/runtime/credentials");
    expect(res.status).toBe(200);
    expect(mockApiKeyService.listResolvedForRuntime).toHaveBeenCalled();
  });

  it("returns provider catalog and recommendation for ceo agents", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "agent-1",
      companyId: "company-1",
    });

    const catalogRes = await request(app).get("/api/settings/router-agent/catalog");
    expect(catalogRes.status).toBe(200);
    expect(mockApiKeyService.listProviderCatalog).toHaveBeenCalled();

    const recRes = await request(app)
      .post("/api/settings/router-agent/recommendation")
      .send({ taskSummary: "Write code", preference: "quality" });
    expect(recRes.status).toBe(200);
    expect(mockApiKeyService.recommendRouterAssignment).toHaveBeenCalledWith({
      taskSummary: "Write code",
      preference: "quality",
    });
  });

  it("supports provider discovery suggestion flow", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "agent-1",
      companyId: "company-1",
    });

    const listRes = await request(app).get("/api/settings/router-agent/provider-discovery/suggestions");
    expect(listRes.status).toBe(200);
    expect(mockProviderDiscoveryService.list).toHaveBeenCalledWith(undefined);

    const discoverRes = await request(app)
      .post("/api/settings/router-agent/provider-discovery/discover")
      .send({ provider: "groq", seedUrl: "https://console.groq.com/docs/api-reference" });
    expect(discoverRes.status).toBe(201);
    expect(mockProviderDiscoveryService.discover).toHaveBeenCalledWith({
      provider: "groq",
      seedUrl: "https://console.groq.com/docs/api-reference",
      discoveredBy: "agent-1",
    });
  });

  it("allows instance admins to publish provider discovery suggestions", async () => {
    const app = createApp({
      type: "board",
      source: "local_implicit",
      userId: "local-board",
      isInstanceAdmin: true,
    });

    const res = await request(app)
      .post("/api/settings/router-agent/provider-discovery/4f7f5f20-b58e-4180-b7d8-4e52feec9c67/publish");
    expect(res.status).toBe(200);
    expect(mockProviderDiscoveryService.publish).toHaveBeenCalledWith(
      "4f7f5f20-b58e-4180-b7d8-4e52feec9c67",
    );
  });

  it("rejects non-admin board mutations", async () => {
    const app = createApp({
      type: "board",
      source: "session",
      userId: "board-user",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app)
      .post("/api/settings/api-keys")
      .send({ provider: "openai", key: "sk-test-1234" });

    expect(res.status).toBe(403);
    expect(mockApiKeyService.save).not.toHaveBeenCalled();
  });
});
