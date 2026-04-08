import { describe, expect, it } from "vitest";
import { formatUiMessage, normalizeUiLocale, translateUiMessage } from "./i18n";

describe("i18n utils", () => {
  it("normalizes locale strings to supported locales", () => {
    expect(normalizeUiLocale("tr-TR")).toBe("tr");
    expect(normalizeUiLocale("en-US")).toBe("en");
    expect(normalizeUiLocale("de-DE")).toBe("en");
    expect(normalizeUiLocale(undefined)).toBe("en");
  });

  it("formats message variables safely", () => {
    expect(formatUiMessage("hello {name}", { name: "paperclip" })).toBe("hello paperclip");
    expect(formatUiMessage("hello {name}")).toBe("hello {name}");
  });

  it("translates using locale dictionary with fallback to english", () => {
    expect(translateUiMessage("tr", "kb.pageTitle")).toBe("Bilgi Tabanı");
    expect(translateUiMessage("en", "kb.pageTitle")).toBe("Knowledge Base");
  });
});

