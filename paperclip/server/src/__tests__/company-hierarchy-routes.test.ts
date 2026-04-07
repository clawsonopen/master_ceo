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

function createDbStub(masterCompanyId = "11111111-1111-4111-8111-111111111111") {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: masterCompanyId, companyType: "master" }]),
      }),
    }),
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      companyIds: ["11111111-1111-4111-8111-111111111111"],
      source: "local_implicit",
      isInstanceAdmin: true,
    };
    next();
  });
  app.use("/api/companies", companyRoutes(createDbStub() as any));
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
});
