import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { apiKeys, providerDiscoverySuggestions } from "@paperclipai/db";
import { badRequest, notFound } from "../errors.js";

type DiscoveryConfidence = "low" | "medium" | "high";
type DiscoveryStatus = "suggested" | "published" | "rejected";
type DiscoveryAuthMode = "bearer_header" | "api_key_header" | "query_key" | null;

type DiscoveryEvidence = {
  url: string;
  note?: string;
  confidenceDelta?: number;
  matchedText?: string;
  evidenceType?: "crawl" | "auth" | "endpoint" | "heuristic" | "known_mapping" | "validation";
};

type DiscoverySuggestion = {
  id: string;
  provider: string;
  status: DiscoveryStatus;
  docsUrl: string | null;
  apiReferenceUrl: string | null;
  testUrl: string | null;
  modelListUrl: string | null;
  authMode: DiscoveryAuthMode;
  authHeader: string | null;
  authPrefix: string | null;
  confidence: DiscoveryConfidence;
  discoveryNotes: string | null;
  sourceEvidence: DiscoveryEvidence[];
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

type KnownDiscoveryProfile = {
  provider: string;
  docsUrl: string;
  apiReferenceUrl: string;
  testUrl: string;
  modelListUrl: string;
  authMode: NonNullable<DiscoveryAuthMode>;
  authHeader: string | null;
  authPrefix: string | null;
  confidence: DiscoveryConfidence;
  note: string;
  crawlSeeds: string[];
};

type CrawlWorkerOptions = {
  maxPages: number;
  requestTimeoutMs: number;
  maxHtmlBytes: number;
};

type CrawledPage = {
  url: string;
  status: number;
  text: string;
  html: string;
};

type CrawlWorkerResult = {
  pages: CrawledPage[];
  failures: Array<{ url: string; reason: string }>;
  visitedCount: number;
};

type DiscoveryParseResult = {
  docsUrl: string | null;
  apiReferenceUrl: string | null;
  testUrl: string | null;
  modelListUrl: string | null;
  authMode: DiscoveryAuthMode;
  authHeader: string | null;
  authPrefix: string | null;
  evidence: DiscoveryEvidence[];
  notes: string[];
  score: number;
};

const DEFAULT_WORKER_OPTIONS: CrawlWorkerOptions = {
  maxPages: 6,
  requestTimeoutMs: 4000,
  maxHtmlBytes: 250_000,
};

const KNOWN_PROVIDER_DISCOVERY_DEFAULTS: Record<string, KnownDiscoveryProfile> = {
  openai: {
    provider: "openai",
    docsUrl: "https://platform.openai.com/docs/",
    apiReferenceUrl: "https://platform.openai.com/docs/api-reference/models",
    testUrl: "https://api.openai.com/v1/models",
    modelListUrl: "https://api.openai.com/v1/models",
    authMode: "bearer_header",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "high",
    note: "Known provider mapping.",
    crawlSeeds: [
      "https://platform.openai.com/docs/",
      "https://platform.openai.com/docs/api-reference/models",
    ],
  },
  openrouter: {
    provider: "openrouter",
    docsUrl: "https://openrouter.ai/docs",
    apiReferenceUrl: "https://openrouter.ai/docs/api-reference/overview",
    testUrl: "https://openrouter.ai/api/v1/key",
    modelListUrl: "https://openrouter.ai/api/v1/models",
    authMode: "bearer_header",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "high",
    note: "Known provider mapping.",
    crawlSeeds: [
      "https://openrouter.ai/docs",
      "https://openrouter.ai/docs/api-reference/overview",
    ],
  },
  groq: {
    provider: "groq",
    docsUrl: "https://console.groq.com/docs",
    apiReferenceUrl: "https://console.groq.com/docs/api-reference",
    testUrl: "https://api.groq.com/openai/v1/models",
    modelListUrl: "https://api.groq.com/openai/v1/models",
    authMode: "bearer_header",
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "high",
    note: "Known provider mapping.",
    crawlSeeds: [
      "https://console.groq.com/docs",
      "https://console.groq.com/docs/api-reference",
    ],
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

function sanitizeHref(baseUrl: string, href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("javascript:")) {
    return null;
  }
  try {
    const parsed = new URL(trimmed, baseUrl);
    if (parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const regex = /<a\s+[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const href = match[1] ?? match[2] ?? match[3] ?? "";
    const url = sanitizeHref(baseUrl, href);
    if (url) {
      links.add(url);
    }
    match = regex.exec(html);
  }
  return Array.from(links);
}

function sameHostOrSubdomain(seedHosts: Set<string>, url: string): boolean {
  try {
    const host = new URL(url).hostname;
    for (const seedHost of seedHosts) {
      if (host === seedHost || host.endsWith(`.${seedHost}`) || seedHost.endsWith(`.${host}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function rankCrawlLink(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (lower.includes("api-reference")) score += 35;
  if (lower.includes("/reference")) score += 30;
  if (lower.includes("/docs")) score += 24;
  if (lower.includes("authentication") || lower.includes("/auth")) score += 20;
  if (lower.includes("models")) score += 18;
  if (lower.includes("quickstart")) score += 14;
  if (lower.includes("/v1/")) score += 10;
  if (lower.includes("blog") || lower.includes("changelog")) score -= 30;
  return score;
}

async function fetchTextWithTimeout(url: string, timeoutMs: number, maxHtmlBytes: number): Promise<{ status: number; html: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "paperclip-provider-discovery/1.0",
        Accept: "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    const rawText = await response.text();
    return {
      status: response.status,
      html: rawText.slice(0, maxHtmlBytes),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runDiscoveryCrawler(seedUrls: string[], options: CrawlWorkerOptions): Promise<CrawlWorkerResult> {
  const seeds = Array.from(new Set(seedUrls.map((url) => url.trim()).filter(Boolean)));
  if (seeds.length === 0) {
    return { pages: [], failures: [], visitedCount: 0 };
  }

  const seedHosts = new Set(
    seeds.map((url) => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    }).filter(Boolean),
  );
  const queue = [...seeds];
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const failures: Array<{ url: string; reason: string }> = [];

  while (queue.length > 0 && pages.length < options.maxPages) {
    const currentUrl = queue.shift()!;
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      const fetched = await fetchTextWithTimeout(currentUrl, options.requestTimeoutMs, options.maxHtmlBytes);
      if (fetched.status >= 400) {
        failures.push({ url: currentUrl, reason: `HTTP ${fetched.status}` });
        continue;
      }
      const text = stripHtmlToText(fetched.html);
      pages.push({
        url: currentUrl,
        status: fetched.status,
        text,
        html: fetched.html,
      });

      const links = extractLinks(fetched.html, currentUrl)
        .filter((url) => !visited.has(url))
        .filter((url) => sameHostOrSubdomain(seedHosts, url))
        .sort((left, right) => rankCrawlLink(right) - rankCrawlLink(left))
        .slice(0, 8);
      for (const link of links) {
        if (!visited.has(link)) queue.push(link);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown crawl error";
      failures.push({ url: currentUrl, reason });
    }
  }

  return { pages, failures, visitedCount: visited.size };
}

function extractAbsoluteUrls(text: string): string[] {
  const urls = new Set<string>();
  const regex = /https:\/\/[^\s"'`<>)]{4,300}/gi;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    try {
      const parsed = new URL(match[0]!);
      parsed.hash = "";
      urls.add(parsed.toString());
    } catch {
      // ignore
    }
    match = regex.exec(text);
  }
  return Array.from(urls);
}

function extractPathCandidates(text: string, baseUrl: string): string[] {
  const paths = new Set<string>();
  const regex = /\/v\d+[a-z0-9/_-]*/gi;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    const rawPath = match[0]!;
    try {
      paths.add(new URL(rawPath, baseUrl).toString());
    } catch {
      // ignore
    }
    match = regex.exec(text);
  }
  return Array.from(paths);
}

function endpointScore(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (lower.includes("/v1/models") || lower.includes("/v1beta/models")) score += 50;
  if (lower.includes("/models")) score += 28;
  if (lower.endsWith("/v1/key") || lower.includes("/apikey")) score += 20;
  if (lower.includes("/health") || lower.includes("/status")) score += 14;
  if (lower.includes("api.")) score += 10;
  return score;
}

function pickHighestRankedEndpoint(urls: string[]): string | null {
  if (urls.length === 0) return null;
  const unique = Array.from(new Set(urls));
  unique.sort((left, right) => endpointScore(right) - endpointScore(left));
  return unique[0] ?? null;
}

function parseAuthSchemeFromText(text: string): {
  mode: DiscoveryAuthMode;
  header: string | null;
  prefix: string | null;
  note: string;
  confidenceDelta: number;
} | null {
  const lower = text.toLowerCase();
  if (/authorization\s*[:=]\s*bearer/.test(lower) || /bearer\s+\$\{?api[_-]?key/.test(lower)) {
    return {
      mode: "bearer_header",
      header: "Authorization",
      prefix: "Bearer",
      note: "Detected Bearer authorization header pattern.",
      confidenceDelta: 0.2,
    };
  }
  if (/(x-api-key|api-key|x_auth_token|x-auth-token)/.test(lower)) {
    return {
      mode: "api_key_header",
      header: /x-auth-token/.test(lower) ? "X-Auth-Token" : "X-API-Key",
      prefix: null,
      note: "Detected API key header pattern.",
      confidenceDelta: 0.2,
    };
  }
  if (/(?:\?|&)key=|api[_-]?key=.*(?:query|string|url)/.test(lower)) {
    return {
      mode: "query_key",
      header: null,
      prefix: null,
      note: "Detected query-string API key pattern.",
      confidenceDelta: 0.15,
    };
  }
  return null;
}

function deriveFromSeedUrl(seedUrl: string | null) {
  if (!seedUrl) {
    return {
      docsUrl: null,
      apiReferenceUrl: null,
      testUrl: null,
      modelListUrl: null,
      authMode: "bearer_header" as DiscoveryAuthMode,
      authHeader: "Authorization",
      authPrefix: "Bearer",
      confidence: "low" as DiscoveryConfidence,
      score: 0.25,
      notes: ["No seed URL supplied; generated placeholder suggestion only."],
      evidence: [] as DiscoveryEvidence[],
    };
  }

  const parsed = new URL(seedUrl);
  const normalizedHost = parsed.hostname.replace(/^console\./, "").replace(/^docs\./, "");
  const candidateApiHost = normalizedHost.startsWith("api.") ? normalizedHost : `api.${normalizedHost}`;
  const candidateModelUrl = `https://${candidateApiHost}/v1/models`;
  return {
    docsUrl: seedUrl,
    apiReferenceUrl: seedUrl,
    testUrl: candidateModelUrl,
    modelListUrl: candidateModelUrl,
    authMode: "bearer_header" as DiscoveryAuthMode,
    authHeader: "Authorization",
    authPrefix: "Bearer",
    confidence: "medium" as DiscoveryConfidence,
    score: 0.58,
    notes: ["Heuristic extraction from seed URL; verify against provider API reference."],
    evidence: [{ url: seedUrl, note: "Seed URL heuristic fallback.", evidenceType: "heuristic" as const, confidenceDelta: 0.1 }],
  };
}

function mapScoreToConfidence(score: number): DiscoveryConfidence {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function summarizeStrategyNotes(parts: {
  provider: string;
  score: number;
  confidence: DiscoveryConfidence;
  pagesCrawled: number;
  visited: number;
  failures: number;
  strategyNotes: string[];
  parseNotes: string[];
}): string {
  const lines = [
    `Discovery worker analyzed provider "${parts.provider}".`,
    `Confidence score: ${parts.score.toFixed(2)} (${parts.confidence}).`,
    `Crawl stats: pages=${parts.pagesCrawled}, visited=${parts.visited}, failures=${parts.failures}.`,
    "Extraction strategy: crawl docs -> parse API references -> detect auth pattern -> detect model/test endpoints -> score confidence.",
  ];
  for (const note of [...parts.strategyNotes, ...parts.parseNotes].slice(0, 6)) {
    lines.push(`- ${note}`);
  }
  return lines.join("\n");
}

function parseDiscoveryFromCrawledPages(pages: CrawledPage[]): DiscoveryParseResult {
  if (pages.length === 0) {
    return {
      docsUrl: null,
      apiReferenceUrl: null,
      testUrl: null,
      modelListUrl: null,
      authMode: null,
      authHeader: null,
      authPrefix: null,
      evidence: [],
      notes: ["Crawler returned no pages."],
      score: 0,
    };
  }

  const endpointCandidates = new Set<string>();
  const evidence: DiscoveryEvidence[] = [];
  let docsUrl: string | null = null;
  let apiReferenceUrl: string | null = null;
  let authMode: DiscoveryAuthMode = null;
  let authHeader: string | null = null;
  let authPrefix: string | null = null;
  let score = 0.22;

  for (const page of pages) {
    const lowerUrl = page.url.toLowerCase();
    const lowerText = page.text.toLowerCase();

    if (!docsUrl && (lowerUrl.includes("/docs") || lowerText.includes("documentation"))) {
      docsUrl = page.url;
      score += 0.08;
      evidence.push({
        url: page.url,
        note: "Docs landing candidate.",
        evidenceType: "crawl",
        confidenceDelta: 0.08,
      });
    }
    if (!apiReferenceUrl && (lowerUrl.includes("api-reference") || lowerText.includes("api reference"))) {
      apiReferenceUrl = page.url;
      score += 0.1;
      evidence.push({
        url: page.url,
        note: "API reference page candidate.",
        evidenceType: "crawl",
        confidenceDelta: 0.1,
      });
    }

    for (const absoluteUrl of extractAbsoluteUrls(page.text)) {
      if (endpointScore(absoluteUrl) > 0) {
        endpointCandidates.add(absoluteUrl);
      }
    }
    for (const pathUrl of extractPathCandidates(page.text, page.url)) {
      if (endpointScore(pathUrl) > 0) {
        endpointCandidates.add(pathUrl);
      }
    }

    if (!authMode) {
      const auth = parseAuthSchemeFromText(page.text);
      if (auth) {
        authMode = auth.mode;
        authHeader = auth.header;
        authPrefix = auth.prefix;
        score += auth.confidenceDelta;
        evidence.push({
          url: page.url,
          note: auth.note,
          evidenceType: "auth",
          confidenceDelta: auth.confidenceDelta,
        });
      }
    }
  }

  if (!docsUrl) {
    docsUrl = pages[0]?.url ?? null;
  }
  if (!apiReferenceUrl) {
    apiReferenceUrl = pages.find((page) => page.url.toLowerCase().includes("reference"))?.url ?? docsUrl;
  }

  const endpointList = Array.from(endpointCandidates);
  const modelListUrl = pickHighestRankedEndpoint(endpointList.filter((url) => url.toLowerCase().includes("models")));
  const testUrl =
    pickHighestRankedEndpoint(
      endpointList.filter((url) =>
        url.toLowerCase().includes("/models") ||
        url.toLowerCase().endsWith("/v1/key") ||
        url.toLowerCase().includes("/status") ||
        url.toLowerCase().includes("/health"),
      ),
    ) ?? modelListUrl;

  if (modelListUrl) {
    score += 0.24;
    evidence.push({
      url: modelListUrl,
      note: "Detected model-list endpoint candidate.",
      evidenceType: "endpoint",
      confidenceDelta: 0.24,
    });
  }
  if (testUrl) {
    score += 0.12;
    evidence.push({
      url: testUrl,
      note: "Detected provider test endpoint candidate.",
      evidenceType: "endpoint",
      confidenceDelta: 0.12,
    });
  }

  if (!authMode) {
    authMode = "bearer_header";
    authHeader = "Authorization";
    authPrefix = "Bearer";
  }

  const notes: string[] = [];
  notes.push(`Parsed ${pages.length} crawled page(s) for API/auth signatures.`);
  if (!modelListUrl) notes.push("No explicit model-list endpoint found in crawled text.");
  if (!testUrl) notes.push("No explicit test endpoint found; consider manual verification.");

  return {
    docsUrl,
    apiReferenceUrl,
    testUrl: testUrl ?? null,
    modelListUrl: modelListUrl ?? null,
    authMode,
    authHeader,
    authPrefix,
    evidence: evidence.slice(0, 16),
    notes,
    score: Math.min(0.98, score),
  };
}

function normalizeKnownProfile(profile: KnownDiscoveryProfile): DiscoveryParseResult {
  return {
    docsUrl: profile.docsUrl,
    apiReferenceUrl: profile.apiReferenceUrl,
    testUrl: profile.testUrl,
    modelListUrl: profile.modelListUrl,
    authMode: profile.authMode,
    authHeader: profile.authHeader,
    authPrefix: profile.authPrefix,
    evidence: [{
      url: profile.apiReferenceUrl,
      note: profile.note,
      evidenceType: "known_mapping",
      confidenceDelta: 0.35,
    }],
    notes: [profile.note],
    score: 0.88,
  };
}

function canPublishSuggestion(suggestion: DiscoverySuggestion): { ok: boolean; reason: string | null } {
  if (suggestion.status === "published") {
    return { ok: false, reason: "Suggestion is already published" };
  }
  if (suggestion.confidence === "low") {
    return { ok: false, reason: "Low-confidence suggestions require manual validation before publish" };
  }
  if (!suggestion.testUrl || !suggestion.modelListUrl) {
    return { ok: false, reason: "Missing test/model endpoint metadata; run discovery again with a stronger seed URL" };
  }
  if (!suggestion.authMode) {
    return { ok: false, reason: "Missing auth metadata; run discovery again or set metadata manually" };
  }
  return { ok: true, reason: null };
}

async function buildDiscoverySuggestion(provider: string, seedUrl: string | null): Promise<{
  docsUrl: string | null;
  apiReferenceUrl: string | null;
  testUrl: string | null;
  modelListUrl: string | null;
  authMode: DiscoveryAuthMode;
  authHeader: string | null;
  authPrefix: string | null;
  confidence: DiscoveryConfidence;
  discoveryNotes: string;
  evidence: DiscoveryEvidence[];
}> {
  const known = KNOWN_PROVIDER_DISCOVERY_DEFAULTS[provider];
  const seedCandidates = Array.from(new Set(
    [seedUrl, ...(known?.crawlSeeds ?? [])].filter((url): url is string => Boolean(url)),
  ));

  const crawl = await runDiscoveryCrawler(seedCandidates, DEFAULT_WORKER_OPTIONS);
  const parsed = parseDiscoveryFromCrawledPages(crawl.pages);
  const knownBaseline = known ? normalizeKnownProfile(known) : null;
  const heuristicFallback = deriveFromSeedUrl(seedUrl);

  let selected = parsed;
  const strategyNotes: string[] = [];

  if (knownBaseline && knownBaseline.score >= selected.score) {
    selected = knownBaseline;
    strategyNotes.push("Known provider baseline was used as primary mapping.");
  } else if (selected.score < 0.45) {
    selected = {
      ...selected,
      docsUrl: selected.docsUrl ?? heuristicFallback.docsUrl,
      apiReferenceUrl: selected.apiReferenceUrl ?? heuristicFallback.apiReferenceUrl,
      testUrl: selected.testUrl ?? heuristicFallback.testUrl,
      modelListUrl: selected.modelListUrl ?? heuristicFallback.modelListUrl,
      authMode: selected.authMode ?? heuristicFallback.authMode,
      authHeader: selected.authHeader ?? heuristicFallback.authHeader,
      authPrefix: selected.authPrefix ?? heuristicFallback.authPrefix,
      evidence: [...selected.evidence, ...heuristicFallback.evidence],
      notes: [...selected.notes, ...heuristicFallback.notes],
      score: Math.max(selected.score, heuristicFallback.score),
    };
    strategyNotes.push("Crawler confidence was low; heuristic seed-url fallback merged.");
  }

  const confidence = mapScoreToConfidence(selected.score);
  const discoveryNotes = summarizeStrategyNotes({
    provider,
    score: selected.score,
    confidence,
    pagesCrawled: crawl.pages.length,
    visited: crawl.visitedCount,
    failures: crawl.failures.length,
    strategyNotes,
    parseNotes: selected.notes,
  });
  const evidence: DiscoveryEvidence[] = [
    ...selected.evidence,
    ...crawl.failures.slice(0, 4).map((failure) => ({
      url: failure.url,
      note: `Crawler failure: ${failure.reason}`,
      evidenceType: "crawl" as const,
      confidenceDelta: -0.03,
    })),
  ].slice(0, 24);

  return {
    docsUrl: selected.docsUrl,
    apiReferenceUrl: selected.apiReferenceUrl,
    testUrl: selected.testUrl,
    modelListUrl: selected.modelListUrl,
    authMode: selected.authMode,
    authHeader: selected.authHeader,
    authPrefix: selected.authPrefix,
    confidence,
    discoveryNotes,
    evidence,
  };
}

export function providerDiscoveryService(db: Db) {
  return {
    discover: async (input: DiscoverProviderInput): Promise<DiscoverySuggestion> => {
      const provider = normalizeProvider(input.provider);
      const seedUrl = normalizeUrl(input.seedUrl ?? null);
      const now = new Date();
      const suggestion = await buildDiscoverySuggestion(provider, seedUrl);

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
          discoveryNotes: suggestion.discoveryNotes,
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
        .then((rows) => rows[0] ?? null) as DiscoverySuggestion | null;
      if (!existing) {
        throw notFound("Discovery suggestion not found");
      }

      const validation = canPublishSuggestion(existing);
      if (!validation.ok) {
        throw badRequest(validation.reason ?? "Suggestion cannot be published");
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
          testAuthHeader: existing.authHeader ?? (existing.authMode === "query_key" ? null : "Authorization"),
          testAuthPrefix: existing.authPrefix ?? (existing.authMode === "bearer_header" ? "Bearer" : null),
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
