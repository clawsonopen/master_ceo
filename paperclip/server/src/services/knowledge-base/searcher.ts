import { KBEmbeddingService, cosineSimilarity } from "./embeddings.js";
import { KBIndexer } from "./indexer.js";

type SearchRow = {
  id: number;
  node_id: number;
  chunk_index: number;
  content: string;
  embedding_json: string | null;
  scope: string;
  file_path: string;
  title: string | null;
};

export type KnowledgeBaseSearchResult = {
  filePath: string;
  scope: string;
  title: string;
  snippet: string;
  similarity: number;
  chunkIndex: number;
  context?: string;
};

function clipSnippet(content: string, maxLength = 260): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTerms(query: string): string[] {
  return normalizeText(query).split(" ").filter((token) => token.length > 1);
}

function countOccurrences(text: string, term: string): number {
  if (!text || !term) return 0;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(`\\b${escaped}\\b`, "g"));
  return matches ? matches.length : 0;
}

function lexicalScore(query: string, row: SearchRow): number {
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(row.title ?? "");
  const normalizedContent = normalizeText(row.content);
  const terms = queryTerms(query);
  let score = 0;

  if (normalizedTitle === normalizedQuery) score += 2000;
  if (normalizedTitle.startsWith(normalizedQuery)) score += 1200;
  if (normalizedTitle.includes(normalizedQuery)) score += 600;
  if (normalizedContent.includes(normalizedQuery)) score += 200;

  for (const term of terms) {
    score += countOccurrences(normalizedTitle, term) * 40;
    score += countOccurrences(normalizedContent, term) * 8;
  }

  return score;
}

function reciprocalRankFuse(
  semanticRanked: Array<{ row: SearchRow; similarity: number }>,
  lexicalRanked: Array<{ row: SearchRow; score: number }>,
  limit: number,
): Array<{ row: SearchRow; similarity: number }> {
  const scores = new Map<number, { fused: number; row: SearchRow; similarity: number }>();
  const k = 60;

  semanticRanked.forEach((entry, index) => {
    const base = scores.get(entry.row.id);
    const value = 1 / (k + index + 1);
    if (base) {
      base.fused += value;
      base.similarity = Math.max(base.similarity, entry.similarity);
    } else {
      scores.set(entry.row.id, { fused: value, row: entry.row, similarity: entry.similarity });
    }
  });

  lexicalRanked.forEach((entry, index) => {
    const base = scores.get(entry.row.id);
    const value = 1 / (k + index + 1);
    if (base) {
      base.fused += value;
    } else {
      scores.set(entry.row.id, { fused: value, row: entry.row, similarity: 0 });
    }
  });

  return Array.from(scores.values())
    .sort((left, right) => right.fused - left.fused)
    .slice(0, limit)
    .map((entry) => ({ row: entry.row, similarity: entry.similarity }));
}

export class KBSearcher {
  private readonly indexer: KBIndexer;
  private readonly embeddingService: KBEmbeddingService;
  private readonly queryCache = new Map<string, number[]>();

  constructor(input: { indexer: KBIndexer; embeddingService: KBEmbeddingService }) {
    this.indexer = input.indexer;
    this.embeddingService = input.embeddingService;
  }

  async search(query: string, scopes: string[], limit = 10): Promise<KnowledgeBaseSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const queryVector = await this.getQueryEmbedding(trimmed);
    const rows = this.indexer.listChunksByScopes(scopes) as SearchRow[];
    const semanticRanked = rows
      .map((row) => {
        const chunkVector = parseEmbeddingJson(row.embedding_json);
        if (!chunkVector) return null;
        const similarity = cosineSimilarity(queryVector, chunkVector);
        return {
          row,
          similarity,
        };
      })
      .filter((entry): entry is { row: SearchRow; similarity: number } => Boolean(entry))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, Math.max(5, Math.min(250, limit * 6)));

    const lexicalRanked = rows
      .map((row) => ({ row, score: lexicalScore(trimmed, row) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(5, Math.min(250, limit * 6)));

    const fused = reciprocalRankFuse(semanticRanked, lexicalRanked, Math.max(1, Math.min(100, limit)));

    return fused.map(({ row, similarity }) => ({
      filePath: row.file_path,
      scope: row.scope,
      title: row.title ?? row.file_path,
      snippet: clipSnippet(row.content),
      similarity,
      chunkIndex: row.chunk_index,
    }));
  }

  async searchWithContext(query: string, scopes: string[], limit = 10): Promise<KnowledgeBaseSearchResult[]> {
    const base = await this.search(query, scopes, limit);
    if (base.length === 0) return base;

    const nodes = this.indexer.listChunksByScopes(scopes) as SearchRow[];
    const byPathAndChunk = new Map<string, SearchRow>();
    for (const row of nodes) {
      byPathAndChunk.set(`${row.file_path}::${row.chunk_index}`, row);
    }

    return base.map((result) => {
      const anchor = byPathAndChunk.get(`${result.filePath}::${result.chunkIndex}`);
      if (!anchor) return result;

      const neighborContext = this.indexer
        .listNeighborChunks(anchor.node_id, anchor.chunk_index)
        .map((item) => item.content.trim())
        .filter(Boolean)
        .join("\n\n");

      const relatedContext = this.indexer
        .listRelatedNodeIds(anchor.node_id, 2)
        .map((relatedId) => this.indexer.getNodePrimaryChunk(relatedId))
        .filter((item): item is { file_path: string; title: string | null; content: string } => Boolean(item))
        .map((item) => `Related: ${item.title ?? item.file_path}\n${clipSnippet(item.content, 180)}`)
        .join("\n\n");

      const context = [neighborContext, relatedContext].filter(Boolean).join("\n\n");
      return { ...result, context };
    });
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    const cached = this.queryCache.get(query);
    if (cached) return cached;
    const embedded = await this.embeddingService.embed(query);
    if (this.queryCache.size >= 128) {
      const oldestKey = this.queryCache.keys().next().value as string | undefined;
      if (oldestKey) this.queryCache.delete(oldestKey);
    }
    this.queryCache.set(query, embedded.vector);
    return embedded.vector;
  }
}

function parseEmbeddingJson(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item) => typeof item === "number") as number[];
  } catch {
    return null;
  }
}
