#!/usr/bin/env -S node --import tsx
import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveDatabaseTarget } from "../packages/db/src/runtime-config.js";
import {
  isPidAlive,
  listLocalServiceRegistryRecords,
  removeLocalServiceRegistryRecord,
  terminateLocalService,
} from "../server/src/services/local-service-supervisor.ts";
import { repoRoot } from "./dev-service-profile.ts";

const execFileAsync = promisify(execFile);

type RecoveryLogLevel = "silent" | "normal";

export type DevRecoveryOptions = {
  repoRoot?: string;
  serverPort?: number;
  allowedServiceKey?: string;
  logLevel?: RecoveryLogLevel;
};

export type DevRecoveryResult = {
  cleanedRegistryRecords: number;
  terminatedPaperclipPids: number[];
  terminatedPostgresPids: number[];
  removedStalePostmasterPidFile: boolean;
};

function logLine(logLevel: RecoveryLogLevel, message: string) {
  if (logLevel === "silent") return;
  console.log(`[paperclip] ${message}`);
}

function toError(error: unknown, context: string): Error {
  if (error instanceof Error) return error;
  if (error === undefined) return new Error(context);
  if (typeof error === "string") return new Error(`${context}: ${error}`);
  try {
    return new Error(`${context}: ${JSON.stringify(error)}`);
  } catch {
    return new Error(`${context}: ${String(error)}`);
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code !== "EADDRINUSE");
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

async function canFetchPaperclipHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!response.ok) return false;
    const payload = await response.json() as { status?: string };
    return payload.status === "ok";
  } catch {
    return false;
  }
}

function looksLikePaperclipCommand(commandLine: string): boolean {
  const normalized = commandLine.toLowerCase();
  return (
    normalized.includes("paperclip") ||
    normalized.includes("dev-runner.ts") ||
    normalized.includes("server/src/index.ts") ||
    normalized.includes("src/index.ts")
  );
}

async function waitForPortToBeAvailable(port: number, timeoutMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortAvailable(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return await isPortAvailable(port);
}

async function readProcessCommandLine(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) return "";

  try {
    if (process.platform === "win32") {
      const command = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `$proc = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -First 1 CommandLine`,
        "if (-not $proc) { '' } else { [string]$proc.CommandLine }",
      ].join("; ");
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", command]);
      return stdout.trim();
    }

    const { stdout } = await execFileAsync("ps", ["-o", "command=", "-p", String(pid)]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function readPortOwnerPid(port: number): Promise<number | null> {
  if (!Number.isInteger(port) || port <= 0) return null;

  try {
    if (process.platform === "win32") {
      const command = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1 OwningProcess`,
        "if (-not $conn) { '' } else { [string]$conn.OwningProcess }",
      ].join("; ");
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", command]);
      const parsed = Number.parseInt(stdout.trim(), 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    const { stdout } = await execFileAsync("lsof", ["-nPiTCP", `:${port}`, "-sTCP:LISTEN", "-t"]);
    const parsed = stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .find((value) => Number.isInteger(value) && value > 0);
    return parsed ?? null;
  } catch {
    return null;
  }
}

function normalizePathForMatch(value: string): string {
  return path.resolve(value).replace(/\\+/g, "\\").toLowerCase();
}

async function findWindowsPostgresProcesses() {
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$procs = Get-CimInstance Win32_Process -Filter \"Name = 'postgres.exe'\" | Select-Object ProcessId, CommandLine",
    "if (-not $procs) { '[]' } else { $procs | ConvertTo-Json -Compress }",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", command]);
  const raw = stdout.trim();
  if (!raw) return [] as Array<{ pid: number; commandLine: string }>;

  const parsed = JSON.parse(raw) as
    | { ProcessId?: number; CommandLine?: string }
    | Array<{ ProcessId?: number; CommandLine?: string }>;
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  return entries
    .map((entry) => ({
      pid: Number(entry.ProcessId ?? 0),
      commandLine: String(entry.CommandLine ?? ""),
    }))
    .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
}

async function findUnixPostgresProcesses() {
  const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number.parseInt(match[1], 10),
        commandLine: match[2] ?? "",
      };
    })
    .filter((entry): entry is { pid: number; commandLine: string } => Boolean(entry));
}

async function findEmbeddedPostgresPids(dataDir: string): Promise<number[]> {
  const normalizedDataDir = normalizePathForMatch(dataDir);
  const entries = process.platform === "win32"
    ? await findWindowsPostgresProcesses()
    : await findUnixPostgresProcesses();

  return entries
    .filter((entry) => entry.commandLine.toLowerCase().includes(normalizedDataDir))
    .map((entry) => entry.pid)
    .filter((pid, index, all) => all.indexOf(pid) === index);
}

async function terminatePid(pid: number): Promise<boolean> {
  if (!isPidAlive(pid)) return true;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  const softDeadline = Date.now() + 1_500;
  while (Date.now() < softDeadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best-effort fallback.
  }

  const hardDeadline = Date.now() + 1_500;
  while (Date.now() < hardDeadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  return !isPidAlive(pid);
}

function readPostmasterPidState(postmasterPidFile: string): {
  alivePid: number | null;
  stalePid: number | null;
} {
  if (!existsSync(postmasterPidFile)) return { alivePid: null, stalePid: null };

  try {
    const firstLine = readFileSync(postmasterPidFile, "utf8").split(/\r?\n/)[0]?.trim();
    const pid = Number(firstLine);
    if (!Number.isInteger(pid) || pid <= 0) return { alivePid: null, stalePid: null };
    if (isPidAlive(pid)) return { alivePid: pid, stalePid: null };
    return { alivePid: null, stalePid: pid };
  } catch {
    return { alivePid: null, stalePid: null };
  }
}

async function cleanStaleDevServiceRecords(
  root: string,
  allowedServiceKey: string | undefined,
): Promise<{
  cleanedCount: number;
  activeConflicts: Array<{ serviceName: string; pid: number; port: number | null; serviceKey: string }>;
}> {
  const records = await listLocalServiceRegistryRecords({
    profileKind: "paperclip-dev",
    metadata: { repoRoot: root },
  });

  let cleanedCount = 0;
  const activeConflicts: Array<{ serviceName: string; pid: number; port: number | null; serviceKey: string }> = [];

  for (const record of records) {
    if (!isPidAlive(record.pid)) {
      await removeLocalServiceRegistryRecord(record.serviceKey);
      cleanedCount += 1;
      continue;
    }
    if (allowedServiceKey && record.serviceKey === allowedServiceKey) {
      continue;
    }
    activeConflicts.push({
      serviceName: record.serviceName,
      pid: record.pid,
      port: record.port,
      serviceKey: record.serviceKey,
    });
  }

  return { cleanedCount, activeConflicts };
}

async function terminateKnownPaperclipOwnerOnPort(
  root: string,
  port: number,
): Promise<number[]> {
  const terminated: number[] = [];
  const records = await listLocalServiceRegistryRecords({
    profileKind: "paperclip-dev",
    metadata: { repoRoot: root },
  });

  for (const record of records) {
    if (record.port !== port) continue;
    if (!isPidAlive(record.pid)) {
      await removeLocalServiceRegistryRecord(record.serviceKey);
      continue;
    }
    await terminateLocalService(record);
    await removeLocalServiceRegistryRecord(record.serviceKey);
    if (!isPidAlive(record.pid)) {
      terminated.push(record.pid);
    }
  }

  if (!(await isPortAvailable(port))) {
    const ownerPid = await readPortOwnerPid(port);
    if (ownerPid && isPidAlive(ownerPid)) {
      const ownerCommandLine = await readProcessCommandLine(ownerPid);
      if (looksLikePaperclipCommand(ownerCommandLine)) {
        const stopped = await terminatePid(ownerPid);
        if (stopped) {
          terminated.push(ownerPid);
        }
      }
    }
  }

  return terminated.filter((pid, index, all) => all.indexOf(pid) === index);
}

export async function runDevStartupRecovery(options: DevRecoveryOptions = {}): Promise<DevRecoveryResult> {
  const root = options.repoRoot ?? repoRoot;
  const serverPort = options.serverPort ?? 3100;
  const logLevel = options.logLevel ?? "normal";

  const result: DevRecoveryResult = {
    cleanedRegistryRecords: 0,
    terminatedPaperclipPids: [],
    terminatedPostgresPids: [],
    removedStalePostmasterPidFile: false,
  };

  const records = await cleanStaleDevServiceRecords(root, options.allowedServiceKey);
  result.cleanedRegistryRecords = records.cleanedCount;

  if (records.activeConflicts.length > 0) {
    const first = records.activeConflicts[0];
    const portSuffix = typeof first.port === "number" ? ` on port ${first.port}` : "";
    throw new Error(
      `Another Paperclip dev instance is already running (${first.serviceName}, pid ${first.pid}${portSuffix}). Stop it with 'pnpm dev:stop' before starting a new one.`,
    );
  }

  const databaseTarget = resolveDatabaseTarget();
  if (databaseTarget.mode === "embedded-postgres") {
    const postmasterPidFile = path.resolve(databaseTarget.dataDir, "postmaster.pid");
    const pidState = readPostmasterPidState(postmasterPidFile);
    const hasKnownLivePostmaster = pidState?.alivePid !== null;
    if (!hasKnownLivePostmaster) {
      const stalePids = await findEmbeddedPostgresPids(databaseTarget.dataDir);
      for (const pid of stalePids) {
        const stopped = await terminatePid(pid);
        if (stopped) {
          result.terminatedPostgresPids.push(pid);
        }
      }
    }

    if (pidState?.stalePid !== null) {
      rmSync(postmasterPidFile, { force: true });
      result.removedStalePostmasterPidFile = true;
    }
  }

  if (!(await isPortAvailable(serverPort))) {
    const isPaperclip = await canFetchPaperclipHealth(serverPort);
    if (isPaperclip) {
      result.terminatedPaperclipPids = await terminateKnownPaperclipOwnerOnPort(root, serverPort);

      if (!(await waitForPortToBeAvailable(serverPort))) {
        throw new Error(
          `Port ${serverPort} is already serving a healthy Paperclip instance. Auto-recovery could not stop it safely; run 'pnpm dev:stop' and retry.`,
        );
      }
    }
    if (!(await waitForPortToBeAvailable(serverPort))) {
      throw new Error(
        `Port ${serverPort} is already in use by another process. Auto-recovery will not kill unknown processes; free the port or set a different PORT before running dev.`,
      );
    }
  }

  if (result.cleanedRegistryRecords > 0) {
    logLine(logLevel, `dev recovery removed ${result.cleanedRegistryRecords} stale service record(s)`);
  }
  if (result.terminatedPostgresPids.length > 0) {
    logLine(logLevel, `dev recovery terminated stale postgres pid(s): ${result.terminatedPostgresPids.join(", ")}`);
  }
  if (result.terminatedPaperclipPids.length > 0) {
    logLine(logLevel, `dev recovery terminated paperclip pid(s) on port ${serverPort}: ${result.terminatedPaperclipPids.join(", ")}`);
  }
  if (result.removedStalePostmasterPidFile) {
    logLine(logLevel, "dev recovery removed stale postmaster.pid");
  }

  return result;
}

function parseCliArgs(argv: string[]) {
  let port = 3100;
  let quiet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--quiet") {
      quiet = true;
      continue;
    }
    if (arg === "--port") {
      const next = argv[i + 1];
      const parsed = Number.parseInt(next ?? "", 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        port = parsed;
        i += 1;
      }
    }
  }

  return { port, quiet };
}

async function main() {
  const { port, quiet } = parseCliArgs(process.argv.slice(2));
  try {
    const result = await runDevStartupRecovery({
      serverPort: port,
      logLevel: quiet ? "silent" : "normal",
    });

    if (!quiet) {
      const changed =
        result.cleanedRegistryRecords > 0 ||
        result.terminatedPaperclipPids.length > 0 ||
        result.terminatedPostgresPids.length > 0 ||
        result.removedStalePostmasterPidFile;
      if (!changed) {
        console.log("[paperclip] dev recovery: nothing to clean");
      }
    }
  } catch (error) {
    const err = toError(error, "Dev recovery failed");
    process.stderr.write(`[paperclip] ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
