import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, agents, approvals, companies, costEvents, issues } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";

type KbPolicySnapshotDetails = {
  totals?: { total?: number; deny?: number; denyRatePercent?: number };
  byAction?: Record<string, { total?: number; allow?: number; deny?: number; denyRatePercent?: number }>;
  byScope?: Record<string, { total?: number; allow?: number; deny?: number; denyRatePercent?: number }>;
  byScopeTop?: Array<{ scope?: string; deny?: number; denyRatePercent?: number }>;
  intervalSeconds?: number;
};

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string, options?: {
      kbPolicyWindow?: "24h" | "7d" | "30d";
      kbPolicyAction?: string;
      kbPolicyScope?: string;
    }) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [{ monthSpend }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);
      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);

      const kbPolicyWindow = options?.kbPolicyWindow ?? "24h";
      const horizonMs = kbPolicyWindow === "30d"
        ? 30 * 24 * 60 * 60 * 1000
        : kbPolicyWindow === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
      const horizon = new Date(Date.now() - horizonMs);
      const policySnapshotRows = await db
        .select({
          details: activityLog.details,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            eq(activityLog.action, "kb.policy_metrics.snapshot"),
            gte(activityLog.createdAt, horizon),
          ),
        )
        .orderBy(asc(activityLog.createdAt));

      const latestPolicyDetails = (policySnapshotRows.at(-1)?.details ?? null) as KbPolicySnapshotDetails | null;
      const actionFilter = options?.kbPolicyAction?.trim();
      const scopeFilter = options?.kbPolicyScope?.trim().toLowerCase();
      const policyTrend = policySnapshotRows
        .map((row) => {
          const details = row.details as KbPolicySnapshotDetails | null;
          const actionSlice = actionFilter ? details?.byAction?.[actionFilter] : undefined;
          const scopeSlice = scopeFilter ? details?.byScope?.[scopeFilter] : undefined;
          const selectedSlice = actionSlice ?? scopeSlice;
          const denyRatePercent = selectedSlice
            ? Number(selectedSlice.denyRatePercent ?? (selectedSlice.total ? ((Number(selectedSlice.deny ?? 0) / Number(selectedSlice.total)) * 100) : 0))
            : Number(details?.totals?.denyRatePercent ?? 0);
          return {
            at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
            denyRatePercent,
          };
        })
        .slice(-24);

      const topDeniedAction = latestPolicyDetails?.byAction
        ? Object.entries(latestPolicyDetails.byAction)
          .sort((left, right) => Number(right[1]?.deny ?? 0) - Number(left[1]?.deny ?? 0))[0]?.[0] ?? null
        : null;
      const topDeniedScope = latestPolicyDetails?.byScopeTop?.[0]?.scope ?? null;
      const byAction = latestPolicyDetails?.byAction
        ? Object.entries(latestPolicyDetails.byAction).map(([action, totals]) => ({
          action,
          deny: Number(totals?.deny ?? 0),
        }))
        : [];
      const byScopeTop = (latestPolicyDetails?.byScopeTop ?? []).map((item) => ({
        scope: item.scope ?? "unknown",
        deny: Number(item.deny ?? 0),
        denyRatePercent: Number(item.denyRatePercent ?? 0),
      }));

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        kbPolicy: {
          window: kbPolicyWindow,
          filter: {
            action: actionFilter ?? null,
            scope: scopeFilter ?? null,
          },
          denyRatePercent: Number(latestPolicyDetails?.totals?.denyRatePercent ?? 0),
          intervalSeconds: Number(latestPolicyDetails?.intervalSeconds ?? 0),
          totalDecisions: Number(latestPolicyDetails?.totals?.total ?? 0),
          denyDecisions: Number(latestPolicyDetails?.totals?.deny ?? 0),
          topDeniedAction,
          topDeniedScope,
          byAction,
          byScopeTop,
          trend: policyTrend,
        },
      };
    },
  };
}
