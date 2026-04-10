import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { apiKeys, companies, costEvents, heartbeatRuns } from "@paperclipai/db";
import { badRequest } from "../errors.js";
import { decryptApiKey, encryptApiKey, maskApiKey } from "../crypto/api-key-crypto.js";

export const API_KEY_PROVIDERS = [
  "gemini",
  "openrouter",
  "groq",
  "cerebras",
  "mistral",
  "github_models",
  "nvidia_nim",
  "openai",
  "anthropic",
] as const;

export type ApiKeyProvider = string;

type ProviderTestResult = {
  ok: boolean;
  status: number | null;
  message: string;
};

type ProviderModelCatalogEntry = {
  provider: string;
  models: string[];
};

type RouterRecommendationInput = {
  taskSummary?: string | null;
  preference?: "balanced" | "quality" | "speed" | "cost";
  expandColumns?: string[] | null;
};

type RouterPreference = NonNullable<RouterRecommendationInput["preference"]>;

type RouterRecommendationAlternative = {
  provider: string;
  model: string;
  reason: string;
};

type RouterRecommendationCandidateRow = Record<string, string | number | boolean | null>;

type ProviderRuntimeMetric = {
  provider: string;
  model: string;
  sampleRuns: number;
  totalCostCents: number;
  inputTokens: number;
  outputTokens: number;
  avgRunMs: number;
};

type RouterRecommendation = {
  // Legacy fields retained for compatibility with existing UI call sites.
  provider: string;
  model: string;
  reason: string;
  confidence: number;
  // Advisory-mode fields.
  decision_mode: "advisory";
  final_decision_by: "master_ceo";
  suggested_model: { provider: string; model: string };
  selected_model: { provider: string; model: string } | null;
  alternatives: RouterRecommendationAlternative[];
  table_columns: string[];
  candidate_table: RouterRecommendationCandidateRow[];
};

type ApiKeyListItem = {
  provider: string;
  maskedKey: string;
  helpUrl: string | null;
  testUrl: string | null;
  testAuthHeader: string | null;
  testAuthPrefix: string | null;
  isValid: boolean;
  lastTestedAt: Date | null;
  updatedAt: Date;
};

type SaveApiKeyInput = {
  provider: string;
  key: string;
  helpUrl?: string | null;
  testUrl?: string | null;
  testAuthHeader?: string | null;
  testAuthPrefix?: string | null;
};

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) {
    throw badRequest("Provider is required");
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
    throw badRequest("Provider must be 2-64 chars and contain only a-z, 0-9, _ or -");
  }
  return normalized;
}

function normalizeUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      throw new Error("Only https URLs are supported");
    }
    return parsed.toString();
  } catch {
    throw badRequest("URL must be a valid https:// address");
  }
}

function normalizeHeaderName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(trimmed)) {
    throw badRequest("Header name must contain only letters, numbers, and hyphen");
  }
  return trimmed;
}

const KNOWN_PROVIDER_MODELS: Record<string, string[]> = {
  openrouter: ["openrouter/auto", "openrouter/qwen-3.6-plus", "openrouter/hermes-3-405b"],
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o"],
  anthropic: ["claude-sonnet-4.6", "claude-opus-4.6"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  groq: ["llama-3.3-70b", "qwen3-32b"],
  cerebras: ["qwen3-32b", "llama-3.3-70b"],
  mistral: ["mistral-large", "codestral-latest"],
  github_models: ["openai/gpt-4.1", "openai/o3"],
  nvidia_nim: ["deepseek-r1", "llama-3.3-70b"],
};

const DEFAULT_ROUTER_TABLE_COLUMNS = [
  "provider",
  "model_id",
  "task_fit_score",
  "input_modality_support",
  "output_modality_support",
  "vision_support",
  "image_generation_support",
  "tool_function_support",
  "context_window",
  "input_cost_per_1m",
  "output_cost_per_1m",
  "expected_latency_band",
  "benchmark_notes",
  "availability_quota_state",
  "platform_runtime_notes",
  "confidence",
] as const;

const MAX_EXPAND_COLUMNS = 24;

function normalizeExpandColumns(raw: string[] | null | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const deduped: string[] = [];
  for (const value of raw) {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!normalized) continue;
    if (deduped.includes(normalized)) continue;
    deduped.push(normalized);
    if (deduped.length >= MAX_EXPAND_COLUMNS) break;
  }
  return deduped;
}

function scoreTaskFit(provider: string, preference: RouterPreference, task: string): number {
  const baseline =
    preference === "quality"
      ? 78
      : preference === "speed"
        ? 74
        : preference === "cost"
          ? 72
          : 75;

  let score = baseline;
  if (provider === "openrouter") score += 2;
  if (provider === "openai" || provider === "anthropic") score += preference === "quality" ? 6 : 2;
  if (provider === "groq" || provider === "cerebras") score += preference === "speed" ? 6 : 1;
  if (provider === "openrouter" || provider === "groq" || provider === "cerebras") {
    score += preference === "cost" ? 5 : 0;
  }
  if (task.includes("code") || task.includes("refactor")) {
    if (provider === "openrouter" || provider === "openai") score += 4;
  }
  if (task.includes("analysis") || task.includes("architecture")) {
    if (provider === "anthropic" || provider === "gemini") score += 4;
  }
  return Math.max(1, Math.min(99, score));
}

function providerHints(provider: string): {
  inputModality: string;
  outputModality: string;
  vision: boolean;
  imageGeneration: boolean;
  toolUse: boolean;
  costIn: string;
  costOut: string;
  latency: "low" | "medium" | "high";
  contextWindow: string;
  benchmarkNotes: string;
  runtimeNotes: string;
} {
  const multimodalProviders = new Set(["openai", "anthropic", "gemini", "openrouter"]);
  const imageGenProviders = new Set(["openai", "gemini", "openrouter"]);
  const fastProviders = new Set(["groq", "cerebras"]);
  const lowCostProviders = new Set(["openrouter", "groq", "cerebras"]);
  return {
    inputModality: multimodalProviders.has(provider) ? "text,image" : "text",
    outputModality: imageGenProviders.has(provider) ? "text,image" : "text",
    vision: multimodalProviders.has(provider),
    imageGeneration: imageGenProviders.has(provider),
    toolUse: true,
    costIn: lowCostProviders.has(provider) ? "low-to-medium" : "medium-to-high",
    costOut: lowCostProviders.has(provider) ? "low-to-medium" : "medium-to-high",
    latency: fastProviders.has(provider) ? "low" : "medium",
    contextWindow: "varies_by_model",
    benchmarkNotes: "Provider/model performance depends on task family and evaluation setup.",
    runtimeNotes: "Verify credentials, quotas, and regional availability at execution time.",
  };
}

function formatUsdPer1M(costCents: number, tokens: number): string {
  if (!Number.isFinite(costCents) || !Number.isFinite(tokens) || tokens <= 0) return "n/a";
  const usdPer1M = (costCents / 100) / (tokens / 1_000_000);
  if (!Number.isFinite(usdPer1M)) return "n/a";
  return `$${usdPer1M.toFixed(2)}`;
}

function latencyBandFromMs(avgRunMs: number): "low" | "medium" | "high" {
  if (!Number.isFinite(avgRunMs) || avgRunMs <= 0) return "medium";
  if (avgRunMs < 12_000) return "low";
  if (avgRunMs < 45_000) return "medium";
  return "high";
}

function confidenceFromSamples(base: number, sampleRuns: number): number {
  if (sampleRuns <= 0) return Number(Math.max(0.45, base - 0.22).toFixed(2));
  if (sampleRuns < 3) return Number(Math.max(0.55, base - 0.14).toFixed(2));
  if (sampleRuns < 10) return Number(Math.max(0.62, base - 0.06).toFixed(2));
  return Number(Math.min(0.96, base + 0.06).toFixed(2));
}

function buildCandidateRow(input: {
  provider: string;
  model: string;
  isValid: boolean;
  preference: RouterPreference;
  task: string;
  confidence: number;
  columns: readonly string[];
  telemetry?: ProviderRuntimeMetric | null;
}): RouterRecommendationCandidateRow {
  const hints = providerHints(input.provider);
  const runtimeCostIn = input.telemetry
    ? formatUsdPer1M(input.telemetry.totalCostCents, input.telemetry.inputTokens)
    : hints.costIn;
  const runtimeCostOut = input.telemetry
    ? formatUsdPer1M(input.telemetry.totalCostCents, input.telemetry.outputTokens)
    : hints.costOut;
  const runtimeLatency = input.telemetry
    ? latencyBandFromMs(input.telemetry.avgRunMs)
    : hints.latency;
  const runtimeConfidence = confidenceFromSamples(input.confidence, input.telemetry?.sampleRuns ?? 0);
  const benchmarkNotes = input.telemetry
    ? `Telemetry-backed from ${input.telemetry.sampleRuns} sampled runs.`
    : hints.benchmarkNotes;
  const base: Record<string, string | number | boolean | null> = {
    provider: input.provider,
    model_id: input.model,
    task_fit_score: scoreTaskFit(input.provider, input.preference, input.task),
    input_modality_support: hints.inputModality,
    output_modality_support: hints.outputModality,
    vision_support: hints.vision,
    image_generation_support: hints.imageGeneration,
    tool_function_support: hints.toolUse,
    context_window: hints.contextWindow,
    input_cost_per_1m: runtimeCostIn,
    output_cost_per_1m: runtimeCostOut,
    expected_latency_band: runtimeLatency,
    benchmark_notes: benchmarkNotes,
    availability_quota_state: input.isValid ? "healthy" : "key_saved_not_validated",
    platform_runtime_notes: hints.runtimeNotes,
    confidence: runtimeConfidence,
  };
  for (const column of input.columns) {
    if (!(column in base)) {
      base[column] = null;
    }
  }
  return base;
}

function providerProbe(
  provider: string,
  apiKey: string,
  fallback?: {
    testUrl: string | null;
    testAuthHeader: string | null;
    testAuthPrefix: string | null;
  } | null,
): { url: string; init: RequestInit } | null {
  switch (provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        init: {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      };
    case "gemini":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        init: {},
      };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/key",
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/models",
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case "cerebras":
      return {
        url: "https://api.cerebras.ai/v1/models",
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case "mistral":
      return {
        url: "https://api.mistral.ai/v1/models",
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case "github_models":
      return {
        url: "https://models.github.ai/inference/models",
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case "nvidia_nim":
      return {
        url: "https://integrate.api.nvidia.com/v1/models",
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    default:
      if (fallback?.testUrl) {
        const headerName = fallback.testAuthHeader?.trim() || "Authorization";
        const prefix = fallback.testAuthPrefix?.trim();
        const headerValue = prefix ? `${prefix} ${apiKey}` : apiKey;
        return {
          url: fallback.testUrl,
          init: { headers: { [headerName]: headerValue } },
        };
      }
      return null;
  }
}

async function testProviderConnection(
  provider: string,
  apiKey: string,
  fallback?: {
    testUrl: string | null;
    testAuthHeader: string | null;
    testAuthPrefix: string | null;
  } | null,
): Promise<ProviderTestResult> {
  const probe = providerProbe(provider, apiKey, fallback);
  if (!probe) {
    return {
      ok: false,
      status: null,
      message: `Connection test is not configured for provider "${provider}" yet`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(probe.url, {
      ...probe.init,
      signal: controller.signal,
    });
    if (response.ok) {
      return { ok: true, status: response.status, message: "Connection succeeded" };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, message: "Provider rejected the API key" };
    }
    return {
      ok: false,
      status: response.status,
      message: `Provider responded with status ${response.status}`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, status: null, message: "Connection test timed out" };
    }
    return { ok: false, status: null, message: "Connection test failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export function apiKeyService(db: Db) {
  return {
    list: async (): Promise<ApiKeyListItem[]> => {
      const rows = await db
        .select()
        .from(apiKeys)
        .orderBy(asc(apiKeys.provider));
      return rows.map((row) => ({
        provider: row.provider,
        maskedKey: row.keyPreview,
        helpUrl: row.helpUrl,
        testUrl: row.testUrl,
        testAuthHeader: row.testAuthHeader,
        testAuthPrefix: row.testAuthPrefix,
        isValid: row.isValid,
        lastTestedAt: row.lastTestedAt,
        updatedAt: row.updatedAt,
      }));
    },

    save: async (input: SaveApiKeyInput, userId?: string | null): Promise<ApiKeyListItem> => {
      const provider = normalizeProvider(input.provider);
      const normalizedKey = input.key.trim();
      if (!normalizedKey) throw badRequest("API key cannot be empty");
      const helpUrl = normalizeUrl(input.helpUrl);
      const testUrl = normalizeUrl(input.testUrl);
      const testAuthHeader = normalizeHeaderName(input.testAuthHeader);
      const testAuthPrefix = (input.testAuthPrefix ?? "").trim() || null;

      const now = new Date();
      const encryptedKey = encryptApiKey(normalizedKey);
      const keyPreview = maskApiKey(normalizedKey);
      const [saved] = await db
        .insert(apiKeys)
        .values({
          provider,
          encryptedKey,
          keyPreview,
          helpUrl,
          testUrl,
          testAuthHeader,
          testAuthPrefix,
          userId: userId ?? null,
          isValid: false,
          lastTestedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [apiKeys.provider],
          set: {
            encryptedKey,
            keyPreview,
            helpUrl,
            testUrl,
            testAuthHeader,
            testAuthPrefix,
            userId: userId ?? null,
            isValid: false,
            lastTestedAt: null,
            updatedAt: now,
          },
        })
        .returning();

      return {
        provider,
        maskedKey: saved.keyPreview,
        helpUrl: saved.helpUrl,
        testUrl: saved.testUrl,
        testAuthHeader: saved.testAuthHeader,
        testAuthPrefix: saved.testAuthPrefix,
        isValid: saved.isValid,
        lastTestedAt: saved.lastTestedAt,
        updatedAt: saved.updatedAt,
      };
    },

    remove: async (providerInput: string): Promise<boolean> => {
      const provider = normalizeProvider(providerInput);
      const removed = await db
        .delete(apiKeys)
        .where(eq(apiKeys.provider, provider))
        .returning({ id: apiKeys.id });
      return removed.length > 0;
    },

    test: async (providerInput: string): Promise<ProviderTestResult> => {
      const provider = normalizeProvider(providerInput);
      const row = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.provider, provider))
        .then((rows) => rows[0] ?? null);
      if (!row) {
        throw badRequest(`No API key saved for provider ${provider}`);
      }

      const plainKey = decryptApiKey(row.encryptedKey);
      const result = await testProviderConnection(provider, plainKey, {
        testUrl: row.testUrl,
        testAuthHeader: row.testAuthHeader,
        testAuthPrefix: row.testAuthPrefix,
      });
      const now = new Date();
      await db
        .update(apiKeys)
        .set({
          isValid: result.ok,
          lastTestedAt: now,
          updatedAt: now,
        })
        .where(and(eq(apiKeys.id, row.id), eq(apiKeys.provider, provider)));

      return result;
    },

    getValue: async (providerInput: string): Promise<{ provider: string; key: string }> => {
      const provider = normalizeProvider(providerInput);
      const row = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.provider, provider))
        .then((rows) => rows[0] ?? null);
      if (!row) {
        throw badRequest(`No API key saved for provider ${provider}`);
      }
      return {
        provider,
        key: decryptApiKey(row.encryptedKey),
      };
    },

    listResolvedForRuntime: async (): Promise<Array<{
      provider: string;
      key: string;
      helpUrl: string | null;
      testUrl: string | null;
      testAuthHeader: string | null;
      testAuthPrefix: string | null;
      isValid: boolean;
      lastTestedAt: Date | null;
    }>> => {
      const rows = await db.select().from(apiKeys).orderBy(asc(apiKeys.provider));
      return rows.map((row) => ({
        provider: row.provider,
        key: decryptApiKey(row.encryptedKey),
        helpUrl: row.helpUrl,
        testUrl: row.testUrl,
        testAuthHeader: row.testAuthHeader,
        testAuthPrefix: row.testAuthPrefix,
        isValid: row.isValid,
        lastTestedAt: row.lastTestedAt,
      }));
    },

    listProviderCatalog: async (): Promise<ProviderModelCatalogEntry[]> => {
      const rows = await db
        .select({ provider: apiKeys.provider })
        .from(apiKeys)
        .orderBy(asc(apiKeys.provider));
      return rows.map((row) => ({
        provider: row.provider,
        models: KNOWN_PROVIDER_MODELS[row.provider] ?? [],
      }));
    },

    recommendRouterAssignment: async (input: RouterRecommendationInput): Promise<RouterRecommendation> => {
      const telemetrySince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const telemetryRows = await db
        .select({
          provider: costEvents.provider,
          model: costEvents.model,
          sampleRuns: sql<number>`count(distinct ${costEvents.heartbeatRunId})::int`,
          totalCostCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
          avgRunMs: sql<number>`coalesce(avg(case when ${heartbeatRuns.startedAt} is not null and ${heartbeatRuns.finishedAt} is not null then extract(epoch from (${heartbeatRuns.finishedAt} - ${heartbeatRuns.startedAt})) * 1000 end), 0)::float`,
        })
        .from(costEvents)
        .leftJoin(heartbeatRuns, eq(costEvents.heartbeatRunId, heartbeatRuns.id))
        .where(gte(costEvents.occurredAt, telemetrySince))
        .groupBy(costEvents.provider, costEvents.model);

      const telemetryByProviderModel = new Map<string, ProviderRuntimeMetric>();
      const telemetryByProvider = new Map<string, ProviderRuntimeMetric>();
      const providerWeightedRunMs = new Map<string, number>();
      for (const row of telemetryRows) {
        const metric: ProviderRuntimeMetric = {
          provider: row.provider,
          model: row.model,
          sampleRuns: Number(row.sampleRuns ?? 0),
          totalCostCents: Number(row.totalCostCents ?? 0),
          inputTokens: Number(row.inputTokens ?? 0),
          outputTokens: Number(row.outputTokens ?? 0),
          avgRunMs: Number(row.avgRunMs ?? 0),
        };
        telemetryByProviderModel.set(`${metric.provider}::${metric.model}`, metric);
        const providerAggregate = telemetryByProvider.get(metric.provider);
        if (!providerAggregate) {
          telemetryByProvider.set(metric.provider, { ...metric });
          providerWeightedRunMs.set(metric.provider, metric.avgRunMs * metric.sampleRuns);
        } else {
          const previousWeightedMs = providerWeightedRunMs.get(metric.provider) ?? 0;
          providerAggregate.sampleRuns += metric.sampleRuns;
          providerAggregate.totalCostCents += metric.totalCostCents;
          providerAggregate.inputTokens += metric.inputTokens;
          providerAggregate.outputTokens += metric.outputTokens;
          const nextWeightedMs = previousWeightedMs + (metric.avgRunMs * metric.sampleRuns);
          providerWeightedRunMs.set(metric.provider, nextWeightedMs);
          providerAggregate.avgRunMs =
            providerAggregate.sampleRuns > 0
              ? nextWeightedMs / providerAggregate.sampleRuns
              : providerAggregate.avgRunMs;
        }
      }

      const rows = await db
        .select({
          provider: apiKeys.provider,
          isValid: apiKeys.isValid,
        })
        .from(apiKeys)
        .orderBy(asc(apiKeys.provider));
      if (rows.length === 0) {
        throw badRequest("No provider keys are configured yet");
      }

      const normalizedPreference = input.preference ?? "balanced";
      const task = (input.taskSummary ?? "").toLowerCase();
      const expandColumns = normalizeExpandColumns(input.expandColumns);
      const tableColumns = Array.from(new Set([...DEFAULT_ROUTER_TABLE_COLUMNS, ...expandColumns]));
      const providers = rows
        .sort((a, b) => Number(b.isValid) - Number(a.isValid))
        .map((row) => row.provider);

      const pickByPreference = (available: string[]): string => {
        const byCost = ["openrouter", "groq", "cerebras", "gemini", "openai", "anthropic"];
        const byQuality = ["anthropic", "openai", "gemini", "openrouter", "mistral"];
        const bySpeed = ["groq", "cerebras", "openrouter", "openai", "gemini"];
        const byBalanced = ["openrouter", "openai", "anthropic", "gemini", "groq"];
        const order =
          normalizedPreference === "cost"
            ? byCost
            : normalizedPreference === "quality"
              ? byQuality
              : normalizedPreference === "speed"
                ? bySpeed
                : byBalanced;
        return order.find((provider) => available.includes(provider)) ?? available[0]!;
      };

      let selectedProvider = pickByPreference(providers);
      if (task.includes("code") || task.includes("refactor")) {
        selectedProvider = providers.includes("openrouter")
          ? "openrouter"
          : providers.includes("openai")
            ? "openai"
            : selectedProvider;
      }
      if (task.includes("analysis") || task.includes("architecture")) {
        selectedProvider = providers.includes("anthropic")
          ? "anthropic"
          : providers.includes("gemini")
            ? "gemini"
            : selectedProvider;
      }

      const model =
        (KNOWN_PROVIDER_MODELS[selectedProvider] ?? [])[0] ??
        `${selectedProvider}/default`;
      const reason = `Router Agent selected ${selectedProvider} for ${normalizedPreference} preference${
        task ? ` with task hint "${input.taskSummary}".` : "."
      }`;
      const confidence = 0.72;
      const candidateTable = rows
        .map((row) => {
          const suggestedModel = (KNOWN_PROVIDER_MODELS[row.provider] ?? [])[0] ?? `${row.provider}/default`;
          const telemetry =
            telemetryByProviderModel.get(`${row.provider}::${suggestedModel}`)
            ?? telemetryByProvider.get(row.provider)
            ?? null;
          return buildCandidateRow({
            provider: row.provider,
            model: suggestedModel,
            isValid: row.isValid,
            preference: normalizedPreference,
            task,
            confidence,
            columns: tableColumns,
            telemetry,
          });
        })
        .sort((a, b) => Number(b.task_fit_score ?? 0) - Number(a.task_fit_score ?? 0));
      const alternatives = providers
        .filter((provider) => provider !== selectedProvider)
        .slice(0, 3)
        .map((provider): RouterRecommendationAlternative => ({
          provider,
          model: (KNOWN_PROVIDER_MODELS[provider] ?? [])[0] ?? `${provider}/default`,
          reason: "Alternative candidate based on current preference/capability ordering.",
        }));
      return {
        provider: selectedProvider,
        model,
        reason,
        confidence,
        decision_mode: "advisory",
        final_decision_by: "master_ceo",
        suggested_model: {
          provider: selectedProvider,
          model,
        },
        selected_model: null,
        alternatives,
        table_columns: tableColumns,
        candidate_table: candidateTable,
      };
    },

    listCompanyIds: async (): Promise<string[]> =>
      db
        .select({ id: companies.id })
        .from(companies)
        .then((rows) => rows.map((row) => row.id)),
  };
}
