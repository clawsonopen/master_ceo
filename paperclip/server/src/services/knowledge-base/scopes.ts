import path from "node:path";

export type KbAccessMatrix = {
  read: string[];
  write: string[];
  search: string[];
};

export function normalizeScope(scope: string): string {
  return scope.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

export function normalizeScopeList(scopes: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (scopes ?? [])
        .map((scope) => normalizeScope(scope))
        .filter((scope) => scope.length > 0),
    ),
  );
}

export function scopeTokenMatches(scope: string, token: string): boolean {
  const normalizedScope = normalizeScope(scope);
  const normalizedToken = normalizeScope(token);
  if (!normalizedScope || !normalizedToken) return false;
  if (normalizedToken === "*") return true;
  if (normalizedScope === normalizedToken) return true;
  if (normalizedScope.startsWith(`${normalizedToken}/`)) return true;
  if (normalizedToken.endsWith("/*")) {
    const base = normalizedToken.slice(0, -2);
    return normalizedScope === base || normalizedScope.startsWith(`${base}/`);
  }
  return false;
}

export function scopeMatchesAny(scope: string, tokens: string[]): boolean {
  return tokens.some((token) => scopeTokenMatches(scope, token));
}

export function sanitizePathSegment(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

export function normalizeRelativeKbPath(value: string): string {
  const normalized = path.posix.normalize(value.trim().replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Path must stay within the KnowledgeBase root");
  }
  return normalized;
}

export function resolveKbScopeFromRelativePath(relativePath: string): string {
  const normalized = normalizeRelativeKbPath(relativePath);
  const segments = normalized.split("/");
  if (segments[0]?.toLowerCase() === "global_holding") return "global";
  if (segments[0]?.toLowerCase() === "intelligence") return "intelligence";
  if (segments[0]?.toLowerCase() === "companies" && segments[1]) {
    if (segments[2]?.toLowerCase() === "projects" && segments[3]) {
      return normalizeScope(`companies/${segments[1]}/projects/${segments[3]}`);
    }
    return normalizeScope(`companies/${segments[1]}`);
  }
  return "unknown";
}

