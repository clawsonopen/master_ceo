import { Router, type Request, type Response } from "express";
import { performance } from "node:perf_hooks";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { agentService } from "../services/agents.js";
import { ensureKnowledgeBaseRuntime, createWikiEntry } from "../services/knowledge-base/index.js";
import { normalizeKbAccess, canReadScope, canSearchScope, canWriteScope, resolveSearchScopes } from "../services/knowledge-base/access.js";
import { normalizeRelativeKbPath } from "../services/knowledge-base/scopes.js";
import { getKbPolicyMetricsSnapshot, recordKbPolicyDecision } from "../services/knowledge-base/policy-audit.js";

const searchSchema = z.object({
  query: z.string().trim().min(1),
  scopes: z.array(z.string().trim().min(1)).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  withContext: z.boolean().optional(),
});

const readQuerySchema = z.object({
  path: z.string().trim().min(1),
});

const writeSchema = z.object({
  path: z.string().trim().min(1),
  content: z.string(),
});

const listQuerySchema = z.object({
  directory: z.string().trim().optional(),
});

const wikiEntrySchema = z.object({
  scope: z.string().trim().min(1),
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
});

const benchmarkSchema = z.object({
  query: z.string().trim().min(1).optional(),
  scopes: z.array(z.string().trim().min(1)).optional(),
  iterations: z.number().int().min(1).max(20).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

type AgentContext = {
  type: "board";
} | {
  type: "agent";
  agentId: string;
  companyId: string;
  access: ReturnType<typeof normalizeKbAccess>;
  name: string;
};

function respondForbiddenTool(res: Response, message: string) {
  res.status(200).json({ ok: false, error: message });
}

export function knowledgeBaseRoutes(db: Db) {
  const router = Router();
  const agentsSvc = agentService(db);
  const runtimeReady = ensureKnowledgeBaseRuntime(db, { startWatcher: false });

  async function getActorContext(req: Request): Promise<AgentContext> {
    if (req.actor.type === "board") return { type: "board" };
    if (req.actor.type !== "agent" || !req.actor.agentId) {
      throw new Error("Board or agent authentication required");
    }
    const agent = await agentsSvc.getById(req.actor.agentId);
    if (!agent) throw new Error("Agent not found");
    return {
      type: "agent",
      agentId: agent.id,
      companyId: agent.companyId,
      access: normalizeKbAccess(agent.kbAccess),
      name: agent.name,
    };
  }

  router.post("/knowledge-base/search", async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }

    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;

    const runtime = await runtimeReady;
    const requestedScopes = parsed.data.scopes ?? [];
    const scopes = context.type === "board"
      ? requestedScopes
      : resolveSearchScopes(context.access, requestedScopes);

    if (context.type === "agent" && scopes.length === 0) {
      recordKbPolicyDecision({
        action: "search",
        decision: "deny",
        actor: "agent",
        reason: "no_allowed_scopes",
        agentId: context.agentId,
        companyId: context.companyId,
      });
      respondForbiddenTool(res, "search_knowledge_base denied: no allowed scopes");
      return;
    }
    const actorType = context.type === "board" ? "board" : "agent";
    for (const scope of scopes) {
      recordKbPolicyDecision({
        action: "search",
        decision: "allow",
        actor: actorType,
        scope,
        agentId: context.type === "agent" ? context.agentId : undefined,
        companyId: context.type === "agent" ? context.companyId : undefined,
      });
    }

    const results = parsed.data.withContext
      ? await runtime.searcher.searchWithContext(parsed.data.query, scopes, parsed.data.limit ?? 10)
      : await runtime.searcher.search(parsed.data.query, scopes, parsed.data.limit ?? 10);
    res.json({ ok: true, query: parsed.data.query, scopes, results });
  });

  router.get("/knowledge-base/read", async (req, res) => {
    const parsed = readQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request query", details: parsed.error.flatten() });
      return;
    }
    const relativePath = normalizeRelativeKbPath(parsed.data.path);
    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;

    const runtime = await runtimeReady;
    const scope = runtime.fileManager.getScope(relativePath);
    if (context.type === "agent" && !canReadScope(context.access, scope)) {
      recordKbPolicyDecision({
        action: "read",
        decision: "deny",
        actor: "agent",
        scope,
        reason: "scope_not_allowed",
        agentId: context.agentId,
        companyId: context.companyId,
      });
      respondForbiddenTool(res, `read_knowledge_base denied for scope "${scope}"`);
      return;
    }
    recordKbPolicyDecision({
      action: "read",
      decision: "allow",
      actor: context.type === "board" ? "board" : "agent",
      scope,
      agentId: context.type === "agent" ? context.agentId : undefined,
      companyId: context.type === "agent" ? context.companyId : undefined,
    });

    try {
      const doc = await runtime.fileManager.readDocument(relativePath);
      res.json({ ok: true, path: doc.relativePath, scope: doc.scope, content: doc.content });
    } catch {
      res.status(404).json({ error: "Knowledge base document not found" });
    }
  });

  router.post("/knowledge-base/write", async (req, res) => {
    const parsed = writeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const relativePath = normalizeRelativeKbPath(parsed.data.path);
    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;

    const runtime = await runtimeReady;
    const scope = runtime.fileManager.getScope(relativePath);
    if (context.type === "agent" && !canWriteScope(context.access, scope)) {
      recordKbPolicyDecision({
        action: "write",
        decision: "deny",
        actor: "agent",
        scope,
        reason: "scope_not_allowed",
        agentId: context.agentId,
        companyId: context.companyId,
      });
      respondForbiddenTool(res, `write_knowledge_base denied for scope "${scope}"`);
      return;
    }
    recordKbPolicyDecision({
      action: "write",
      decision: "allow",
      actor: context.type === "board" ? "board" : "agent",
      scope,
      agentId: context.type === "agent" ? context.agentId : undefined,
      companyId: context.type === "agent" ? context.companyId : undefined,
    });

    const writeResult = await runtime.fileManager.writeDocument(relativePath, parsed.data.content);
    const indexing = await runtime.indexer.updateDocument(relativePath);
    await runtime.fileManager.appendWikiLogEntry({
      targetRelativePath: relativePath,
      actorName: context.type === "agent" ? context.name : "board",
      action: "updated",
    });
    res.json({
      ok: true,
      path: writeResult.relativePath,
      scope: writeResult.scope,
      indexing,
    });
  });

  router.get("/knowledge-base/list", async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request query", details: parsed.error.flatten() });
      return;
    }
    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;

    const runtime = await runtimeReady;
    const docs = await runtime.fileManager.listDocuments(parsed.data.directory ?? "");
    const filtered = context.type === "board"
      ? docs
      : docs.filter((doc) => canReadScope(context.access, doc.scope));
    const actorType = context.type === "board" ? "board" : "agent";
    for (const doc of filtered) {
      recordKbPolicyDecision({
        action: "list",
        decision: "allow",
        actor: actorType,
        scope: doc.scope,
        agentId: context.type === "agent" ? context.agentId : undefined,
        companyId: context.type === "agent" ? context.companyId : undefined,
      });
    }
    res.json({ ok: true, documents: filtered });
  });

  router.post("/knowledge-base/wiki-entry", async (req, res) => {
    const parsed = wikiEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;

    if (context.type === "agent" && !canWriteScope(context.access, parsed.data.scope)) {
      recordKbPolicyDecision({
        action: "wiki_entry",
        decision: "deny",
        actor: "agent",
        scope: parsed.data.scope,
        reason: "scope_not_allowed",
        agentId: context.agentId,
        companyId: context.companyId,
      });
      respondForbiddenTool(res, `create_wiki_entry denied for scope "${parsed.data.scope}"`);
      return;
    }
    recordKbPolicyDecision({
      action: "wiki_entry",
      decision: "allow",
      actor: context.type === "board" ? "board" : "agent",
      scope: parsed.data.scope,
      agentId: context.type === "agent" ? context.agentId : undefined,
      companyId: context.type === "agent" ? context.companyId : undefined,
    });

    const runtime = await runtimeReady;
    const created = await createWikiEntry(runtime, {
      scope: parsed.data.scope,
      title: parsed.data.title,
      content: parsed.data.content,
      actorName: context.type === "agent" ? context.name : "board",
    });
    res.json({ ok: true, ...created });
  });

  router.get("/knowledge-base/health", async (req, res) => {
    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;
    const runtime = await runtimeReady;
    const stats = runtime.indexer.getStats();
    recordKbPolicyDecision({
      action: "health",
      decision: "allow",
      actor: context.type === "board" ? "board" : "agent",
      agentId: context.type === "agent" ? context.agentId : undefined,
      companyId: context.type === "agent" ? context.companyId : undefined,
    });
    res.json({
      ok: true,
      rootPath: runtime.fileManager.getRootPath(),
      stats,
      vector: runtime.indexer.getVectorCapability(),
      actor: context.type,
    });
  });

  router.post("/knowledge-base/benchmark", async (req, res) => {
    const parsed = benchmarkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;

    const runtime = await runtimeReady;
    const query = parsed.data.query ?? "knowledge base";
    const scopes = context.type === "board"
      ? (parsed.data.scopes ?? [])
      : resolveSearchScopes(context.access, parsed.data.scopes ?? []);
    if (context.type === "agent" && scopes.length === 0) {
      recordKbPolicyDecision({
        action: "benchmark",
        decision: "deny",
        actor: "agent",
        reason: "no_allowed_scopes",
        agentId: context.agentId,
        companyId: context.companyId,
      });
      respondForbiddenTool(res, "benchmark denied: no allowed scopes");
      return;
    }
    const actorType = context.type === "board" ? "board" : "agent";
    for (const scope of scopes) {
      recordKbPolicyDecision({
        action: "benchmark",
        decision: "allow",
        actor: actorType,
        scope,
        agentId: context.type === "agent" ? context.agentId : undefined,
        companyId: context.type === "agent" ? context.companyId : undefined,
      });
    }
    const iterations = parsed.data.iterations ?? 5;
    const limit = parsed.data.limit ?? 10;

    const samples: number[] = [];
    for (let index = 0; index < iterations; index += 1) {
      const start = performance.now();
      await runtime.searcher.search(query, scopes, limit);
      samples.push(performance.now() - start);
    }
    const total = samples.reduce((acc, value) => acc + value, 0);
    const avgMs = total / samples.length;
    const minMs = Math.min(...samples);
    const maxMs = Math.max(...samples);
    res.json({
      ok: true,
      benchmark: {
        query,
        scopes,
        iterations,
        limit,
        avgMs,
        minMs,
        maxMs,
        vector: runtime.indexer.getVectorCapability(),
      },
    });
  });

  router.get("/knowledge-base/policy-metrics", async (req, res) => {
    const context = await getActorContext(req).catch((error) => {
      res.status(403).json({ error: error instanceof Error ? error.message : "Forbidden" });
      return null;
    });
    if (!context) return;
    if (context.type !== "board") {
      respondForbiddenTool(res, "policy metrics are board-only");
      return;
    }
    res.json({ ok: true, metrics: getKbPolicyMetricsSnapshot() });
  });

  return router;
}
