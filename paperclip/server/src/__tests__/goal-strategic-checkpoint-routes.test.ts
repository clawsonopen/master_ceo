import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalRoutes } from "../routes/goals.js";
import { errorHandler } from "../middleware/index.js";

const mockGoalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  approve: vi.fn(),
  requestRevision: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  goalService: () => mockGoalService,
  companyService: () => mockCompanyService,
  agentService: () => mockAgentService,
  approvalService: () => mockApprovalService,
  logActivity: mockLogActivity,
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: () => null,
}));

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", goalRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("goal strategic checkpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoalService.create.mockResolvedValue({
      id: "goal-1",
      companyId: "company-1",
      title: "Refactor goal",
      level: "task",
      status: "planned",
    });
    mockCompanyService.getById.mockResolvedValue({
      id: "company-1",
      companyType: "master",
    });
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      role: "ceo",
    });
    mockApprovalService.create.mockResolvedValue({
      id: "approval-1",
      type: "approve_ceo_strategy",
      status: "pending",
    });
    mockApprovalService.approve.mockResolvedValue({});
    mockApprovalService.requestRevision.mockResolvedValue({});
  });

  it("queues manual gate instead of creating goal immediately", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "agent-1",
      companyId: "company-1",
      companyIds: ["company-1"],
      runId: null,
    });

    const res = await request(app)
      .post("/api/companies/company-1/goals")
      .send({
        title: "Launch strategic shift",
        description: "Plan major shift with cross-company impact and governance constraints.",
        strategicCheckpoint: { mode: "manual_gate" },
      });

    expect(res.status).toBe(202);
    expect(res.body.queuedForApproval).toBe(true);
    expect(res.body.gateMode).toBe("manual_gate");
    expect(mockGoalService.create).not.toHaveBeenCalled();
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
  });

  it("bounces in qa gate for insufficient context", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "agent-1",
      companyId: "company-1",
      companyIds: ["company-1"],
      runId: null,
    });

    const res = await request(app)
      .post("/api/companies/company-1/goals")
      .send({
        title: "Short",
        description: "tiny",
        strategicCheckpoint: { mode: "qa_gate" },
      });

    expect(res.status).toBe(202);
    expect(res.body.gateDecision).toBe("bounce");
    expect(mockApprovalService.requestRevision).toHaveBeenCalledTimes(1);
    expect(mockGoalService.create).not.toHaveBeenCalled();
  });

  it("auto passes in qa gate for healthy context", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "agent-1",
      companyId: "company-1",
      companyIds: ["company-1"],
      runId: null,
    });

    const res = await request(app)
      .post("/api/companies/company-1/goals")
      .send({
        title: "Improve planning cadence",
        description: "Define weekly planning protocol, decision checkpoints, and measurable follow-up actions.",
        strategicCheckpoint: { mode: "qa_gate" },
      });

    expect(res.status).toBe(201);
    expect(mockApprovalService.approve).toHaveBeenCalledTimes(1);
    expect(mockGoalService.create).toHaveBeenCalledTimes(1);
  });
});

