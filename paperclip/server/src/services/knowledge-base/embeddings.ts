import { createHash } from "node:crypto";

const EMBEDDING_DIMENSION = 768;

type RuntimeCredentialsResolver = () => Promise<Array<{ provider: string; key: string }>>;

type EmbedResult = {
  vector: number[];
  provider: "gemini" | "ollama" | "openrouter" | "tfidf";
  model: string;
};

function cosineNormalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));
  if (magnitude <= 0) return vector;
  return vector.map((value) => value / magnitude);
}

function normalizeDimension(vector: number[], target = EMBEDDING_DIMENSION): number[] {
  if (vector.length === target) return cosineNormalize(vector);
  if (vector.length > target) return cosineNormalize(vector.slice(0, target));
  const padded = [...vector];
  while (padded.length < target) padded.push(0);
  return cosineNormalize(padded);
}

function tokenize(content: string): string[] {
  return content
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length > 1);
}

function hashToBucket(token: string): number {
  const hash = createHash("sha256").update(token).digest();
  return hash.readUInt16BE(0) % EMBEDDING_DIMENSION;
}

function tfidfFallbackVector(content: string): number[] {
  const tokens = tokenize(content);
  const vector = Array.from<number>({ length: EMBEDDING_DIMENSION }).fill(0);
  if (tokens.length === 0) return vector;
  const termCounts = new Map<string, number>();
  for (const token of tokens) {
    termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
  }
  for (const [token, count] of termCounts) {
    const bucket = hashToBucket(token);
    const tf = count / tokens.length;
    vector[bucket] += tf;
  }
  return cosineNormalize(vector);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const max = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < max; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class KBEmbeddingService {
  private readonly runtimeCredentialsResolver: RuntimeCredentialsResolver;
  private readonly disableRemoteEmbeddings: boolean;
  private cachedCredentials: Map<string, string> | null = null;
  private cachedCredentialsAt = 0;

  constructor(input?: {
    runtimeCredentialsResolver?: RuntimeCredentialsResolver;
    disableRemoteEmbeddings?: boolean;
  }) {
    this.runtimeCredentialsResolver = input?.runtimeCredentialsResolver ?? (async () => []);
    this.disableRemoteEmbeddings = input?.disableRemoteEmbeddings ?? process.env.PAPERCLIP_KB_DISABLE_REMOTE_EMBEDDINGS === "true";
  }

  private async getCredentials(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.cachedCredentials && now - this.cachedCredentialsAt < 30_000) {
      return this.cachedCredentials;
    }
    const rows = await this.runtimeCredentialsResolver().catch(() => []);
    const next = new Map<string, string>();
    for (const row of rows) {
      const provider = row.provider.trim().toLowerCase();
      if (!provider || !row.key?.trim()) continue;
      next.set(provider, row.key.trim());
    }
    this.cachedCredentials = next;
    this.cachedCredentialsAt = now;
    return next;
  }

  async embed(content: string): Promise<EmbedResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      return {
        vector: Array.from<number>({ length: EMBEDDING_DIMENSION }).fill(0),
        provider: "tfidf",
        model: "tfidf-hash-fallback",
      };
    }

    if (!this.disableRemoteEmbeddings) {
      const credentials = await this.getCredentials();
      const geminiKey = credentials.get("gemini");
      if (geminiKey) {
        const gemini = await this.embedWithGemini(trimmed, geminiKey).catch(() => null);
        if (gemini) return gemini;
      }

      const ollama = await this.embedWithOllama(trimmed).catch(() => null);
      if (ollama) return ollama;

      const openRouterKey = credentials.get("openrouter");
      if (openRouterKey) {
        const openRouter = await this.embedWithOpenRouter(trimmed, openRouterKey).catch(() => null);
        if (openRouter) return openRouter;
      }
    }

    return {
      vector: tfidfFallbackVector(trimmed),
      provider: "tfidf",
      model: "tfidf-hash-fallback",
    };
  }

  private async embedWithGemini(content: string, apiKey: string): Promise<EmbedResult> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: content }] },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini embedding request failed with status ${response.status}`);
    }
    const data = await response.json() as {
      embedding?: { values?: number[] };
    };
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("Gemini embedding response was missing vector values");
    }
    return {
      vector: normalizeDimension(values),
      provider: "gemini",
      model: "text-embedding-004",
    };
  }

  private async embedWithOllama(content: string): Promise<EmbedResult> {
    const model = process.env.PAPERCLIP_KB_OLLAMA_EMBED_MODEL?.trim() || "gemma4:e4b";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("http://127.0.0.1:11434/api/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: content }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Ollama embedding request failed with status ${response.status}`);
      }
      const data = await response.json() as { embedding?: number[] };
      if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
        throw new Error("Ollama embedding response was missing vector values");
      }
      return {
        vector: normalizeDimension(data.embedding),
        provider: "ollama",
        model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async embedWithOpenRouter(content: string, apiKey: string): Promise<EmbedResult> {
    const model = process.env.PAPERCLIP_KB_OPENROUTER_EMBED_MODEL?.trim() || "nomic-ai/nomic-embed-text-v1.5";
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: content,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter embedding request failed with status ${response.status}`);
    }
    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenRouter embedding response was missing vector values");
    }
    return {
      vector: normalizeDimension(embedding),
      provider: "openrouter",
      model,
    };
  }
}

