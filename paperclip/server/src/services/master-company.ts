import fs from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, projects, routines, routineTriggers } from "@paperclipai/db";
import { agentInstructionsService } from "./agent-instructions.js";
import { loadDefaultAgentInstructionsBundle } from "./default-agent-instructions.js";
import { routineService } from "./routines.js";

export const MASTER_COMPANY_NAME = "Master Holding Company";
export const MASTER_CEO_NAME = "Master CEO";
export const COST_RESEARCH_AGENT_NAME = "Cost & Provider Research Agent";
export const MODEL_RESEARCH_ROUTER_AGENT_NAME = "Model Research Router Agent";
export const AI_NEWS_AND_RELEASES_AGENT_NAME = "AI News and Releases Agent";
export const DEVILS_ADVOCATE_AGENT_NAME = "Devil's Advocate QA Agent";

type SeededMasterHierarchy = {
  companyId: string;
  masterCeoId: string;
  costResearchAgentId: string;
  modelResearchRouterAgentId: string;
  aiNewsAndReleasesAgentId: string;
  devilsAdvocateAgentId: string;
  masterCompanyCreated: boolean;
  masterCeoCreated: boolean;
  costResearchAgentCreated: boolean;
  modelResearchRouterAgentCreated: boolean;
  aiNewsAndReleasesAgentCreated: boolean;
  devilsAdvocateAgentCreated: boolean;
};

type MasterHierarchyDb = Pick<Db, "select" | "insert" | "update">;

function deriveIssuePrefixBase(name: string) {
  const normalized = name.toUpperCase().replace(/[^A-Z]/g, "");
  return normalized.slice(0, 4) || "MSTR";
}

function suffixForAttempt(attempt: number) {
  if (attempt <= 1) return "";
  return String(attempt);
}

function isIssuePrefixConflict(error: unknown) {
  const constraint = typeof error === "object" && error !== null && "constraint" in error
    ? (error as { constraint?: string }).constraint
    : typeof error === "object" && error !== null && "constraint_name" in error
      ? (error as { constraint_name?: string }).constraint_name
      : undefined;
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "23505"
    && constraint === "companies_issue_prefix_idx";
}

async function createMasterCompany(tx: MasterHierarchyDb) {
  const base = deriveIssuePrefixBase(MASTER_COMPANY_NAME);

  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const issuePrefix = `${base}${suffixForAttempt(attempt)}`;
    try {
      const [company] = await tx
        .insert(companies)
        .values({
          name: MASTER_COMPANY_NAME,
          description: "Protected parent company for the Master CEO hierarchy.",
          status: "active",
          issuePrefix,
          companyType: "master",
          isDeletable: false,
          parentCompanyId: null,
          requireBoardApprovalForNewAgents: false,
        })
        .returning();
      return company;
    } catch (error) {
      if (!isIssuePrefixConflict(error)) throw error;
    }
  }

  throw new Error("Unable to allocate issue prefix for master company");
}

async function ensureProtectedAgent(
  tx: MasterHierarchyDb,
  input: {
    companyId: string;
    name: string;
    role: "ceo" | "researcher";
    title: string;
    icon: string;
    reportsTo?: string | null;
    permissions?: Record<string, unknown>;
    skills?: string[];
    kbAccess?: { read: string[]; write: string[]; search: string[] };
  },
) {
  const existing = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.companyId, input.companyId), eq(agents.name, input.name)))
    .then((rows) => rows[0] ?? null);

  const values = {
    companyId: input.companyId,
    name: input.name,
    role: input.role,
    title: input.title,
    icon: input.icon,
    status: "idle" as const,
    reportsTo: input.reportsTo ?? null,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    isProtected: true,
    hiredBy: null,
    skills: input.skills ?? [],
    kbAccess: input.kbAccess ?? { read: ["global"], write: ["global"], search: ["global"] },
    modelPreference: { mode: "auto" },
    permissions: input.permissions ?? {},
    updatedAt: new Date(),
  };

  if (!existing) {
    const [created] = await tx.insert(agents).values(values).returning({ id: agents.id });
    return { id: created.id, created: true };
  }

  await tx
    .update(agents)
    .set(values)
    .where(eq(agents.id, existing.id));

  return { id: existing.id, created: false };
}

const MODEL_RESEARCH_ROUTER_CAPABILITIES = [
  "Owns provider+model assignment recommendations for Master CEO and company CEOs.",
  "Combines quality, speed, and cost heuristics with saved provider key health.",
  "Generates deterministic recommendation notes for auditability.",
  "Maintains router assignment policy defaults and fallback provider strategy.",
  "Prepares provider API reference mappings for auth/test endpoint validation.",
  "Plans and drives provider docs auto-discovery (Phase 3B crawl + parse workflow).",
].join("\n");

const AI_NEWS_AND_RELEASES_CAPABILITIES = [
  "Scans AI ecosystem sources daily and tracks noteworthy updates for leadership.",
  "Summarizes releases across models, agents, frameworks, and applied best practices.",
  "Maintains structured release intelligence notes with source URLs and publication dates.",
  "Highlights what changed, why it matters, and recommended follow-up actions for Master CEO.",
].join("\n");

const DEVILS_ADVOCATE_CAPABILITIES = [
  "Performs pre-execution strategic quality checks for Master CEO created goals/issues.",
  "Can approve, bounce, or escalate strategic plans before worker dispatch.",
  "Evaluates logical consistency, missing context, and execution risk with compact JSON handoff records.",
  "Maintains audit-ready reasoning notes for each checkpoint decision.",
].join("\n");

const MASTER_OPERATIONS_PROJECT_NAME = "Master Operations";
const AI_NEWS_DAILY_ROUTINE_TITLE = "Daily AI News and Releases Scan";
const AI_NEWS_DAILY_ROUTINE_CRON = "0 9 * * *";
const AI_NEWS_DAILY_ROUTINE_TIMEZONE = "UTC";

const MODEL_RESEARCH_ROUTER_INSTRUCTION_FILE_NAMES = [
  "AGENTS.md",
  "HEARTBEAT.md",
  "SOUL.md",
  "TOOLS.md",
  "SKILLS.md",
] as const;
const AI_NEWS_INSTRUCTION_FILE_NAMES = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md", "SKILLS.md"] as const;
const DEVILS_ADVOCATE_INSTRUCTION_FILE_NAMES = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md", "SKILLS.md"] as const;

function resolveInstructionFileUrl(folderName: string, fileName: string) {
  return new URL(`../onboarding-assets/${folderName}/${fileName}`, import.meta.url);
}

async function loadInstructionBundle(
  folderName: string,
  fileNames: readonly string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveInstructionFileUrl(folderName, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function ensureMasterOperationsProject(
  db: Db,
  companyId: string,
) {
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.name, MASTER_OPERATIONS_PROJECT_NAME)))
    .then((rows) => rows[0] ?? null);

  if (existing) return existing.id;

  const [created] = await db
    .insert(projects)
    .values({
      companyId,
      name: MASTER_OPERATIONS_PROJECT_NAME,
      description: "Operational routines and reporting tasks for master-level protected agents.",
      status: "active",
    })
    .returning({ id: projects.id });
  return created.id;
}

async function materializeManagedBundleForAgent(
  db: Db,
  input: { agentId: string; files: Record<string, string> },
) {
  const seededAgent = await db
    .select({
      id: agents.id,
      companyId: agents.companyId,
      name: agents.name,
      role: agents.role,
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
    })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .then((rows) => rows[0] ?? null);
  if (!seededAgent) return;

  const instructions = agentInstructionsService();
  const materialized = await instructions.materializeManagedBundle(
    seededAgent,
    input.files,
    {
      entryFile: "AGENTS.md",
      replaceExisting: false,
      clearLegacyPromptTemplate: true,
    },
  );

  await db
    .update(agents)
    .set({
      adapterConfig: materialized.adapterConfig,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, input.agentId));
}

async function ensureMasterSeedInstructionBundles(
  db: Db,
  input: {
    masterCeoId: string;
    costResearchAgentId: string;
    modelResearchRouterAgentId: string;
    aiNewsAndReleasesAgentId: string;
    devilsAdvocateAgentId: string;
  },
) {
  const [ceoFiles, masterWorkerFiles, routerFiles, aiNewsFiles, devilsAdvocateFiles] = await Promise.all([
    loadDefaultAgentInstructionsBundle("ceo"),
    loadDefaultAgentInstructionsBundle("master_worker"),
    loadInstructionBundle("model-research-router", MODEL_RESEARCH_ROUTER_INSTRUCTION_FILE_NAMES),
    loadInstructionBundle("ai-news-releases", AI_NEWS_INSTRUCTION_FILE_NAMES),
    loadInstructionBundle("devils-advocate", DEVILS_ADVOCATE_INSTRUCTION_FILE_NAMES),
  ]);

  await materializeManagedBundleForAgent(db, {
    agentId: input.masterCeoId,
    files: ceoFiles,
  });
  await materializeManagedBundleForAgent(db, {
    agentId: input.costResearchAgentId,
    files: masterWorkerFiles,
  });
  await materializeManagedBundleForAgent(db, {
    agentId: input.modelResearchRouterAgentId,
    files: routerFiles,
  });
  await materializeManagedBundleForAgent(db, {
    agentId: input.aiNewsAndReleasesAgentId,
    files: aiNewsFiles,
  });
  await materializeManagedBundleForAgent(db, {
    agentId: input.devilsAdvocateAgentId,
    files: devilsAdvocateFiles,
  });
}

async function ensureAiNewsAgentDefaults(
  db: Db,
  input: { companyId: string; agentId: string },
) {
  const [existingRoutine] = await db
    .select({ id: routines.id })
    .from(routines)
    .where(and(
      eq(routines.companyId, input.companyId),
      eq(routines.assigneeAgentId, input.agentId),
      eq(routines.title, AI_NEWS_DAILY_ROUTINE_TITLE),
    ))
    .limit(1);

  const routinesSvc = routineService(db);
  const projectId = await ensureMasterOperationsProject(db, input.companyId);
  const routine = existingRoutine
    ? await routinesSvc.get(existingRoutine.id)
    : await routinesSvc.create(
      input.companyId,
      {
        projectId,
        title: AI_NEWS_DAILY_ROUTINE_TITLE,
        description: [
          "Run a daily scan across AI release channels (GitHub releases, YouTube updates, and x.com posts).",
          "Capture notable model/agent/project updates with URLs, dates, and concise strategic summaries.",
          "Prioritize items that change capabilities, performance, reliability, or operating costs.",
        ].join("\n"),
        assigneeAgentId: input.agentId,
        priority: "medium",
        status: "active",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        variables: [],
      },
      { userId: "system" },
    );

  const hasScheduleTrigger = await db
    .select({ id: routineTriggers.id })
    .from(routineTriggers)
    .where(and(
      eq(routineTriggers.routineId, routine.id),
      eq(routineTriggers.kind, "schedule"),
      eq(routineTriggers.cronExpression, AI_NEWS_DAILY_ROUTINE_CRON),
      eq(routineTriggers.timezone, AI_NEWS_DAILY_ROUTINE_TIMEZONE),
    ))
    .then((rows) => rows.length > 0);

  if (!hasScheduleTrigger) {
    await routinesSvc.createTrigger(
      routine.id,
      {
        kind: "schedule",
        label: "Daily master AI release scan",
        enabled: true,
        cronExpression: AI_NEWS_DAILY_ROUTINE_CRON,
        timezone: AI_NEWS_DAILY_ROUTINE_TIMEZONE,
      },
      { userId: "system" },
    );
  }
}

export async function ensureMasterCompanyHierarchy(db: Db): Promise<SeededMasterHierarchy> {
  const seedResult = await db.transaction(async (tx) => {
    let masterCompany = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.companyType, "master"))
      .then((rows) => rows[0] ?? null);

    const masterCompanyCreated = !masterCompany;
    if (!masterCompany) {
      masterCompany = await createMasterCompany(tx);
    } else {
      await tx
        .update(companies)
        .set({
          isDeletable: false,
          parentCompanyId: null,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, masterCompany.id));
    }

    const masterCeo = await ensureProtectedAgent(tx, {
      companyId: masterCompany.id,
      name: MASTER_CEO_NAME,
      role: "ceo",
      title: "Chief Executive Officer",
      icon: "crown",
      permissions: { canCreateAgents: true },
      skills: ["orchestrate_companies", "assign_tasks", "select_models"],
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });

    const costResearchAgent = await ensureProtectedAgent(tx, {
      companyId: masterCompany.id,
      name: COST_RESEARCH_AGENT_NAME,
      role: "researcher",
      title: "Provider Intelligence Researcher",
      icon: "search",
      reportsTo: masterCeo.id,
      permissions: { canCreateAgents: true },
      skills: ["provider_research", "cost_analysis", "quota_monitoring"],
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });

    const modelResearchRouterAgent = await ensureProtectedAgent(tx, {
      companyId: masterCompany.id,
      name: MODEL_RESEARCH_ROUTER_AGENT_NAME,
      role: "researcher",
      title: "Model Research + Router Agent",
      icon: "route",
      reportsTo: masterCeo.id,
      permissions: { canCreateAgents: true },
      skills: [
        "router_assignment",
        "model_research",
        "provider_catalog_curation",
        "cost_performance_tradeoff_analysis",
        "provider_docs_autodiscovery",
      ],
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });

    const aiNewsAndReleasesAgent = await ensureProtectedAgent(tx, {
      companyId: masterCompany.id,
      name: AI_NEWS_AND_RELEASES_AGENT_NAME,
      role: "researcher",
      title: "AI News and Releases Intelligence Agent",
      icon: "newspaper",
      reportsTo: masterCeo.id,
      permissions: { canCreateAgents: true },
      skills: [
        "ai_news_scanning",
        "release_notes_analysis",
        "model_capability_tracking",
        "source_evidence_curation",
      ],
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });

    const devilsAdvocateAgent = await ensureProtectedAgent(tx, {
      companyId: masterCompany.id,
      name: DEVILS_ADVOCATE_AGENT_NAME,
      role: "researcher",
      title: "Strategic QA / Reviewer",
      icon: "shield",
      reportsTo: masterCeo.id,
      permissions: { canCreateAgents: false },
      skills: [
        "strategy_review",
        "logic_consistency_check",
        "risk_escalation",
        "approval_bounce_triage",
      ],
      kbAccess: { read: ["global"], write: ["global"], search: ["global"] },
    });

    await tx
      .update(agents)
      .set({
        capabilities: MODEL_RESEARCH_ROUTER_CAPABILITIES,
        adapterConfig: {
          instructionsBundleMode: "managed",
          instructionsEntryFile: "AGENTS.md",
          routerProvider: "openrouter",
          routerModel: "openrouter/auto",
          routerPreference: "balanced",
          routerDecisionNote: "Default seeded assignment: balanced routing with audit-first notes.",
        },
        updatedAt: new Date(),
      })
      .where(eq(agents.id, modelResearchRouterAgent.id));

    await tx
      .update(agents)
      .set({
        capabilities: AI_NEWS_AND_RELEASES_CAPABILITIES,
        adapterConfig: {
          instructionsBundleMode: "managed",
          instructionsEntryFile: "AGENTS.md",
          briefingCadence: "daily",
          scanSources: ["github_releases", "youtube", "x_com"],
          summaryFocus: "models_agents_projects_research_best_practices",
        },
        updatedAt: new Date(),
      })
      .where(eq(agents.id, aiNewsAndReleasesAgent.id));

    await tx
      .update(agents)
      .set({
        capabilities: DEVILS_ADVOCATE_CAPABILITIES,
        adapterConfig: {
          instructionsBundleMode: "managed",
          instructionsEntryFile: "AGENTS.md",
          reviewScope: "strategic_checkpoints",
          decisionModes: ["approve", "bounce", "escalate"],
          outputFormat: "hybrid_json",
        },
        updatedAt: new Date(),
      })
      .where(eq(agents.id, devilsAdvocateAgent.id));

    return {
      companyId: masterCompany.id,
      masterCeoId: masterCeo.id,
      costResearchAgentId: costResearchAgent.id,
      modelResearchRouterAgentId: modelResearchRouterAgent.id,
      aiNewsAndReleasesAgentId: aiNewsAndReleasesAgent.id,
      devilsAdvocateAgentId: devilsAdvocateAgent.id,
      masterCompanyCreated,
      masterCeoCreated: masterCeo.created,
      costResearchAgentCreated: costResearchAgent.created,
      modelResearchRouterAgentCreated: modelResearchRouterAgent.created,
      aiNewsAndReleasesAgentCreated: aiNewsAndReleasesAgent.created,
      devilsAdvocateAgentCreated: devilsAdvocateAgent.created,
    };
  });

  await ensureMasterSeedInstructionBundles(db, {
    masterCeoId: seedResult.masterCeoId,
    costResearchAgentId: seedResult.costResearchAgentId,
    modelResearchRouterAgentId: seedResult.modelResearchRouterAgentId,
    aiNewsAndReleasesAgentId: seedResult.aiNewsAndReleasesAgentId,
    devilsAdvocateAgentId: seedResult.devilsAdvocateAgentId,
  });

  await ensureAiNewsAgentDefaults(db, {
    companyId: seedResult.companyId,
    agentId: seedResult.aiNewsAndReleasesAgentId,
  });

  return seedResult;
}
