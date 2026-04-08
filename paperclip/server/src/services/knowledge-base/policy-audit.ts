import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog } from "@paperclipai/db";
import { trackKnowledgeBasePolicyAccess } from "@paperclipai/shared/telemetry";
import { logger } from "../../middleware/logger.js";
import { getTelemetryClient } from "../../telemetry.js";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";

type KbPolicyAction = "search" | "read" | "write" | "list" | "wiki_entry" | "benchmark" | "health";
type KbPolicyDecision = "allow" | "deny";
type KbActorType = "board" | "agent";
type TrafficBand = "low" | "medium" | "high";

type ActionTotals = {
  total: number;
  allow: number;
  deny: number;
};

type CompanyBucket = {
  total: number;
  allow: number;
  deny: number;
  byAction: Record<KbPolicyAction, ActionTotals>;
  byScope: Record<string, ActionTotals>;
};

type Snapshot = {
  total: number;
  allow: number;
  deny: number;
  byAction: Record<KbPolicyAction, ActionTotals>;
  byActor: Record<KbActorType, ActionTotals>;
  byScope: Record<string, ActionTotals>;
  byCompany: Record<string, CompanyBucket>;
};

type SamplingState = {
  windowSeconds: number;
  recentRps: number;
  baseAllowSampleRate: number;
  autoAllowSampleRate: number;
  effectiveAllowSampleRate: number;
  trafficBand: TrafficBand;
  importantScopeTokens: string[];
};

type SamplingConfig = {
  baseAllowSampleRate: number;
  trafficWindowSeconds: number;
  mediumRpsThreshold: number;
  highRpsThreshold: number;
  mediumAllowSampleRate: number;
  highAllowSampleRate: number;
  importantScopeTokens: string[];
  firstEventKeyTtlSeconds: number;
};

const ALL_ACTIONS: KbPolicyAction[] = ["search", "read", "write", "list", "wiki_entry", "benchmark", "health"];
const SNAPSHOT_ACTION = "kb.policy_metrics.snapshot";
const DAILY_ROLLUP_ACTION = "kb.policy_metrics.rollup.daily";
const MONTHLY_ROLLUP_ACTION = "kb.policy_metrics.rollup.monthly";
const ARCHIVE_EVENT_ACTION = "kb.policy_metrics.archive.export";

function parseRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function parsePositive(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseScopeTokens(raw: string | undefined): string[] {
  const base = raw ?? "global,intelligence";
  return Array.from(new Set(base
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)));
}

function loadSamplingConfig(): SamplingConfig {
  return {
    baseAllowSampleRate: parseRate(process.env.PAPERCLIP_KB_POLICY_ALLOW_SAMPLE_RATE, 0.1),
    trafficWindowSeconds: parsePositive(process.env.PAPERCLIP_KB_POLICY_TRAFFIC_WINDOW_SECONDS, 60),
    mediumRpsThreshold: parsePositive(process.env.PAPERCLIP_KB_POLICY_MEDIUM_RPS_THRESHOLD, 5),
    highRpsThreshold: parsePositive(process.env.PAPERCLIP_KB_POLICY_HIGH_RPS_THRESHOLD, 20),
    mediumAllowSampleRate: parseRate(process.env.PAPERCLIP_KB_POLICY_AUTO_MEDIUM_SAMPLE_RATE, 0.25),
    highAllowSampleRate: parseRate(process.env.PAPERCLIP_KB_POLICY_AUTO_HIGH_SAMPLE_RATE, 0.1),
    importantScopeTokens: parseScopeTokens(process.env.PAPERCLIP_KB_POLICY_IMPORTANT_SCOPES),
    firstEventKeyTtlSeconds: parsePositive(process.env.PAPERCLIP_KB_POLICY_FIRST_EVENT_TTL_SECONDS, 3600),
  };
}

function createActionTotals(): ActionTotals {
  return { total: 0, allow: 0, deny: 0 };
}

function createActionRecord(): Record<KbPolicyAction, ActionTotals> {
  return {
    search: createActionTotals(),
    read: createActionTotals(),
    write: createActionTotals(),
    list: createActionTotals(),
    wiki_entry: createActionTotals(),
    benchmark: createActionTotals(),
    health: createActionTotals(),
  };
}

function createActorRecord(): Record<KbActorType, ActionTotals> {
  return {
    board: createActionTotals(),
    agent: createActionTotals(),
  };
}

function createCompanyBucket(): CompanyBucket {
  return {
    total: 0,
    allow: 0,
    deny: 0,
    byAction: createActionRecord(),
    byScope: {},
  };
}

function createSnapshotState(): Snapshot {
  return {
    total: 0,
    allow: 0,
    deny: 0,
    byAction: createActionRecord(),
    byActor: createActorRecord(),
    byScope: {},
    byCompany: {},
  };
}

function bumpTotals(target: ActionTotals, decision: KbPolicyDecision): void {
  target.total += 1;
  if (decision === "allow") target.allow += 1;
  if (decision === "deny") target.deny += 1;
}

function applyToSnapshot(
  snapshot: Snapshot,
  input: {
    action: KbPolicyAction;
    decision: KbPolicyDecision;
    actor: KbActorType;
    scope?: string;
    companyId?: string;
  },
): void {
  snapshot.total += 1;
  if (input.decision === "allow") snapshot.allow += 1;
  if (input.decision === "deny") snapshot.deny += 1;
  bumpTotals(snapshot.byAction[input.action], input.decision);
  bumpTotals(snapshot.byActor[input.actor], input.decision);

  const scope = input.scope?.trim().toLowerCase();
  if (scope) {
    if (!snapshot.byScope[scope]) snapshot.byScope[scope] = createActionTotals();
    bumpTotals(snapshot.byScope[scope], input.decision);
  }

  const companyId = input.companyId?.trim();
  if (companyId) {
    if (!snapshot.byCompany[companyId]) snapshot.byCompany[companyId] = createCompanyBucket();
    const bucket = snapshot.byCompany[companyId];
    bucket.total += 1;
    if (input.decision === "allow") bucket.allow += 1;
    if (input.decision === "deny") bucket.deny += 1;
    bumpTotals(bucket.byAction[input.action], input.decision);
    if (scope) {
      if (!bucket.byScope[scope]) bucket.byScope[scope] = createActionTotals();
      bumpTotals(bucket.byScope[scope], input.decision);
    }
  }
}

const state: Snapshot = createSnapshotState();
let intervalAccumulator: Snapshot = createSnapshotState();

const eventWindowTimestamps: number[] = [];
const firstEventKeySeenAt = new Map<string, number>();
let lastSamplingState: SamplingState = {
  windowSeconds: 60,
  recentRps: 0,
  baseAllowSampleRate: 0.1,
  autoAllowSampleRate: 1,
  effectiveAllowSampleRate: 0.1,
  trafficBand: "low",
  importantScopeTokens: ["global", "intelligence"],
};

let persistenceTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let persistenceInFlight = Promise.resolve();
let persistenceDb: Db | null = null;
let persistenceIntervalMs = Math.max(15_000, parsePositive(process.env.PAPERCLIP_KB_POLICY_SNAPSHOT_INTERVAL_MS, 60_000));
let maintenanceIntervalMs = Math.max(5 * 60_000, parsePositive(process.env.PAPERCLIP_KB_POLICY_MAINTENANCE_INTERVAL_MS, 6 * 60_000));

const snapshotRetentionDays = Math.max(1, parsePositive(process.env.PAPERCLIP_KB_POLICY_SNAPSHOT_RETENTION_DAYS, 90));
const dailyRollupRetentionDays = Math.max(30, parsePositive(process.env.PAPERCLIP_KB_POLICY_DAILY_ROLLUP_RETENTION_DAYS, 730));
const monthlyRollupRetentionDays = Math.max(180, parsePositive(process.env.PAPERCLIP_KB_POLICY_MONTHLY_ROLLUP_RETENTION_DAYS, 3650));
const archiveExportEnabled = parseBool(process.env.PAPERCLIP_KB_POLICY_ARCHIVE_EXPORT_ENABLED, true);
const archiveRetentionDays = Math.max(7, parsePositive(process.env.PAPERCLIP_KB_POLICY_ARCHIVE_RETENTION_DAYS, 3650));
const snapshotRetentionBatchSize = Math.max(100, Math.floor(parsePositive(process.env.PAPERCLIP_KB_POLICY_RETENTION_BATCH_SIZE, 1000)));
const snapshotScopeCap = Math.max(20, Math.floor(parsePositive(process.env.PAPERCLIP_KB_POLICY_SNAPSHOT_SCOPE_CAP, 200)));
const archiveMaxBytes = Math.max(50 * 1024 * 1024, Math.floor(parsePositive(process.env.PAPERCLIP_KB_POLICY_ARCHIVE_MAX_BYTES, 2 * 1024 * 1024 * 1024)));
const archiveDir = path.resolve(
  process.env.PAPERCLIP_KB_POLICY_ARCHIVE_DIR?.trim() || path.join(resolvePaperclipInstanceRoot(), "data", "analytics", "kb-policy-archive"),
);

function computeSamplingState(nowMs: number, config: SamplingConfig): SamplingState {
  const windowMs = config.trafficWindowSeconds * 1000;
  eventWindowTimestamps.push(nowMs);
  while (eventWindowTimestamps.length > 0 && eventWindowTimestamps[0] < nowMs - windowMs) {
    eventWindowTimestamps.shift();
  }

  const recentRps = eventWindowTimestamps.length / Math.max(1, config.trafficWindowSeconds);
  let autoAllowSampleRate = 1;
  let trafficBand: TrafficBand = "low";
  if (recentRps >= config.highRpsThreshold) {
    autoAllowSampleRate = config.highAllowSampleRate;
    trafficBand = "high";
  } else if (recentRps >= config.mediumRpsThreshold) {
    autoAllowSampleRate = config.mediumAllowSampleRate;
    trafficBand = "medium";
  }
  const effectiveAllowSampleRate = Math.min(config.baseAllowSampleRate, autoAllowSampleRate);

  return {
    windowSeconds: config.trafficWindowSeconds,
    recentRps,
    baseAllowSampleRate: config.baseAllowSampleRate,
    autoAllowSampleRate,
    effectiveAllowSampleRate,
    trafficBand,
    importantScopeTokens: config.importantScopeTokens,
  };
}

function scopeIsImportant(scope: string | undefined, importantTokens: string[]): boolean {
  const normalizedScope = scope?.trim().toLowerCase();
  if (!normalizedScope) return false;
  return importantTokens.some((token) => normalizedScope === token || normalizedScope.startsWith(`${token}/`));
}

function shouldEmitDetailedEvent(input: {
  action: KbPolicyAction;
  decision: KbPolicyDecision;
  actor: KbActorType;
  scope?: string;
  sampling: SamplingState;
  firstEventKeyTtlSeconds: number;
}): boolean {
  if (input.decision === "deny") return true;
  if (scopeIsImportant(input.scope, input.sampling.importantScopeTokens)) return true;

  const nowMs = Date.now();
  const key = `${input.actor}:${input.action}:${input.decision}:${input.scope ?? "*"}`;
  const firstSeen = firstEventKeySeenAt.get(key);
  if (!firstSeen || nowMs - firstSeen > input.firstEventKeyTtlSeconds * 1000) {
    firstEventKeySeenAt.set(key, nowMs);
    return true;
  }

  return Math.random() < input.sampling.effectiveAllowSampleRate;
}

function buildTopScopes(byScope: Record<string, ActionTotals>, limit: number): Array<{
  scope: string;
  total: number;
  deny: number;
  allow: number;
  denyRatePercent: number;
}> {
  return Object.entries(byScope)
    .filter(([, totals]) => totals.total > 0)
    .map(([scope, totals]) => ({
      scope,
      total: totals.total,
      deny: totals.deny,
      allow: totals.allow,
      denyRatePercent: totals.total > 0 ? Number(((totals.deny / totals.total) * 100).toFixed(2)) : 0,
    }))
    .sort((left, right) => right.deny - left.deny || right.total - left.total)
    .slice(0, limit);
}

function buildScopeView(byScope: Record<string, ActionTotals>, cap: number): Record<string, { total: number; allow: number; deny: number; denyRatePercent: number }> {
  return Object.entries(byScope)
    .sort((left, right) => right[1].total - left[1].total)
    .slice(0, cap)
    .reduce<Record<string, { total: number; allow: number; deny: number; denyRatePercent: number }>>((acc, [scope, totals]) => {
      acc[scope] = actionTotalsToView(totals);
      return acc;
    }, {});
}

function dayKeyFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

function actionTotalsToView(totals: ActionTotals): { total: number; allow: number; deny: number; denyRatePercent: number } {
  return {
    total: totals.total,
    allow: totals.allow,
    deny: totals.deny,
    denyRatePercent: totals.total > 0 ? Number(((totals.deny / totals.total) * 100).toFixed(2)) : 0,
  };
}

function buildActionView(source: Record<KbPolicyAction, ActionTotals>) {
  const out: Record<string, { total: number; allow: number; deny: number; denyRatePercent: number }> = {};
  for (const action of ALL_ACTIONS) {
    out[action] = actionTotalsToView(source[action]);
  }
  return out;
}

function bucketFromSnapshotDetails(details: unknown): { total: number; allow: number; deny: number; byAction: Record<KbPolicyAction, ActionTotals> } {
  const actionRecord = createActionRecord();
  const payload = (details ?? {}) as {
    totals?: { total?: number; allow?: number; deny?: number };
    byAction?: Record<string, { total?: number; allow?: number; deny?: number }>;
  };
  for (const action of ALL_ACTIONS) {
    const row = payload.byAction?.[action];
    actionRecord[action] = {
      total: Number(row?.total ?? 0),
      allow: Number(row?.allow ?? 0),
      deny: Number(row?.deny ?? 0),
    };
  }
  return {
    total: Number(payload.totals?.total ?? 0),
    allow: Number(payload.totals?.allow ?? 0),
    deny: Number(payload.totals?.deny ?? 0),
    byAction: actionRecord,
  };
}

async function writeArchiveFile(rows: Array<{
  id: string;
  companyId: string;
  createdAt: Date;
  details: unknown;
}>): Promise<string | null> {
  if (!archiveExportEnabled || rows.length === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dayDir = dayKeyFromIso(new Date().toISOString());
  const targetDir = path.resolve(archiveDir, dayDir);
  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.resolve(targetDir, `kb-policy-snapshots-${stamp}.jsonl`);
  const body = rows
    .map((row) => JSON.stringify({
      id: row.id,
      companyId: row.companyId,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      details: row.details,
    }))
    .join("\n");
  await fs.writeFile(filePath, `${body}\n`, "utf8");
  return filePath;
}

async function pruneArchiveFiles(nowMs = Date.now()): Promise<void> {
  if (!archiveExportEnabled) return;
  const cutoffMs = nowMs - archiveRetentionDays * 24 * 60 * 60 * 1000;
  const trackedFiles: Array<{ path: string; mtimeMs: number; size: number }> = [];
  const rootEntries = await fs.readdir(archiveDir, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    const target = path.resolve(archiveDir, entry.name);
    if (entry.isDirectory()) {
      const files = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile()) continue;
        const filePath = path.resolve(target, file.name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat) continue;
        if (stat.mtimeMs < cutoffMs) {
          await fs.rm(filePath, { force: true }).catch(() => undefined);
        } else {
          trackedFiles.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
        }
      }
      const remaining = await fs.readdir(target).catch(() => []);
      if (remaining.length === 0) {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) continue;
    if (stat.mtimeMs < cutoffMs) {
      await fs.rm(target, { force: true }).catch(() => undefined);
    } else {
      trackedFiles.push({ path: target, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }

  let totalBytes = trackedFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= archiveMaxBytes) return;
  trackedFiles.sort((left, right) => left.mtimeMs - right.mtimeMs);
  for (const file of trackedFiles) {
    if (totalBytes <= archiveMaxBytes) break;
    await fs.rm(file.path, { force: true }).catch(() => undefined);
    totalBytes -= file.size;
  }
  if (totalBytes > archiveMaxBytes) {
    logger.warn({ totalBytes, archiveMaxBytes, archiveDir }, "KB policy archive remains above max size after pruning");
  }
}

async function maintainPolicySnapshots(db: Db): Promise<void> {
  const snapshotCutoff = new Date(Date.now() - snapshotRetentionDays * 24 * 60 * 60 * 1000);
  while (true) {
    const rows = await db
      .select({
        id: activityLog.id,
        companyId: activityLog.companyId,
        createdAt: activityLog.createdAt,
        details: activityLog.details,
      })
      .from(activityLog)
      .where(and(eq(activityLog.action, SNAPSHOT_ACTION), lt(activityLog.createdAt, snapshotCutoff)))
      .limit(snapshotRetentionBatchSize);

    if (rows.length === 0) break;

    const archivePath = await writeArchiveFile(rows as Array<{ id: string; companyId: string; createdAt: Date; details: unknown }>);

    const dailyByCompanyAndDay = new Map<string, { total: number; allow: number; deny: number; byAction: Record<KbPolicyAction, ActionTotals> }>();
    const monthlyByCompanyAndMonth = new Map<string, { total: number; allow: number; deny: number; byAction: Record<KbPolicyAction, ActionTotals> }>();
    for (const row of rows) {
      const createdAtIso = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
      const snap = bucketFromSnapshotDetails(row.details);
      const dayKey = `${row.companyId}::${dayKeyFromIso(createdAtIso)}`;
      const monthKey = `${row.companyId}::${monthKeyFromIso(createdAtIso)}`;

      const dayBucket = dailyByCompanyAndDay.get(dayKey) ?? { total: 0, allow: 0, deny: 0, byAction: createActionRecord() };
      dayBucket.total += snap.total;
      dayBucket.allow += snap.allow;
      dayBucket.deny += snap.deny;
      for (const action of ALL_ACTIONS) {
        dayBucket.byAction[action].total += snap.byAction[action].total;
        dayBucket.byAction[action].allow += snap.byAction[action].allow;
        dayBucket.byAction[action].deny += snap.byAction[action].deny;
      }
      dailyByCompanyAndDay.set(dayKey, dayBucket);

      const monthBucket = monthlyByCompanyAndMonth.get(monthKey) ?? { total: 0, allow: 0, deny: 0, byAction: createActionRecord() };
      monthBucket.total += snap.total;
      monthBucket.allow += snap.allow;
      monthBucket.deny += snap.deny;
      for (const action of ALL_ACTIONS) {
        monthBucket.byAction[action].total += snap.byAction[action].total;
        monthBucket.byAction[action].allow += snap.byAction[action].allow;
        monthBucket.byAction[action].deny += snap.byAction[action].deny;
      }
      monthlyByCompanyAndMonth.set(monthKey, monthBucket);
    }

    const rollupRows: Array<{
      companyId: string;
      actorType: "system";
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      details: Record<string, unknown>;
    }> = [];

    for (const [compoundKey, bucket] of dailyByCompanyAndDay) {
      const [companyId, day] = compoundKey.split("::");
      rollupRows.push({
        companyId,
        actorType: "system",
        actorId: "system:kb-policy",
        action: DAILY_ROLLUP_ACTION,
        entityType: "knowledge_base_policy_rollup",
        entityId: `daily:${companyId}:${day}:${randomUUID()}`,
        details: {
          kind: "kb_policy_metrics_rollup_daily",
          day,
          totals: actionTotalsToView({ total: bucket.total, allow: bucket.allow, deny: bucket.deny }),
          byAction: buildActionView(bucket.byAction),
        },
      });
    }

    for (const [compoundKey, bucket] of monthlyByCompanyAndMonth) {
      const [companyId, month] = compoundKey.split("::");
      rollupRows.push({
        companyId,
        actorType: "system",
        actorId: "system:kb-policy",
        action: MONTHLY_ROLLUP_ACTION,
        entityType: "knowledge_base_policy_rollup",
        entityId: `monthly:${companyId}:${month}:${randomUUID()}`,
        details: {
          kind: "kb_policy_metrics_rollup_monthly",
          month,
          totals: actionTotalsToView({ total: bucket.total, allow: bucket.allow, deny: bucket.deny }),
          byAction: buildActionView(bucket.byAction),
        },
      });
    }

    if (rollupRows.length > 0) {
      await db.insert(activityLog).values(rollupRows);
    }

    const rowIds = rows.map((row) => row.id);
    await db.delete(activityLog).where(inArray(activityLog.id, rowIds));

    if (archivePath) {
      const archiveRows = Array.from(new Set(rows.map((row) => row.companyId))).map((companyId) => ({
        companyId,
        actorType: "system" as const,
        actorId: "system:kb-policy",
        action: ARCHIVE_EVENT_ACTION,
        entityType: "knowledge_base_policy_archive",
        entityId: randomUUID(),
        details: {
          kind: "kb_policy_metrics_archive_export",
          filePath: archivePath,
          snapshotRows: rows.length,
        },
      }));
      if (archiveRows.length > 0) {
        await db.insert(activityLog).values(archiveRows);
      }
    }
  }

  const dailyCutoff = new Date(Date.now() - dailyRollupRetentionDays * 24 * 60 * 60 * 1000);
  const monthlyCutoff = new Date(Date.now() - monthlyRollupRetentionDays * 24 * 60 * 60 * 1000);
  await db.delete(activityLog).where(and(eq(activityLog.action, DAILY_ROLLUP_ACTION), lt(activityLog.createdAt, dailyCutoff)));
  await db.delete(activityLog).where(and(eq(activityLog.action, MONTHLY_ROLLUP_ACTION), lt(activityLog.createdAt, monthlyCutoff)));
  await pruneArchiveFiles();
}

async function persistAccumulatedSnapshot(db: Db): Promise<void> {
  const flushTarget = intervalAccumulator;
  intervalAccumulator = createSnapshotState();
  if (flushTarget.total === 0) return;

  const now = new Date().toISOString();
  const intervalSeconds = Math.max(1, Math.round(persistenceIntervalMs / 1000));

  const rows = Object.entries(flushTarget.byCompany)
    .filter(([, bucket]) => bucket.total > 0)
    .map(([companyId, bucket]) => {
      const byAction: Record<string, { total: number; allow: number; deny: number; denyRatePercent: number }> = {};
      for (const action of ALL_ACTIONS) {
        const totals = bucket.byAction[action];
        byAction[action] = {
          total: totals.total,
          allow: totals.allow,
          deny: totals.deny,
          denyRatePercent: totals.total > 0 ? Number(((totals.deny / totals.total) * 100).toFixed(2)) : 0,
        };
      }

      const details = {
        kind: "kb_policy_metrics_snapshot",
        capturedAt: now,
        intervalSeconds,
        totals: {
          total: bucket.total,
          allow: bucket.allow,
          deny: bucket.deny,
          denyRatePercent: bucket.total > 0 ? Number(((bucket.deny / bucket.total) * 100).toFixed(2)) : 0,
        },
        byAction,
        byScope: buildScopeView(bucket.byScope, snapshotScopeCap),
        byScopeTop: buildTopScopes(bucket.byScope, 12),
        sampling: {
          ...lastSamplingState,
          recentRps: Number(lastSamplingState.recentRps.toFixed(3)),
        },
      };

      return {
        companyId,
        actorType: "system" as const,
        actorId: "system:kb-policy",
        action: SNAPSHOT_ACTION,
        entityType: "knowledge_base_policy",
        entityId: randomUUID(),
        details,
      };
    });

  if (rows.length > 0) {
    await db.insert(activityLog).values(rows);
  }
}

export function recordKbPolicyDecision(input: {
  action: KbPolicyAction;
  decision: KbPolicyDecision;
  actor: KbActorType;
  scope?: string;
  reason?: string;
  agentId?: string;
  companyId?: string;
}): void {
  applyToSnapshot(state, input);
  applyToSnapshot(intervalAccumulator, input);

  const config = loadSamplingConfig();
  const sampling = computeSamplingState(Date.now(), config);
  lastSamplingState = sampling;

  const emitDetailed = shouldEmitDetailedEvent({
    action: input.action,
    decision: input.decision,
    actor: input.actor,
    scope: input.scope,
    sampling,
    firstEventKeyTtlSeconds: config.firstEventKeyTtlSeconds,
  });

  if (emitDetailed) {
    const payload = {
      policy: "knowledge_base_access",
      action: input.action,
      decision: input.decision,
      actor: input.actor,
      scope: input.scope?.trim().toLowerCase() ?? null,
      reason: input.reason ?? null,
      agentId: input.agentId ?? null,
      companyId: input.companyId ?? null,
      sampling,
    };

    if (input.decision === "deny") {
      logger.warn(payload, "Knowledge base policy denied");
    } else {
      logger.info(payload, "Knowledge base policy allowed");
    }
  }

  const telemetry = getTelemetryClient();
  if (telemetry) {
    trackKnowledgeBasePolicyAccess(telemetry, {
      action: input.action,
      decision: input.decision,
      actor: input.actor,
      scope: input.scope?.trim().toLowerCase() ?? null,
      reason: input.reason ?? null,
    });
  }
}

export function getKbPolicyMetricsSnapshot(): Snapshot & { sampling: SamplingState } {
  return {
    ...(JSON.parse(JSON.stringify(state)) as Snapshot),
    sampling: { ...lastSamplingState },
  };
}

export function resetKbPolicyMetricsForTests(): void {
  const fresh = createSnapshotState();
  state.total = fresh.total;
  state.allow = fresh.allow;
  state.deny = fresh.deny;
  state.byAction = fresh.byAction;
  state.byActor = fresh.byActor;
  state.byScope = fresh.byScope;
  state.byCompany = fresh.byCompany;
  intervalAccumulator = createSnapshotState();
  eventWindowTimestamps.length = 0;
  firstEventKeySeenAt.clear();
  lastSamplingState = {
    windowSeconds: 60,
    recentRps: 0,
    baseAllowSampleRate: 0.1,
    autoAllowSampleRate: 1,
    effectiveAllowSampleRate: 0.1,
    trafficBand: "low",
    importantScopeTokens: ["global", "intelligence"],
  };
}

export function startKbPolicyMetricsPersistence(db: Db): void {
  persistenceDb = db;
  persistenceIntervalMs = Math.max(15_000, parsePositive(process.env.PAPERCLIP_KB_POLICY_SNAPSHOT_INTERVAL_MS, 60_000));
  maintenanceIntervalMs = Math.max(5 * 60_000, parsePositive(process.env.PAPERCLIP_KB_POLICY_MAINTENANCE_INTERVAL_MS, 6 * 60_000));
  if (persistenceTimer) return;

  persistenceTimer = setInterval(() => {
    if (!persistenceDb) return;
    persistenceInFlight = persistenceInFlight
      .then(() => persistAccumulatedSnapshot(persistenceDb as Db))
      .catch((error) => {
        logger.warn({ err: error }, "Failed to persist KB policy metrics snapshot");
      });
  }, persistenceIntervalMs);

  if (typeof persistenceTimer === "object" && "unref" in persistenceTimer) {
    persistenceTimer.unref();
  }

  maintenanceTimer = setInterval(() => {
    if (!persistenceDb) return;
    persistenceInFlight = persistenceInFlight
      .then(() => maintainPolicySnapshots(persistenceDb as Db))
      .catch((error) => {
        logger.warn({ err: error }, "Failed to maintain KB policy snapshots");
      });
  }, maintenanceIntervalMs);

  if (typeof maintenanceTimer === "object" && "unref" in maintenanceTimer) {
    maintenanceTimer.unref();
  }
}

export async function stopKbPolicyMetricsPersistence(): Promise<void> {
  if (persistenceTimer) {
    clearInterval(persistenceTimer);
    persistenceTimer = null;
  }
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }

  if (persistenceDb) {
    persistenceInFlight = persistenceInFlight
      .then(() => persistAccumulatedSnapshot(persistenceDb as Db))
      .then(() => maintainPolicySnapshots(persistenceDb as Db))
      .catch((error) => {
        logger.warn({ err: error }, "Failed to persist final KB policy metrics snapshot");
      });
    await persistenceInFlight;
  }
  persistenceDb = null;
}
