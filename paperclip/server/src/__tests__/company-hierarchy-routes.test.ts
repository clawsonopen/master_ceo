import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/index.js";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockFeedbackService = vi.hoisted(() => ({
  listIssueVotesForUser: vi.fn(),
  listFeedbackTraces: vi.fn(),
  getFeedbackTraceById: vi.fn(),
  saveIssueVote: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  companyPortabilityService: () => mockCompanyPortabilityService,
  companyService: () => mockCompanyService,
  feedbackService: () => mockFeedbackService,
  logActivity: mockLogActivity,
}));

function createDbStub(masterCompanyId: string | null = "11111111-1111-4111-8111-111111111111") {
  const rows = masterCompanyId ? [{ id: masterCompanyId, companyType: "master" }] : [];
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

type TestActor =
  | {
    type: "board";
    userId: string;
    companyIds: string[];
    source: "local_implicit" | "session" | "board_key";
    isInstanceAdmin: boolean;
  }
  | {
    type: "agent";
    agentId: string;
    companyId: string;
    runId?: string | null;
  };

function createApp(options?: { actor?: TestActor; masterCompanyId?: string | null }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = options?.actor ?? {
      type: "board",
      userId: "board-user",
      companyIds: ["11111111-1111-4111-8111-111111111111"],
      source: "local_implicit",
      isInstanceAdmin: true,
    };
    next();
  });
  app.use("/api/companies", companyRoutes(createDbStub(options?.masterCompanyId) as any));
  app.use(errorHandler);
  return app;
}

describe("company hierarchy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults regular companies under the master company", async () => {
    mockCompanyService.create.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Child Co",
      companyType: "regular",
      parentCompanyId: "11111111-1111-4111-8111-111111111111",
      isDeletable: true,
      budgetMonthlyCents: 0,
    });

    const res = await request(createApp())
      .post("/api/companies")
      .send({
        name: "Child Co",
        description: "sub company",
      });

    expect(res.status).toBe(201);
    expect(mockCompanyService.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Child Co",
      companyType: "regular",
      parentCompanyId: "11111111-1111-4111-8111-111111111111",
      isDeletable: true,
    }));
  });

  it("rejects deletion of the master company", async () => {
    mockCompanyService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Master Holding Company",
      companyType: "master",
      isDeletable: false,
    });

    const res = await request(createApp()).delete("/api/companies/11111111-1111-4111-8111-111111111111");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Master company");
    expect(mockCompanyService.remove).not.toHaveBeenCalled();
  });

  it("rejects deletion when company is not archived", async () => {
    mockCompanyService.getById.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Regular Co",
      companyType: "regular",
      isDeletable: true,
      status: "active",
    });

    const res = await request(createApp()).delete("/api/companies/22222222-2222-4222-8222-222222222222");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only archived companies can be deleted");
    expect(mockCompanyService.remove).not.toHaveBeenCalled();
  });

  it("allows deletion of archived regular companies", async () => {
    mockCompanyService.getById.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Regular Co",
      companyType: "regular",
      isDeletable: true,
      status: "archived",
    });
    mockCompanyService.remove.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
    });

    const res = await request(createApp()).delete("/api/companies/22222222-2222-4222-8222-222222222222");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockCompanyService.remove).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
  });

  it("rejects archiving of the master company", async () => {
    mockCompanyService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Master Holding Company",
      companyType: "master",
      isDeletable: false,
    });

    const res = await request(createApp()).post("/api/companies/11111111-1111-4111-8111-111111111111/archive");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Master company");
    expect(mockCompanyService.archive).not.toHaveBeenCalled();
  });

  it("allows master CEO agents to create regular companies", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-master-ceo",
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "ceo",
    });
    mockCompanyService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyType: "master",
    });
    mockCompanyService.create.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Agent Child Co",
      companyType: "regular",
      parentCompanyId: "11111111-1111-4111-8111-111111111111",
      isDeletable: true,
      budgetMonthlyCents: 0,
    });

    const res = await request(createApp({
      actor: {
        type: "agent",
        agentId: "agent-master-ceo",
        companyId: "11111111-1111-4111-8111-111111111111",
      },
    }))
      .post("/api/companies")
      .send({
        name: "Agent Child Co",
      });

    expect(res.status).toBe(201);
    expect(mockCompanyService.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Agent Child Co",
      companyType: "regular",
      parentCompanyId: "11111111-1111-4111-8111-111111111111",
      isDeletable: true,
    }));
    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "agent",
      "agent-master-ceo",
      "owner",
      "active",
    );
  });

  it("rejects master company creation by master CEO agents", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-master-ceo",
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "ceo",
    });
    mockCompanyService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyType: "master",
    });

    const res = await request(createApp({
      actor: {
        type: "agent",
        agentId: "agent-master-ceo",
        companyId: "11111111-1111-4111-8111-111111111111",
      },
    }))
      .post("/api/companies")
      .send({
        name: "Not Allowed Master",
        companyType: "master",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("only create regular companies");
    expect(mockCompanyService.create).not.toHaveBeenCalled();
  });

  it("rejects regular-company CEOs from creating companies", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-regular-ceo",
      companyId: "22222222-2222-4222-8222-222222222222",
      role: "ceo",
    });
    mockCompanyService.getById.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      companyType: "regular",
    });

    const res = await request(createApp({
      actor: {
        type: "agent",
        agentId: "agent-regular-ceo",
        companyId: "22222222-2222-4222-8222-222222222222",
      },
    }))
      .post("/api/companies")
      .send({
        name: "Not Allowed Child",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("master company CEO agents");
    expect(mockCompanyService.create).not.toHaveBeenCalled();
  });
});
