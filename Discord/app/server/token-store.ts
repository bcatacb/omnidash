/**
 * Encrypted token persistence.
 *
 * Tokens captured via QR or token-paste are written to /data/gg-api/accounts.enc
 * (AES-256-GCM with a server-held key). On boot we decrypt and re-hydrate the
 * mock state so accounts survive container restarts.
 *
 * Encryption key comes from TOKEN_ENCRYPTION_KEY env var (32-byte hex). If
 * missing, the module logs a loud warning and persistence is disabled — every
 * restart will wipe accounts, but the rest of the server still works.
 *
 * File format (after decrypting):
 *   {
 *     "version": 1,
 *     "accounts": [
 *       { account: DiscordAccount, token: string, userId: string, capturedAt: string }
 *     ]
 *   }
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { DiscordAccount } from "./api-types";

const STORE_DIR = process.env.TOKEN_STORE_DIR || "/data/gg-api";
const STORE_FILE = path.join(STORE_DIR, "accounts.enc");

const RAW_KEY = process.env.TOKEN_ENCRYPTION_KEY || "";
const KEY: Buffer | null = RAW_KEY
  ? (RAW_KEY.length === 64
      ? Buffer.from(RAW_KEY, "hex")
      : scryptSync(RAW_KEY, "discord-unibox-salt-v1", 32))
  : null;

if (!KEY) {
  console.warn("[token-store] no TOKEN_ENCRYPTION_KEY set — persistence DISABLED. Tokens will be lost on restart.");
} else {
  console.log(`[token-store] persistence ENABLED at ${STORE_FILE}`);
}

export interface StoredAccount {
  account: DiscordAccount;
  token: string;
  userId: string;
  capturedAt: string;
}

interface StoreFile {
  version: 1;
  accounts: StoredAccount[];
}

function encrypt(plaintext: string): Buffer {
  if (!KEY) throw new Error("no encryption key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [12-byte iv][16-byte tag][ciphertext]
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(blob: Buffer): string {
  if (!KEY) throw new Error("no encryption key");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const dec = createDecipheriv("aes-256-gcm", KEY, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString("utf8");
}

// In-memory mirror to avoid re-reading the file on every save.
let cache: StoreFile = { version: 1, accounts: [] };
let loaded = false;

async function load(): Promise<StoreFile> {
  if (!KEY) return { version: 1, accounts: [] };
  try {
    const buf = await fs.readFile(STORE_FILE);
    const json = decrypt(buf);
    const parsed = JSON.parse(json) as StoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      console.warn("[token-store] file present but invalid shape, treating as empty");
      return { version: 1, accounts: [] };
    }
    return parsed;
  } catch (err: any) {
    if (err?.code === "ENOENT") return { version: 1, accounts: [] };
    console.warn(`[token-store] load failed: ${err?.message || err}. Treating as empty.`);
    return { version: 1, accounts: [] };
  }
}

async function persist(): Promise<void> {
  if (!KEY) return;
  await fs.mkdir(STORE_DIR, { recursive: true });
  const json = JSON.stringify(cache);
  const blob = encrypt(json);
  // Atomic write: tmp + rename.
  const tmp = STORE_FILE + ".tmp";
  await fs.writeFile(tmp, blob, { mode: 0o600 });
  await fs.rename(tmp, STORE_FILE);
}

export async function init(): Promise<StoredAccount[]> {
  cache = await load();
  loaded = true;
  console.log(`[token-store] loaded ${cache.accounts.length} account(s) from disk`);
  return cache.accounts;
}

export async function save(entry: StoredAccount): Promise<void> {
  if (!loaded) await init();
  cache.accounts = cache.accounts.filter((a) => a.account.id !== entry.account.id);
  cache.accounts.push(entry);
  await persist();
}

export async function remove(accountId: string): Promise<void> {
  if (!loaded) await init();
  cache.accounts = cache.accounts.filter((a) => a.account.id !== accountId);
  await persist();
}

export async function all(): Promise<StoredAccount[]> {
  if (!loaded) await init();
  return cache.accounts.slice();
}

export const PERSISTENCE_ENABLED = !!KEY;
