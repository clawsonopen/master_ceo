import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { dashboardService } from "../services/dashboard.js";
import { assertCompanyAccess } from "./authz.js";

export function dashboardRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const kbPolicyWindowRaw = typeof req.query.kbPolicyWindow === "string" ? req.query.kbPolicyWindow : undefined;
    const kbPolicyAction = typeof req.query.kbPolicyAction === "string" ? req.query.kbPolicyAction.trim() : undefined;
    const kbPolicyScope = typeof req.query.kbPolicyScope === "string" ? req.query.kbPolicyScope.trim().toLowerCase() : undefined;
    const kbPolicyWindow = kbPolicyWindowRaw === "7d" || kbPolicyWindowRaw === "30d" || kbPolicyWindowRaw === "24h"
      ? kbPolicyWindowRaw
      : "24h";
    const summary = await svc.summary(companyId, {
      kbPolicyWindow,
      kbPolicyAction: kbPolicyAction || undefined,
      kbPolicyScope: kbPolicyScope || undefined,
    });
    res.json(summary);
  });

  return router;
}
