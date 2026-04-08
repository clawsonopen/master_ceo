import { api } from "./client";

export type KBDocumentEntry = {
  relativePath: string;
  scope: string;
};

export type KBReadResponse = {
  ok: boolean;
  path: string;
  scope: string;
  content: string;
  error?: string;
};

export type KBListResponse = {
  ok: boolean;
  documents: KBDocumentEntry[];
  error?: string;
};

export type KBWriteResponse = {
  ok: boolean;
  path: string;
  scope: string;
  error?: string;
};

export type KBSearchResult = {
  filePath: string;
  scope: string;
  score: number;
  snippet?: string;
  chunkId?: string;
};

export type KBSearchResponse = {
  ok: boolean;
  query: string;
  scopes: string[];
  results: KBSearchResult[];
  error?: string;
};

function assertOk<T extends { ok: boolean; error?: string }>(response: T): T {
  if (!response.ok) {
    throw new Error(response.error ?? "Knowledge base request failed");
  }
  return response;
}

export const knowledgeBaseApi = {
  async list(directory = ""): Promise<KBListResponse> {
    const qs = directory.trim().length > 0
      ? `?directory=${encodeURIComponent(directory)}`
      : "";
    return assertOk(await api.get<KBListResponse>(`/knowledge-base/list${qs}`));
  },

  async read(path: string): Promise<KBReadResponse> {
    return assertOk(await api.get<KBReadResponse>(`/knowledge-base/read?path=${encodeURIComponent(path)}`));
  },

  async write(path: string, content: string): Promise<KBWriteResponse> {
    return assertOk(await api.post<KBWriteResponse>("/knowledge-base/write", { path, content }));
  },

  async search(query: string, scopes?: string[], limit = 20): Promise<KBSearchResponse> {
    return assertOk(await api.post<KBSearchResponse>("/knowledge-base/search", { query, scopes, limit }));
  },
};

