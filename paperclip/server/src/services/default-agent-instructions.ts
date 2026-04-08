import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md", "SKILLS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md", "SKILLS.md"],
  master_worker: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md", "SKILLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

const DEFAULT_AGENT_BUNDLE_DIR: Record<DefaultAgentBundleRole, string> = {
  default: "default",
  ceo: "ceo",
  master_worker: "master-worker",
};

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${DEFAULT_AGENT_BUNDLE_DIR[role]}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function resolveDefaultAgentInstructionsBundleRole(
  role: string,
  options?: { companyType?: string | null },
): DefaultAgentBundleRole {
  if (role === "ceo") return "ceo";
  if (options?.companyType === "master") return "master_worker";
  return "default";
}
