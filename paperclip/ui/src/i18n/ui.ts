import { useMemo } from "react";
import { useI18n } from "@/context/I18nContext";
import { translateUiMessage } from "@/lib/i18n";
import type { UiMessageKey } from "./messages";

export { type UiMessageKey, type UiLocale } from "./messages";

export function useUiI18n() {
  const i18n = useI18n();
  const fallback = useMemo(() => ({
    locale: "en" as const,
    t: (key: UiMessageKey, vars?: Record<string, string | number>) => translateUiMessage("en", key, vars),
  }), []);

  return i18n ?? fallback;
}

