// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeBase } from "./KnowledgeBase";

const listMock = vi.fn();
const readMock = vi.fn();
const writeMock = vi.fn();
const searchMock = vi.fn();
const pushToastMock = vi.fn();

vi.mock("../api/knowledgeBase", () => ({
  knowledgeBaseApi: {
    list: (directory?: string) => listMock(directory),
    read: (path: string) => readMock(path),
    write: (path: string, content: string) => writeMock(path, content),
    search: (query: string, scopes?: string[], limit?: number) => searchMock(query, scopes, limit),
  },
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("KnowledgeBase page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    listMock.mockReset();
    readMock.mockReset();
    writeMock.mockReset();
    searchMock.mockReset();
    pushToastMock.mockReset();
    window.localStorage.setItem("paperclip.ui.locale", "en");
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("saves markdown content to knowledge-base path", async () => {
    listMock.mockResolvedValue({
      ok: true,
      documents: [],
    });
    readMock.mockResolvedValue({ ok: true, path: "", scope: "global", content: "" });
    writeMock.mockResolvedValue({
      ok: true,
      path: "Global_Holding/wiki/ops.md",
      scope: "global",
    });
    searchMock.mockResolvedValue({
      ok: true,
      query: "ops",
      scopes: [],
      results: [],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <KnowledgeBase />
        </QueryClientProvider>,
      );
      await flush();
    });
    expect(listMock).toHaveBeenCalled();

    const pathInput = container.querySelector("#kb-path") as HTMLInputElement | null;
    const editor = container.querySelector("#kb-content") as HTMLTextAreaElement | null;
    expect(pathInput).toBeTruthy();
    expect(editor).toBeTruthy();
    await act(async () => {
      if (pathInput) setInputValue(pathInput, "Global_Holding/wiki/ops.md");
      if (editor) setInputValue(editor, "# Ops\n\nUpdated content.");
      await flush();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Save"),
    );
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(writeMock).toHaveBeenCalledWith("Global_Holding/wiki/ops.md", "# Ops\n\nUpdated content.");
    expect(pushToastMock).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("runs semantic search and shows result rows", async () => {
    listMock.mockResolvedValue({
      ok: true,
      documents: [{ relativePath: "Global_Holding/wiki/ops.md", scope: "global" }],
    });
    readMock.mockResolvedValue({
      ok: true,
      path: "Global_Holding/wiki/ops.md",
      scope: "global",
      content: "# Ops",
    });
    writeMock.mockResolvedValue({
      ok: true,
      path: "Global_Holding/wiki/ops.md",
      scope: "global",
    });
    searchMock.mockResolvedValue({
      ok: true,
      query: "policy",
      scopes: ["global"],
      results: [
        {
          filePath: "Global_Holding/wiki/ops.md",
          scope: "global",
          score: 0.99,
          snippet: "Policy note",
        },
      ],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <KnowledgeBase />
        </QueryClientProvider>,
      );
      await flush();
    });

    const searchInput = container.querySelector('input[placeholder*="knowledge base"]') as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
    await act(async () => {
      if (searchInput) setInputValue(searchInput, "policy");
      await flush();
    });

    const searchButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Search"),
    );
    expect(searchButton).toBeTruthy();
    await act(async () => {
      searchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(searchMock).toHaveBeenCalledWith("policy", undefined, undefined);
    expect(container.textContent).toContain("Global_Holding/wiki/ops.md");
    expect(container.textContent).toContain("Policy note");

    await act(async () => {
      root.unmount();
    });
  });
});
