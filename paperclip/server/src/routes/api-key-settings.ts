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
    });
    res.json(recommendation);
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
