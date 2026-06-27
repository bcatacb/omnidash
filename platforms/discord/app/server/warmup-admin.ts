// v0.74 — slim admin module (was warmup-admin). Keeps only what the Outreach
// page needs: captcha test lab + proxy rebalance. The warmup engine and
// state-machine routes were removed.

import type { Express, Request, Response } from "express";
import * as db from "./db";
import { query } from "./db";
import { invalidateProxyCache } from "./discord-http";

interface AcctRow {
  id: string;
  username: string;
  warmup_status: string;
}

async function listAccountsBasic(): Promise<AcctRow[]> {
  return await query<AcctRow>(
    `SELECT id, username, COALESCE(warmup_status, 'captured') AS warmup_status
       FROM tenant_main.discord_accounts ORDER BY id`,
  );
}

// Accounts + live guild counts from gateway state. Test-lab picker uses this
// so the operator can see which accounts have guilds to scrape from.
async function listAccountsWithGuilds(): Promise<Array<AcctRow & { guildCount: number }>> {
  const rows = await listAccountsBasic();
  const { getAccountGuilds } = await import("./discord-gateway");
  return rows.map((r) => ({ ...r, guildCount: getAccountGuilds(r.id).length }));
}

export function registerWarmupAdminRoutes(app: Express): void {
  // ───── Proxy rebalance (operator UI on /app/proxies) ──────────────────
  // POST /api/admin/proxies/rebalance — distribute accounts evenly.
  app.post("/api/admin/proxies/rebalance", async (req: Request, res: Response) => {
    const target = Math.max(1, Math.min(10, Number(req.body?.accountsPerProxy) || 2));
    const allProxies = await db.listProxies();
    if (allProxies.length === 0) {
      return res.status(400).json({ error: "no proxies configured" });
    }
    const allAccounts = await listAccountsBasic();
    const proxyMap = await db.getAccountProxyMap();
    // Keep all existing assignments — only distribute currently unassigned accounts.
    // Moving assigned accounts risks suspicious-activity flags from Discord.
    const finalAssignments = new Map<string, string>(proxyMap);
    const unassigned = allAccounts.filter((a) => !proxyMap.has(a.id)).map((a) => a.id);
    const pool = [...unassigned];
    // Fill each proxy's empty slots up to target.
    for (const p of allProxies) {
      const current = [...finalAssignments.values()].filter((pid) => pid === p.id).length;
      const slots = Math.max(0, target - current);
      for (let i = 0; i < slots && pool.length > 0; i++) {
        finalAssignments.set(pool.shift()!, p.id);
      }
    }
    // Distribute any remaining unassigned one-per-proxy.
    for (let i = 0; pool.length > 0; i++) {
      finalAssignments.set(pool.shift()!, allProxies[i % allProxies.length].id);
    }
    let changed = 0;
    let unchanged = 0;
    const removed = 0;
    for (const [accountId, newProxyId] of finalAssignments.entries()) {
      const prev = proxyMap.get(accountId);
      if (prev === newProxyId) unchanged += 1;
      else if (!prev) { await db.assignProxy(accountId, newProxyId); changed += 1; }
      // existing assignments to a different proxy are left untouched
    }
    const perProxy: Record<string, number> = {};
    for (const p of allProxies) perProxy[p.id] = 0;
    for (const [, pid] of finalAssignments.entries()) perProxy[pid] = (perProxy[pid] || 0) + 1;
    if (changed > 0) invalidateProxyCache(); // bulk rebalance changed assignments — flush entire cache
    res.json({ ok: true, target, changed, unchanged, removed, unassigned: allAccounts.length - finalAssignments.size, perProxy });
  });

  // ───── Captcha Test Lab — env-gated dev-only (v0.76) ──────────────────
  // The lab UI was removed when the warmup-as-campaign page took its place.
  // These endpoints remain for dev diagnostics. Default-off in production.
  if (process.env.ENABLE_CAPTCHA_LAB !== "1") return;
  console.log("[warmup-admin] captcha lab endpoints ENABLED (ENABLE_CAPTCHA_LAB=1)");

  app.get("/api/admin/warmup/test/accounts", async (_req: Request, res: Response) => {
    const accounts = await listAccountsWithGuilds();
    res.json({ accounts });
  });

  app.get("/api/admin/warmup/test/account/:id/guilds", async (req: Request, res: Response) => {
    const accountId = String(req.params.id);
    const all = await db.loadAllAccounts();
    const acct = all.find((a) => a.account.id === accountId);
    if (!acct || !acct.token) return res.status(404).json({ error: "account not found or no token" });
    const { getAccountGuilds } = await import("./discord-gateway");
    const cached = getAccountGuilds(accountId);
    if (cached.length > 0) return res.json({ ok: true, guilds: cached, source: "gateway-cache" });
    const { listGuilds } = await import("./discord-scrape");
    try {
      const guilds = await listGuilds(acct.token);
      res.json({ ok: true, guilds, source: "rest" });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: `gateway cache empty AND REST: ${err?.message || err}` });
    }
  });

  app.get("/api/admin/warmup/test/account/:id/guilds/:guildId/members", async (req: Request, res: Response) => {
    const accountId = String(req.params.id);
    const guildId = String(req.params.guildId);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const all = await db.loadAllAccounts();
    const acct = all.find((a) => a.account.id === accountId);
    if (!acct || !acct.token) return res.status(404).json({ error: "account not found or no token" });
    const { scrapeGuildMembersSmart } = await import("./discord-scrape");
    try {
      // scrapeGuildMembersSmart tries OP 8 first (fast, works on small guilds)
      // then falls back to OP 14 (lazy member list — what Discord's real
      // client uses for large guilds). For most Discord servers >50 members,
      // OP 8 returns empty and we MUST use OP 14.
      const result = await scrapeGuildMembersSmart(accountId, guildId, null, acct.token);
      const trimmed = (result.members || []).slice(0, limit).map((m: any) => ({
        discordUserId: String(m?.user?.id || m?.id || ""),
        username: String(m?.user?.username || m?.username || ""),
        displayName: String(m?.user?.global_name || m?.nick || m?.user?.username || ""),
      })).filter((m) => m.discordUserId);
      if (trimmed.length === 0) {
        return res.status(200).json({
          ok: false, members: [], totalScraped: 0, via: result.via,
          error: `no members via op8+op14 (chunks=${result.chunks}). Account may lack View Members permission, OR gateway WS isn't healthy for this account, OR the guild is empty/restricted.`,
        });
      }
      res.json({
        ok: true,
        members: trimmed,
        totalScraped: result.members?.length || 0,
        truncated: result.truncated,
        via: result.via,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // POST /api/admin/warmup/test/dm — full cold-DM probe:
  //   1. Open DM channel (captcha-aware, retries with CapSolver if walled)
  //   2. Send the actual message (captcha-aware, second captcha can fire here)
  //   3. Report exactly which step succeeded / failed
  //
  // Body: { accountId, recipientDiscordUserId, messageContent?, pageUrl? }
  app.post("/api/admin/warmup/test/dm", async (req: Request, res: Response) => {
    const accountId = String(req.body?.accountId || "");
    const recipientDiscordUserId = String(req.body?.recipientDiscordUserId || "").trim();
    const messageContent = String(req.body?.messageContent || "hi").slice(0, 1000);
    const overridePageUrl = String(req.body?.pageUrl || "https://discord.com/channels/@me");
    if (!accountId || !recipientDiscordUserId) {
      return res.status(400).json({ error: "accountId and recipientDiscordUserId required" });
    }
    const all = await db.loadAllAccounts();
    const acct = all.find((a) => a.account.id === accountId);
    if (!acct || !acct.token) return res.status(404).json({ error: "account not found or no token" });

    const { tlsFetch, discordHeaders } = await import("./discord-http");
    const { solveCaptchaForToken } = await import("./captcha");
    const start = Date.now();
    let totalCostCents = 0;
    let solversUsed: string[] = [];

    // ────────── STEP 1: open DM channel ──────────
    const channelStep = await captchaAwarePost(
      "https://discord.com/api/v9/users/@me/channels",
      { recipients: [recipientDiscordUserId] },
      acct.token, accountId, overridePageUrl, tlsFetch, discordHeaders, solveCaptchaForToken,
    );
    totalCostCents += channelStep.costCents;
    if (channelStep.solverUsed) solversUsed.push(`channel:${channelStep.solverUsed}`);
    if (!channelStep.ok) {
      return res.json({
        ok: false, joined: false, step: "channel",
        error: channelStep.error, durationMs: Date.now() - start,
        totalCostCents, solversUsed,
        retryHttpStatus: channelStep.httpStatus, sitekey: channelStep.sitekey,
        pageUrlSentToSolver: overridePageUrl,
        channelStep, messageStep: null,
      });
    }
    const channelId = channelStep.json?.id ? String(channelStep.json.id) : null;
    if (!channelId) {
      return res.json({
        ok: false, joined: false, step: "channel", error: "channel created but no id in response",
        durationMs: Date.now() - start, totalCostCents, solversUsed,
        channelStep, messageStep: null,
      });
    }

    // ────────── STEP 2: send the actual message ──────────
    const msgStep = await captchaAwarePost(
      `https://discord.com/api/v9/channels/${encodeURIComponent(channelId)}/messages`,
      { content: messageContent, nonce: String(Date.now()), flags: 0 },
      acct.token, accountId, overridePageUrl, tlsFetch, discordHeaders, solveCaptchaForToken,
    );
    totalCostCents += msgStep.costCents;
    if (msgStep.solverUsed) solversUsed.push(`message:${msgStep.solverUsed}`);

    res.json({
      ok: msgStep.ok,
      joined: msgStep.ok, // semantic name kept for frontend compat — means "test passed"
      step: msgStep.ok ? "complete" : "message",
      channelId,
      messageContent: messageContent.slice(0, 100),
      messageId: msgStep.json?.id || null,
      error: msgStep.ok ? undefined : `[message] solver=${msgStep.solverUsed || "—"} discord=${msgStep.httpStatus}: ${msgStep.error}`,
      durationMs: Date.now() - start,
      totalCostCents,
      solversUsed,
      solverUsed: msgStep.solverUsed || channelStep.solverUsed,
      retryHttpStatus: msgStep.httpStatus,
      sitekey: msgStep.sitekey || channelStep.sitekey,
      pageUrlSentToSolver: overridePageUrl,
      channelStep, messageStep: msgStep,
    });
  });
}

// Helper: do a Discord POST that may need a captcha. If the response includes
// captcha_sitekey, route through the solver and retry. Returns the final
// outcome + the FULL raw response body so the lab UI can show exactly what
// Discord said.
export interface CaptchaAwareStepResult {
  ok: boolean;
  httpStatus: number;
  rawBody: string;        // full Discord response body (untruncated)
  json?: any;             // parsed JSON if Discord returned JSON
  captchaTriggered: boolean;
  error?: string;
  solverUsed?: string;
  costCents: number;
  sitekey?: string;
  retryRawBody?: string;  // body of the second (post-solve) Discord call
  retryHttpStatus?: number;
}

async function captchaAwarePost(
  url: string,
  body: any,
  token: string,
  accountId: string,
  pageUrlForSolver: string,
  tlsFetch: any, discordHeaders: any, solveCaptchaForToken: any,
): Promise<CaptchaAwareStepResult> {
  const first = await tlsFetch(url, {
    method: "POST",
    headers: await discordHeaders(token, true, undefined, accountId),
    body: JSON.stringify(body),
    timeoutMs: 15_000,
    accountId,
  });
  const firstText = await first.text();
  let firstJson: any = null;
  try { firstJson = JSON.parse(firstText); } catch { /* not JSON */ }
  if (first.ok) {
    return { ok: true, httpStatus: first.status, rawBody: firstText, json: firstJson, captchaTriggered: false, costCents: 0 };
  }
  if (!firstJson?.captcha_sitekey) {
    return {
      ok: false, httpStatus: first.status, rawBody: firstText, json: firstJson,
      captchaTriggered: false,
      error: firstJson?.message || firstText.slice(0, 200),
      costCents: 0,
    };
  }
  const sitekey = String(firstJson.captcha_sitekey);
  const rqdata = String(firstJson.captcha_rqdata || "");
  const rqtoken = String(firstJson.captcha_rqtoken || "");
  const cs = await solveCaptchaForToken({ sitekey, pageUrl: pageUrlForSolver, rqdata, rqtoken, accountId });
  if (!cs.ok || !cs.token) {
    return {
      ok: false, httpStatus: first.status, rawBody: firstText, json: firstJson,
      captchaTriggered: true,
      error: `solver=${cs.solverUsed || "—"}: ${cs.error}`,
      solverUsed: cs.solverUsed, costCents: cs.costCents || 0, sitekey,
    };
  }
  const retry = await tlsFetch(url, {
    method: "POST",
    headers: await discordHeaders(token, true),
    body: JSON.stringify({ ...body, captcha_key: cs.token, captcha_rqtoken: rqtoken || undefined }),
    timeoutMs: 15_000,
    accountId,
  });
  const retryText = await retry.text();
  let retryJson: any = null;
  try { retryJson = JSON.parse(retryText); } catch { /* */ }
  if (retry.ok) {
    return {
      ok: true, httpStatus: retry.status, rawBody: firstText, json: retryJson,
      captchaTriggered: true,
      solverUsed: cs.solverUsed, costCents: cs.costCents || 0, sitekey,
      retryRawBody: retryText, retryHttpStatus: retry.status,
    };
  }
  return {
    ok: false, httpStatus: retry.status, rawBody: firstText, json: retryJson,
    captchaTriggered: true,
    error: retryJson?.message || retryText.slice(0, 200),
    solverUsed: cs.solverUsed, costCents: cs.costCents || 0, sitekey,
    retryRawBody: retryText, retryHttpStatus: retry.status,
  };
}
