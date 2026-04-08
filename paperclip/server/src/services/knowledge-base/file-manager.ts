import fs from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import {
  normalizeRelativeKbPath,
  resolveKbScopeFromRelativePath,
  sanitizePathSegment,
} from "./scopes.js";

type WatchEvent = "add" | "change" | "unlink";

export type KnowledgeBaseWatcherEvent = {
  event: WatchEvent;
  relativePath: string;
  absolutePath: string;
};

function formatLogTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function resolveKnowledgeBaseRoot(): string {
  const overriddenRoot = process.env.PAPERCLIP_KNOWLEDGE_BASE_ROOT?.trim();
  if (overriddenRoot) return path.resolve(overriddenRoot);
  return path.resolve(resolvePaperclipInstanceRoot(), "KnowledgeBase");
}

export class KBFileManager {
  private readonly rootPath: string;

  constructor(rootPath = resolveKnowledgeBaseRoot()) {
    this.rootPath = path.resolve(rootPath);
  }

  getRootPath(): string {
    return this.rootPath;
  }

  resolveAbsolutePath(relativePath: string): string {
    const normalized = normalizeRelativeKbPath(relativePath);
    const absolutePath = path.resolve(this.rootPath, normalized);
    const relativeToRoot = path.relative(this.rootPath, absolutePath);
    if (relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`)) {
      throw new Error("Path must stay within the KnowledgeBase root");
    }
    return absolutePath;
  }

  toRelativePath(filePath: string): string {
    const absolute = path.isAbsolute(filePath) ? filePath : this.resolveAbsolutePath(filePath);
    const relative = path.relative(this.rootPath, absolute).replaceAll("\\", "/");
    return normalizeRelativeKbPath(relative);
  }

  getScope(filePath: string): string {
    const relativePath = this.toRelativePath(filePath);
    return resolveKbScopeFromRelativePath(relativePath);
  }

  async scaffoldBaseStructure(): Promise<void> {
    const dirs = [
      "Global_Holding/raw",
      "Global_Holding/wiki",
      "Global_Holding/policies",
      "Global_Holding/model_research",
      "Intelligence/raw",
      "Intelligence/wiki",
      "Companies",
    ];

    await Promise.all(dirs.map((dir) => fs.mkdir(this.resolveAbsolutePath(dir), { recursive: true })));

    await this.ensureFile(
      "Global_Holding/wiki/index.md",
      "# Global Holding Knowledge Index\n\nThis wiki captures canonical, organization-wide knowledge.\n",
    );
    await this.ensureFile("Global_Holding/wiki/log.md", "# Global Holding Wiki Log\n");
    await this.ensureFile("Intelligence/wiki/index.md", "# Intelligence Index\n\nDaily research summaries land here.\n");
    await this.ensureFile("Intelligence/wiki/log.md", "# Intelligence Wiki Log\n");
    await this.ensureFile(
      "Intelligence/sources.yaml",
      "youtube_channels: []\nx_accounts: []\ngithub_repos: []\ngithub_topics: []\nrss_feeds: []\nkeywords: []\n",
    );
  }

  async ensureCompanyStructure(companyName: string): Promise<{ companySlug: string; basePath: string }> {
    const companySlug = sanitizePathSegment(companyName);
    const basePath = `Companies/${companySlug}`;
    await fs.mkdir(this.resolveAbsolutePath(`${basePath}/raw`), { recursive: true });
    await fs.mkdir(this.resolveAbsolutePath(`${basePath}/wiki`), { recursive: true });
    await fs.mkdir(this.resolveAbsolutePath(`${basePath}/projects`), { recursive: true });
    await this.ensureFile(`${basePath}/wiki/index.md`, `# ${companyName}\n\nCompany overview.\n`);
    await this.ensureFile(`${basePath}/wiki/log.md`, `# ${companyName} Wiki Log\n`);
    await this.ensureFile(`${basePath}/wiki/team.md`, `# ${companyName} Team\n`);
    return { companySlug, basePath };
  }

  async ensureProjectStructure(
    companyName: string,
    projectName: string,
  ): Promise<{ companySlug: string; projectSlug: string; basePath: string }> {
    const { companySlug } = await this.ensureCompanyStructure(companyName);
    const projectSlug = sanitizePathSegment(projectName);
    const basePath = `Companies/${companySlug}/projects/${projectSlug}`;
    await fs.mkdir(this.resolveAbsolutePath(`${basePath}/raw`), { recursive: true });
    await fs.mkdir(this.resolveAbsolutePath(`${basePath}/wiki`), { recursive: true });
    await fs.mkdir(this.resolveAbsolutePath(`${basePath}/code`), { recursive: true });
    await this.ensureFile(`${basePath}/wiki/index.md`, `# ${projectName}\n\nProject overview and goals.\n`);
    await this.ensureFile(`${basePath}/wiki/log.md`, `# ${projectName} Wiki Log\n`);
    await this.ensureFile(`${basePath}/wiki/todo.md`, `# ${projectName} TODO\n`);
    await this.ensureFile(`${basePath}/wiki/architecture.md`, `# ${projectName} Architecture\n`);
    return { companySlug, projectSlug, basePath };
  }

  async writeDocument(relativePath: string, content: string): Promise<{ relativePath: string; scope: string }> {
    const normalized = normalizeRelativeKbPath(relativePath);
    if (!normalized.toLowerCase().endsWith(".md")) {
      throw new Error("Knowledge base documents must be Markdown (.md)");
    }
    const absolutePath = this.resolveAbsolutePath(normalized);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
    return { relativePath: normalized, scope: this.getScope(normalized) };
  }

  async readDocument(relativePath: string): Promise<{ relativePath: string; content: string; scope: string }> {
    const normalized = normalizeRelativeKbPath(relativePath);
    const absolutePath = this.resolveAbsolutePath(normalized);
    const content = await fs.readFile(absolutePath, "utf8");
    return { relativePath: normalized, content, scope: this.getScope(normalized) };
  }

  async listDocuments(directory = ""): Promise<Array<{ relativePath: string; scope: string }>> {
    const normalizedDirectory = directory.trim().length > 0 ? normalizeRelativeKbPath(directory) : "";
    const absoluteDir = normalizedDirectory ? this.resolveAbsolutePath(normalizedDirectory) : this.rootPath;

    async function walk(dirPath: string): Promise<string[]> {
      const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
      const collected: string[] = [];
      for (const entry of entries) {
        const nextPath = path.resolve(dirPath, entry.name);
        if (entry.isDirectory()) {
          collected.push(...(await walk(nextPath)));
          continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.toLowerCase().endsWith(".md")) continue;
        collected.push(nextPath);
      }
      return collected;
    }

    const absoluteFiles = await walk(absoluteDir);
    return absoluteFiles
      .map((absolutePath) => {
        const relativePath = this.toRelativePath(absolutePath);
        return { relativePath, scope: this.getScope(relativePath) };
      })
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  watchDirectory(
    onEvent: (event: KnowledgeBaseWatcherEvent) => Promise<void> | void,
    options?: { ignoreInitial?: boolean },
  ): FSWatcher {
    const watcher = chokidar.watch(this.rootPath, {
      ignoreInitial: options?.ignoreInitial ?? true,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
    });

    const toPayload = (event: WatchEvent, absolutePath: string): KnowledgeBaseWatcherEvent => ({
      event,
      absolutePath,
      relativePath: this.toRelativePath(absolutePath),
    });

    watcher.on("add", (absolutePath) => {
      if (!absolutePath.toLowerCase().endsWith(".md")) return;
      void onEvent(toPayload("add", absolutePath));
    });
    watcher.on("change", (absolutePath) => {
      if (!absolutePath.toLowerCase().endsWith(".md")) return;
      void onEvent(toPayload("change", absolutePath));
    });
    watcher.on("unlink", (absolutePath) => {
      if (!absolutePath.toLowerCase().endsWith(".md")) return;
      void onEvent(toPayload("unlink", absolutePath));
    });

    return watcher;
  }

  async appendWikiLogEntry(input: {
    targetRelativePath: string;
    actorName: string;
    action: "created" | "updated" | "deleted";
  }): Promise<void> {
    const targetRelativePath = normalizeRelativeKbPath(input.targetRelativePath);
    const normalized = targetRelativePath.toLowerCase();
    const wikiMarker = "/wiki/";
    if (!normalized.includes(wikiMarker)) return;
    if (normalized.endsWith("/log.md")) return;

    const wikiPrefix = targetRelativePath.slice(0, normalized.indexOf(wikiMarker) + wikiMarker.length);
    const logRelativePath = `${wikiPrefix}log.md`;
    const logAbsolutePath = this.resolveAbsolutePath(logRelativePath);
    await fs.mkdir(path.dirname(logAbsolutePath), { recursive: true });
    if (!(await exists(logAbsolutePath))) {
      await fs.writeFile(logAbsolutePath, "# Wiki Log\n", "utf8");
    }

    const line = `[${formatLogTimestamp()}] ${input.actorName}: ${input.action} ${targetRelativePath}\n`;
    await fs.appendFile(logAbsolutePath, line, "utf8");
  }

  private async ensureFile(relativePath: string, content: string): Promise<void> {
    const absolutePath = this.resolveAbsolutePath(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    if (await exists(absolutePath)) return;
    await fs.writeFile(absolutePath, content, "utf8");
  }
}
