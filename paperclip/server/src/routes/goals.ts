import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createGoalSchema, updateGoalSchema } from "@paperclipai/shared";
import { trackGoalCreated } from "@paperclipai/shared/telemetry";
import { validate } from "../middleware/validate.js";
import { agentService, approvalService, companyService, goalService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { getTelemetryClient } from "../telemetry.js";
import {
  evaluateStrategicProposal,
  resolveStrategicCheckpointMode,
  shouldApplyStrategicCheckpoint,
} from "../services/strategic-checkpoints.js";

export function goalRoutes(db: Db) {
  const router = Router();
  const svc = goalService(db);
  const companiesSvc = companyService(db);
  const agentsSvc = agentService(db);
  const approvalsSvc = approvalService(db);

  router.get("/companies/:companyId/goals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  router.get("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const goal = await svc.getById(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, goal.companyId);
    res.json(goal);
  });

  router.post("/companies/:companyId/goals", validate(createGoalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    const {
      strategicCheckpoint: checkpointConfigRaw,
      ...goalInput
    } = req.body as typeof req.body & { strategicCheckpoint?: unknown };
    const checkpointConfig = (checkpointConfigRaw ?? null) as
      | { mode?: string | null; note?: string | null; workflowId?: string | null }
      | null;

    const [company, actorAgent] = await Promise.all([
      companiesSvc.getById(companyId),
      actor.agentId ? agentsSvc.getById(actor.agentId) : Promise.resolve(null),
    ]);
    const applyCheckpoint = shouldApplyStrategicCheckpoint({
      actorType: actor.actorType === "agent" ? "agent" : "user",
      actorRole: actorAgent?.role ?? null,
      companyType: company?.companyType ?? null,
    });
    const checkpointMode = applyCheckpoint
      ? resolveStrategicCheckpointMode({ explicitMode: checkpointConfig?.mode ?? null })
      : "auto_pass";

    if (applyCheckpoint && checkpointMode !== "auto_pass") {
      const qaResult = checkpointMode === "qa_gate"
        ? evaluateStrategicProposal({
          title: String(req.body.title ?? ""),
          description: typeof req.body.description === "string" ? req.body.description : null,
          priority: null,
        })
        : null;
      const payload = {
        entityType: "goal",
        mode: checkpointMode,
        requestedPayload: goalInput,
        note: checkpointConfig?.note ?? null,
        workflowId: checkpointConfig?.workflowId ?? null,
        handoff:
          qaResult?.handoff
          ?? {
            schema: "paperclip.strategic_handoff.v1",
            status: "needs_human_decision",
            reason_code: "manual_gate",
            summary: "Manual strategic checkpoint requires Master CEO review.",
            checks: [],
          },
      } as Record<string, unknown>;
      const approval = await approvalsSvc.create(companyId, {
        type: "approve_ceo_strategy",
        requestedByAgentId: actor.agentId ?? null,
        payload,
      });

      if (checkpointMode === "qa_gate" && qaResult) {
        if (qaResult.decision === "approve") {
          await approvalsSvc.approve(approval.id, "qa-devils-advocate", qaResult.summary);
        } else if (qaResult.decision === "bounce") {
          await approvalsSvc.requestRevision(approval.id, "qa-devils-advocate", qaResult.summary);
          res.status(202).json({
            ok: false,
            queuedForApproval: true,
            gateMode: checkpointMode,
            gateDecision: qaResult.decision,
            approval,
            handoff: qaResult.handoff,
          });
          return;
        } else {
          res.status(202).json({
            ok: true,
            queuedForApproval: true,
            gateMode: checkpointMode,
            gateDecision: qaResult.decision,
            approval,
            handoff: qaResult.handoff,
          });
          return;
        }
      } else {
        res.status(202).json({
          ok: true,
          queuedForApproval: true,
          gateMode: checkpointMode,
          gateDecision: "escalate",
          approval,
          handoff: payload.handoff,
        });
        return;
      }
    }

    const goal = await svc.create(companyId, goalInput);

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.created",
      entityType: "goal",
      entityId: goal.id,
      details: { title: goal.title },
    });
    const telemetryClient = getTelemetryClient();
    if (telemetryClient) {
      trackGoalCreated(telemetryClient, { goalLevel: goal.level });
    }
    res.status(201).json(goal);
  });

  router.patch("/goals/:id", validate(updateGoalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const goal = await svc.update(id, req.body);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.updated",
      entityType: "goal",
      entityId: goal.id,
      details: req.body,
    });

    res.json(goal);
  });

  router.delete("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const goal = await svc.remove(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.deleted",
      entityType: "goal",
      entityId: goal.id,
    });

    res.json(goal);
  });

  return router;
}
