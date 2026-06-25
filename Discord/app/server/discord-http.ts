/**
 * Discord HTTP client with TLS fingerprint impersonation.
 *
 * The reason this exists: Discord's anti-spam doesn't just read headers — it
 * inspects the TLS ClientHello (JA3/JA4) and HTTP/2 frame ordering. Node's
 * native fetch / undici has a distinct signature that screams "automated".
 * cycletls spawns a Go sidecar that performs the TLS handshake byte-for-byte
 * like Chrome 124, then proxies the request through. Headers we set still get
 * applied; the difference is the underlying handshake Discord can no longer
 * fingerprint as Node.js.
 *
 * Provides:
 *   - `tlsFetch(url, opts)`         — drop-in fetch() replacement
 *   - `discordHeaders(token, ...)`  — same as before; header builder
 *   - `getFingerprint(token)`       — Discord /experiments fingerprint cache
 *   - `discordDispatcher()`         — legacy undici dispatcher; only used by
 *                                     gateway-adjacent code that can't yet move
 *                                     off undici. Will be removed once gateway
 *                                     WS is verified safe (it isn't captcha'd).
 */
import initCycleTLS from "cycletls";
import { ProxyAgent } from "undici";
import { spawnSync } from "child_process";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PROXY_URL = process.env.WEBSHARE_PROXY_URL || "";
const fetchDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

// Per-account strict proxy enforcement. Each call passes accountId; we look up
// its FIXED assigned proxy from the DB (cached 30s). No assignment ⇒ direct
// connection through the VPS IP (never falls back to a shared/rotating pool).
// Mixing accounts through a rotating proxy gives them different IPs per request
// which Discord flags as account takeover.
const PROXY_CACHE_TTL_MS = 30_000;
const proxyCache = new Map<string, { url: string | null; ts: number }>();

// Shared bulk-load promise — all concurrent first-time lookups share one DB query
// instead of firing N individual queries (which exhausted the connection pool at boot).
let bulkLoadPromise: Promise<void> | null = null;

async function ensureProxyCachePopulated(now: number): Promise<void> {
  if (!bulkLoadPromise) {
    bulkLoadPromise = (async () => {
      const { listAllAccountProxyUrls } = await import("./db");
      const all = await listAllAccountProxyUrls();
      for (const [id, url] of all) proxyCache.set(id, { url, ts: now });
    })().catch((err) => {
      console.warn(`[tls] bulk proxy cache load failed: ${(err as any)?.message || err}`);
    }).finally(() => {
      setTimeout(() => { bulkLoadPromise = null; }, PROXY_CACHE_TTL_MS);
    });
  }
  return bulkLoadPromise;
}

export async function lookupAccountProxy(accountId: string | undefined): Promise<string | undefined> {
  if (!accountId) return undefined; // no account context — go direct
  const now = Date.now();
  const cached = proxyCache.get(accountId);
  if (cached && now - cached.ts < PROXY_CACHE_TTL_MS) return cached.url || undefined;
  try {
    await ensureProxyCachePopulated(now);
    if (!proxyCache.has(accountId)) proxyCache.set(accountId, { url: null, ts: now });
    return proxyCache.get(accountId)?.url || undefined;
  } catch (err) {
    console.warn(`[tls] proxy lookup failed acct=${accountId}: ${(err as any)?.message || err}`);
    return undefined; // fail safe: go direct
  }
}
export function invalidateProxyCache(accountId?: string): void {
  if (accountId) proxyCache.delete(accountId);
  else proxyCache.clear();
  // Reset bulk load promise so the next lookup triggers a fresh DB query.
  bulkLoadPromise = null;
}

// Chrome 124 ClientHello (JA3): cipher suites + extensions + curves Chrome
// actually negotiates. Discord pattern-matches on this.
const CHROME_124_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0";

// Dynamically fetched — refreshed every 6 h so client_build_number stays current.
// Stale build numbers (months old) get flagged by Discord's anti-abuse heuristics.
let _buildNumber = 343773; // overwritten on first successful fetch
let _buildNumberFetchedAt = 0;
const BUILD_NUMBER_CACHE_MS = 6 * 60 * 60_000;

async function fetchDiscordBuildNumber(): Promise<number> {
  try {
    const html = await fetch("https://discord.com/app", {
      headers: { "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.text());
    const srcs = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
    for (const src of srcs.slice(0, 12)) {
      const js = await fetch(`https://discord.com${src}`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      }).then((r) => r.text()).catch(() => "");
      const m = js.match(/buildNumber["']?\s*:\s*(\d{5,7})/);
      if (m) {
        const n = Number(m[1]);
        if (n > 300_000) {
          console.log(`[tls] Discord build number refreshed: ${n}`);
          return n;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[tls] build number fetch failed: ${err?.message || err}`);
  }
  return _buildNumber;
}

function buildSuperPropsB64(buildNumber: number): string {
  return Buffer.from(JSON.stringify({
    os: "Windows", browser: "Chrome", device: "", system_locale: "en-US",
    browser_user_agent: USER_AGENT, browser_version: "124.0.0.0", os_version: "10",
    referrer: "", referring_domain: "", referrer_current: "", referring_domain_current: "",
    release_channel: "stable", client_build_number: buildNumber,
    client_event_source: null, design_id: 0,
  })).toString("base64");
}

export async function getSuperPropertiesB64(): Promise<string> {
  const now = Date.now();
  if (now - _buildNumberFetchedAt < BUILD_NUMBER_CACHE_MS) return buildSuperPropsB64(_buildNumber);
  _buildNumber = await fetchDiscordBuildNumber();
  _buildNumberFetchedAt = now;
  return buildSuperPropsB64(_buildNumber);
}

// Singleton cycletls instance. Lazy-init on first use so the sidecar Go
// binary only spawns when we actually need it.
let cycleTLSInstance: any = null;
let cycleTLSInitPromise: Promise<any> | null = null;

async function getCycleTLS(): Promise<any> {
  if (cycleTLSInstance) return cycleTLSInstance;
  if (!cycleTLSInitPromise) {
    // Random port to avoid clashing with anything else local. cycletls picks
    // its own free port internally if we omit, but pinning makes logs clearer.
    cycleTLSInitPromise = initCycleTLS({ port: 9119 })
      .then((c: any) => { cycleTLSInstance = c; return c; })
      .catch((err: any) => {
        console.warn(`[tls] cycletls init failed: ${err?.message || err}`);
        cycleTLSInitPromise = null; // allow retry
        throw err;
      });
  }
  return cycleTLSInitPromise;
}

/** Clean shutdown — called from index.ts on SIGTERM so the Go sidecar exits cleanly. */
export async function shutdownTls(): Promise<void> {
  if (cycleTLSInstance?.exit) {
    try { await cycleTLSInstance.exit(); } catch { /* noop */ }
    cycleTLSInstance = null;
  }
}

export interface TlsResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<any>;
}

export interface TlsRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  // v0.66 — pass accountId so the request egresses through the account's
  // strictly-assigned proxy. Omit only for calls not tied to any specific
  // account (e.g. proxy health checks).
  accountId?: string;
}

/**
 * fetch()-shaped wrapper around cycletls. All outbound Discord REST calls go
 * through this so they share the same Chrome 124 TLS fingerprint.
 */
export async function tlsFetch(url: string, opts: TlsRequestOptions = {}): Promise<TlsResponse> {
  const client = await getCycleTLS();
  const proxy = await lookupAccountProxy(opts.accountId);
  // cycletls API: client(url, options, method) — url is positional, NOT in options.
  const result = await client(
    url,
    {
      body: opts.body || "",
      headers: opts.headers || {},
      ja3: CHROME_124_JA3,
      userAgent: USER_AGENT,
      proxy: proxy || undefined,
      timeout: Math.ceil((opts.timeoutMs ?? 20_000) / 1000),
      disableRedirect: false,
    } as any,
    (opts.method || "get").toLowerCase() as any,
  );
  // cycletls returns body as string OR pre-parsed object depending on content-type.
  // Normalize to a string for `text()` and let `json()` parse-or-return.
  const rawBody = result?.body;
  const bodyStr = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody ?? "");
  const status = Number(result?.status ?? 0);
  const headers: Record<string, string> = {};
  if (result?.headers && typeof result.headers === "object") {
    for (const [k, v] of Object.entries(result.headers as Record<string, any>)) {
      headers[String(k).toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
    }
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => bodyStr,
    json: async () => (typeof rawBody === "object" && rawBody !== null ? rawBody : JSON.parse(bodyStr)),
  };
}

const fingerprintCache = new Map<string, { fp: string; ts: number }>();
const FINGERPRINT_TTL_MS = 60 * 60_000; // 1 hour

async function fetchFingerprint(token: string, accountId?: string): Promise<string | null> {
  try {
    const r = await tlsFetch("https://discord.com/api/v9/experiments?with_guild_experiments=false", {
      method: "GET",
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        authorization: token,
        origin: "https://discord.com",
        referer: "https://discord.com/channels/@me",
        "x-super-properties": await getSuperPropertiesB64(),
        "x-debug-options": "bugReporterEnabled",
        "x-discord-locale": "en-US",
        "x-discord-timezone": "UTC",
      },
      timeoutMs: 8_000,
      accountId,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.fingerprint ? String(j.fingerprint) : null;
  } catch {
    return null;
  }
}

export async function getFingerprint(token: string, accountId?: string): Promise<string | null> {
  const now = Date.now();
  const cached = fingerprintCache.get(token);
  if (cached && now - cached.ts < FINGERPRINT_TTL_MS) return cached.fp;
  const fp = await fetchFingerprint(token, accountId);
  if (fp) fingerprintCache.set(token, { fp, ts: now });
  return fp;
}

export async function discordHeaders(
  token: string,
  withBody = false,
  userAgentOverride?: string,
  accountId?: string,
): Promise<Record<string, string>> {
  const [fp, superProps] = await Promise.all([getFingerprint(token, accountId), getSuperPropertiesB64()]);
  const ua = userAgentOverride || USER_AGENT;
  const h: Record<string, string> = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    authorization: token,
    origin: "https://discord.com",
    referer: "https://discord.com/channels/@me",
    "user-agent": ua,
    "x-debug-options": "bugReporterEnabled",
    "x-discord-locale": "en-US",
    "x-discord-timezone": "UTC",
    "x-super-properties": superProps,
  };
  if (fp) h["x-fingerprint"] = fp;
  if (withBody) h["content-type"] = "application/json";
  return h;
}

/** Legacy: undici dispatcher for gateway WS (which uses `ws` package, separate
 *  proxy handling) and any non-Discord HTTP call that doesn't need impersonation. */
export function discordDispatcher() {
  return fetchDispatcher;
}

/**
 * Upload a file attachment to a Discord channel using multipart/form-data.
 * Uses undici fetch (proxy-aware) since cycletls doesn't support binary bodies.
 */
export async function sendDiscordFile(
  accountId: string,
  token: string,
  channelId: string,
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
  caption?: string,
): Promise<{ ok: boolean; httpStatus?: number; error?: string; discordMessageId?: string; attachmentUrl?: string }> {
  const proxyUrl = await lookupAccountProxy(accountId);
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  const { fetch: undiciFetch } = await import("undici");

  // Build multipart/form-data manually. Using the global FormData with
  // undici's fetch can lose the Content-Type boundary because undici checks
  // instanceof against its own internal FormData class, not the global one.
  const boundary = `----DiscordFormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const CRLF = "\r\n";
  const payloadJson = JSON.stringify({ content: caption || "" });

  const bodyParts: Buffer[] = [
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="payload_json"${CRLF}` +
      `Content-Type: application/json${CRLF}${CRLF}` +
      `${payloadJson}${CRLF}`
    ),
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="files[0]"; filename="${filename}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`
    ),
    fileBuffer,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ];
  const body = Buffer.concat(bodyParts);

  try {
    const r = await (undiciFetch as any)(
      `https://discord.com/api/v9/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: token,
          "User-Agent": USER_AGENT,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
        body,
        dispatcher,
      },
    );
    const text = await r.text();
    if (!r.ok) return { ok: false, httpStatus: r.status, error: text.slice(0, 200) };
    const json = JSON.parse(text);
    const attachmentUrl: string | undefined = json?.attachments?.[0]?.url ?? undefined;
    return { ok: true, discordMessageId: String(json?.id || ""), attachmentUrl };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Convert any browser-recorded audio (WebM/MP4) to OGG/Opus via ffmpeg,
 * then upload as a Discord native voice message (flags=8192). The recipient
 * sees a proper voice message bubble with a waveform and play button.
 * Falls back to a plain audio attachment if ffmpeg is unavailable.
 */
export async function sendDiscordVoice(
  accountId: string,
  token: string,
  channelId: string,
  audioBuffer: Buffer,
  mimeType: string,
  durationSecs: number,
): Promise<{ ok: boolean; httpStatus?: number; error?: string; discordMessageId?: string; attachmentUrl?: string }> {
  // Convert to OGG/Opus — Discord voice messages require this format.
  const oggBuffer = convertToOggOpus(audioBuffer);
  if (!oggBuffer) {
    // ffmpeg not available — fall back to plain attachment.
    const cleanMime = mimeType.split(";")[0].trim() || "audio/webm";
    const ext = cleanMime.includes("mp4") ? "mp4" : "webm";
    return sendDiscordFile(accountId, token, channelId, audioBuffer, cleanMime, `voice-message.${ext}`, "");
  }

  const proxyUrl = await lookupAccountProxy(accountId);
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const { fetch: undiciFetch } = await import("undici");

  const waveform = buildWaveform(oggBuffer);
  const dur = Math.max(0.1, durationSecs);
  const boundary = `----DiscordVoiceBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const CRLF = "\r\n";
  const payloadJson = JSON.stringify({
    flags: 8192,
    content: "",
    attachments: [{ id: "0", filename: "voice-message.ogg", waveform, duration_secs: dur }],
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="payload_json"${CRLF}` +
      `Content-Type: application/json${CRLF}${CRLF}` +
      `${payloadJson}${CRLF}`
    ),
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="files[0]"; filename="voice-message.ogg"${CRLF}` +
      `Content-Type: audio/ogg${CRLF}${CRLF}`
    ),
    oggBuffer,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ]);

  try {
    const r = await (undiciFetch as any)(
      `https://discord.com/api/v9/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: token,
          "User-Agent": USER_AGENT,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
        body,
        dispatcher,
      },
    );
    const text = await r.text();
    if (!r.ok) return { ok: false, httpStatus: r.status, error: text.slice(0, 200) };
    const json = JSON.parse(text);
    const attachmentUrl: string | undefined = json?.attachments?.[0]?.url ?? undefined;
    return { ok: true, discordMessageId: String(json?.id || ""), attachmentUrl };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function convertToOggOpus(input: Buffer): Buffer | null {
  try {
    const result = spawnSync("ffmpeg", [
      "-i", "pipe:0",
      "-c:a", "libopus",
      "-b:a", "96k",
      "-vbr", "on",
      "-compression_level", "10",
      "-f", "ogg",
      "pipe:1",
    ], { input, maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
    if (result.status !== 0 || !result.stdout?.length) return null;
    return result.stdout as Buffer;
  } catch {
    return null;
  }
}

function buildWaveform(audioBuffer: Buffer): string {
  // Sample 256 amplitude values across the buffer for the Discord waveform.
  const samples = 256;
  const step = Math.max(1, Math.floor(audioBuffer.length / samples));
  const wave = new Uint8Array(samples);
  for (let i = 0; i < samples; i++) {
    wave[i] = audioBuffer[Math.min(i * step, audioBuffer.length - 1)] ?? 64;
  }
  return Buffer.from(wave).toString("base64");
}
