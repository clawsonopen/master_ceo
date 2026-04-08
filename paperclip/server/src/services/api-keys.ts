import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { apiKeys, companies } from "@paperclipai/db";
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
};

type RouterRecommendation = {
  provider: string;
  model: string;
  reason: string;
  confidence: number;
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
      return {
        provider: selectedProvider,
        model,
        reason,
        confidence: 0.72,
      };
    },

    listCompanyIds: async (): Promise<string[]> =>
      db
        .select({ id: companies.id })
        .from(companies)
        .then((rows) => rows.map((row) => row.id)),
  };
}
