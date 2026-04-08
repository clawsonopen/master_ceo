import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { KBEmbeddingService } from "../src/services/knowledge-base/embeddings.js";
import { KBFileManager } from "../src/services/knowledge-base/file-manager.js";
import { KBIndexer } from "../src/services/knowledge-base/indexer.js";
import { KBSearcher } from "../src/services/knowledge-base/searcher.js";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rawIndex = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rawIndex));
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  const iterations = Math.max(6, Number(process.env.PAPERCLIP_KB_PERF_ITERATIONS ?? 12));
  const warmup = Math.max(2, Number(process.env.PAPERCLIP_KB_PERF_WARMUP ?? 3));
  const avgThresholdMs = Math.max(1, Number(process.env.PAPERCLIP_KB_PERF_MAX_AVG_MS ?? 120));
  const p95ThresholdMs = Math.max(1, Number(process.env.PAPERCLIP_KB_PERF_MAX_P95_MS ?? 250));
  const requireVectorBackend = process.env.PAPERCLIP_KB_PERF_REQUIRE_VEC === "true";

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kb-perf-"));
  process.env.PAPERCLIP_KNOWLEDGE_BASE_ROOT = root;
  process.env.PAPERCLIP_KB_DISABLE_REMOTE_EMBEDDINGS = "true";

  const fileManager = new KBFileManager(root);
  await fileManager.scaffoldBaseStructure();
  const embeddingService = new KBEmbeddingService({ disableRemoteEmbeddings: true });
  const indexer = new KBIndexer({ fileManager, embeddingService });
  const searcher = new KBSearcher({ indexer, embeddingService });

  try {
    const docs: Array<{ path: string; content: string }> = [];
    for (let i = 0; i < 30; i += 1) {
      docs.push({
        path: `Global_Holding/wiki/perf-${i}.md`,
        content: `# Perf ${i}

Knowledge base retrieval benchmark document ${i}.
This file contains semantic retrieval phrases about roadmap strategy, memory indexing, and policy guardrails.
`,
      });
    }
    docs.push({
      path: "Intelligence/wiki/perf-signal.md",
      content: `# Signal

Market intelligence and trend signals for semantic search benchmarking.
`,
    });

    for (const doc of docs) {
      await fileManager.writeDocument(doc.path, doc.content);
      await indexer.indexDocument(doc.path);
    }

    for (let i = 0; i < warmup; i += 1) {
      await searcher.search("memory indexing roadmap strategy", ["global", "intelligence"], 10);
    }

    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      await searcher.search("memory indexing roadmap strategy", ["global", "intelligence"], 10);
      samples.push(performance.now() - start);
    }

    const total = samples.reduce((acc, value) => acc + value, 0);
    const avgMs = total / samples.length;
    const p95Ms = percentile(samples, 95);
    const minMs = Math.min(...samples);
    const maxMs = Math.max(...samples);
    const payload = {
      vector: indexer.getVectorCapability(),
      requireVectorBackend,
      iterations,
      warmup,
      avgMs,
      p95Ms,
      minMs,
      maxMs,
      thresholds: {
        avgMs: avgThresholdMs,
        p95Ms: p95ThresholdMs,
      },
    };

    console.log("[kb-perf-smoke]", JSON.stringify(payload));

    if (requireVectorBackend && !payload.vector.available) {
      throw new Error("kb-perf-smoke requires sqlite-vec backend, but vector backend is unavailable");
    }

    if (avgMs > avgThresholdMs || p95Ms > p95ThresholdMs) {
      throw new Error(
        `kb-perf-smoke thresholds exceeded: avg=${avgMs.toFixed(2)}ms (max ${avgThresholdMs}), p95=${p95Ms.toFixed(2)}ms (max ${p95ThresholdMs})`,
      );
    }
  } finally {
    indexer.close();
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.PAPERCLIP_KNOWLEDGE_BASE_ROOT;
  }
}

main().catch((error) => {
  console.error("[kb-perf-smoke] failed", error);
  process.exit(1);
});
