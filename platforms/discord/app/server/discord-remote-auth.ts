/**
 * Discord remote-auth (QR login) implementation.
 *
 * Speaks the same wss://remote-auth-gateway.discord.gg/?v=2 protocol the official
 * Discord desktop client uses for "scan to log in" — the same one beeper-discord
 * and mautrix-discord use. This is undocumented but stable; if it stops working,
 * Discord changed something and we'd have to inspect the desktop client traffic.
 *
 * ToS posture: connecting to Discord with a user token (not a bot) is in the
 * grey zone of Discord's ToS. The product wraps this honestly in the UI.
 *
 * Captured tokens are kept in-memory only on this module, never logged, never
 * surfaced to the API caller, and only used internally when we wire the
 * actual bridge stack. For production, encrypt at rest with a server-held key.
 */

import WebSocket from "ws";
import {
  generateKeyPairSync,
  privateDecrypt,
  constants,
  createHash,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { EventEmitter } from "node:events";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent } from "undici";

const REMOTE_AUTH_WS = "wss://remote-auth-gateway.discord.gg/?v=2";
const REMOTE_AUTH_LOGIN_URL = "https://discord.com/api/v9/users/@me/remote-auth/login";
const SESSION_TTL_MS = 5 * 60 * 1000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Residential proxy: when WEBSHARE_PROXY_URL is set, BOTH the WebSocket and the
// REST POST egress through it. Discord captcha-walls remote-auth from datacenter
// IPs (we hit this from Hetzner — 100% captcha rate); residential IPs route around it.
const PROXY_URL = process.env.WEBSHARE_PROXY_URL || "";
const wsAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;
const fetchDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
if (PROXY_URL) {
  // Log only the host:port portion, never the creds. Confirms in boot logs that proxy is on.
  const masked = PROXY_URL.replace(/\/\/[^@]+@/, "//***@");
  console.log(`[qr] residential proxy ENABLED via ${masked}`);
} else {
  console.warn(`[qr] no WEBSHARE_PROXY_URL — Discord will captcha-wall this VPS's datacenter IP`);
}

export type QrSessionStatus =
  | "opening"
  | "pending_scan"
  | "user_seen"
  | "authorizing"
  | "captcha_required"
  | "authorized"
  | "cancelled"
  | "error"
  | "expired";

export interface CaptchaChallenge {
  sitekey: string;
  rqdata: string;
  rqtoken: string | null;
  service: "hcaptcha" | "recaptcha" | string;
  sessionId: string | null;
}

export interface QrUserPreview {
  id: string;
  username: string;
  discriminator: string | null;
  avatarHash: string | null;
}

export interface QrSessionPublic {
  id: string;
  status: QrSessionStatus;
  qrUrl: string | null;
  userPreview: QrUserPreview | null;
  errorReason: string | null;
  captcha: CaptchaChallenge | null;
  createdAt: string;
  expiresAt: string;
}

interface InternalSession extends QrSessionPublic {
  ws: WebSocket | null;
  privateKey: KeyObject;
  hbTimer: NodeJS.Timeout | null;
  expiryTimer: NodeJS.Timeout | null;
  capturedToken: string | null; // never serialised
  // For captcha-retry flow: kept after pending_login so the user can solve and we resubmit.
  pendingTicket: string | null;
  pendingCaptcha: CaptchaChallenge | null;
  // Hard cap on captcha attempts. Discord's risk model often rejects everything we
  // submit regardless of correctness (server-fetch fingerprint), so retrying just
  // loops while hCaptcha's Privacy Pass auto-passes each new challenge silently.
  captchaAttempts: number;
}

const MAX_CAPTCHA_ATTEMPTS = 1;

const sessions = new Map<string, InternalSession>();
const events = new EventEmitter();

/** Subscribe to all QR session lifecycle events. Returns an unsubscribe fn. */
export function subscribe(listener: (evt: QrEvent) => void): () => void {
  events.on("evt", listener);
  return () => events.off("evt", listener);
}

export type QrEvent =
  | { type: "qr_ready"; sessionId: string; qrUrl: string; ts: string }
  | { type: "qr_user_seen"; sessionId: string; user: QrUserPreview; ts: string }
  | { type: "qr_authorizing"; sessionId: string; user: QrUserPreview; ts: string }
  | { type: "qr_captcha_required"; sessionId: string; user: QrUserPreview; sitekey: string; rqdata: string; service: string; ts: string }
  | { type: "qr_authorized"; sessionId: string; user: QrUserPreview; ts: string }
  | { type: "qr_failed"; sessionId: string; reason: string; ts: string }
  | { type: "qr_cancelled"; sessionId: string; ts: string };

const now = () => new Date().toISOString();
const emit = (evt: QrEvent) => events.emit("evt", evt);

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const decrypt = (sess: InternalSession, b64: string) =>
  privateDecrypt(
    { key: sess.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(b64, "base64"),
  );

function toPublic(s: InternalSession): QrSessionPublic {
  return {
    id: s.id,
    status: s.status,
    qrUrl: s.qrUrl,
    userPreview: s.userPreview,
    errorReason: s.errorReason,
    captcha: s.pendingCaptcha,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  };
}

export function getSession(id: string): QrSessionPublic | null {
  const s = sessions.get(id);
  return s ? toPublic(s) : null;
}

/** Read-only access to the captured token for internal use only (e.g. bridge wiring). */
export function consumeCapturedToken(id: string): string | null {
  const s = sessions.get(id);
  if (!s || s.status !== "authorized" || !s.capturedToken) return null;
  const token = s.capturedToken;
  // Wipe the token from memory once consumed so it can't be read twice.
  s.capturedToken = null;
  return token;
}

export function cancelSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  cleanup(s, "cancelled");
  emit({ type: "qr_cancelled", sessionId: id, ts: now() });
}

function cleanup(s: InternalSession, status: QrSessionStatus, reason?: string) {
  if (s.hbTimer) clearInterval(s.hbTimer);
  if (s.expiryTimer) clearTimeout(s.expiryTimer);
  s.hbTimer = null;
  s.expiryTimer = null;
  if (s.ws && s.ws.readyState === WebSocket.OPEN) {
    try {
      s.ws.close();
    } catch {
      /* noop */
    }
  }
  s.ws = null;
  s.status = status;
  if (reason) s.errorReason = reason;
  // Keep the session record around briefly so the UI can fetch the final state.
  setTimeout(() => sessions.delete(s.id), 30_000);
}

export function startSession(): QrSessionPublic {
  const id = randomBytes(8).toString("hex");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encodedPublicKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  const ws = new WebSocket(REMOTE_AUTH_WS, {
    origin: "https://discord.com",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
    agent: wsAgent,
  });

  const sess: InternalSession = {
    id,
    status: "opening",
    qrUrl: null,
    userPreview: null,
    errorReason: null,
    createdAt: now(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    ws,
    privateKey,
    hbTimer: null,
    expiryTimer: setTimeout(() => {
      if (
        sess.status === "pending_scan" ||
        sess.status === "user_seen" ||
        sess.status === "opening" ||
        sess.status === "captcha_required"
      ) {
        cleanup(sess, "expired");
        emit({ type: "qr_failed", sessionId: id, reason: "session expired (5 min)", ts: now() });
      }
    }, SESSION_TTL_MS),
    captcha: null,
    capturedToken: null,
    pendingTicket: null,
    pendingCaptcha: null,
    captchaAttempts: 0,
  };
  sessions.set(id, sess);

  ws.on("open", () => {
    console.log(`[qr] session=${id} ws opened`);
  });

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn(`[qr] session=${id} non-JSON message`);
      return;
    }

    switch (msg.op) {
      case "hello":
        sess.hbTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "heartbeat" }));
        }, Number(msg.heartbeat_interval) || 30_000);
        ws.send(JSON.stringify({ op: "init", encoded_public_key: encodedPublicKey }));
        break;

      case "nonce_proof": {
        const nonce = decrypt(sess, msg.encrypted_nonce);
        const proof = b64url(createHash("sha256").update(nonce).digest());
        ws.send(JSON.stringify({ op: "nonce_proof", proof }));
        break;
      }

      case "pending_remote_init": {
        sess.qrUrl = `https://discord.com/ra/${msg.fingerprint}`;
        sess.status = "pending_scan";
        emit({ type: "qr_ready", sessionId: id, qrUrl: sess.qrUrl, ts: now() });
        console.log(`[qr] session=${id} qr ready`);
        break;
      }

      case "pending_ticket": {
        // Discord just sent us an encrypted blob containing the user's public info.
        // Format: "<id>:<discriminator>:<avatar>:<username>"
        const decrypted = decrypt(sess, msg.encrypted_user_payload).toString("utf-8");
        const parts = decrypted.split(":");
        const user: QrUserPreview = {
          id: parts[0] || "",
          discriminator: parts[1] && parts[1] !== "0" ? parts[1] : null,
          avatarHash: parts[2] || null,
          username: parts.slice(3).join(":") || "(unknown)",
        };
        sess.userPreview = user;
        sess.status = "user_seen";
        emit({ type: "qr_user_seen", sessionId: id, user, ts: now() });
        console.log(`[qr] session=${id} user seen: ${user.username} (${user.id})`);
        break;
      }

      case "pending_login": {
        // User tapped "Log in" on mobile. Trade the ticket for an encrypted token.
        // Status flip BEFORE await so the WS close handler doesn't tear down mid-flight.
        sess.status = "authorizing";
        sess.pendingTicket = String(msg.ticket);
        console.log(`[qr] session=${id} pending_login received, exchanging ticket for token…`);
        emit({
          type: "qr_authorizing",
          sessionId: id,
          user: sess.userPreview ?? { id: "unknown", username: "unknown", discriminator: null, avatarHash: null },
          ts: now(),
        });
        await tryDiscordLogin(sess);
        break;
      }

      case "cancel": {
        cleanup(sess, "cancelled");
        emit({ type: "qr_cancelled", sessionId: id, ts: now() });
        break;
      }

      default:
        // Unknown op — log the FULL payload so we can spot if Discord renames something
        console.warn(`[qr] session=${id} unknown op: ${msg.op} payload=${JSON.stringify(msg).slice(0, 300)}`);
    }
  });

  ws.on("error", (err: Error) => {
    if (
      sess.status === "authorized" ||
      sess.status === "authorizing" ||
      sess.status === "captcha_required"
    ) return;
    cleanup(sess, "error", err.message);
    emit({ type: "qr_failed", sessionId: id, reason: err.message, ts: now() });
  });

  ws.on("close", (code: number) => {
    if (
      sess.status === "authorized" ||
      sess.status === "cancelled" ||
      sess.status === "expired" ||
      sess.status === "authorizing" || // ticket exchange still in flight — fetch will set final status
      sess.status === "captcha_required" // waiting for user to solve hCaptcha in the modal
    ) return;
    // Translate raw close codes into messages a human can act on.
    // Discord closes with 1005 (no status) on:
    //   - user tapped Cancel on phone
    //   - user didn't tap Log in within Discord's timeout (~2 min)
    //   - generic disconnect
    let reason: string;
    if (sess.status === "user_seen") {
      reason = "Login wasn't confirmed on your phone. Open Discord mobile and tap \"Log in\" on the prompt — or scan a new QR.";
    } else if (sess.status === "pending_scan") {
      reason = "Discord closed the connection before the QR was scanned.";
    } else {
      reason = `Connection to Discord closed (code=${code}).`;
    }
    cleanup(sess, "error", reason);
    emit({ type: "qr_failed", sessionId: id, reason, ts: now() });
  });

  return toPublic(sess);
}

// ============================================================================
// Discord /login POST — shared between first attempt and captcha-retry path.
// Surfaces captcha-required responses to the UI via qr_captcha_required instead
// of treating them as errors. The user solves hCaptcha in the modal and we
// retry the same ticket with the captcha_key in the request body.
// ============================================================================

const DISCORD_LOGIN_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "accept": "*/*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": USER_AGENT,
  "origin": "https://discord.com",
  "referer": "https://discord.com/",
  "x-discord-locale": "en-US",
  "x-discord-timezone": "UTC",
  "x-super-properties":
    "eyJvcyI6IkxpbnV4IiwiYnJvd3NlciI6IkNocm9tZSIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJlbi1VUyIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChYMTE7IExpbnV4IHg4Nl82NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyNC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTI0LjAuMC4wIiwib3NfdmVyc2lvbiI6IiIsInJlZmVycmVyIjoiIiwicmVmZXJyaW5nX2RvbWFpbiI6IiIsInJlZmVycmVyX2N1cnJlbnQiOiIiLCJyZWZlcnJpbmdfZG9tYWluX2N1cnJlbnQiOiIiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNDM3NzMsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGwsImRlc2lnbl9pZCI6MH0=",
};

async function tryDiscordLogin(sess: InternalSession, captchaKey?: string): Promise<void> {
  if (!sess.pendingTicket) {
    cleanup(sess, "error", "no pending ticket");
    emit({ type: "qr_failed", sessionId: sess.id, reason: "no pending ticket", ts: now() });
    return;
  }
  const id = sess.id;
  const t0 = Date.now();
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 15_000);
  // Discord's submission body uses captcha_key as a STRING (the h-captcha-response).
  // The array form in error responses is just OpenAPI validation noise.
  // Also: captcha_rqtoken (NOT rqdata) is the server-issued correlation token we echo back.
  const body: any = { ticket: sess.pendingTicket };
  if (captchaKey) {
    body.captcha_key = captchaKey;
    if (sess.pendingCaptcha?.rqtoken) body.captcha_rqtoken = sess.pendingCaptcha.rqtoken;
    if (sess.pendingCaptcha?.sessionId) body.captcha_session_id = sess.pendingCaptcha.sessionId;
  }
  try {
    const r = await fetch(REMOTE_AUTH_LOGIN_URL, {
      method: "POST",
      // @ts-expect-error — undici dispatcher
      dispatcher: fetchDispatcher,
      headers: DISCORD_LOGIN_HEADERS,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    clearTimeout(timeoutId);
    console.log(`[qr] session=${id} login HTTP ${r.status} in ${Date.now() - t0}ms (captcha=${captchaKey ? "yes" : "no"})`);

    // Captcha-required: HTTP 400 with captcha_key array in the body.
    if (r.status === 400) {
      const j = (await r.json().catch(() => null)) as any;
      // Log full 400 body so we can see WHICH error code Discord returned
      // (captcha-required vs invalid-input-response vs rqtoken-expired).
      console.warn(`[qr] session=${id} 400 body: ${JSON.stringify(j).slice(0, 400)}`);
      if (j?.captcha_key && j?.captcha_sitekey) {
        const challenge: CaptchaChallenge = {
          sitekey: String(j.captcha_sitekey),
          rqdata: String(j.captcha_rqdata || ""),
          rqtoken: j.captcha_rqtoken ? String(j.captcha_rqtoken) : null,
          service: String(j.captcha_service || "hcaptcha"),
          sessionId: j.captcha_session_id ? String(j.captcha_session_id) : null,
        };
        sess.pendingCaptcha = challenge;
        sess.status = "captcha_required";
        emit({
          type: "qr_captcha_required",
          sessionId: id,
          user: sess.userPreview ?? { id: "unknown", username: "unknown", discriminator: null, avatarHash: null },
          sitekey: challenge.sitekey,
          rqdata: challenge.rqdata,
          service: challenge.service,
          ts: now(),
        });
        console.log(`[qr] session=${id} CAPTCHA_REQUIRED sitekey=${challenge.sitekey.slice(0, 12)}… service=${challenge.service}`);
        return;
      }
      // 400 but not captcha — fall through to generic error
      const txt = JSON.stringify(j || "").slice(0, 200);
      cleanup(sess, "error", `login 400: ${txt}`);
      emit({ type: "qr_failed", sessionId: id, reason: `Discord rejected login: ${txt}`, ts: now() });
      return;
    }

    if (!r.ok) {
      const body = await r.text().catch(() => "");
      cleanup(sess, "error", `login ${r.status}: ${body.slice(0, 80)}`);
      emit({ type: "qr_failed", sessionId: id, reason: `Discord rejected login (HTTP ${r.status})`, ts: now() });
      return;
    }

    const json = (await r.json()) as { encrypted_token?: string };
    if (!json.encrypted_token) {
      cleanup(sess, "error", "missing encrypted_token");
      emit({ type: "qr_failed", sessionId: id, reason: "Discord response missing encrypted_token", ts: now() });
      return;
    }
    const token = decrypt(sess, json.encrypted_token).toString("utf-8");
    sess.capturedToken = token;
    sess.pendingTicket = null;
    sess.pendingCaptcha = null;
    sess.status = "authorized";
    emit({
      type: "qr_authorized",
      sessionId: id,
      user: sess.userPreview ?? { id: "unknown", username: "unknown", discriminator: null, avatarHash: null },
      ts: now(),
    });
    console.log(`[qr] session=${id} AUTHORIZED user=${sess.userPreview?.username} token=<${token.length}ch>`);
    cleanup(sess, "authorized");
  } catch (err: any) {
    clearTimeout(timeoutId);
    const msgText = err?.name === "AbortError"
      ? "Discord login endpoint timed out after 15s"
      : String(err?.message || err);
    console.warn(`[qr] session=${id} login THREW: ${msgText}`);
    cleanup(sess, "error", msgText);
    emit({ type: "qr_failed", sessionId: id, reason: msgText, ts: now() });
  }
}

/**
 * User solved the hCaptcha in their browser. Pass us the solved captcha key
 * (hCaptcha calls it the h-captcha-response token) and we retry the login.
 */
export async function submitCaptcha(
  sessionId: string,
  captchaKey: string,
): Promise<{ ok: boolean; status: QrSessionStatus; error?: string }> {
  const sess = sessions.get(sessionId);
  if (!sess) return { ok: false, status: "error", error: "session not found" };
  if (sess.status !== "captcha_required") {
    return { ok: false, status: sess.status, error: `wrong state: ${sess.status}` };
  }
  if (!sess.pendingTicket) return { ok: false, status: "error", error: "no pending ticket" };
  if (!captchaKey || captchaKey.length < 20) {
    return { ok: false, status: sess.status, error: "captcha_key looks invalid" };
  }
  // Cap retries — Discord rejects everything anyway and hCaptcha's Privacy Pass
  // auto-loops with new tokens, so we'd thrash forever without bound.
  sess.captchaAttempts += 1;
  if (sess.captchaAttempts > MAX_CAPTCHA_ATTEMPTS) {
    const reason = `Discord rejected the captcha solve. This often means Discord's risk model isn't satisfied by hCaptcha alone (it also checks browser fingerprint + cookies that we don't have as a server). Switch to the Token tab and paste your token instead.`;
    cleanup(sess, "error", reason);
    emit({ type: "qr_failed", sessionId, reason, ts: now() });
    return { ok: false, status: "error", error: reason };
  }
  sess.status = "authorizing";
  emit({
    type: "qr_authorizing",
    sessionId,
    user: sess.userPreview ?? { id: "unknown", username: "unknown", discriminator: null, avatarHash: null },
    ts: now(),
  });
  await tryDiscordLogin(sess, captchaKey);
  // After the await, status will be one of: authorized | captcha_required | error.
  const finalStatus = sess.status as QrSessionStatus;
  return { ok: finalStatus === "authorized", status: finalStatus, error: sess.errorReason ?? undefined };
}
