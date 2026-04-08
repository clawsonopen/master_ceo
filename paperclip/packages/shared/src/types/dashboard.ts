export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  kbPolicy?: {
    window: "24h" | "7d" | "30d";
    filter: {
      action: string | null;
      scope: string | null;
    };
    denyRatePercent: number;
    intervalSeconds: number;
    totalDecisions: number;
    denyDecisions: number;
    topDeniedAction: string | null;
    topDeniedScope: string | null;
    byAction: Array<{
      action: string;
      deny: number;
    }>;
    byScopeTop: Array<{
      scope: string;
      deny: number;
      denyRatePercent: number;
    }>;
    trend: Array<{
      at: string;
      denyRatePercent: number;
    }>;
  };
}
