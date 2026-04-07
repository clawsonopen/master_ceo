import path from "node:path";
import fs from "node:fs";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { readConfigFile } from "../config-file.js";
import { resolveDefaultLogsDir, resolveHomeAwarePath } from "../home-paths.js";

const DEFAULT_LOG_RETENTION_DAYS = 30;
const ROTATED_LOG_FILE_RE = /^server-\d{4}-\d{2}-\d{2}(?:-\d+)?\.log$/;

function resolveServerLogDir(): string {
  const envOverride = process.env.PAPERCLIP_LOG_DIR?.trim();
  if (envOverride) return resolveHomeAwarePath(envOverride);

  const fileLogDir = readConfigFile()?.logging.logDir?.trim();
  if (fileLogDir) return resolveHomeAwarePath(fileLogDir);

  return resolveDefaultLogsDir();
}

function resolveLogRetentionDays(): number {
  const raw = process.env.PAPERCLIP_LOG_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_LOG_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LOG_RETENTION_DAYS;
  return parsed;
}

function formatDateYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function archiveCurrentLogFile(logDir: string, logFile: string) {
  if (!fs.existsSync(logFile)) return;
  const stat = fs.statSync(logFile);
  if (stat.size <= 0) return;

  const todayYmd = formatDateYmd(new Date());
  const lastWriteYmd = formatDateYmd(stat.mtime);
  if (lastWriteYmd === todayYmd) return;

  let target = path.join(logDir, `server-${lastWriteYmd}.log`);
  let counter = 1;
  while (fs.existsSync(target)) {
    target = path.join(logDir, `server-${lastWriteYmd}-${counter}.log`);
    counter += 1;
  }
  fs.renameSync(logFile, target);
}

function pruneExpiredRotatedLogs(logDir: string, retentionDays: number) {
  const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  for (const entry of fs.readdirSync(logDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!ROTATED_LOG_FILE_RE.test(entry.name)) continue;
    const filePath = path.join(logDir, entry.name);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

const logDir = resolveServerLogDir();
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, "server.log");
const retentionDays = resolveLogRetentionDays();

try {
  archiveCurrentLogFile(logDir, logFile);
  pruneExpiredRotatedLogs(logDir, retentionDays);
} catch (error) {
  // Logging should never block server startup.
  console.warn("[logger] Failed to rotate/prune server logs:", error);
}

const sharedOpts = {
  translateTime: "HH:MM:ss",
  ignore: "pid,hostname",
  singleLine: true,
};

export const logger = pino({
  level: "debug",
  redact: ["req.headers.authorization"],
}, pino.transport({
  targets: [
    {
      target: "pino-pretty",
      options: { ...sharedOpts, ignore: "pid,hostname,req,res,responseTime", colorize: true, destination: 1 },
      level: "info",
    },
    {
      target: "pino-pretty",
      options: { ...sharedOpts, colorize: false, destination: logFile, mkdir: true },
      level: "debug",
    },
  ],
}));

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, res, err) {
    const ctx = (res as any).__errorContext;
    const errMsg = ctx?.error?.message || err?.message || (res as any).err?.message || "unknown error";
    return `${req.method} ${req.url} ${res.statusCode} — ${errMsg}`;
  },
  customProps(req, res) {
    if (res.statusCode >= 400) {
      const ctx = (res as any).__errorContext;
      if (ctx) {
        return {
          errorContext: ctx.error,
          reqBody: ctx.reqBody,
          reqParams: ctx.reqParams,
          reqQuery: ctx.reqQuery,
        };
      }
      const props: Record<string, unknown> = {};
      const { body, params, query } = req as any;
      if (body && typeof body === "object" && Object.keys(body).length > 0) {
        props.reqBody = body;
      }
      if (params && typeof params === "object" && Object.keys(params).length > 0) {
        props.reqParams = params;
      }
      if (query && typeof query === "object" && Object.keys(query).length > 0) {
        props.reqQuery = query;
      }
      if ((req as any).route?.path) {
        props.routePath = (req as any).route.path;
      }
      return props;
    }
    return {};
  },
});
