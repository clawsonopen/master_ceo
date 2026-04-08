import type { Db } from "@paperclipai/db";
import type { FSWatcher } from "chokidar";
import { logger } from "../../middleware/logger.js";
import { apiKeyService } from "../api-keys.js";
import { KBEmbeddingService } from "./embeddings.js";
import { KBFileManager } from "./file-manager.js";
import { KBIndexer } from "./indexer.js";
import { KBSearcher } from "./searcher.js";
import { normalizeRelativeKbPath, normalizeScope, sanitizePathSegment } from "./scopes.js";

type KnowledgeBaseRuntime = {
  fileManager: KBFileManager;
  embeddingService: KBEmbeddingService;
  indexer: KBIndexer;
  searcher: KBSearcher;
  startWatcher: () => Promise<void>;
  stopWatcher: () => Promise<void>;
};

let runtimePromise: Promise<KnowledgeBaseRuntime> | null = null;

function resolveScopeRootPath(scope: string): string {
  const normalized = normalizeScope(scope);
  if (normalized === "global") return "Global_Holding/wiki";
  if (normalized === "intelligence") return "Intelligence/wiki";
  const segments = normalized.split("/");
  if (segments[0] === "companies" && segments[1]) {
    if (segments[2] === "projects" && segments[3]) {
      return `Companies/${segments[1]}/projects/${segments[3]}/wiki`;
    }
    return `Companies/${segments[1]}/wiki`;
  }
  throw new Error(`Unknown scope: ${scope}`);
}

function toWikiEntryPath(scope: string, title: string): string {
  const root = resolveScopeRootPath(scope);
  const slug = sanitizePathSegment(title).replace(/\.md$/i, "");
  return normalizeRelativeKbPath(`${root}/${slug}.md`);
}

async function createRuntime(db: Db): Promise<KnowledgeBaseRuntime> {
  const fileManager = new KBFileManager();
  await fileManager.scaffoldBaseStructure();
  const runtimeCredentials = apiKeyService(db);
  const embeddingService = new KBEmbeddingService({
    runtimeCredentialsResolver: async () => runtimeCredentials.listResolvedForRuntime(),
  });
  const indexer = new KBIndexer({ fileManager, embeddingService });
  await indexer.indexAll();
  const searcher = new KBSearcher({ indexer, embeddingService });

  let watcher: FSWatcher | null = null;
  let watcherReady = false;
  let watcherInFlight = Promise.resolve();
  const debounceMs = Math.max(100, Number(process.env.PAPERCLIP_KB_WATCH_DEBOUNCE_MS ?? 300));
  const watcherTimers = new Map<string, NodeJS.Timeout>();
  const pendingEvents = new Map<string, "add" | "change" | "unlink">();

  const mergeEvent = (
    previousEvent: "add" | "change" | "unlink" | undefined,
    incomingEvent: "add" | "change" | "unlink",
  ): "add" | "change" | "unlink" => {
    if (!previousEvent) return incomingEvent;
    if (incomingEvent === "unlink") return "unlink";
    if (incomingEvent === "add") return "add";
    if (previousEvent === "add") return "add";
    if (previousEvent === "unlink" && incomingEvent === "change") return "change";
    return "change";
  };

  const handleWatcherEvent = async (event: { event: "add" | "change" | "unlink"; relativePath: string }) => {
    const normalizedPath = normalizeRelativeKbPath(event.relativePath);
    try {
      if (event.event === "unlink") {
        await indexer.removeDocument(normalizedPath);
        await fileManager.appendWikiLogEntry({
          targetRelativePath: normalizedPath,
          actorName: "system",
          action: "deleted",
        });
        return;
      }
      const result = await indexer.updateDocument(normalizedPath);
      if (result.status === "indexed") {
        await fileManager.appendWikiLogEntry({
          targetRelativePath: normalizedPath,
          actorName: "system",
          action: event.event === "add" ? "created" : "updated",
        });
      }
    } catch (error) {
      logger.warn({ err: error, relativePath: normalizedPath }, "Knowledge base watcher event failed");
    }
  };

  const startWatcher = async () => {
    if (watcherReady) return;
    watcher = fileManager.watchDirectory((event) => {
      const normalizedPath = normalizeRelativeKbPath(event.relativePath);
      const mergedEvent = mergeEvent(pendingEvents.get(normalizedPath), event.event);
      pendingEvents.set(normalizedPath, mergedEvent);
      const existingTimer = watcherTimers.get(normalizedPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const timer = setTimeout(() => {
        watcherTimers.delete(normalizedPath);
        const pendingEvent = pendingEvents.get(normalizedPath);
        if (!pendingEvent) return;
        pendingEvents.delete(normalizedPath);
        watcherInFlight = watcherInFlight.then(() =>
          handleWatcherEvent({ event: pendingEvent, relativePath: normalizedPath })
        );
      }, debounceMs);
      watcherTimers.set(normalizedPath, timer);
      return Promise.resolve();
    });
    watcherReady = true;
  };

  const stopWatcher = async () => {
    if (!watcherReady || !watcher) return;
    for (const timer of watcherTimers.values()) {
      clearTimeout(timer);
    }
    watcherTimers.clear();
    pendingEvents.clear();
    await watcher.close();
    await watcherInFlight;
    watcherReady = false;
    watcher = null;
  };

  return {
    fileManager,
    embeddingService,
    indexer,
    searcher,
    startWatcher,
    stopWatcher,
  };
}

export async function ensureKnowledgeBaseRuntime(
  db: Db,
  options?: { startWatcher?: boolean },
): Promise<KnowledgeBaseRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime(db);
  }
  const runtime = await runtimePromise;
  if (options?.startWatcher) {
    await runtime.startWatcher();
  }
  return runtime;
}

export async function shutdownKnowledgeBaseRuntime(): Promise<void> {
  if (!runtimePromise) return;
  const runtime = await runtimePromise;
  await runtime.stopWatcher();
  runtime.indexer.close();
  runtimePromise = null;
}

export async function createWikiEntry(
  runtime: KnowledgeBaseRuntime,
  input: { scope: string; title: string; content: string; actorName: string },
): Promise<{ path: string; scope: string }> {
  const relativePath = toWikiEntryPath(input.scope, input.title);
  const writeResult = await runtime.fileManager.writeDocument(relativePath, input.content);
  await runtime.indexer.updateDocument(relativePath);
  await runtime.fileManager.appendWikiLogEntry({
    targetRelativePath: relativePath,
    actorName: input.actorName,
    action: "created",
  });
  return { path: relativePath, scope: writeResult.scope };
}
