import type { KbAccessMatrix } from "./scopes.js";
import { normalizeScope, normalizeScopeList, scopeMatchesAny } from "./scopes.js";

export function normalizeKbAccess(rawValue: unknown): KbAccessMatrix {
  if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
    return { read: [], write: [], search: [] };
  }
  const record = rawValue as Record<string, unknown>;
  return {
    read: normalizeScopeList(Array.isArray(record.read) ? (record.read as string[]) : []),
    write: normalizeScopeList(Array.isArray(record.write) ? (record.write as string[]) : []),
    search: normalizeScopeList(Array.isArray(record.search) ? (record.search as string[]) : []),
  };
}

export function canSearchScope(access: KbAccessMatrix, scope: string): boolean {
  return scopeMatchesAny(normalizeScope(scope), access.search);
}

export function canReadScope(access: KbAccessMatrix, scope: string): boolean {
  const normalizedScope = normalizeScope(scope);
  return scopeMatchesAny(normalizedScope, access.read) || scopeMatchesAny(normalizedScope, access.search);
}

export function canWriteScope(access: KbAccessMatrix, scope: string): boolean {
  return scopeMatchesAny(normalizeScope(scope), access.write);
}

export function resolveSearchScopes(access: KbAccessMatrix, requestedScopes: string[] | null | undefined): string[] {
  const normalizedRequested = normalizeScopeList(requestedScopes);
  if (normalizedRequested.length === 0) return access.search;
  return normalizedRequested.filter((scope) => canSearchScope(access, scope));
}

