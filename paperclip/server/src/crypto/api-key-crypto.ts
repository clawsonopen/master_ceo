import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { badRequest } from "../errors.js";

interface ApiKeyEncryptedPayloadV1 {
  scheme: "api_key_aes_256_gcm_v1";
  iv: string;
  tag: string;
  ciphertext: string;
}

function resolveMasterKeyFilePath() {
  const fromEnv = process.env.PAPERCLIP_API_KEYS_MASTER_KEY_FILE?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "data/secrets/master.key");
}

function decodeMasterKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // ignored
  }

  if (Buffer.byteLength(trimmed, "utf8") === 32) {
    return Buffer.from(trimmed, "utf8");
  }
  return null;
}

function resolveMasterKeyFromEnv(): Buffer | null {
  const raw =
    process.env.PAPERCLIP_API_KEYS_MASTER_KEY?.trim() ||
    process.env.PAPERCLIP_SECRETS_MASTER_KEY?.trim() ||
    "";
  if (!raw) return null;
  const decoded = decodeMasterKey(raw);
  if (!decoded) {
    throw badRequest(
      "Invalid API key master key (expected 32-byte base64, 64-char hex, or raw 32-char string)",
    );
  }
  return decoded;
}

function loadOrCreateMasterKey(): Buffer {
  const fromEnv = resolveMasterKeyFromEnv();
  if (fromEnv) return fromEnv;

  const keyPath = resolveMasterKeyFilePath();
  if (existsSync(keyPath)) {
    const decoded = decodeMasterKey(readFileSync(keyPath, "utf8"));
    if (!decoded) {
      throw badRequest(`Invalid API key master key at ${keyPath}`);
    }
    return decoded;
  }

  mkdirSync(path.dirname(keyPath), { recursive: true });
  const generated = randomBytes(32);
  writeFileSync(keyPath, generated.toString("base64"), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // best effort
  }
  return generated;
}

function parseEncryptedPayload(value: string): ApiKeyEncryptedPayloadV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw badRequest("Invalid encrypted API key payload");
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>).scheme === "api_key_aes_256_gcm_v1" &&
    typeof (parsed as Record<string, unknown>).iv === "string" &&
    typeof (parsed as Record<string, unknown>).tag === "string" &&
    typeof (parsed as Record<string, unknown>).ciphertext === "string"
  ) {
    return parsed as ApiKeyEncryptedPayloadV1;
  }
  throw badRequest("Invalid encrypted API key payload");
}

export function encryptApiKey(plainValue: string): string {
  const trimmed = plainValue.trim();
  if (!trimmed) throw badRequest("API key cannot be empty");

  const masterKey = loadOrCreateMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: ApiKeyEncryptedPayloadV1 = {
    scheme: "api_key_aes_256_gcm_v1",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(payload);
}

export function decryptApiKey(encryptedValue: string): string {
  const payload = parseEncryptedPayload(encryptedValue);
  const masterKey = loadOrCreateMasterKey();
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

export function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const last4 = trimmed.slice(-4);
  return `****${last4}`;
}
