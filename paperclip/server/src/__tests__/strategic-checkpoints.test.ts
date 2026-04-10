import { describe, expect, it } from "vitest";
import {
  evaluateStrategicProposal,
  resolveStrategicCheckpointMode,
  shouldApplyStrategicCheckpoint,
} from "../services/strategic-checkpoints.js";

describe("strategic checkpoints", () => {
  it("resolves explicit mode first", () => {
    expect(
      resolveStrategicCheckpointMode({
        explicitMode: "qa_gate",
        projectPolicyMode: "manual_gate",
      }),
    ).toBe("qa_gate");
  });

  it("falls back to project policy mode", () => {
    expect(
      resolveStrategicCheckpointMode({
        explicitMode: null,
        projectPolicyMode: "manual_gate",
      }),
    ).toBe("manual_gate");
  });

  it("applies only for master company ceo agents", () => {
    expect(
      shouldApplyStrategicCheckpoint({
        actorType: "agent",
        actorRole: "ceo",
        companyType: "master",
      }),
    ).toBe(true);
    expect(
      shouldApplyStrategicCheckpoint({
        actorType: "user",
        actorRole: "ceo",
        companyType: "master",
      }),
    ).toBe(false);
  });

  it("returns bounce for missing context", () => {
    const result = evaluateStrategicProposal({
      title: "Short",
      description: "tiny",
      priority: "medium",
    });
    expect(result.decision).toBe("bounce");
    expect(result.handoff.status).toBe("blocked");
  });

  it("returns escalate for high risk keywords", () => {
    const result = evaluateStrategicProposal({
      title: "Security migration review",
      description: "Need to perform production security migration with compliance impact.",
      priority: "medium",
    });
    expect(result.decision).toBe("escalate");
    expect(result.handoff.status).toBe("needs_human_decision");
  });

  it("returns approve for healthy context", () => {
    const result = evaluateStrategicProposal({
      title: "Refactor dashboard query planner",
      description: "Improve query stability and reduce cost while keeping behavior unchanged.",
      priority: "medium",
    });
    expect(result.decision).toBe("approve");
    expect(result.handoff.status).toBe("approved");
  });
});

