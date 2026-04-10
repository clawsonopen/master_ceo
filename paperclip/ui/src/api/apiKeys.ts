import { api } from "./client";

export type ApiKeyProvider = string;

export interface ApiKeyListItem {
  provider: ApiKeyProvider;
  maskedKey: string;
  helpUrl: string | null;
  testUrl: string | null;
  testAuthHeader: string | null;
  testAuthPrefix: string | null;
  isValid: boolean;
  lastTestedAt: string | null;
  updatedAt: string;
}

export interface ApiKeyTestResult {
  ok: boolean;
  status: number | null;
  message: string;
}

export interface RouterProviderCatalogEntry {
  provider: string;
  models: string[];
}

export interface RouterRecommendation {
  provider: string;
  model: string;
  reason: string;
  confidence: number;
  decision_mode?: "advisory";
  final_decision_by?: "master_ceo";
  suggested_model?: { provider: string; model: string };
  selected_model?: { provider: string; model: string } | null;
  alternatives?: Array<{ provider: string; model: string; reason: string }>;
  table_columns?: string[];
  candidate_table?: Array<Record<string, string | number | boolean | null>>;
}

export interface ProviderDiscoverySuggestion {
  id: string;
  provider: string;
  status: "suggested" | "published" | "rejected";
  docsUrl: string | null;
  apiReferenceUrl: string | null;
  testUrl: string | null;
  modelListUrl: string | null;
  authMode: string | null;
  authHeader: string | null;
  authPrefix: string | null;
  confidence: "low" | "medium" | "high";
  discoveryNotes: string | null;
  sourceEvidence: Array<{
    url: string;
    note?: string;
    confidenceDelta?: number;
    matchedText?: string;
    evidenceType?: "crawl" | "auth" | "endpoint" | "heuristic" | "known_mapping" | "validation";
  }>;
  discoveredBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const apiKeysApi = {
  list: () => api.get<ApiKeyListItem[]>("/settings/api-keys"),
  save: (input: {
    provider: ApiKeyProvider;
    key: string;
    helpUrl?: string | null;
    testUrl?: string | null;
    testAuthHeader?: string | null;
    testAuthPrefix?: string | null;
  }) =>
    api.post<ApiKeyListItem>("/settings/api-keys", input),
  test: (provider: ApiKeyProvider) =>
    api.post<ApiKeyTestResult>(`/settings/api-keys/${provider}/test`, {}),
  getValue: (provider: ApiKeyProvider) =>
    api.get<{ provider: string; key: string }>(`/settings/api-keys/${provider}/value`),
  routerCatalog: () =>
    api.get<RouterProviderCatalogEntry[]>("/settings/router-agent/catalog"),
  routerRecommendation: (input: {
    taskSummary?: string | null;
    preference?: "balanced" | "quality" | "speed" | "cost";
    expandColumns?: string[];
  }) =>
    api.post<RouterRecommendation>("/settings/router-agent/recommendation", input),
  routerOverride: (input: {
    companyId?: string | null;
    taskSummary?: string | null;
    preference?: "balanced" | "quality" | "speed" | "cost";
    expandColumns?: string[];
    selectedProvider: string;
    selectedModel: string;
    rationale?: string | null;
  }) =>
    api.post<{
      ok: boolean;
      final_decision_by: "master_ceo";
      selected_model: { provider: string; model: string };
      suggested_model: { provider: string; model: string };
      rationale: string | null;
      report_path: string | null;
      recommendation: RouterRecommendation;
    }>("/settings/router-agent/override", input),
  listProviderDiscoverySuggestions: (provider?: string) =>
    api.get<ProviderDiscoverySuggestion[]>(
      provider
        ? `/settings/router-agent/provider-discovery/suggestions?provider=${encodeURIComponent(provider)}`
        : "/settings/router-agent/provider-discovery/suggestions",
    ),
  discoverProviderMetadata: (input: { provider: string; seedUrl?: string | null }) =>
    api.post<ProviderDiscoverySuggestion>("/settings/router-agent/provider-discovery/discover", input),
  publishProviderDiscoverySuggestion: (id: string) =>
    api.post<ProviderDiscoverySuggestion>(`/settings/router-agent/provider-discovery/${id}/publish`, {}),
  remove: (provider: ApiKeyProvider) =>
    api.delete<{ ok: boolean }>(`/settings/api-keys/${provider}`),
};
