import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { UiMessageKey, UiLocale } from "@/i18n/messages";
import { normalizeUiLocale, translateUiMessage, UI_LOCALE_STORAGE_KEY } from "@/lib/i18n";

type I18nContextValue = {
  locale: UiLocale;
  setLocale: (nextLocale: UiLocale) => void;
  t: (key: UiMessageKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLocale(): UiLocale {
  if (typeof window === "undefined") return "en";
  try {
    return normalizeUiLocale(window.localStorage.getItem(UI_LOCALE_STORAGE_KEY));
  } catch {
    return normalizeUiLocale(window.navigator.language);
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(() => detectInitialLocale());

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: (nextLocale: UiLocale) => {
      setLocaleState(nextLocale);
      try {
        window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, nextLocale);
      } catch {
        // Ignore storage failures in restricted environments.
      }
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("lang", nextLocale);
      }
    },
    t: (key, vars) => translateUiMessage(locale, key, vars),
  }), [locale]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

