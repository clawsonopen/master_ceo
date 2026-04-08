import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { apiKeys, providerDiscoverySuggestions } from "@paperclipai/db";
import { badRequest, notFound } from "../errors.js";

type DiscoveryConfidence = "low" | "medium" | "high";
type DiscoveryStatus = "suggested" | "published" | "rejected";

type DiscoverySuggestion = {
  id: string;
  provider: string;
  status: DiscoveryStatus;
  docsUrl: string | null;
  apiReferenceUrl: string | null;
  testUrl: string | null;
  modelListUrl: string | null;
  authMode: string | null;
  authHeader: string | null;
  authPrefix: string | null;
  confidence: DiscoveryConfidence;
  discoveryNotes: string | null;
  sourceEvidence: Array<{ url: string; note?: string }>;
  discoveredBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DiscoverProviderInput = {
  provider: string;
  seedUrl?: string | null;
  discoveredBy?: string | null;
};

const KNOWN_PROVIDER_DISCOVERY_DEFAULTS: Record<
  string,
  {
    docsUrl: string;
    apiReferenceUrl: string;
    testUrl: string;
    modelListUrl: string;
    authMode: string;
    authHeader: string;
    authPrefix: string;
    confidence: DiscoveryConfidence;
    note: string;
  }
> = {
  openai: {
    docsUrl: "https://platform.openai.com/docs/",
    apiReferenceUrl: "https://platform.openai.com/docs/api-reference/models",
    testUrl: "https://api.openai.com/v1/models",
    modelListUrl: "https://api.openai.com/v1/models",
    authMode: "bearer_header",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "high",
    note: "Known OpenAI-compatible provider mapping.",
  },
  openrouter: {
    docsUrl: "https://openrouter.ai/docs",
    apiReferenceUrl: "https://openrouter.ai/docs/api-reference/overview",
    testUrl: "https://openrouter.ai/api/v1/key",
    modelListUrl: "https://openrouter.ai/api/v1/models",
    authMode: "bearer_header",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "high",
    note: "Known OpenRouter mapping.",
  },
  groq: {
    docsUrl: "https://console.groq.com/docs",
    apiReferenceUrl: "https://console.groq.com/docs/api-reference",
    testUrl: "https://api.groq.com/openai/v1/models",
    modelListUrl: "https://api.groq.com/openai/v1/models",
    authMode: "bearer_header",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "high",
    note: "Known Groq mapping.",
  },
};

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
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

function deriveFromSeedUrl(provider: string, seedUrl: string | null) {
  if (!seedUrl) {
    return {
      docsUrl: null,
      apiReferenceUrl: null,
      testUrl: null,
      modelListUrl: null,
      authMode: "bearer_header",
      authHeader: "Authorization",
      authPrefix: "Bearer",
      confidence: "low" as DiscoveryConfidence,
      note: "No seed URL supplied; placeholder suggestion only.",
      evidence: [] as Array<{ url: string; note?: string }>,
    };
  }
  const parsed = new URL(seedUrl);
  const hostname = parsed.hostname;
  const candidateApiHost =
    hostname.startsWith("api.")
      ? hostname
      : `api.${hostname.replace(/^console\./, "").replace(/^docs\./, "")}`;
  const candidateModelUrl = `https://${candidateApiHost}/v1/models`;
  return {
    docsUrl: seedUrl,
    apiReferenceUrl: seedUrl,
    testUrl: candidateModelUrl,
    modelListUrl: candidateModelUrl,
    authMode: "bearer_header",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "medium" as DiscoveryConfidence,
    note: "Heuristic suggestion from seed URL. Verify against provider API reference.",
    evidence: [{ url: seedUrl, note: "Seed URL provided for discovery." }],
  };
}

export function providerDiscoveryService(db: Db) {
  return {
    discover: async (input: DiscoverProviderInput): Promise<DiscoverySuggestion> => {
      const provider = normalizeProvider(input.provider);
      const seedUrl = normalizeUrl(input.seedUrl ?? null);
      const known = KNOWN_PROVIDER_DISCOVERY_DEFAULTS[provider];
      const now = new Date();

      const suggestion = known
        ? {
            docsUrl: known.docsUrl,
            apiReferenceUrl: known.apiReferenceUrl,
            testUrl: known.testUrl,
            modelListUrl: known.modelListUrl,
            authMode: known.authMode,
            authHeader: known.authHeader,
            authPrefix: known.authPrefix,
            confidence: known.confidence,
            note: known.note,
            evidence: [{ url: known.apiReferenceUrl, note: "Known provider mapping." }],
          }
        : deriveFromSeedUrl(provider, seedUrl);

      const [created] = await db
        .insert(providerDiscoverySuggestions)
        .values({
          provider,
          status: "suggested",
          docsUrl: suggestion.docsUrl,
          apiReferenceUrl: suggestion.apiReferenceUrl,
          testUrl: suggestion.testUrl,
          modelListUrl: suggestion.modelListUrl,
          authMode: suggestion.authMode,
          authHeader: suggestion.authHeader,
          authPrefix: suggestion.authPrefix,
          confidence: suggestion.confidence,
          discoveryNotes: suggestion.note,
          sourceEvidence: suggestion.evidence,
          discoveredBy: input.discoveredBy ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return created as DiscoverySuggestion;
    },

    list: async (providerInput?: string | null): Promise<DiscoverySuggestion[]> => {
      const provider = providerInput ? normalizeProvider(providerInput) : null;
      const rows = provider
        ? await db
            .select()
            .from(providerDiscoverySuggestions)
            .where(eq(providerDiscoverySuggestions.provider, provider))
            .orderBy(desc(providerDiscoverySuggestions.updatedAt))
        : await db
            .select()
            .from(providerDiscoverySuggestions)
            .orderBy(desc(providerDiscoverySuggestions.updatedAt));
      return rows as DiscoverySuggestion[];
    },

    publish: async (suggestionId: string): Promise<DiscoverySuggestion> => {
      const existing = await db
        .select()
        .from(providerDiscoverySuggestions)
        .where(eq(providerDiscoverySuggestions.id, suggestionId))
        .then((rows) => rows[0] ?? null);
      if (!existing) {
        throw notFound("Discovery suggestion not found");
      }

      const now = new Date();
      await db
        .update(providerDiscoverySuggestions)
        .set({
          status: "published",
          publishedAt: now,
          updatedAt: now,
        })
        .where(eq(providerDiscoverySuggestions.id, suggestionId));

      await db
        .update(apiKeys)
        .set({
          helpUrl: existing.docsUrl ?? null,
          testUrl: existing.testUrl ?? null,
          testAuthHeader: existing.authHeader ?? "Authorization",
          testAuthPrefix: existing.authPrefix ?? "Bearer",
          updatedAt: now,
        })
        .where(eq(apiKeys.provider, existing.provider));

      const published = await db
        .select()
        .from(providerDiscoverySuggestions)
        .where(and(eq(providerDiscoverySuggestions.id, suggestionId), eq(providerDiscoverySuggestions.status, "published")))
        .then((rows) => rows[0] ?? null);
      if (!published) {
        throw notFound("Published suggestion could not be read");
      }
      return published as DiscoverySuggestion;
    },
  };
}
