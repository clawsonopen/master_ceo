import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { apiKeyService } from "../services/api-keys.js";
import { providerDiscoveryService } from "../services/provider-discovery.js";
import { getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { forbidden } from "../errors.js";
import { agentService } from "../services/agents.js";
import { ensureKnowledgeBaseRuntime } from "../services/knowledge-base/index.js";
import { normalizeRelativeKbPath, sanitizePathSegment } from "../services/knowledge-base/scopes.js";

const saveApiKeySchema = z.object({
  provider: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  key: z.string().min(1),
  helpUrl: z.string().trim().optional().nullable(),
  testUrl: z.string().trim().optional().nullable(),
  testAuthHeader: z.string().trim().optional().nullable(),
  testAuthPrefix: z.string().trim().optional().nullable(),
});
const routerRecommendationSchema = z.object({
  taskSummary: z.string().optional().nullable(),
  preference: z.enum(["balanced", "quality", "speed", "cost"]).optional(),
  expandColumns: z.array(z.string().trim().min(1).max(64)).max(24).optional(),
});
const routerOverrideSchema = z.object({
  companyId: z.string().uuid().optional().nullable(),
  taskSummary: z.string().optional().nullable(),
  preference: z.enum(["balanced", "quality", "speed", "cost"]).optional(),
  expandColumns: z.array(z.string().trim().min(1).max(64)).max(24).optional(),
  selectedProvider: z.string().trim().min(2).max(64),
  selectedModel: z.string().trim().min(2).max(160),
  rationale: z.string().trim().max(4000).optional().nullable(),
});
const discoveryStartSchema = z.object({
  provider: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  seedUrl: z.string().trim().optional().nullable(),
});
const discoveryListQuerySchema = z.object({
  provider: z.string().trim().optional(),
});
const discoveryPublishParamsSchema = z.object({
  id: z.string().uuid(),
});

function markdownRow(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value).replaceAll("|", "\\|");
}

function buildRouterDecisionMarkdown(input: {
  createdAtIso: string;
  actorName: string;
  taskSummary: string | null;
  companyScope: string;
  selectedProvider: string;
  selectedModel: string;
  suggestedProvider: string;
  suggestedModel: string;
  preference: "balanced" | "quality" | "speed" | "cost";
  rationale: string | null;
  tableColumns: string[];
  candidateTable: Array<Record<string, unknown>>;
}): string {
  const tableHeader = `| ${input.tableColumns.join(" | ")} |`;
  const tableDivider = `| ${input.tableColumns.map(() => "---").join(" | ")} |`;
  const tableRows = input.candidateTable.map((row) =>
    `| ${input.tableColumns.map((column) => markdownRow(row[column])).join(" | ")} |`
  );
  const fm = [
    "---",
    `created_by_agent_name: ${input.actorName}`,
    "requested_by: master_ceo",
    `company_scope: ${input.companyScope}`,
    `created_at: ${input.createdAtIso}`,
    `updated_at: ${input.createdAtIso}`,
    `selected_model: ${input.selectedProvider}/${input.selectedModel}`,
    `suggested_model: ${input.suggestedProvider}/${input.suggestedModel}`,
    "---",
    "",
  ].join("\n");

  return [
    fm,
    "# Router Decision Report",
    "",
    `- Created At: ${input.createdAtIso}`,
    `- Requested By: master_ceo`,
    `- Created By: ${input.actorName}`,
    `- Preference: ${input.preference}`,
    `- Task Summary: ${input.taskSummary ?? "-"}`,
    `- Suggested: ${input.suggestedProvider} / ${input.suggestedModel}`,
    `- Selected: ${input.selectedProvider} / ${input.selectedModel}`,
    `- Rationale: ${input.rationale ?? "-"}`,
    "",
    "## Candidate Table",
    "",
    tableHeader,
    tableDivider,
    ...(tableRows.length > 0 ? tableRows : ["| - |"]),
    "",
  ].join("\n");
}

function assertCanManageApiKeys(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function apiKeySettingsRoutes(db: Db) {
  const router = Router();
  const svc = apiKeyService(db);
  const discoverySvc = providerDiscoveryService(db);
  const agentsSvc = agentService(db);

  async function assertCanReadRuntimeCredentials(req: Request) {
    if (req.actor.type === "board") return;
    if (req.actor.type !== "agent" || !req.actor.agentId) {
      throw forbidden("Board or permitted agent authentication required");
    }
    const actorAgent = await agentsSvc.getById(req.actor.agentId);
    const canCreateAgents = Boolean(actorAgent?.permissions && (actorAgent.permissions as Record<string, unknown>).canCreateAgents);
    if (!actorAgent) {
      throw forbidden("Missing permission to read provider credentials");
    }
    const company = await db
      .select({ companyType: companies.companyType })
      .from(companies)
      .where(eq(companies.id, actorAgent.companyId))
      .then((rows) => rows[0] ?? null);
    const isMasterCompanyAgent = company?.companyType === "master";
    if (!isMasterCompanyAgent && !canCreateAgents && actorAgent.role !== "ceo") {
      throw forbidden("Missing permission to read provider credentials");
    }
  }

  router.get("/settings/api-keys", async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    res.json(await svc.list());
  });

  router.post("/settings/api-keys", validate(saveApiKeySchema), async (req, res) => {
    assertCanManageApiKeys(req);
    const saved = await svc.save({
      provider: req.body.provider,
      key: req.body.key,
      helpUrl: req.body.helpUrl ?? null,
      testUrl: req.body.testUrl ?? null,
      testAuthHeader: req.body.testAuthHeader ?? null,
      testAuthPrefix: req.body.testAuthPrefix ?? null,
    }, req.actor.userId ?? null);

    const actor = getActorInfo(req);
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.api_key.saved",
          entityType: "api_key",
          entityId: saved.provider,
          details: {
            provider: saved.provider,
            maskedKey: saved.maskedKey,
          },
        }),
      ),
    );

    res.status(201).json(saved);
  });

  router.post("/settings/api-keys/:provider/test", async (req, res) => {
    assertCanManageApiKeys(req);
    const result = await svc.test(req.params.provider);

    const actor = getActorInfo(req);
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.api_key.tested",
          entityType: "api_key",
          entityId: req.params.provider,
          details: {
            provider: req.params.provider,
            ok: result.ok,
            status: result.status,
            message: result.message,
          },
        }),
      ),
    );

    res.json(result);
  });

  router.get("/settings/api-keys/:provider/value", async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    const value = await svc.getValue(req.params.provider);

    const actor = getActorInfo(req);
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.api_key.viewed",
          entityType: "api_key",
          entityId: value.provider,
          details: {
            provider: value.provider,
          },
        }),
      ),
    );

    res.json(value);
  });

  router.get("/settings/api-keys/runtime/credentials", async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    res.json(await svc.listResolvedForRuntime());
  });

  router.get("/settings/router-agent/catalog", async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    res.json(await svc.listProviderCatalog());
  });

  router.post("/settings/router-agent/recommendation", validate(routerRecommendationSchema), async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    const recommendation = await svc.recommendRouterAssignment({
      taskSummary: req.body.taskSummary ?? null,
      preference: req.body.preference ?? "balanced",
      expandColumns: req.body.expandColumns ?? [],
    });
    res.json(recommendation);
  });

  router.post("/settings/router-agent/override", validate(routerOverrideSchema), async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    const recommendation = await svc.recommendRouterAssignment({
      taskSummary: req.body.taskSummary ?? null,
      preference: req.body.preference ?? "balanced",
      expandColumns: req.body.expandColumns ?? [],
    });
    const actor = getActorInfo(req);
    const now = new Date();
    const companyId = req.body.companyId
      ?? req.actor.companyId
      ?? (await svc.listCompanyIds())[0]
      ?? null;
    if (!companyId) {
      throw forbidden("Company context required for override audit");
    }

    const selected = {
      provider: req.body.selectedProvider.trim().toLowerCase(),
      model: req.body.selectedModel.trim(),
    };
    const suggestion = recommendation.suggested_model;
    const rationale = (req.body.rationale ?? "").trim() || null;

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "router.decision.override",
      entityType: "router_assignment",
      entityId: `${selected.provider}:${selected.model}`,
      details: {
        final_decision_by: "master_ceo",
        selected_model: selected,
        suggested_model: suggestion,
        recommendation_table_columns: recommendation.table_columns,
        task_summary: req.body.taskSummary ?? null,
        preference: req.body.preference ?? "balanced",
        rationale,
      },
    });

    let reportPath: string | null = null;
    try {
      const runtime = await ensureKnowledgeBaseRuntime(db);
      const yyyy = String(now.getUTCFullYear());
      const mm = `${now.getUTCMonth() + 1}`.padStart(2, "0");
      const taskId = sanitizePathSegment(
        actor.runId ?? `${now.getTime()}`,
      );
      const slug = sanitizePathSegment(req.body.taskSummary ?? `${selected.provider}-${selected.model}`);
      reportPath = normalizeRelativeKbPath(
        `Global_Holding/wiki/router_decisions/${yyyy}/${mm}/${taskId}-${slug}.md`,
      );

      const actorName = actor.actorId ?? actor.agentId ?? "system";
      const markdown = buildRouterDecisionMarkdown({
        createdAtIso: now.toISOString(),
        actorName,
        taskSummary: req.body.taskSummary ?? null,
        companyScope: "global",
        selectedProvider: selected.provider,
        selectedModel: selected.model,
        suggestedProvider: suggestion.provider,
        suggestedModel: suggestion.model,
        preference: req.body.preference ?? "balanced",
        rationale,
        tableColumns: recommendation.table_columns,
        candidateTable: recommendation.candidate_table,
      });
      await runtime.fileManager.writeDocument(reportPath, markdown);
      await runtime.indexer.updateDocument(reportPath);
      await runtime.fileManager.appendWikiLogEntry({
        targetRelativePath: reportPath,
        actorName,
        action: "created",
      });

      const indexPath = "Global_Holding/wiki/router_decisions/index.md";
      const indexLine = `- ${now.toISOString()} | ${actorName} | ${selected.provider}/${selected.model} | ${reportPath}`;
      let indexContent = "# Router Decision Index\n\n";
      try {
        const existing = await runtime.fileManager.readDocument(indexPath);
        indexContent = existing.content.endsWith("\n")
          ? existing.content
          : `${existing.content}\n`;
      } catch {
        // keep default initial content
      }
      await runtime.fileManager.writeDocument(indexPath, `${indexContent}${indexLine}\n`);
      await runtime.indexer.updateDocument(indexPath);
    } catch {
      reportPath = null;
    }

    res.json({
      ok: true,
      final_decision_by: "master_ceo",
      selected_model: selected,
      suggested_model: suggestion,
      rationale,
      report_path: reportPath,
      recommendation,
    });
  });

  router.get("/settings/router-agent/provider-discovery/suggestions", async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    const query = discoveryListQuerySchema.parse(req.query);
    const provider = query.provider;
    res.json(await discoverySvc.list(provider));
  });

  router.post("/settings/router-agent/provider-discovery/discover", validate(discoveryStartSchema), async (req, res) => {
    await assertCanReadRuntimeCredentials(req);
    const actor = getActorInfo(req);
    const discoveredBy = actor.actorId ?? actor.agentId ?? null;
    const suggestion = await discoverySvc.discover({
      provider: req.body.provider,
      seedUrl: req.body.seedUrl ?? null,
      discoveredBy,
    });
    res.status(201).json(suggestion);
  });

  router.post(
    "/settings/router-agent/provider-discovery/:id/publish",
    async (req, res) => {
      assertCanManageApiKeys(req);
      const params = discoveryPublishParamsSchema.parse(req.params);
      const published = await discoverySvc.publish(params.id);
      res.json(published);
    },
  );

  router.delete("/settings/api-keys/:provider", async (req, res) => {
    assertCanManageApiKeys(req);
    const removed = await svc.remove(req.params.provider);

    const actor = getActorInfo(req);
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.api_key.deleted",
          entityType: "api_key",
          entityId: req.params.provider,
          details: {
            provider: req.params.provider,
            removed,
          },
        }),
      ),
    );

    res.json({ ok: removed });
  });

  return router;
}
