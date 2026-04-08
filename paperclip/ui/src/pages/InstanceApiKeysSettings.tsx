import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, KeyRound, Plus, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { apiKeysApi, type ApiKeyProvider } from "@/api/apiKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";

const KNOWN_PROVIDERS: Array<{
  id: string;
  label: string;
  helpUrl: string;
}> = [
  { id: "gemini", label: "Google Gemini", helpUrl: "https://ai.google.dev/" },
  { id: "openrouter", label: "OpenRouter", helpUrl: "https://openrouter.ai/keys" },
  { id: "groq", label: "Groq", helpUrl: "https://console.groq.com/keys" },
  { id: "cerebras", label: "Cerebras", helpUrl: "https://cloud.cerebras.ai/" },
  { id: "mistral", label: "Mistral", helpUrl: "https://console.mistral.ai/api-keys/" },
  { id: "github_models", label: "GitHub Models", helpUrl: "https://github.com/settings/tokens" },
  { id: "nvidia_nim", label: "NVIDIA NIM", helpUrl: "https://build.nvidia.com/" },
  { id: "openai", label: "OpenAI", helpUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", helpUrl: "https://console.anthropic.com/settings/keys" },
];
const DEFAULT_TEST_AUTH_HEADER = "Authorization";
const DEFAULT_TEST_AUTH_PREFIX = "Bearer";

function prettifyProviderLabel(providerId: string): string {
  return providerId
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

export function InstanceApiKeysSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [showKeyByProvider, setShowKeyByProvider] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [testMessages, setTestMessages] = useState<Partial<Record<string, string>>>({});
  const [customProviderInput, setCustomProviderInput] = useState("");
  const [customProviderKeyInput, setCustomProviderKeyInput] = useState("");
  const [showCustomProviderKey, setShowCustomProviderKey] = useState(false);
  const [customHelpUrlInput, setCustomHelpUrlInput] = useState("");
  const [customTestUrlInput, setCustomTestUrlInput] = useState("");
  const [customProviderIds, setCustomProviderIds] = useState<string[]>([]);
  const [providerConfigOpenById, setProviderConfigOpenById] = useState<Record<string, boolean>>({});
  const [providerMetaById, setProviderMetaById] = useState<
    Record<string, { helpUrl?: string; testUrl?: string; testAuthHeader?: string; testAuthPrefix?: string }>
  >({});

  useEffect(() => {
    setBreadcrumbs([{ label: "Instance Settings" }, { label: "API Keys" }]);
  }, [setBreadcrumbs]);

  const apiKeysQuery = useQuery({
    queryKey: queryKeys.instance.apiKeys,
    queryFn: () => apiKeysApi.list(),
  });

  const keyByProvider = useMemo(() => {
    const map = new Map<string, {
      maskedKey: string;
      isValid: boolean;
      helpUrl: string | null;
      testUrl: string | null;
      testAuthHeader: string | null;
      testAuthPrefix: string | null;
    }>();
    for (const item of apiKeysQuery.data ?? []) {
      map.set(item.provider, {
        maskedKey: item.maskedKey,
        isValid: item.isValid,
        helpUrl: item.helpUrl,
        testUrl: item.testUrl,
        testAuthHeader: item.testAuthHeader,
        testAuthPrefix: item.testAuthPrefix,
      });
    }
    return map;
  }, [apiKeysQuery.data]);

  const providerRows = useMemo(() => {
    const knownById = new Map(KNOWN_PROVIDERS.map((provider) => [provider.id, provider]));
    const allIds = new Set<string>([
      ...KNOWN_PROVIDERS.map((provider) => provider.id),
      ...customProviderIds,
      ...Array.from(keyByProvider.keys()),
    ]);

    return Array.from(allIds).map((id) => {
      const known = knownById.get(id);
      return {
        id,
        label: known?.label ?? prettifyProviderLabel(id),
        helpUrl: known?.helpUrl ?? "",
      };
    });
  }, [customProviderIds, keyByProvider]);

  const refreshApiKeys = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.instance.apiKeys });
  };

  const saveMutation = useMutation({
    mutationFn: ({ provider, key }: { provider: ApiKeyProvider; key: string }) =>
      apiKeysApi.save({
        provider,
        key,
        helpUrl: providerMetaById[provider]?.helpUrl ?? keyByProvider.get(provider)?.helpUrl ?? null,
        testUrl: providerMetaById[provider]?.testUrl ?? keyByProvider.get(provider)?.testUrl ?? null,
        testAuthHeader:
          providerMetaById[provider]?.testAuthHeader ?? keyByProvider.get(provider)?.testAuthHeader ?? null,
        testAuthPrefix:
          providerMetaById[provider]?.testAuthPrefix ?? keyByProvider.get(provider)?.testAuthPrefix ?? null,
      }),
    onSuccess: async (_data, variables) => {
      setActionError(null);
      setInputs((prev) => ({ ...prev, [variables.provider]: variables.key }));
      await refreshApiKeys();
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to save API key.");
    },
  });

  const testMutation = useMutation({
    mutationFn: (provider: ApiKeyProvider) => apiKeysApi.test(provider),
    onSuccess: async (data, provider) => {
      setActionError(null);
      setTestMessages((prev) => ({ ...prev, [provider]: data.message }));
      await refreshApiKeys();
    },
    onError: (error, provider) => {
      const message = error instanceof Error ? error.message : "Connection test failed.";
      setTestMessages((prev) => ({ ...prev, [provider]: message }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (provider: ApiKeyProvider) => apiKeysApi.remove(provider),
    onSuccess: async (_data, provider) => {
      setActionError(null);
      setTestMessages((prev) => ({ ...prev, [provider]: undefined }));
      setInputs((prev) => ({ ...prev, [provider]: "" }));
      setShowKeyByProvider((prev) => ({ ...prev, [provider]: false }));
      await refreshApiKeys();
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to delete API key.");
    },
  });

  const addCustomProviderMutation = useMutation({
    mutationFn: (input: {
      provider: string;
      key: string;
      helpUrl?: string | null;
      testUrl?: string | null;
    }) =>
      apiKeysApi.save({
        provider: input.provider,
        key: input.key,
        helpUrl: input.helpUrl ?? null,
        testUrl: input.testUrl ?? null,
        testAuthHeader: DEFAULT_TEST_AUTH_HEADER,
        testAuthPrefix: DEFAULT_TEST_AUTH_PREFIX,
      }),
    onSuccess: async (_data, variables) => {
      setCustomProviderIds((prev) =>
        prev.includes(variables.provider) ? prev : [...prev, variables.provider],
      );
      setProviderConfigOpenById((prev) => ({ ...prev, [variables.provider]: false }));
      setProviderMetaById((prev) => ({
        ...prev,
        [variables.provider]: {
          helpUrl: variables.helpUrl ?? undefined,
          testUrl: variables.testUrl ?? undefined,
          testAuthHeader: DEFAULT_TEST_AUTH_HEADER,
          testAuthPrefix: DEFAULT_TEST_AUTH_PREFIX,
        },
      }));
      setInputs((prev) => ({ ...prev, [variables.provider]: variables.key }));
      setShowKeyByProvider((prev) => ({ ...prev, [variables.provider]: false }));
      setCustomProviderInput("");
      setCustomProviderKeyInput("");
      setShowCustomProviderKey(false);
      setCustomHelpUrlInput("");
      setCustomTestUrlInput("");
      setActionError(null);
      await refreshApiKeys();
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to add custom provider.");
    },
  });

  function removeCustomProviderFromLocalState(providerId: string) {
    setCustomProviderIds((prev) => prev.filter((id) => id !== providerId));
    setProviderConfigOpenById((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setProviderMetaById((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setInputs((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setShowKeyByProvider((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setTestMessages((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
  }

  async function handleRemoveCustomProvider(providerId: string, hasSavedKey: boolean) {
    try {
      if (hasSavedKey) {
        await deleteMutation.mutateAsync(providerId);
      }
      removeCustomProviderFromLocalState(providerId);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove custom provider.");
    }
  }

  async function toggleProviderVisibility(providerId: string, hasSavedKey: boolean) {
    const currentlyVisible = showKeyByProvider[providerId] === true;
    if (currentlyVisible) {
      setShowKeyByProvider((prev) => ({ ...prev, [providerId]: false }));
      return;
    }

    const hasTypedValue = (inputs[providerId] ?? "").trim().length > 0;
    if (!hasTypedValue && hasSavedKey) {
      try {
        const response = await apiKeysApi.getValue(providerId);
        setInputs((prev) => ({ ...prev, [providerId]: response.key }));
        setActionError(null);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Failed to reveal API key.");
        return;
      }
    }
    setShowKeyByProvider((prev) => ({ ...prev, [providerId]: true }));
  }

  function addCustomProvider() {
    const normalized = customProviderInput.trim().toLowerCase();
    const key = customProviderKeyInput.trim();
    if (!normalized) return;
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
      setActionError("Provider must be 2-64 chars and contain only a-z, 0-9, _ or -");
      return;
    }
    if (!key) {
      setActionError("API key is required for custom provider.");
      return;
    }
    addCustomProviderMutation.mutate({
      provider: normalized,
      key,
      helpUrl: customHelpUrlInput.trim() || null,
      testUrl: customTestUrlInput.trim() || null,
    });
  }

  if (apiKeysQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading API keys...</div>;
  }

  if (apiKeysQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {apiKeysQuery.error instanceof Error
          ? apiKeysQuery.error.message
          : "Failed to load API keys."}
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">API Keys</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Global provider keys for the whole instance. Keys are encrypted at rest.
        </p>
      </div>

      <div className="rounded-md border border-amber-300/40 bg-amber-100/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
        All keys are encrypted. You can start without keys using local Gemma 4 and free-tier models.
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="space-y-3">
          <div className="text-sm font-semibold">Add Custom Provider</div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Provider ID</div>
            <Input
              value={customProviderInput}
              onChange={(event) => setCustomProviderInput(event.target.value)}
              placeholder="provider_id (example: together)"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">API Key</div>
            <div className="flex items-center gap-2">
              <Input
                type={showCustomProviderKey ? "text" : "password"}
                value={customProviderKeyInput}
                onChange={(event) => setCustomProviderKeyInput(event.target.value)}
                placeholder="Paste provider API key"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => setShowCustomProviderKey((prev) => !prev)}
                title={showCustomProviderKey ? "Hide key" : "Show key"}
                aria-label={showCustomProviderKey ? "Hide key" : "Show key"}
              >
                {showCustomProviderKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Help URL</div>
            <Input
              value={customHelpUrlInput}
              onChange={(event) => setCustomHelpUrlInput(event.target.value)}
              placeholder="https://provider.com/keys"
            />
            <div className="text-xs text-muted-foreground">
              Example (OpenRouter):{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                https://openrouter.ai/keys
              </a>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Test Endpoint URL</div>
            <Input
              value={customTestUrlInput}
              onChange={(event) => setCustomTestUrlInput(event.target.value)}
              placeholder="https://api.provider.com/v1/models"
            />
            <div className="text-xs text-muted-foreground">
              Example (OpenRouter):{" "}
              <a
                href="https://openrouter.ai/api/v1/key"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                https://openrouter.ai/api/v1/key
              </a>
            </div>
          </div>
          <div>
            <Button
              type="button"
              size="sm"
              onClick={addCustomProvider}
              disabled={addCustomProviderMutation.isPending}
            >
              <Plus className="h-4 w-4" />
              {addCustomProviderMutation.isPending ? "Adding..." : "Add Provider & Save Key"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          URL format must be <code>https://...</code>. Help URL is the key-generation page. Test endpoint is used
          by connection tests and Router/Model Research validation calls.
          Default auth is <code>{DEFAULT_TEST_AUTH_HEADER}: {DEFAULT_TEST_AUTH_PREFIX} &lt;API_KEY&gt;</code>.
          Most OpenAI-compatible providers work with this.
        </p>
      </section>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <div className="space-y-3">
        {providerRows.map((provider) => {
          const isCustomProvider = !KNOWN_PROVIDERS.some((known) => known.id === provider.id);
          const saved = keyByProvider.get(provider.id);
          const saving = saveMutation.isPending && saveMutation.variables?.provider === provider.id;
          const testing = testMutation.isPending && testMutation.variables === provider.id;
          const deleting = deleteMutation.isPending && deleteMutation.variables === provider.id;
          const hasSaved = Boolean(saved);
          return (
            <section key={provider.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="min-w-56 space-y-1">
                  <div className="text-sm font-semibold">{provider.label}</div>
                  <div className="text-xs text-muted-foreground">{provider.id}</div>
                  {(providerMetaById[provider.id]?.helpUrl || saved?.helpUrl || provider.helpUrl) ? (
                    <a
                      href={providerMetaById[provider.id]?.helpUrl || saved?.helpUrl || provider.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Generate key
                    </a>
                  ) : null}
                  {isCustomProvider ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() =>
                          setProviderConfigOpenById((prev) => ({
                            ...prev,
                            [provider.id]: !prev[provider.id],
                          }))
                        }
                      >
                        {providerConfigOpenById[provider.id] ? "Collapse config" : "Edit config"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-destructive"
                        onClick={() => void handleRemoveCustomProvider(provider.id, hasSaved)}
                        disabled={deleting}
                      >
                        Remove provider
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Input
                      type={showKeyByProvider[provider.id] ? "text" : "password"}
                      value={inputs[provider.id] ?? ""}
                      onChange={(event) =>
                        setInputs((prev) => ({ ...prev, [provider.id]: event.target.value }))
                      }
                      placeholder={saved ? `${saved.maskedKey} (saved)` : "Paste API key"}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => void toggleProviderVisibility(provider.id, hasSaved)}
                      title={showKeyByProvider[provider.id] ? "Hide key" : "Show key"}
                      aria-label={showKeyByProvider[provider.id] ? "Hide key" : "Show key"}
                    >
                      {showKeyByProvider[provider.id] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {isCustomProvider && providerConfigOpenById[provider.id] ? (
                    <div className="mt-2 space-y-2">
                      <Input
                        value={providerMetaById[provider.id]?.helpUrl ?? saved?.helpUrl ?? ""}
                        onChange={(event) =>
                          setProviderMetaById((prev) => ({
                            ...prev,
                            [provider.id]: { ...prev[provider.id], helpUrl: event.target.value },
                          }))
                        }
                        placeholder="Help URL (https://...)"
                      />
                      <Input
                        value={providerMetaById[provider.id]?.testUrl ?? saved?.testUrl ?? ""}
                        onChange={(event) =>
                          setProviderMetaById((prev) => ({
                            ...prev,
                            [provider.id]: { ...prev[provider.id], testUrl: event.target.value },
                          }))
                        }
                        placeholder="Test endpoint URL (https://...)"
                      />
                      <div className="text-xs text-muted-foreground">
                        Auth defaults to <code>{DEFAULT_TEST_AUTH_HEADER}: {DEFAULT_TEST_AUTH_PREFIX} &lt;API_KEY&gt;</code>.
                        If your provider differs, check its API reference.
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveMutation.mutate({ provider: provider.id, key: inputs[provider.id] ?? "" })}
                    disabled={saving || (inputs[provider.id] ?? "").trim().length === 0}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testMutation.mutate(provider.id)}
                    disabled={testing || !saved}
                  >
                    {testing ? "Testing..." : "Test Connection"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(provider.id)}
                    disabled={deleting || !saved}
                    aria-label={`Delete ${provider.label} key`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 text-xs">
                {saved ? (
                  saved.isValid ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-emerald-600 dark:text-emerald-400">Valid</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-amber-700 dark:text-amber-300">Not tested or invalid</span>
                    </>
                  )
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">No key saved</span>
                  </>
                )}
                {testMessages[provider.id] ? (
                  <span className="text-muted-foreground">- {testMessages[provider.id]}</span>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
