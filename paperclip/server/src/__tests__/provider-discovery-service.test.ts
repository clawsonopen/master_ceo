import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { apiKeys, createDb, providerDiscoverySuggestions } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { providerDiscoveryService } from "../services/provider-discovery.js";

describe("providerDiscoveryService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-provider-discovery-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(providerDiscoverySuggestions);
    await db.delete(apiKeys);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await (db as { $client?: { end?: (options?: { timeout?: number }) => Promise<unknown> } }).$client?.end?.({
      timeout: 0,
    });
    await tempDb?.cleanup();
  });

  it("discovers auth and endpoint metadata from crawled pages", async () => {
    const docsHtml = `
      <html>
        <body>
          <h1>Acme API Reference</h1>
          <p>Use Authorization: Bearer YOUR_API_KEY.</p>
          <p>List models: https://api.acme.ai/v1/models</p>
          <p>Key validation: https://api.acme.ai/v1/key</p>
          <a href="/authentication">Authentication</a>
        </body>
      </html>
    `;
    const authHtml = `
      <html>
        <body>
          <h1>Authentication</h1>
          <p>Send Authorization: Bearer YOUR_API_KEY</p>
        </body>
      </html>
    `;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://docs.acme.ai/api-reference") {
        return new Response(docsHtml, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url === "https://docs.acme.ai/authentication") {
        return new Response(authHtml, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const svc = providerDiscoveryService(db);
    const suggestion = await svc.discover({
      provider: "acme",
      seedUrl: "https://docs.acme.ai/api-reference",
      discoveredBy: "agent-1",
    });

    expect(suggestion.provider).toBe("acme");
    expect(suggestion.authMode).toBe("bearer_header");
    expect(suggestion.authHeader).toBe("Authorization");
    expect(suggestion.authPrefix).toBe("Bearer");
    expect(suggestion.modelListUrl).toBe("https://api.acme.ai/v1/models");
    expect(suggestion.testUrl).toBe("https://api.acme.ai/v1/models");
    expect(suggestion.confidence).toBe("high");
    expect(suggestion.discoveryNotes).toContain("Extraction strategy");
    expect(Array.isArray(suggestion.sourceEvidence)).toBe(true);
    expect(suggestion.sourceEvidence.length).toBeGreaterThan(0);
  });

  it("blocks publishing low-confidence unvalidated suggestions", async () => {
    const [inserted] = await db
      .insert(providerDiscoverySuggestions)
      .values({
        provider: "custom-low",
        status: "suggested",
        confidence: "low",
        docsUrl: "https://docs.custom-low.ai",
        apiReferenceUrl: "https://docs.custom-low.ai/reference",
        testUrl: null,
        modelListUrl: null,
        authMode: null,
        authHeader: null,
        authPrefix: null,
        discoveryNotes: "placeholder",
        sourceEvidence: [],
        discoveredBy: "agent-1",
      })
      .returning();

    const svc = providerDiscoveryService(db);
    await expect(svc.publish(inserted!.id)).rejects.toThrow(
      "Low-confidence suggestions require manual validation before publish",
    );
  });

  it("publishes validated suggestions and writes metadata to api keys", async () => {
    await db.insert(apiKeys).values({
      provider: "acme",
      encryptedKey: "enc-key",
      keyPreview: "****1234",
      userId: "user-1",
      isValid: false,
    });

    const [inserted] = await db
      .insert(providerDiscoverySuggestions)
      .values({
        provider: "acme",
        status: "suggested",
        confidence: "high",
        docsUrl: "https://docs.acme.ai",
        apiReferenceUrl: "https://docs.acme.ai/api-reference",
        testUrl: "https://api.acme.ai/v1/models",
        modelListUrl: "https://api.acme.ai/v1/models",
        authMode: "bearer_header",
        authHeader: "Authorization",
        authPrefix: "Bearer",
        discoveryNotes: "validated",
        sourceEvidence: [{ url: "https://docs.acme.ai/api-reference", note: "validated" }],
        discoveredBy: "agent-1",
      })
      .returning();

    const svc = providerDiscoveryService(db);
    const published = await svc.publish(inserted!.id);

    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeTruthy();

    const keyRow = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.provider, "acme"))
      .then((rows) => rows[0] ?? null);

    expect(keyRow?.helpUrl).toBe("https://docs.acme.ai");
    expect(keyRow?.testUrl).toBe("https://api.acme.ai/v1/models");
    expect(keyRow?.testAuthHeader).toBe("Authorization");
    expect(keyRow?.testAuthPrefix).toBe("Bearer");
  });
});
