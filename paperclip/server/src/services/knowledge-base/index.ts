export { KBFileManager, resolveKnowledgeBaseRoot, type KnowledgeBaseWatcherEvent } from "./file-manager.js";
export { KBEmbeddingService, cosineSimilarity } from "./embeddings.js";
export { KBIndexer } from "./indexer.js";
export { KBSearcher, type KnowledgeBaseSearchResult } from "./searcher.js";
export { normalizeKbAccess, canReadScope, canWriteScope, canSearchScope, resolveSearchScopes } from "./access.js";
export {
  ensureKnowledgeBaseRuntime,
  shutdownKnowledgeBaseRuntime,
  createWikiEntry,
} from "./runtime.js";
export { normalizeScope, normalizeScopeList, scopeMatchesAny, normalizeRelativeKbPath, resolveKbScopeFromRelativePath } from "./scopes.js";

