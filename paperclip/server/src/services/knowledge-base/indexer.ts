import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { KBFileManager } from "./file-manager.js";
import { KBEmbeddingService } from "./embeddings.js";
import { normalizeRelativeKbPath, scopeMatchesAny } from "./scopes.js";

type ChunkRecord = {
  index: number;
  content: string;
};

type ChunkRow = {
  id: number;
  node_id: number;
  chunk_index: number;
  content: string;
  embedding_json: string | null;
  scope: string;
  file_path: string;
  title: string | null;
};

type SqliteMasterRow = {
  type: string;
  sql: string | null;
};

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function extractTitle(content: string, fallback: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  if (heading) return heading.replace(/^#+\s*/, "").trim() || fallback;
  return fallback;
}

function estimateTokenCount(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.floor(words * 1.3));
}

function buildChunks(content: string): ChunkRecord[] {
  const paragraphs = content
    .split(/\r?\n\s*\r?\n/g)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (paragraphs.length === 0) return [];

  const minTokens = 200;
  const targetTokens = 320;
  const maxTokens = 500;
  const overlapTokens = 50;
  const chunks: ChunkRecord[] = [];

  let buffer: string[] = [];
  let bufferTokens = 0;
  const flush = () => {
    if (buffer.length === 0) return;
    const contentValue = buffer.join("\n\n").trim();
    if (!contentValue) {
      buffer = [];
      bufferTokens = 0;
      return;
    }
    chunks.push({ index: chunks.length, content: contentValue });
    const words = contentValue.split(/\s+/).filter(Boolean);
    const overlapWordCount = Math.max(1, Math.floor(overlapTokens / 1.3));
    const overlap = words.slice(-overlapWordCount).join(" ");
    buffer = overlap ? [overlap] : [];
    bufferTokens = estimateTokenCount(overlap);
  };

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokenCount(paragraph);
    const wouldExceed = bufferTokens + paragraphTokens > maxTokens;
    if (wouldExceed && bufferTokens >= minTokens) flush();

    buffer.push(paragraph);
    bufferTokens += paragraphTokens;
    if (bufferTokens >= targetTokens) flush();
  }

  if (buffer.length > 0) {
    const merged = buffer.join("\n\n").trim();
    if (merged) chunks.push({ index: chunks.length, content: merged });
  }
  return chunks;
}

function sqliteNow(): string {
  return new Date().toISOString();
}

function isExternalLink(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}

function toLinkedRelativePath(baseRelativePath: string, href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || isExternalLink(trimmed)) return null;
  const [withoutQuery] = trimmed.split("?");
  const [withoutFragment] = withoutQuery.split("#");
  if (!withoutFragment) return null;
  const baseDir = path.posix.dirname(baseRelativePath);
  const candidate = withoutFragment.startsWith("/")
    ? withoutFragment.slice(1)
    : path.posix.join(baseDir, withoutFragment);
  const withExtension = candidate.toLowerCase().endsWith(".md") ? candidate : `${candidate}.md`;
  try {
    return normalizeRelativeKbPath(withExtension);
  } catch {
    return null;
  }
}

function extractLinkedRelativePaths(content: string, baseRelativePath: string): string[] {
  const found = new Set<string>();
  const markdownLinkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
  const wikiLinkRegex = /\[\[([^[\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g;

  let markdownMatch: RegExpExecArray | null = markdownLinkRegex.exec(content);
  while (markdownMatch) {
    const linked = toLinkedRelativePath(baseRelativePath, markdownMatch[1] ?? "");
    if (linked) found.add(linked);
    markdownMatch = markdownLinkRegex.exec(content);
  }

  let wikiMatch: RegExpExecArray | null = wikiLinkRegex.exec(content);
  while (wikiMatch) {
    const linked = toLinkedRelativePath(baseRelativePath, wikiMatch[1] ?? "");
    if (linked) found.add(linked);
    wikiMatch = wikiLinkRegex.exec(content);
  }

  found.delete(baseRelativePath);
  return Array.from(found);
}

type VectorCapability =
  | { available: true; backend: "sqlite-vec"; extensionPath: string | null; detail: string }
  | { available: false; backend: "none"; extensionPath: string | null; reason: string };

function candidateVectorExtensionPaths(): string[] {
  const fromEnv = process.env.PAPERCLIP_SQLITE_VEC_EXTENSION_PATH?.trim();
  const cwd = process.cwd();
  const candidates = [
    fromEnv ?? "",
    path.resolve(cwd, "vendor/sqlite-extensions/vec0.dll"),
    path.resolve(cwd, "../vendor/sqlite-extensions/vec0.dll"),
    path.resolve(cwd, "../../vendor/sqlite-extensions/vec0.dll"),
    path.resolve(cwd, "vendor/sqlite-extensions/vec0.dylib"),
    path.resolve(cwd, "../vendor/sqlite-extensions/vec0.dylib"),
    path.resolve(cwd, "../../vendor/sqlite-extensions/vec0.dylib"),
    path.resolve(cwd, "vendor/sqlite-extensions/vec0.so"),
    path.resolve(cwd, "../vendor/sqlite-extensions/vec0.so"),
    path.resolve(cwd, "../../vendor/sqlite-extensions/vec0.so"),
  ].filter(Boolean);
  return Array.from(new Set(candidates.map((item) => path.resolve(item))));
}

function ensureVecChunksTable(db: DatabaseSync, dbPath: string): {
  vecExtensionLoaded: boolean;
  vectorCapability: VectorCapability;
} {
  const extensionCandidates = candidateVectorExtensionPaths();
  const envExtensionPath = process.env.PAPERCLIP_SQLITE_VEC_EXTENSION_PATH?.trim() || null;
  let extensionPath: string | null = envExtensionPath;
  let loaded = false;
  let reason = "sqlite-vec extension path is not configured";
  const existingPath = extensionCandidates.find((candidate) => fs.existsSync(candidate));
  if (existingPath) {
    extensionPath = existingPath;
    try {
      db.enableLoadExtension(true);
      db.loadExtension(existingPath);
      loaded = true;
      reason = "";
    } catch (error) {
      loaded = false;
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      reason = `sqlite-vec failed to load from ${existingPath}: ${errorMessage}`;
    }
  } else if (envExtensionPath) {
    reason = `sqlite-vec extension path not found: ${path.resolve(envExtensionPath)}`;
  }

  try {
    if (loaded) {
      const current = db
        .prepare("SELECT type, sql FROM sqlite_master WHERE name = 'vec_chunks'")
        .get() as SqliteMasterRow | undefined;
      const isVirtualVec = current?.sql?.toLowerCase().includes("using vec0") ?? false;
      if (current && !isVirtualVec && current.type === "table") {
        db.exec("DROP TABLE vec_chunks;");
      }
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[768]);");
    } else {
      db.exec("CREATE TABLE IF NOT EXISTS vec_chunks (chunk_id INTEGER PRIMARY KEY, embedding_json TEXT NOT NULL);");
    }
  } catch {
    db.exec("CREATE TABLE IF NOT EXISTS vec_chunks (chunk_id INTEGER PRIMARY KEY, embedding_json TEXT NOT NULL);");
    loaded = false;
    if (!reason) reason = "sqlite-vec virtual table init failed; using JSON fallback";
  }

  void dbPath;
  return {
    vecExtensionLoaded: loaded,
    vectorCapability: loaded
      ? {
        available: true,
        backend: "sqlite-vec",
        extensionPath: extensionPath ? path.resolve(extensionPath) : null,
        detail: "sqlite-vec extension loaded successfully",
      }
      : {
        available: false,
        backend: "none",
        extensionPath: extensionPath ? path.resolve(extensionPath) : null,
        reason,
      },
  };
}

export class KBIndexer {
  private readonly fileManager: KBFileManager;
  private readonly embeddingService: KBEmbeddingService;
  private readonly db: DatabaseSync;
  private readonly vecExtensionLoaded: boolean;
  private readonly vectorCapability: VectorCapability;

  constructor(input: {
    fileManager: KBFileManager;
    embeddingService: KBEmbeddingService;
    dbPath?: string;
  }) {
    this.fileManager = input.fileManager;
    this.embeddingService = input.embeddingService;
    const dbPath = path.resolve(input.dbPath ?? this.fileManager.resolveAbsolutePath("memory.db"));
    this.db = new DatabaseSync(dbPath, { allowExtension: true });
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS nodes (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  file_path TEXT UNIQUE NOT NULL,",
        "  scope TEXT NOT NULL,",
        "  title TEXT,",
        "  content_hash TEXT,",
        "  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        ");",
        "CREATE TABLE IF NOT EXISTS chunks (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,",
        "  chunk_index INTEGER NOT NULL,",
        "  content TEXT NOT NULL,",
        "  embedding_json TEXT,",
        "  scope TEXT NOT NULL,",
        "  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        ");",
        "CREATE INDEX IF NOT EXISTS chunks_scope_idx ON chunks(scope);",
        "CREATE INDEX IF NOT EXISTS chunks_node_chunk_idx ON chunks(node_id, chunk_index);",
        "CREATE TABLE IF NOT EXISTS edges (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  source_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,",
        "  target_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,",
        "  relation TEXT NOT NULL,",
        "  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        ");",
        "CREATE UNIQUE INDEX IF NOT EXISTS edges_unique_idx ON edges(source_id, target_id, relation);",
      ].join("\n"),
    );
    const vec = ensureVecChunksTable(this.db, dbPath);
    this.vecExtensionLoaded = vec.vecExtensionLoaded;
    this.vectorCapability = vec.vectorCapability;
  }

  close(): void {
    this.db.close();
  }

  getDb(): DatabaseSync {
    return this.db;
  }

  getVectorCapability(): VectorCapability {
    return this.vectorCapability;
  }

  async indexDocument(relativePathInput: string): Promise<{
    status: "indexed" | "skipped";
    relativePath: string;
    chunks: number;
    scope: string;
  }> {
    const relativePath = normalizeRelativeKbPath(relativePathInput);
    const document = await this.fileManager.readDocument(relativePath);
    const contentHash = hashContent(document.content);
    const existing = this.db
      .prepare("SELECT id, content_hash FROM nodes WHERE file_path = ?")
      .get(document.relativePath) as { id: number; content_hash: string | null } | undefined;
    if (existing?.content_hash === contentHash) {
      return { status: "skipped", relativePath: document.relativePath, chunks: 0, scope: document.scope };
    }

    let nodeId: number;
    if (existing) {
      nodeId = existing.id;
      this.db.prepare("DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE node_id = ?)").run(nodeId);
      this.db.prepare("DELETE FROM chunks WHERE node_id = ?").run(nodeId);
      this.db
        .prepare("UPDATE nodes SET scope = ?, title = ?, content_hash = ?, updated_at = ? WHERE id = ?")
        .run(document.scope, extractTitle(document.content, path.basename(relativePath, ".md")), contentHash, sqliteNow(), nodeId);
    } else {
      const result = this.db
        .prepare("INSERT INTO nodes (file_path, scope, title, content_hash, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(
          document.relativePath,
          document.scope,
          extractTitle(document.content, path.basename(relativePath, ".md")),
          contentHash,
          sqliteNow(),
        );
      nodeId = Number(result.lastInsertRowid);
    }

    const chunks = buildChunks(document.content);
    for (const chunk of chunks) {
      const embedding = await this.embeddingService.embed(chunk.content);
      const result = this.db
        .prepare(
          "INSERT INTO chunks (node_id, chunk_index, content, embedding_json, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(nodeId, chunk.index, chunk.content, JSON.stringify(embedding.vector), document.scope, sqliteNow());
      const chunkId = Number(result.lastInsertRowid);

      if (this.vecExtensionLoaded) {
        try {
          this.db.prepare("INSERT OR REPLACE INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)").run(
            chunkId,
            JSON.stringify(embedding.vector),
          );
        } catch {
          try {
            this.db.prepare("INSERT OR REPLACE INTO vec_chunks (chunk_id, embedding_json) VALUES (?, ?)").run(
              chunkId,
              JSON.stringify(embedding.vector),
            );
          } catch {
            // Some sqlite-vec builds require binary vector binding; keep chunks.embedding_json as fallback.
          }
        }
      } else {
        this.db.prepare("INSERT OR REPLACE INTO vec_chunks (chunk_id, embedding_json) VALUES (?, ?)").run(
          chunkId,
          JSON.stringify(embedding.vector),
        );
      }
    }

    this.db.prepare("DELETE FROM edges WHERE source_id = ? AND relation = ?").run(nodeId, "links_to");
    const linkedPaths = extractLinkedRelativePaths(document.content, document.relativePath);
    for (const linkedPath of linkedPaths) {
      const target = this.db.prepare("SELECT id FROM nodes WHERE file_path = ?").get(linkedPath) as { id: number } | undefined;
      if (!target) continue;
      this.db
        .prepare("INSERT OR IGNORE INTO edges (source_id, target_id, relation, created_at) VALUES (?, ?, ?, ?)")
        .run(nodeId, target.id, "links_to", sqliteNow());
    }

    return { status: "indexed", relativePath: document.relativePath, chunks: chunks.length, scope: document.scope };
  }

  async removeDocument(relativePathInput: string): Promise<boolean> {
    const relativePath = normalizeRelativeKbPath(relativePathInput);
    const existing = this.db
      .prepare("SELECT id FROM nodes WHERE file_path = ?")
      .get(relativePath) as { id: number } | undefined;
    if (!existing) return false;
    this.db.prepare("DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE node_id = ?)").run(existing.id);
    this.db.prepare("DELETE FROM chunks WHERE node_id = ?").run(existing.id);
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(existing.id);
    return true;
  }

  async updateDocument(relativePathInput: string): Promise<{
    status: "indexed" | "skipped";
    relativePath: string;
    chunks: number;
    scope: string;
  }> {
    return this.indexDocument(relativePathInput);
  }

  async indexAll(): Promise<{ indexed: number; skipped: number }> {
    const docs = await this.fileManager.listDocuments();
    let indexed = 0;
    let skipped = 0;
    for (const doc of docs) {
      const result = await this.indexDocument(doc.relativePath);
      if (result.status === "indexed") indexed += 1;
      if (result.status === "skipped") skipped += 1;
    }
    return { indexed, skipped };
  }

  getStats(): { nodes: number; chunks: number; scopes: number } {
    const nodeCount = this.db.prepare("SELECT COUNT(*) AS count FROM nodes").get() as { count: number };
    const chunkCount = this.db.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number };
    const scopeCount = this.db.prepare("SELECT COUNT(DISTINCT scope) AS count FROM nodes").get() as { count: number };
    return { nodes: Number(nodeCount.count), chunks: Number(chunkCount.count), scopes: Number(scopeCount.count) };
  }

  listChunksByScopes(scopes: string[]): ChunkRow[] {
    const rows = this.db
      .prepare(
        [
          "SELECT c.id, c.node_id, c.chunk_index, c.content, c.embedding_json, c.scope, n.file_path, n.title",
          "FROM chunks c",
          "INNER JOIN nodes n ON n.id = c.node_id",
        ].join("\n"),
      )
      .all() as ChunkRow[];
    if (scopes.length === 0) return rows;
    return rows.filter((row) => scopeMatchesAny(row.scope, scopes));
  }

  listNeighborChunks(nodeId: number, chunkIndex: number): Array<{ chunk_index: number; content: string }> {
    return this.db
      .prepare(
        [
          "SELECT chunk_index, content",
          "FROM chunks",
          "WHERE node_id = ? AND chunk_index >= ? AND chunk_index <= ?",
          "ORDER BY chunk_index ASC",
        ].join("\n"),
      )
      .all(nodeId, chunkIndex - 1, chunkIndex + 1) as Array<{ chunk_index: number; content: string }>;
  }

  listRelatedNodeIds(nodeId: number, limit = 4): number[] {
    const rows = this.db
      .prepare(
        [
          "SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END AS related_id",
          "FROM edges",
          "WHERE (source_id = ? OR target_id = ?) AND relation = ?",
          "ORDER BY created_at DESC",
          "LIMIT ?",
        ].join("\n"),
      )
      .all(nodeId, nodeId, nodeId, "links_to", limit) as Array<{ related_id: number }>;
    return rows.map((row) => Number(row.related_id)).filter((value) => Number.isFinite(value));
  }

  getNodePrimaryChunk(nodeId: number): { file_path: string; title: string | null; content: string } | null {
    const row = this.db
      .prepare(
        [
          "SELECT n.file_path, n.title, c.content",
          "FROM nodes n",
          "INNER JOIN chunks c ON c.node_id = n.id",
          "WHERE n.id = ?",
          "ORDER BY c.chunk_index ASC",
          "LIMIT 1",
        ].join("\n"),
      )
      .get(nodeId) as { file_path: string; title: string | null; content: string } | undefined;
    return row ?? null;
  }
}
