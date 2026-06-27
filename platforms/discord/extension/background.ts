// MV3 module worker — explicit `export {}` keeps TS treating this as a module
// (avoids global-scope collisions with options.ts / popup.ts during type-check).
export {};

/**
 * GG Account Switcher — background service worker.
 *
 * Stateless except for an in-memory token cache. On "activate" message from
 * gg.linktree.bond:
 *   1. Fetch the group's token bundle from gg (using the gg session cookie).
 *   2. Find the requested accountId in the bundle.
 *   3. Pick the operator's discord.com tab (create one if none exists).
 *   4. Use chrome.scripting.executeScript to write localStorage.token + reload.
 *
 * No tokens written to chrome.storage.local. Browser close evicts everything.
 */

interface TokenEntry {
  accountId: string;
  username: string;
  label: string;
  token: string;
  // If present, route discord.com traffic for this account through this proxy.
  // Format: http://user:pass@host:port (basic-auth in URL). We parse the auth
  // out and feed it back via webRequest.onAuthRequired (chrome.proxy.settings
  // doesn't accept inline auth in fixed_servers mode).
  proxyUrl?: string;
  // v0.68 — pending lead Discord user IDs this account still needs to wave.
  // Sent by gg's token-bundle endpoint. The extension batches DM-create for
  // all of these on first Open-in-Discord click.
  pendingRecipientIds?: string[];
}
interface TokenBundle {
  groupId: string;
  groupName: string;
  fetchedAt: string;
  entries: TokenEntry[];
}

// In-memory cache keyed by groupId. Each entry is short-lived; we evict after
// 5 minutes so a token paste-then-revoke flow doesn't leave stale tokens.
const cache = new Map<string, { bundle: TokenBundle; cachedAtMs: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const GG_ORIGIN_KEY = "gg-origin";
const GG_ORIGIN_DEFAULT = "https://80-208-224-130.sslip.io";

async function getGgOrigin(): Promise<string> {
  const stored = await chrome.storage.local.get(GG_ORIGIN_KEY);
  return stored[GG_ORIGIN_KEY] || GG_ORIGIN_DEFAULT;
}

async function fetchBundle(groupId: string, originOverride?: string, sessionToken?: string): Promise<TokenBundle> {
  const now = Date.now();
  const cached = cache.get(groupId);
  if (cached && now - cached.cachedAtMs < CACHE_TTL_MS) return cached.bundle;

  const origin = originOverride || await getGgOrigin();
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (sessionToken) headers["x-session-token"] = sessionToken;
  const path = `/api/groups/${encodeURIComponent(groupId)}/token-bundle`;

  // Extension service workers are not subject to mixed-content rules, so they
  // can fetch HTTP even from an HTTPS context. For IP-address servers with
  // self-signed certs (ERR_CERT_AUTHORITY_INVALID), fall back to HTTP so the
  // operator doesn't need to manually trust the cert in their OS store.
  const isIpOrigin = /^https?:\/\/[\d.]+/.test(origin);
  const urls = isIpOrigin
    ? [origin + path, origin.replace(/^https/, "http") + path]
    : [origin + path];

  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { credentials: "include", cache: "no-store", headers });
      if (!r.ok) throw new Error(`HTTP ${r.status} — are you logged into gg?`);
      const bundle = (await r.json()) as TokenBundle;
      cache.set(groupId, { bundle, cachedAtMs: now });
      return bundle;
    } catch (e: any) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error(`fetch ${groupId} token bundle failed`);
}

async function findOrCreateDiscordTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ url: "https://discord.com/*" });
  if (tabs.length > 0) return tabs[0];
  return await chrome.tabs.create({ url: "https://discord.com/channels/@me", active: true });
}

async function writeTokenAndReload(tabId: number, token: string, navigateChannelId?: string): Promise<void> {
  // v0.63 — aggressive token swap:
  //   1. Iframe-based localStorage write. Discord's bundle wipes window.localStorage
  //      shortly after boot ("anti token extraction"). A fresh, never-booted iframe
  //      has an intact localStorage object that writes to the same origin storage.
  //   2. Wipe IndexedDB (Discord caches the active-user identity there — when the
  //      token swaps but IDB still has the old user, Discord shows a re-auth /
  //      continue-in-browser interstitial that halts boot until dismissed; that's
  //      what was causing the "two clicks" symptom).
  //   3. Pre-set known marketing/onboarding flags so the "Open in app?" overlay
  //      doesn't reappear after the reload.
  //   4. Run in MAIN world so we can use page-native indexedDB / caches APIs
  //      against discord.com's origin.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (t: string) => {
      const log = (...a: any[]) => console.log("[gg-ext]", ...a);
      // 1. Iframe token write (bypasses Discord's localStorage wipe).
      try {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        document.body.appendChild(iframe);
        const ls = iframe.contentWindow?.localStorage;
        if (ls) {
          ls.setItem("token", JSON.stringify(t));
          // Skip Discord's "Open in app?" / install-prompt overlays so we don't
          // get the interstitial that blocks the React boot on first reload.
          ls.setItem("hideAppInstallNotice", "true");
          ls.setItem("DESKTOP_APP_NUDGE_SEEN", "true");
          ls.setItem("APP_NUDGE_LAST_DISMISSED", String(Date.now()));
          log("token written via iframe");
        } else {
          throw new Error("iframe has no localStorage");
        }
        iframe.remove();
      } catch (e) {
        console.warn("[gg-ext] iframe write failed, falling back to direct:", e);
        try {
          localStorage.setItem("token", JSON.stringify(t));
          localStorage.setItem("hideAppInstallNotice", "true");
        } catch {}
      }
      // 2. Wipe IndexedDB so the previous account's cached identity doesn't
      //    trigger a "session mismatch" re-auth interstitial.
      try {
        if (typeof (indexedDB as any).databases === "function") {
          const dbs = await (indexedDB as any).databases();
          for (const db of dbs) {
            if (db?.name) {
              try { indexedDB.deleteDatabase(db.name); } catch {}
            }
          }
          log(`cleared ${dbs.length} indexedDB databases`);
        }
      } catch (e) {
        console.warn("[gg-ext] indexedDB clear failed:", e);
      }
      // 3. Drop any service-worker caches that might pin the old user.
      try {
        if (typeof caches !== "undefined") {
          const keys = await caches.keys();
          for (const k of keys) await caches.delete(k);
          log(`cleared ${keys.length} cache stores`);
        }
      } catch (e) {
        console.warn("[gg-ext] caches clear failed:", e);
      }
    },
    args: [token],
  });
  if (navigateChannelId && /^\d+$/.test(navigateChannelId)) {
    await reloadThenSpaNavigate(tabId, navigateChannelId);
  } else {
    await chrome.tabs.reload(tabId);
  }
}

// v0.64 — boot Discord at BARE /channels/@me, then SPA-route to the channel.
//
// Why: Discord's "Discord App Detected" prompt (the literal overlay the user
// hit) fires specifically when a deep-link URL like /channels/@me/<id> is
// loaded top-level. /channels/@me (no channel id, the DM hub) does NOT trigger
// it. So we:
//   1. Move the tab to /channels/@me (full top-level nav → boots fresh React
//      under the new localStorage token, NO prompt).
//   2. If the tab is already at /channels/@me, use chrome.tabs.reload instead
//      (chrome.tabs.update to the same URL is a no-op).
//   3. Once the React app has mounted, use history.pushState to SPA-route
//      to /channels/@me/<id>. This happens INSIDE the booted React app —
//      Discord's Router treats it as in-page routing, never shows the prompt.
const HUB_URL = "https://discord.com/channels/@me";

async function reloadThenSpaNavigate(tabId: number, channelId: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const currentUrl = (tab.url || "").split("#")[0].replace(/\/$/, "");
  const atHub = currentUrl === HUB_URL;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      // status:'complete' fires at the load event, but Discord's React app
      // mounts a few hundred ms later. 1500ms is comfortable on a proxied
      // connection. Without it, pushState fires before React Router subscribes.
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (id: string) => {
            try {
              history.pushState({}, "", `/channels/@me/${id}`);
              window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
            } catch (e) { console.error("[gg-ext] pushState failed", e); }
          },
          args: [channelId],
        });
      } catch (e) {
        console.warn("[bg] pushState injection failed:", e);
      }
      resolve();
    };
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") void finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timeout = setTimeout(() => void finish(), 12_000);
    if (atHub) {
      void chrome.tabs.reload(tabId);
    } else {
      void chrome.tabs.update(tabId, { url: HUB_URL, active: true });
    }
  });
}

// Holds the basic-auth creds for the currently-active proxy. webRequest's
// onAuthRequired listener reads this on 407 challenges to inject the right
// Webshare username/password. Switching accounts updates this.
let currentProxyAuth: { username: string; password: string } | null = null;

const SESSION_PROXY_KEY = "active-proxy-url";

// On Chrome start or extension install/update: wipe the session proxy so the
// next startup begins clean.
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.remove(SESSION_PROXY_KEY);
  await chrome.proxy.settings.clear({ scope: "regular" });
  currentProxyAuth = null;
  disableProxyAuthListener();
  console.log("[bg] proxy cleared on Chrome startup");
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.remove(SESSION_PROXY_KEY);
  await chrome.proxy.settings.clear({ scope: "regular" });
  currentProxyAuth = null;
  disableProxyAuthListener();
  console.log("[bg] proxy cleared on install/update");
});

// On every service worker restart within a session: restore proxy + credentials
// from session storage. Chrome persists the proxy host across SW restarts but
// currentProxyAuth (in-memory) is reset — without this, every CONNECT fails
// because the proxy gets a 407 with no credentials to answer it.
// onInstalled/onStartup clear the session key first, so fresh sessions start clean.
(async () => {
  const s = await chrome.storage.session.get(SESSION_PROXY_KEY);
  const url = s[SESSION_PROXY_KEY] as string | undefined;
  if (url) {
    await setActiveProxy(url);
    console.log("[bg] proxy restored from session:", url);
  } else {
    await chrome.proxy.settings.clear({ scope: "regular" });
    console.log("[bg] no active proxy in session — cleared");
  }
})();

// Parse "http://user:pass@host:port" into { server, username, password }.
function parseProxyUrl(url: string): { scheme: "http" | "https"; host: string; port: number; username: string; password: string } | null {
  try {
    const u = new URL(url);
    const scheme = u.protocol === "https:" ? "https" : "http";
    const port = Number(u.port) || (scheme === "https" ? 443 : 80);
    return {
      scheme,
      host: u.hostname,
      port,
      username: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
    };
  } catch { return null; }
}

// Configure chrome.proxy.settings to route ALL outbound HTTP through the
// given proxy, EXCEPT gg.linktree.bond + localhost (so our own fetch flow
// stays direct). Without the bypassList, the extension's own token-bundle
// fetch would also tunnel through Webshare — slower and unnecessary.
async function setActiveProxy(proxyUrl: string | undefined): Promise<void> {
  if (!proxyUrl) {
    currentProxyAuth = null;
    disableProxyAuthListener();
    await chrome.storage.session.remove(SESSION_PROXY_KEY);
    await chrome.proxy.settings.clear({ scope: "regular" });
    console.log("[bg] proxy cleared — system network restored");
    return;
  }
  const parsed = parseProxyUrl(proxyUrl);
  if (!parsed) {
    console.warn("[bg] unparseable proxy url, leaving previous proxy in place");
    return;
  }
  currentProxyAuth = { username: parsed.username, password: parsed.password };
  enableProxyAuthListener();
  await chrome.storage.session.set({ [SESSION_PROXY_KEY]: proxyUrl });
  await chrome.proxy.settings.set({
    scope: "regular",
    value: {
      mode: "fixed_servers",
      rules: {
        singleProxy: { scheme: parsed.scheme, host: parsed.host, port: parsed.port },
        // bypassList values are space- or comma-separated host patterns. <local>
        // is the magic value for any plain hostname (localhost, gg-api, etc).
        bypassList: ["<local>", "80-208-224-130.sslip.io"],
      },
    },
  });
  console.log(`[bg] proxy set to ${parsed.scheme}://${parsed.host}:${parsed.port} (bypass gg.linktree.bond + <local>)`);
}

// onAuthRequired listener is registered/unregistered dynamically so it
// only intercepts traffic when a Webshare proxy is actually active.
// Keeping it registered globally (even with a pass-through return) blocks
// the phone hotspot's transparent proxy CONNECT tunnel → ERR_TUNNEL_CONNECTION_FAILED.
function handleProxyAuth(details: chrome.webRequest.WebAuthChallengeDetails): chrome.webRequest.BlockingResponse {
  if (!details.isProxy || !currentProxyAuth) return {};
  return { authCredentials: currentProxyAuth };
}
let proxyAuthListenerActive = false;

function enableProxyAuthListener() {
  if (proxyAuthListenerActive) return;
  chrome.webRequest.onAuthRequired.addListener(handleProxyAuth, { urls: ["<all_urls>"] }, ["blocking"]);
  proxyAuthListenerActive = true;
}

function disableProxyAuthListener() {
  if (!proxyAuthListenerActive) return;
  chrome.webRequest.onAuthRequired.removeListener(handleProxyAuth);
  proxyAuthListenerActive = false;
}

interface ActivateMessage { type: "activate"; groupId: string; accountId: string; navigateChannelId?: string; sessionToken?: string }
interface PrepareAndOpenMessage { type: "prepare-and-open"; groupId: string; accountId: string; recipientDiscordUserId: string }
interface PingMessage { type: "ping" }
type IncomingMessage = ActivateMessage | PrepareAndOpenMessage | PingMessage;

// v0.67 — open DM channel(s) by calling Discord's REST API from INSIDE the
// booted discord.com tab. Two big wins:
//   1. The request egresses from the operator's IP, not our backend proxy.
//      Same IP that captured the account ⇒ no fingerprint-mismatch 4004s.
//   2. The token comes from a fresh iframe localStorage so Discord's main-world
//      "delete window.localStorage" doesn't bite us.
//
// v0.68 — batch mode. `recipients` is now an array; we POST each in sequence
// with ~700ms spacing (Discord rate-limits DM creation at ~10/min — slow
// enough to be safe for a typical 5–10 lead batch). Returns the channelId for
// the FIRST recipient (the one the operator clicked); other channels are
// imported via the gateway's CHANNEL_CREATE handler so the Unibox refreshes
// its pending_ rows automatically.
async function openDmsInDiscordTab(tabId: number, recipients: string[]): Promise<{ primaryChannelId?: string; opened: number; failed: number; error?: string }> {
  if (!recipients.length) return { opened: 0, failed: 0 };
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (recipientList: string[]) => {
      let token: string | null = null;
      try {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        document.body.appendChild(iframe);
        const ls = iframe.contentWindow?.localStorage;
        const raw = ls?.getItem("token");
        iframe.remove();
        if (!raw) return { error: "no token in localStorage" };
        token = raw.startsWith('"') ? JSON.parse(raw) : raw;
      } catch (e: any) {
        return { error: "token read failed: " + (e?.message || String(e)) };
      }
      let primaryChannelId: string | undefined;
      let opened = 0;
      let failed = 0;
      for (let i = 0; i < recipientList.length; i++) {
        const recipient = recipientList[i];
        try {
          const r = await fetch("https://discord.com/api/v9/users/@me/channels", {
            method: "POST",
            headers: {
              authorization: token!,
              "content-type": "application/json",
            },
            body: JSON.stringify({ recipients: [recipient] }),
          });
          if (!r.ok) {
            failed += 1;
            console.warn(`[gg-ext] DM-open failed recipient=${recipient} HTTP ${r.status}`);
          } else {
            const j = await r.json().catch(() => ({}));
            const channelId = String(j?.id || "");
            if (i === 0) primaryChannelId = channelId;
            opened += 1;
          }
        } catch (e: any) {
          failed += 1;
          console.warn(`[gg-ext] DM-open threw recipient=${recipient}`, e);
        }
        // 700ms spacing: Discord's user-token DM-create rate limit is ~10/min.
        // 700ms ⇒ ~85/min capacity headroom while still well under the limit.
        if (i < recipientList.length - 1) {
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      return { primaryChannelId, opened, failed };
    },
    args: [recipients],
  });
  return (results[0]?.result || { opened: 0, failed: 0 }) as any;
}

// Messages from the content-script bridge (page-bridge.ts), which forwards
// postMessage calls from the web page. Chrome 120+ removed
// chrome.runtime.sendMessage from the web page context, so the bridge is
// necessary for modern Chrome versions.
chrome.runtime.onMessage.addListener((msg: IncomingMessage | { type: "reset-proxy" }, sender, sendResponse) => {
  if ((msg as any).type === "reset-proxy") {
    currentProxyAuth = null;
    disableProxyAuthListener();
    chrome.proxy.settings.clear({ scope: "regular" });
    sendResponse({ ok: true });
    return true;
  }
  // Use the content script's page origin (http://localhost:5173 or
  // https://gg.linktree.bond) instead of the hardcoded storage default,
  // so local dev works without configuring extension options.
  const apiOrigin = sender.origin || undefined;
  (async () => {
    try {
      if (msg.type === "activate") {
        const bundle = await fetchBundle(msg.groupId, apiOrigin, msg.sessionToken);
        const entry = bundle.entries.find((e) => e.accountId === msg.accountId);
        if (!entry) { sendResponse({ ok: false, error: "account not in group bundle" }); return; }
        const tab = await findOrCreateDiscordTab();
        if (!tab.id) { sendResponse({ ok: false, error: "no discord tab id" }); return; }
        await setActiveProxy(entry.proxyUrl);
        await writeTokenAndReload(tab.id, entry.token, msg.navigateChannelId);
        sendResponse({ ok: true, accountId: msg.accountId, username: entry.username, proxy: entry.proxyUrl ? "set" : "direct", navigated: !!msg.navigateChannelId });
        return;
      }
      if (msg.type === "prepare-and-open") {
        const bundle = await fetchBundle(msg.groupId, apiOrigin, msg.sessionToken);
        const entry = bundle.entries.find((e) => e.accountId === msg.accountId);
        if (!entry) { sendResponse({ ok: false, error: "account not in group bundle" }); return; }
        const tab = await findOrCreateDiscordTab();
        if (!tab.id) { sendResponse({ ok: false, error: "no discord tab id" }); return; }
        await setActiveProxy(entry.proxyUrl);
        await writeTokenAndReload(tab.id, entry.token);
        await new Promise((r) => setTimeout(r, 1800));
        const pendingFromBundle = Array.isArray(entry.pendingRecipientIds) ? entry.pendingRecipientIds.slice() : [];
        const dedup = new Set<string>();
        const ordered: string[] = [];
        for (const r of [msg.recipientDiscordUserId, ...pendingFromBundle]) {
          if (!r || dedup.has(r)) continue;
          dedup.add(r);
          ordered.push(r);
        }
        const batch = await openDmsInDiscordTab(tab.id, ordered);
        if (!batch.primaryChannelId) {
          console.warn(`[bg] prepare-and-open batch failed: ${batch.error || "no primary channel"}`);
          sendResponse({ ok: false, error: batch.error || "DM batch open failed" });
          return;
        }
        console.log(`[bg] prepare-and-open batch ok acct=${msg.accountId} opened=${batch.opened} failed=${batch.failed} primary=${batch.primaryChannelId}`);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (id: string) => {
              try {
                history.pushState({}, "", `/channels/@me/${id}`);
                window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
              } catch (e) { console.error("[gg-ext] pushState failed", e); }
            },
            args: [batch.primaryChannelId],
          });
        } catch (e) {
          console.warn("[bg] post-open pushState failed:", e);
        }
        sendResponse({ ok: true, channelId: batch.primaryChannelId, opened: batch.opened, failed: batch.failed, accountId: msg.accountId, username: entry.username });
        return;
      }
      sendResponse({ ok: false, error: "unknown message type" });
    } catch (err: any) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});


// Messages from gg.linktree.bond (externally_connectable). We deliberately
// do NOT accept any other senders — the externally_connectable manifest
// entry restricts which origins can call sendMessage.
chrome.runtime.onMessageExternal.addListener((msg: IncomingMessage, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "ping") {
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
        return;
      }
      if (msg.type === "activate") {
        const bundle = await fetchBundle(msg.groupId, _sender.origin, msg.sessionToken);
        const entry = bundle.entries.find((e) => e.accountId === msg.accountId);
        if (!entry) { sendResponse({ ok: false, error: "account not in group bundle" }); return; }
        const tab = await findOrCreateDiscordTab();
        if (!tab.id) { sendResponse({ ok: false, error: "no discord tab id" }); return; }
        await setActiveProxy(entry.proxyUrl);
        await writeTokenAndReload(tab.id, entry.token, msg.navigateChannelId);
        sendResponse({ ok: true, accountId: msg.accountId, username: entry.username, proxy: entry.proxyUrl ? "set" : "direct", navigated: !!msg.navigateChannelId });
        return;
      }
      if (msg.type === "prepare-and-open") {
        const bundle = await fetchBundle(msg.groupId, _sender.origin, msg.sessionToken);
        const entry = bundle.entries.find((e) => e.accountId === msg.accountId);
        if (!entry) { sendResponse({ ok: false, error: "account not in group bundle" }); return; }
        const tab = await findOrCreateDiscordTab();
        if (!tab.id) { sendResponse({ ok: false, error: "no discord tab id" }); return; }
        await setActiveProxy(entry.proxyUrl);
        await writeTokenAndReload(tab.id, entry.token);
        // Give Discord's React app time to mount + iframe localStorage read.
        await new Promise((r) => setTimeout(r, 1800));
        // Recipient order matters: put the clicked one FIRST so its channelId
        // is reported back as the primary (used for the SPA-route below).
        const pendingFromBundle = Array.isArray(entry.pendingRecipientIds) ? entry.pendingRecipientIds.slice() : [];
        const dedup = new Set<string>();
        const ordered: string[] = [];
        for (const r of [msg.recipientDiscordUserId, ...pendingFromBundle]) {
          if (!r || dedup.has(r)) continue;
          dedup.add(r);
          ordered.push(r);
        }
        const batch = await openDmsInDiscordTab(tab.id, ordered);
        if (!batch.primaryChannelId) {
          console.warn(`[bg] prepare-and-open batch failed: ${batch.error || "no primary channel"}`);
          sendResponse({ ok: false, error: batch.error || "DM batch open failed" });
          return;
        }
        console.log(`[bg] prepare-and-open batch ok acct=${msg.accountId} opened=${batch.opened} failed=${batch.failed} primary=${batch.primaryChannelId}`);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (id: string) => {
              try {
                history.pushState({}, "", `/channels/@me/${id}`);
                window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
              } catch (e) { console.error("[gg-ext] pushState failed", e); }
            },
            args: [batch.primaryChannelId],
          });
        } catch (e) {
          console.warn("[bg] post-open pushState failed:", e);
        }
        sendResponse({
          ok: true,
          channelId: batch.primaryChannelId,
          opened: batch.opened,
          failed: batch.failed,
          accountId: msg.accountId,
          username: entry.username,
        });
        return;
      }
      sendResponse({ ok: false, error: "unknown message type" });
    } catch (err: any) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true; // async sendResponse
});
