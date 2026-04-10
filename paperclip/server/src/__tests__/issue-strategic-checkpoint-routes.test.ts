import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  approve: vi.fn(),
  requestRevision: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
  }),
  agentService: () => mockAgentService,
  approvalService: () => mockApprovalService,
  companyService: () => mockCompanyService,
  documentService: () => ({
    getIssueDocumentPayload: vi.fn(async () => ({})),
  }),
  executionWorkspaceService: () => ({
    getById: vi.fn(),
  }),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({
    getById: vi.fn(),
    getDefaultCompanyGoal: vi.fn(),
  }),
  heartbeatService: () => ({
    getRun: vi.fn(),
    getActiveRunForAgent: vi.fn(),
    wakeup: vi.fn(),
    reportRunActivity: vi.fn(),
  }),
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    })),
    listCompanyIds: vi.fn(async () => ["company-1"]),
  }),
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => mockProjectService,
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({
    listForIssue: vi.fn(async () => []),
  }),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue strategic checkpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.create.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1200",
      title: "Strategic issue",
      status: "backlog",
      priority: "medium",
      projectId: null,
      goalId: null,
      parentId: null,
      assigneeAgentId: null,
      assigneeUserId: null,
    });
    mockCompanyService.getById.mockResolvedValue({
      id: "company-1",
      companyType: "master",
      status: "active",
    });
    mockAgentService.getById.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      role: "ceo",
      companyId: "company-1",
    });
    mockProjectService.getById.mockResolvedValue(null);
    mockApprovalService.create.mockResolvedValue({
      id: "approval-1",
      type: "approve_ceo_strategy",
      status: "pending",
    });
    mockApprovalService.approve.mockResolvedValue({});
    mockApprovalService.requestRevision.mockResolvedValue({});
  });

  it("queues manual gate instead of creating issue", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "22222222-2222-4222-8222-222222222222",
      companyId: "company-1",
      companyIds: ["company-1"],
      runId: null,
    });

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Strategic shift issue",
        description: "Needs master-level approval before execution in this workflow.",
        strategicCheckpoint: { mode: "manual_gate" },
      });

    expect(res.status).toBe(202);
    expect(res.body.queuedForApproval).toBe(true);
    expect(res.body.gateMode).toBe("manual_gate");
    expect(mockIssueService.create).not.toHaveBeenCalled();
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
  });

  it("creates issue when qa gate approves", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "22222222-2222-4222-8222-222222222222",
      companyId: "company-1",
      companyIds: ["company-1"],
      runId: null,
    });

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Improve strategic planning quality",
        description: "Define clear milestones, measurable outcomes, and weekly execution checkpoints for teams.",
        strategicCheckpoint: { mode: "qa_gate" },
      });

    expect(res.status).toBe(201);
    expect(mockApprovalService.approve).toHaveBeenCalledTimes(1);
    expect(mockIssueService.create).toHaveBeenCalledTimes(1);
    expect(mockIssueApprovalService.linkManyForApproval).toHaveBeenCalledTimes(1);
  });
});
