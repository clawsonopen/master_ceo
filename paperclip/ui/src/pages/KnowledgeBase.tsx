import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, FolderTree, FileText, RefreshCw, Save, PlusSquare } from "lucide-react";
import { knowledgeBaseApi, type KBDocumentEntry, type KBSearchResult } from "../api/knowledgeBase";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { useUiI18n } from "../i18n/ui";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TreeNode = {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: TreeNode[];
};

function toTree(entries: KBDocumentEntry[]): TreeNode[] {
  type MutableNode = TreeNode & { childrenMap: Map<string, MutableNode> };
  const rootMap = new Map<string, MutableNode>();

  for (const entry of entries) {
    const segments = entry.relativePath.split("/").filter(Boolean);
    let currentMap = rootMap;
    let currentPath = "";

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;

      let node = currentMap.get(segment) as MutableNode | undefined;
      if (!node) {
        node = {
          name: segment,
          fullPath: currentPath,
          isFile,
          children: [],
          childrenMap: new Map<string, MutableNode>(),
        };
        currentMap.set(segment, node);
      }
      if (isFile) {
        node.isFile = true;
      }
      currentMap = node.childrenMap;
    }
  }

  function sortNodes(nodes: MutableNode[]): TreeNode[] {
    return [...nodes]
      .map((node) => ({
        name: node.name,
        fullPath: node.fullPath,
        isFile: node.isFile,
        children: sortNodes(Array.from(node.childrenMap.values())),
      }))
      .sort((left, right) => {
        if (left.isFile !== right.isFile) return left.isFile ? 1 : -1;
        return left.name.localeCompare(right.name);
      });
  }

  return sortNodes(Array.from(rootMap.values()) as MutableNode[]);
}

function collectScopes(entries: KBDocumentEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.scope))).sort((left, right) => left.localeCompare(right));
}

function TreeView({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <div key={node.fullPath}>
          <button
            type="button"
            onClick={() => {
              if (node.isFile) onSelect(node.fullPath);
            }}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs border border-transparent",
              node.isFile
                ? "hover:bg-accent/40"
                : "text-muted-foreground cursor-default",
              node.isFile && selectedPath === node.fullPath && "bg-accent border-border",
            )}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            {node.isFile ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <FolderTree className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{node.name}</span>
          </button>
          {node.children.length > 0 && (
            <TreeView nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

export function KnowledgeBase() {
  const { t } = useUiI18n();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [directory, setDirectory] = useState("");
  const [scopeFilter, setScopeFilter] = useState("__all__");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<KBSearchResult[]>([]);

  useEffect(() => {
    setBreadcrumbs([{ label: t("kb.pageTitle") }]);
  }, [setBreadcrumbs, t]);

  const listQuery = useQuery({
    queryKey: queryKeys.knowledgeBase.list(directory, scopeFilter),
    queryFn: () => knowledgeBaseApi.list(directory),
  });

  const readQuery = useQuery({
    queryKey: queryKeys.knowledgeBase.read(selectedPath),
    queryFn: () => knowledgeBaseApi.read(selectedPath!),
    enabled: Boolean(selectedPath),
  });

  useEffect(() => {
    if (!readQuery.data) return;
    setEditorPath(readQuery.data.path);
    setEditorContent(readQuery.data.content);
  }, [readQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => knowledgeBaseApi.write(editorPath.trim(), editorContent),
    onSuccess: (result) => {
      pushToast({
        tone: "success",
        title: t("kb.writeSuccessTitle"),
        body: t("kb.writeSuccessBody", { path: result.path }),
      });
      setSelectedPath(result.path);
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase.list(directory, scopeFilter) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase.read(result.path) });
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: t("kb.writeErrorTitle"),
        body: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const searchMutation = useMutation({
    mutationFn: () => knowledgeBaseApi.search(searchInput.trim()),
    onSuccess: (result) => {
      setSearchResults(result.results);
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: t("kb.searchErrorTitle"),
        body: error instanceof Error ? error.message : String(error),
      });
      setSearchResults([]);
    },
  });

  const allDocs = listQuery.data?.documents ?? [];
  const scopes = useMemo(() => collectScopes(allDocs), [allDocs]);
  const visibleDocs = useMemo(
    () => (scopeFilter === "__all__" ? allDocs : allDocs.filter((doc) => doc.scope === scopeFilter)),
    [allDocs, scopeFilter],
  );
  const tree = useMemo(() => toTree(visibleDocs), [visibleDocs]);

  const pageStatus = saveMutation.isPending
    ? t("kb.statusSaving")
    : listQuery.isFetching || readQuery.isFetching
      ? t("kb.statusLoading")
      : t("kb.statusReady");

  return (
    <div className="space-y-4">
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle>{t("kb.pageTitle")}</CardTitle>
          <CardDescription>{t("kb.pageDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-directory">
                {t("kb.directoryLabel")}
              </label>
              <Input
                id="kb-directory"
                value={directory}
                placeholder={t("kb.directoryPlaceholder")}
                onChange={(event) => setDirectory(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-scope">
                {t("kb.scopeLabel")}
              </label>
              <select
                id="kb-scope"
                value={scopeFilter}
                onChange={(event) => setScopeFilter(event.target.value)}
                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="__all__">{t("kb.scopeAll")}</option>
                {scopes.map((scope) => (
                  <option key={scope} value={scope}>{scope}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void listQuery.refetch();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("kb.refresh")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("kb.filesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <div className="max-h-[480px] overflow-auto pr-2">
              {listQuery.isLoading ? (
                <p className="px-2 text-xs text-muted-foreground">{t("kb.statusLoading")}</p>
              ) : tree.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">{t("kb.filesEmpty")}</p>
              ) : (
                <TreeView
                  nodes={tree}
                  selectedPath={selectedPath}
                  onSelect={(path) => {
                    setSelectedPath(path);
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("kb.searchTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              <div className="flex gap-2">
                <Input
                  value={searchInput}
                  placeholder={t("kb.searchPlaceholder")}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <Button
                  type="button"
                  disabled={searchInput.trim().length === 0 || searchMutation.isPending}
                  onClick={() => {
                    void searchMutation.mutateAsync();
                  }}
                >
                  <Search className="mr-2 h-4 w-4" />
                  {t("kb.searchButton")}
                </Button>
              </div>
              <div className="max-h-48 overflow-auto border border-border">
                {searchMutation.isPending ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">{t("kb.statusLoading")}</p>
                ) : searchInput.trim().length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">{t("kb.searchEmpty")}</p>
                ) : searchResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">{t("kb.searchNoMatches")}</p>
                ) : (
                  searchResults.map((result) => (
                    <button
                      key={`${result.filePath}-${result.chunkId ?? "top"}`}
                      type="button"
                      className="w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent/40"
                      onClick={() => setSelectedPath(result.filePath)}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium">{result.filePath}</span>
                        <span className="font-mono text-muted-foreground">{result.score.toFixed(3)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.snippet ?? result.scope}</p>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("kb.editorTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-path">{t("kb.pathLabel")}</label>
                <Input
                  id="kb-path"
                  value={editorPath}
                  placeholder={t("kb.pathPlaceholder")}
                  onChange={(event) => setEditorPath(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-content">{t("kb.contentLabel")}</label>
                <Textarea
                  id="kb-content"
                  value={editorContent}
                  placeholder={t("kb.contentPlaceholder")}
                  onChange={(event) => setEditorContent(event.target.value)}
                  className="min-h-[280px] font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedPath(null);
                    setEditorPath("");
                    setEditorContent("");
                  }}
                >
                  <PlusSquare className="mr-2 h-4 w-4" />
                  {t("kb.newFile")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedPath}
                  onClick={() => {
                    if (!selectedPath) return;
                    void readQuery.refetch();
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("kb.loadFile")}
                </Button>
                <Button
                  type="button"
                  disabled={editorPath.trim().length === 0 || saveMutation.isPending}
                  onClick={() => {
                    void saveMutation.mutateAsync();
                  }}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {t("kb.saveFile")}
                </Button>
                <span className="text-xs text-muted-foreground">{pageStatus}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t("kb.readOnlyHint")}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
