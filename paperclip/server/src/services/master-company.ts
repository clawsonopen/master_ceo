import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies } from "@paperclipai/db";

export const MASTER_COMPANY_NAME = "Master Holding Company";
export const MASTER_CEO_NAME = "Master CEO";
export const COST_RESEARCH_AGENT_NAME = "Cost & Provider Research Agent";
export const MODEL_RESEARCH_ROUTER_AGENT_NAME = "Model Research Router Agent";

type SeededMasterHierarchy = {
  companyId: string;
  masterCompanyCreated: boolean;
  masterCeoCreated: boolean;
  costResearchAgentCreated: boolean;
  modelResearchRouterAgentCreated: boolean;
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

const MODEL_RESEARCH_ROUTER_INSTRUCTIONS = `# SKILLS.md

## Current skills
- router_assignment
- model_research
- provider_catalog_curation
- cost_performance_tradeoff_analysis
- provider_key_health_awareness
- deterministic_decision_logging

## In-progress / planned skills (Phase 3B)
- provider_docs_autodiscovery
- auth_scheme_detection
- test_endpoint_discovery
- api_reference_crawl
- model_list_live_discovery

## Operating notes
- Prefer deterministic safety rules for execution-time enforcement.
- Use API key validity state and provider model catalog before recommending assignments.
- Emit explicit decision notes with preference, task hint, and fallback path.
`;

export async function ensureMasterCompanyHierarchy(db: Db): Promise<SeededMasterHierarchy> {
  return db.transaction(async (tx) => {
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

    await tx
      .update(agents)
      .set({
        capabilities: MODEL_RESEARCH_ROUTER_CAPABILITIES,
        adapterConfig: {
          instructionsBundleMode: "inline_seeded",
          instructionsEntryFile: "SKILLS.md",
          seededSkillsMarkdown: MODEL_RESEARCH_ROUTER_INSTRUCTIONS,
          routerProvider: "openrouter",
          routerModel: "openrouter/auto",
          routerPreference: "balanced",
          routerDecisionNote: "Default seeded assignment: balanced routing with audit-first notes.",
        },
        updatedAt: new Date(),
      })
      .where(eq(agents.id, modelResearchRouterAgent.id));

    return {
      companyId: masterCompany.id,
      masterCompanyCreated,
      masterCeoCreated: masterCeo.created,
      costResearchAgentCreated: costResearchAgent.created,
      modelResearchRouterAgentCreated: modelResearchRouterAgent.created,
    };
  });
}
