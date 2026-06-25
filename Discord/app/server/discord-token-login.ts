/**
 * Token-paste login.
 *
 * The user copies their Discord user token from a logged-in Discord client
 * (DevTools → Network → any request → Authorization header) and pastes it.
 * We verify it works by hitting GET /api/v9/users/@me, then provision a
 * DiscordAccount using the same downstream path as QR captures.
 *
 * No captcha involved — this isn't an auth endpoint, just a profile fetch
 * with a token Discord already issued.
 */

import { ProxyAgent } from "undici";

const ME_URL = "https://discord.com/api/v9/users/@me";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PROXY_URL = process.env.WEBSHARE_PROXY_URL || "";
const fetchDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

// Discord user tokens come in three rough shapes:
//   - 24+ char base64.6+chars.27+ chars  (modern user token)
//   - mfa.<base64>                       (legacy MFA token)
//   - 24+ char base64.6+chars.38+ chars  (newer 2024 format)
// We do a loose check — better to let Discord reject it than to be over-strict.
const TOKEN_SHAPE = /^(mfa\.[A-Za-z0-9_-]{40,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,})$/;

export interface DiscordUserMe {
  id: string;
  username: string;
  discriminator: string | null;
  avatarHash: string | null;
  email: string | null;
  verified: boolean;
  global_name: string | null;
}

export interface TokenLoginResult {
  ok: boolean;
  user?: DiscordUserMe;
  reason?: string;
  httpStatus?: number;
}

export async function verifyDiscordToken(token: string): Promise<TokenLoginResult> {
  const trimmed = String(token || "").trim();
  if (!trimmed) return { ok: false, reason: "token is empty" };
  if (!TOKEN_SHAPE.test(trimmed)) {
    return { ok: false, reason: "token doesn't look like a Discord user token" };
  }

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 12_000);

  try {
    const r = await fetch(ME_URL, {
      method: "GET",
      // @ts-expect-error — undici dispatcher
      dispatcher: fetchDispatcher,
      headers: {
        "authorization": trimmed,
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": USER_AGENT,
        "origin": "https://discord.com",
        "referer": "https://discord.com/channels/@me",
        "x-discord-locale": "en-US",
        "x-discord-timezone": "UTC",
        "x-super-properties":
          "eyJvcyI6IkxpbnV4IiwiYnJvd3NlciI6IkNocm9tZSIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJlbi1VUyIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChYMTE7IExpbnV4IHg4Nl82NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyNC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTI0LjAuMC4wIiwib3NfdmVyc2lvbiI6IiIsInJlZmVycmVyIjoiIiwicmVmZXJyaW5nX2RvbWFpbiI6IiIsInJlZmVycmVyX2N1cnJlbnQiOiIiLCJyZWZlcnJpbmdfZG9tYWluX2N1cnJlbnQiOiIiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNDM3NzMsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGwsImRlc2lnbl9pZCI6MH0=",
      },
      signal: ac.signal,
    });
    clearTimeout(timeoutId);

    if (r.status === 401) return { ok: false, httpStatus: 401, reason: "Discord rejected the token (expired, regenerated, or invalid)" };
    if (r.status === 403) return { ok: false, httpStatus: 403, reason: "Account locked or token disabled" };
    if (r.status === 429) return { ok: false, httpStatus: 429, reason: "Rate-limited — wait a minute and try again" };
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, httpStatus: r.status, reason: `HTTP ${r.status}: ${body.slice(0, 80)}` };
    }

    const j = (await r.json()) as any;
    const user: DiscordUserMe = {
      id: String(j.id || ""),
      username: String(j.username || j.global_name || "unknown"),
      discriminator: j.discriminator && j.discriminator !== "0" ? String(j.discriminator) : null,
      avatarHash: j.avatar ? String(j.avatar) : null,
      email: j.email ? String(j.email) : null,
      verified: Boolean(j.verified),
      global_name: j.global_name ? String(j.global_name) : null,
    };
    if (!user.id) return { ok: false, reason: "Discord response missing user id" };
    console.log(`[token-login] verified token for ${user.username} (${user.id})`);
    return { ok: true, user };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const msg = err?.name === "AbortError" ? "verification timed out (12s)" : String(err?.message || err);
    return { ok: false, reason: msg };
  }
}
