import { DEFAULT_UI_LOCALE, UI_MESSAGES, type UiLocale, type UiMessageKey } from "@/i18n/messages";

export const UI_LOCALE_STORAGE_KEY = "paperclip.ui.locale";

export function normalizeUiLocale(rawValue: string | null | undefined): UiLocale {
  if (!rawValue) return DEFAULT_UI_LOCALE;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized.startsWith("tr")) return "tr";
  if (normalized.startsWith("en")) return "en";
  return DEFAULT_UI_LOCALE;
}

export function formatUiMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replaceAll(/\{(\w+)\}/g, (match, key) => {
    if (!(key in vars)) return match;
    return String(vars[key]);
  });
}

export function translateUiMessage(
  locale: UiLocale,
  key: UiMessageKey,
  vars?: Record<string, string | number>,
): string {
  const fallback = UI_MESSAGES[DEFAULT_UI_LOCALE][key] ?? key;
  const template = UI_MESSAGES[locale][key] ?? fallback;
  return formatUiMessage(template, vars);
}

