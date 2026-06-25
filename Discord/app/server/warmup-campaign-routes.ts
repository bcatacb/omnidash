import type { Express, Request, Response } from "express";
import * as db from "./db";
import { getAccountGuilds } from "./discord-gateway";

function newId(): string { return "wc_" + Math.random().toString(36).slice(2, 10); }
function badRequest(res: Response, msg: string) { return res.status(400).json({ error: msg }); }
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

export function registerWarmupCampaignRoutes(app: Express): void {
  app.get("/api/warmup-campaigns", async (_req: Request, res: Response) => {
    res.json({ campaigns: await db.listWarmupCampaigns() });
  });

  app.get("/api/warmup-campaigns/:id", async (req: Request, res: Response) => {
    const c = await db.getWarmupCampaign(String(req.params.id));
    if (!c) return res.status(404).json({ error: "not found" });
    const [accounts, pairs] = await Promise.all([
      db.listWarmupCampaignAccounts(c.id),
      db.listWarmupCampaignPairs(c.id),
    ]);
    res.json({ campaign: c, accounts, pairs });
  });

  app.post("/api/warmup-campaigns", async (req: Request, res: Response) => {
    const b = req.body || {};
    if (!b.name) return badRequest(res, "name required");
    const id = newId();
    await db.createWarmupCampaign({
      id,
      name: String(b.name).slice(0, 200),
      status: "draft",
      active_hours_start_utc: clamp(Number(b.active_hours_start_utc ?? 9), 0, 23),
      active_hours_end_utc:   clamp(Number(b.active_hours_end_utc   ?? 21), 0, 23),
      per_account_interval_min_minutes: clamp(Number(b.per_account_interval_min_minutes ?? 15), 1, 1440),
      per_account_interval_max_minutes: clamp(Number(b.per_account_interval_max_minutes ?? 30), 1, 1440),
      between_account_interval_minutes: clamp(Number(b.between_account_interval_minutes ?? 10), 1, 1440),
      daily_send_cap: clamp(Number(b.daily_send_cap ?? 15), 1, 500),
      guild_id: b.guild_id ? String(b.guild_id).trim() : null,
    });
    res.json({ ok: true, id });
  });

  // Bulk setup — replaces the N-separate-requests pattern. Accepts all accounts
  // and pairs in one payload and processes them in parallel server-side.
  app.post("/api/warmup-campaigns/:id/setup", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const b = req.body || {};
    const accounts: { accountId: string; messageBank: string[] }[] = Array.isArray(b.accounts) ? b.accounts : [];
    const pairs: { acctA: string; acctB: string }[] = Array.isArray(b.pairs) ? b.pairs : [];
    const proxyMap = await db.getAccountProxyMap();
    const skippedPairs: string[] = [];
    // Accounts are few — process in parallel.
    await Promise.all(accounts.map((a) =>
      db.upsertWarmupCampaignAccount(id, String(a.accountId), (a.messageBank || []).map(String)),
    ));
    // Pairs can number in the thousands for large campaigns. Batch in groups of
    // 25 to avoid saturating the DB connection pool with concurrent upserts.
    const BATCH = 25;
    for (let i = 0; i < pairs.length; i += BATCH) {
      await Promise.all(pairs.slice(i, i + BATCH).map(async (p) => {
        if (String(p.acctA) === String(p.acctB)) { skippedPairs.push(`${p.acctA}↔${p.acctB}`); return; }
        const pa = proxyMap.get(String(p.acctA)) || null;
        const pb = proxyMap.get(String(p.acctB)) || null;
        if (pa && pb && pa === pb) { skippedPairs.push(`${p.acctA}↔${p.acctB}`); return; }
        await db.upsertWarmupCampaignPair(id, String(p.acctA), String(p.acctB));
      }));
    }
    res.json({ ok: true, skippedPairs });
  });

  app.post("/api/warmup-campaigns/:id/accounts", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const b = req.body || {};
    if (!b.accountId || !Array.isArray(b.messageBank)) return badRequest(res, "accountId, messageBank[] required");
    await db.upsertWarmupCampaignAccount(id, String(b.accountId), b.messageBank.map(String));
    res.json({ ok: true });
  });

  // Accounts eligible to be added to a campaign: connected, not already enrolled,
  // and — if the campaign has a guild_id — confirmed members of that server.
  app.get("/api/warmup-campaigns/:id/eligible-accounts", async (req: Request, res: Response) => {
    const campaign = await db.getWarmupCampaign(String(req.params.id));
    if (!campaign) return res.status(404).json({ error: "not found" });
    const [enrolled, allAccts] = await Promise.all([
      db.listWarmupCampaignAccounts(campaign.id),
      db.loadAllAccounts(),
    ]);
    const enrolledIds = new Set(enrolled.map((a) => a.account_id));
    const eligible = allAccts
      .filter((a) => a.account.status === "connected" && !enrolledIds.has(a.account.id))
      .filter((a) => {
        if (!campaign.guild_id) return true;
        const guilds = getAccountGuilds(a.account.id);
        if (guilds.length === 0) return true; // gateway not READY yet — don't block
        return guilds.some((g) => g.id === campaign.guild_id);
      })
      .map((a) => ({ id: a.account.id, username: a.account.username || a.account.id, label: a.account.label || "" }));
    res.json({ accounts: eligible, guildId: campaign.guild_id });
  });

  // Hot-add: add a new account to a running campaign and auto-pair with all
  // current active accounts (respecting proxy constraints).
  app.post("/api/warmup-campaigns/:id/accounts/add", async (req: Request, res: Response) => {
    const campaignId = String(req.params.id);
    const b = req.body || {};
    if (!b.accountId || !Array.isArray(b.messageBank)) return badRequest(res, "accountId, messageBank[] required");
    const newId = String(b.accountId);

    // Guild membership guard — if the campaign is locked to a server, the account
    // must be a confirmed member before it can be enrolled. Prevents accounts that
    // are not in the server from being added (they would hit captcha on every send).
    const campaign = await db.getWarmupCampaign(campaignId);
    if (campaign?.guild_id) {
      const guilds = getAccountGuilds(newId);
      if (guilds.length > 0 && !guilds.some((g) => g.id === campaign.guild_id)) {
        return badRequest(res, `Account is not in this campaign's Discord server — add the account to the server first.`);
      }
    }

    await db.upsertWarmupCampaignAccount(campaignId, newId, b.messageBank.map(String));

    // Auto-pair with every existing active (non-dead) account in the campaign.
    const [existing, proxyMap] = await Promise.all([
      db.listWarmupCampaignAccounts(campaignId),
      db.getAccountProxyMap(),
    ]);
    const newProxy = proxyMap.get(newId) || null;
    const pairsCreated: string[] = [];
    const skipped: string[] = [];
    for (const acct of existing) {
      if (acct.account_id === newId || acct.dead_since) continue;
      const existingProxy = proxyMap.get(acct.account_id) || null;
      if (newProxy && existingProxy && newProxy === existingProxy) {
        skipped.push(acct.account_id);
        continue;
      }
      await db.upsertWarmupCampaignPair(campaignId, newId, acct.account_id);
      pairsCreated.push(acct.account_id);
    }
    res.json({ ok: true, pairsCreated: pairsCreated.length, skippedSameProxy: skipped.length });
  });

  // Hot-remove: pull an account from a running campaign without stopping it.
  app.delete("/api/warmup-campaigns/:id/accounts/:accountId", async (req: Request, res: Response) => {
    await db.removeAccountFromWarmupCampaign(
      String(req.params.id),
      String(req.params.accountId),
    );
    res.json({ ok: true });
  });

  // Auto-pair all enrolled accounts with each other (cross-proxy only).
  // Safe to call on a running campaign — upserts are idempotent, existing pairs
  // are left untouched. Fixes campaigns where accounts were enrolled without pairs.
  app.post("/api/warmup-campaigns/:id/pair-all", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [accounts, proxyMap] = await Promise.all([
      db.listWarmupCampaignAccounts(id),
      db.getAccountProxyMap(),
    ]);
    const active = accounts.filter((a) => !a.dead_since);
    let created = 0;
    let skipped = 0;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]!;
        const b = active[j]!;
        const pa = proxyMap.get(a.account_id) || null;
        const pb = proxyMap.get(b.account_id) || null;
        if (pa && pb && pa === pb) { skipped++; continue; }
        await db.upsertWarmupCampaignPair(id, a.account_id, b.account_id);
        created++;
      }
    }
    res.json({ ok: true, created, skippedSameProxy: skipped, totalAccounts: active.length });
  });

  app.post("/api/warmup-campaigns/:id/pairs", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const b = req.body || {};
    if (!b.acctA || !b.acctB || b.acctA === b.acctB) return badRequest(res, "acctA, acctB required and distinct");
    const proxyMap = await db.getAccountProxyMap();
    const pa = proxyMap.get(String(b.acctA)) || null;
    const pb = proxyMap.get(String(b.acctB)) || null;
    if (pa && pb && pa === pb) return badRequest(res, `same proxy ${pa} — pair refused`);
    await db.upsertWarmupCampaignPair(id, String(b.acctA), String(b.acctB));
    res.json({ ok: true });
  });

  // Update mutable settings on an existing campaign (guild_id, name, intervals).
  app.patch("/api/warmup-campaigns/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const b = req.body || {};
    if ("guild_id" in b) {
      await db.setWarmupCampaignGuildId(id, b.guild_id ? String(b.guild_id).trim() : null);
    }
    res.json({ ok: true });
  });

  // Returns guilds that appear across all enrolled accounts for this campaign.
  // Only uses in-memory gateway guild cache — no Discord REST call needed.
  app.get("/api/warmup-campaigns/:id/mutual-guilds", async (req: Request, res: Response) => {
    const campaign = await db.getWarmupCampaign(String(req.params.id));
    if (!campaign) return res.status(404).json({ error: "not found" });
    const accounts = await db.listWarmupCampaignAccounts(campaign.id);
    const guildCountMap = new Map<string, { name: string; count: number }>();
    const total = accounts.length;
    for (const acct of accounts) {
      const guilds = getAccountGuilds(acct.account_id);
      for (const g of guilds) {
        const entry = guildCountMap.get(g.id) ?? { name: g.name, count: 0 };
        entry.count += 1;
        guildCountMap.set(g.id, entry);
      }
    }
    const mutual = Array.from(guildCountMap.entries())
      .filter(([, v]) => v.count === total)
      .map(([id, v]) => ({ id, name: v.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ guilds: mutual, accountCount: total });
  });

  app.post("/api/warmup-campaigns/:id/start", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await db.setWarmupCampaignStatus(id, "running");
    // Safety net: if the wizard somehow submitted with zero pairs, create all
    // cross-proxy pairs now so the campaign isn't dead on arrival. If pairs already
    // exist (the normal case), skip entirely — don't override what the wizard set.
    const existingPairs = await db.listWarmupCampaignPairs(id);
    if (existingPairs.length === 0) {
      const [accounts, proxyMap] = await Promise.all([
        db.listWarmupCampaignAccounts(id),
        db.getAccountProxyMap(),
      ]);
      const active = accounts.filter((a) => !a.dead_since);
      const BATCH = 25;
      const pairsToCreate: Array<[string, string]> = [];
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i]!; const b = active[j]!;
          const pa = proxyMap.get(a.account_id) || null;
          const pb = proxyMap.get(b.account_id) || null;
          if (pa && pb && pa === pb) continue;
          pairsToCreate.push([a.account_id, b.account_id]);
        }
      }
      for (let i = 0; i < pairsToCreate.length; i += BATCH) {
        await Promise.all(pairsToCreate.slice(i, i + BATCH).map(([a, b]) => db.upsertWarmupCampaignPair(id, a, b)));
      }
    }
    res.json({ ok: true });
  });
  app.post("/api/warmup-campaigns/:id/pause",  async (req, res) => { await db.setWarmupCampaignStatus(String(req.params.id), "paused");    res.json({ ok: true }); });
  app.post("/api/warmup-campaigns/:id/resume", async (req, res) => { await db.setWarmupCampaignStatus(String(req.params.id), "running");   res.json({ ok: true }); });
  app.post("/api/warmup-campaigns/:id/cancel", async (req, res) => { await db.setWarmupCampaignStatus(String(req.params.id), "cancelled"); res.json({ ok: true }); });
  app.delete("/api/warmup-campaigns/:id", async (req, res) => {
    const id = String(req.params.id);
    await db.deleteWarmupCampaign(id);
    const { clearCampaignCache } = await import("./warmup-campaign-engine");
    clearCampaignCache(id);
    res.json({ ok: true });
  });

  app.get("/api/warmup-campaigns/:id/messages", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const limit = clamp(Number(req.query.limit || 50), 1, 500);
    res.json({ messages: await db.listRecentWarmupMessages(id, limit) });
  });
}
