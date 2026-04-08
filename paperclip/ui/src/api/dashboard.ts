import type { DashboardSummary } from "@paperclipai/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (companyId: string, options?: {
    kbPolicyWindow?: "24h" | "7d" | "30d";
    kbPolicyAction?: string | null;
    kbPolicyScope?: string | null;
  }) =>
    api.get<DashboardSummary>(
      (() => {
        const params = new URLSearchParams();
        if (options?.kbPolicyWindow) params.set("kbPolicyWindow", options.kbPolicyWindow);
        if (options?.kbPolicyAction) params.set("kbPolicyAction", options.kbPolicyAction);
        if (options?.kbPolicyScope) params.set("kbPolicyScope", options.kbPolicyScope);
        const query = params.toString();
        return `/companies/${companyId}/dashboard${query ? `?${query}` : ""}`;
      })(),
    ),
};
