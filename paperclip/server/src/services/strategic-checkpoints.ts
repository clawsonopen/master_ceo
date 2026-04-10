export const STRATEGIC_CHECKPOINT_MODES = ["auto_pass", "manual_gate", "qa_gate"] as const;
export type StrategicCheckpointMode = (typeof STRATEGIC_CHECKPOINT_MODES)[number];

export type StrategicCheckpointDecision = "approve" | "bounce" | "escalate";

export type StrategicCheckpointResult = {
  decision: StrategicCheckpointDecision;
  reasonCode: string;
  summary: string;
  handoff: {
    schema: "paperclip.strategic_handoff.v1";
    status: "approved" | "blocked" | "needs_human_decision";
    reason_code: string;
    summary: string;
    checks: Array<{ code: string; ok: boolean; detail?: string }>;
  };
};

function parseMode(value: unknown): StrategicCheckpointMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto_pass" || normalized === "manual_gate" || normalized === "qa_gate") {
    return normalized;
  }
  return null;
}

export function resolveStrategicCheckpointMode(input: {
  explicitMode?: string | null;
  projectPolicyMode?: string | null;
}): StrategicCheckpointMode {
  const explicit = parseMode(input.explicitMode);
  if (explicit) return explicit;
  const projectPolicy = parseMode(input.projectPolicyMode);
  if (projectPolicy) return projectPolicy;
  const envMode = parseMode(process.env.PAPERCLIP_STRATEGIC_CHECKPOINT_DEFAULT_MODE);
  return envMode ?? "auto_pass";
}

export function shouldApplyStrategicCheckpoint(input: {
  actorType: "agent" | "user";
  actorRole?: string | null;
  companyType?: string | null;
}): boolean {
  if (input.actorType !== "agent") return false;
  if ((input.companyType ?? "").toLowerCase() !== "master") return false;
  return input.actorRole === "ceo";
}

function buildHandoff(
  status: "approved" | "blocked" | "needs_human_decision",
  reasonCode: string,
  summary: string,
  checks: Array<{ code: string; ok: boolean; detail?: string }>,
): StrategicCheckpointResult["handoff"] {
  return {
    schema: "paperclip.strategic_handoff.v1",
    status,
    reason_code: reasonCode,
    summary,
    checks,
  };
}

export function evaluateStrategicProposal(input: {
  title: string;
  description?: string | null;
  priority?: string | null;
}): StrategicCheckpointResult {
  const title = input.title.trim();
  const description = (input.description ?? "").trim();
  const priority = (input.priority ?? "").trim().toLowerCase();
  const checks: Array<{ code: string; ok: boolean; detail?: string }> = [];

  const hasMinTitle = title.length >= 8;
  checks.push({
    code: "title_min_length",
    ok: hasMinTitle,
    detail: hasMinTitle ? undefined : "Title should be at least 8 characters.",
  });
  const hasDescription = description.length >= 20;
  checks.push({
    code: "description_min_context",
    ok: hasDescription,
    detail: hasDescription ? undefined : "Description should include enough context (20+ chars).",
  });

  if (!hasMinTitle || !hasDescription) {
    const summary = "Plan is missing enough context for safe execution. Please revise and resubmit.";
    return {
      decision: "bounce",
      reasonCode: "insufficient_context",
      summary,
      handoff: buildHandoff("blocked", "insufficient_context", summary, checks),
    };
  }

  const riskKeywords = ["security", "legal", "compliance", "migration", "production outage"];
  const combined = `${title.toLowerCase()} ${description.toLowerCase()}`;
  const matchedRisk = riskKeywords.find((keyword) => combined.includes(keyword));
  if (matchedRisk || priority === "high") {
    const summary = matchedRisk
      ? `Plan touches "${matchedRisk}" and should be explicitly approved by Master CEO.`
      : "High-priority strategic task requires explicit human confirmation.";
    checks.push({ code: "high_risk_or_priority", ok: false, detail: summary });
    return {
      decision: "escalate",
      reasonCode: "human_decision_required",
      summary,
      handoff: buildHandoff("needs_human_decision", "human_decision_required", summary, checks),
    };
  }

  const summary = "Plan passed QA gate and can proceed to execution.";
  checks.push({ code: "qa_gate_passed", ok: true });
  return {
    decision: "approve",
    reasonCode: "qa_passed",
    summary,
    handoff: buildHandoff("approved", "qa_passed", summary, checks),
  };
}
