import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getKbPolicyMetricsSnapshot,
  recordKbPolicyDecision,
  resetKbPolicyMetricsForTests,
  startKbPolicyMetricsPersistence,
  stopKbPolicyMetricsPersistence,
} from "../services/knowledge-base/policy-audit.js";

describe("knowledge base policy audit", () => {
  beforeEach(() => {
    resetKbPolicyMetricsForTests();
  });

  afterEach(async () => {
    await stopKbPolicyMetricsPersistence();
    vi.restoreAllMocks();
  });

  it("tracks company-scoped allow/deny counters in memory snapshot", () => {
    recordKbPolicyDecision({
      action: "search",
      decision: "allow",
      actor: "agent",
      companyId: "company-1",
      scope: "companies/acme",
      agentId: "agent-1",
    });
    recordKbPolicyDecision({
      action: "search",
      decision: "deny",
      actor: "agent",
      companyId: "company-1",
      reason: "no_allowed_scopes",
      agentId: "agent-1",
    });

    const snapshot = getKbPolicyMetricsSnapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.byCompany["company-1"]?.total).toBe(2);
    expect(snapshot.byCompany["company-1"]?.byAction.search.deny).toBe(1);
  });

  it("flushes periodic snapshots into db activity_log payloads on stop", async () => {
    const insertedRows: unknown[] = [];
    const dbMock = {
      insert: () => ({
        values: async (rows: unknown) => {
          if (Array.isArray(rows)) insertedRows.push(...rows);
          else insertedRows.push(rows);
        },
      }),
    } as never;

    startKbPolicyMetricsPersistence(dbMock);
    recordKbPolicyDecision({
      action: "write",
      decision: "allow",
      actor: "agent",
      companyId: "company-2",
      scope: "companies/zeno/wiki",
      agentId: "agent-2",
    });
    recordKbPolicyDecision({
      action: "write",
      decision: "deny",
      actor: "agent",
      companyId: "company-2",
      scope: "companies/zeno/wiki",
      reason: "scope_not_allowed",
      agentId: "agent-2",
    });

    await stopKbPolicyMetricsPersistence();
    expect(insertedRows.length).toBeGreaterThanOrEqual(1);
    const first = insertedRows[0] as { action?: string; details?: { kind?: string; totals?: { deny?: number } } };
    expect(first.action).toBe("kb.policy_metrics.snapshot");
    expect(first.details?.kind).toBe("kb_policy_metrics_snapshot");
    expect(Number(first.details?.totals?.deny ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

