import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptApiKey, encryptApiKey, maskApiKey } from "../crypto/api-key-crypto.js";

describe("api key crypto utility", () => {
  const originalMasterKey = process.env.PAPERCLIP_API_KEYS_MASTER_KEY;
  const originalSecretsKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;

  beforeEach(() => {
    process.env.PAPERCLIP_API_KEYS_MASTER_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  });

  afterEach(() => {
    if (originalMasterKey === undefined) {
      delete process.env.PAPERCLIP_API_KEYS_MASTER_KEY;
    } else {
      process.env.PAPERCLIP_API_KEYS_MASTER_KEY = originalMasterKey;
    }
    if (originalSecretsKey === undefined) {
      delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
    } else {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY = originalSecretsKey;
    }
    vi.restoreAllMocks();
  });

  it("encrypts and decrypts round-trip", () => {
    const encrypted = encryptApiKey("sk-test-value-1234");
    expect(encrypted).not.toContain("sk-test-value-1234");

    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe("sk-test-value-1234");
  });

  it("masks keys with only last 4 chars visible", () => {
    expect(maskApiKey("abcdefgh1234")).toBe("****1234");
  });
});
