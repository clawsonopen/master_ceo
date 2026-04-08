import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KBEmbeddingService } from "../services/knowledge-base/embeddings.js";
import { KBFileManager } from "../services/knowledge-base/file-manager.js";
import { KBIndexer } from "../services/knowledge-base/indexer.js";
import { KBSearcher } from "../services/knowledge-base/searcher.js";
import { canReadScope, canWriteScope, normalizeKbAccess } from "../services/knowledge-base/access.js";

async function createTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kb-"));
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}

async function createRuntimeForTest() {
  const root = await createTempRoot();
  const fileManager = new KBFileManager(root);
  await fileManager.scaffoldBaseStructure();
  const embeddingService = new KBEmbeddingService({ disableRemoteEmbeddings: true });
  const indexer = new KBIndexer({ fileManager, embeddingService });
  const searcher = new KBSearcher({ indexer, embeddingService });
  return { root, fileManager, embeddingService, indexer, searcher };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("knowledge base services", () => {
  it("writes and indexes markdown documents for semantic search", async () => {
    const runtime = await createRuntimeForTest();
    try {
      await runtime.fileManager.writeDocument("Global_Holding/wiki/roadmap.md", "# Roadmap\n\nKnowledge base phase active.");
      const indexed = await runtime.indexer.indexDocument("Global_Holding/wiki/roadmap.md");
      const stats = runtime.indexer.getStats();
      const results = await runtime.searcher.search("knowledge base phase", ["global"], 5);

      expect(indexed.status).toBe("indexed");
      expect(stats.nodes).toBeGreaterThan(0);
      expect(stats.chunks).toBeGreaterThan(0);
      expect(results.some((result) => result.filePath === "Global_Holding/wiki/roadmap.md")).toBe(true);
    } finally {
      runtime.indexer.close();
      await fs.rm(runtime.root, { recursive: true, force: true });
    }
  });

  it("applies scope filtering to search and access control", async () => {
    const runtime = await createRuntimeForTest();
    try {
      await runtime.fileManager.writeDocument("Global_Holding/wiki/global.md", "# Global\n\nShared strategy.");
      await runtime.fileManager.writeDocument("Intelligence/wiki/intel.md", "# Intel\n\nPrivate intel signal.");
      await runtime.indexer.indexAll();

      const globalOnly = await runtime.searcher.search("signal strategy", ["global"], 10);
      expect(globalOnly.every((result) => result.scope === "global")).toBe(true);

      const access = normalizeKbAccess({ read: ["global"], write: ["global"], search: ["global"] });
      expect(canReadScope(access, "global")).toBe(true);
      expect(canReadScope(access, "intelligence")).toBe(false);
      expect(canWriteScope(access, "global")).toBe(true);
      expect(canWriteScope(access, "intelligence")).toBe(false);
    } finally {
      runtime.indexer.close();
      await fs.rm(runtime.root, { recursive: true, force: true });
    }
  });

  it("re-indexes only when document hash changes", async () => {
    const runtime = await createRuntimeForTest();
    try {
      await runtime.fileManager.writeDocument("Global_Holding/wiki/hash-test.md", "# Hash\n\nFirst version.");
      const first = await runtime.indexer.indexDocument("Global_Holding/wiki/hash-test.md");
      const second = await runtime.indexer.updateDocument("Global_Holding/wiki/hash-test.md");
      await runtime.fileManager.writeDocument("Global_Holding/wiki/hash-test.md", "# Hash\n\nSecond version with update.");
      const third = await runtime.indexer.updateDocument("Global_Holding/wiki/hash-test.md");

      expect(first.status).toBe("indexed");
      expect(second.status).toBe("skipped");
      expect(third.status).toBe("indexed");
    } finally {
      runtime.indexer.close();
      await fs.rm(runtime.root, { recursive: true, force: true });
    }
  });

  it("falls back embedding provider chain to tfidf when remote providers fail", async () => {
    const fetchMock = vi.fn(async () => new Response("fail", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const embedding = new KBEmbeddingService({
      disableRemoteEmbeddings: false,
      runtimeCredentialsResolver: async () => [
        { provider: "gemini", key: "gemini-key" },
        { provider: "openrouter", key: "openrouter-key" },
      ],
    });

    const result = await embedding.embed("fallback resilience check");
    expect(result.provider).toBe("tfidf");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("auto-indexes new files and updates wiki log through watcher", async () => {
    const runtime = await createRuntimeForTest();
    const events: string[] = [];
    const watcher = runtime.fileManager.watchDirectory(async (event) => {
      events.push(`${event.event}:${event.relativePath}`);
      if (event.event === "unlink") {
        await runtime.indexer.removeDocument(event.relativePath);
        await runtime.fileManager.appendWikiLogEntry({
          targetRelativePath: event.relativePath,
          actorName: "system",
          action: "deleted",
        });
        return;
      }
      const result = await runtime.indexer.updateDocument(event.relativePath);
      if (result.status === "indexed") {
        await runtime.fileManager.appendWikiLogEntry({
          targetRelativePath: event.relativePath,
          actorName: "system",
          action: event.event === "add" ? "created" : "updated",
        });
      }
    });

    try {
      await new Promise<void>((resolve) => {
        watcher.once("ready", () => resolve());
      });
      const targetPath = runtime.fileManager.resolveAbsolutePath("Intelligence/wiki/watcher-case.md");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, "# Watcher\n\nAuto-index me.", "utf8");
      await waitFor(() => events.length > 0);
      await waitFor(() => runtime.indexer.getStats().nodes >= 1);
      await waitFor(async () => {
        const log = await runtime.fileManager.readDocument("Intelligence/wiki/log.md").catch(() => null);
        return Boolean(log?.content.includes("watcher-case.md"));
      });
      const results = await runtime.searcher.search("auto-index", ["intelligence"], 5);
      expect(results.some((item) => item.filePath === "Intelligence/wiki/watcher-case.md")).toBe(true);
    } finally {
      await watcher.close();
      runtime.indexer.close();
      await fs.rm(runtime.root, { recursive: true, force: true });
    }
  }, 15_000);

  it("coalesces rapid watcher updates without breaking final index state", async () => {
    const runtime = await createRuntimeForTest();
    const watcher = runtime.fileManager.watchDirectory(async (event) => {
      if (event.event === "unlink") {
        await runtime.indexer.removeDocument(event.relativePath);
        return;
      }
      await runtime.indexer.updateDocument(event.relativePath);
    });

    try {
      await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
      const targetPath = runtime.fileManager.resolveAbsolutePath("Global_Holding/wiki/rapid.md");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, "# Rapid\n\nVersion 1", "utf8");
      await fs.writeFile(targetPath, "# Rapid\n\nVersion 2", "utf8");
      await fs.writeFile(targetPath, "# Rapid\n\nVersion 3 final", "utf8");

      await waitFor(async () => {
        const results = await runtime.searcher.search("Version 3 final", ["global"], 3);
        return results.some((item) => item.filePath === "Global_Holding/wiki/rapid.md");
      }, 8_000);
    } finally {
      await watcher.close();
      runtime.indexer.close();
      await fs.rm(runtime.root, { recursive: true, force: true });
    }
  }, 15_000);

  it("includes related linked document context when using searchWithContext", async () => {
    const runtime = await createRuntimeForTest();
    try {
      await runtime.fileManager.writeDocument(
        "Global_Holding/wiki/alpha.md",
        "# Alpha\n\nPrimary planning note.\n\nSee [Beta](beta.md) for implementation details.",
      );
      await runtime.fileManager.writeDocument(
        "Global_Holding/wiki/beta.md",
        "# Beta\n\nImplementation details and rollout checklist.",
      );
      await runtime.indexer.indexDocument("Global_Holding/wiki/beta.md");
      await runtime.indexer.indexDocument("Global_Holding/wiki/alpha.md");

      const results = await runtime.searcher.searchWithContext("planning note", ["global"], 5);
      const alpha = results.find((item) => item.filePath === "Global_Holding/wiki/alpha.md");
      expect(alpha).toBeTruthy();
      expect(alpha?.context).toContain("Related: Beta");
      expect(alpha?.context).toContain("Implementation details");
    } finally {
      runtime.indexer.close();
      await fs.rm(runtime.root, { recursive: true, force: true });
    }
  });
});
