import type { Express, Request, Response } from "express";
import * as db from "./db";
import { sendFrManual } from "./fr-campaign-engine";
import { _getCapturedToken } from "./discord-mock";
import { browserSendFriendRequest } from "./discord-browser";

export function registerFrCampaignRoutes(app: Express): void {
  app.get("/api/fr-campaigns", async (_req: Request, res: Response) => {
    res.json(await db.listFrCampaigns());
  });

  app.post("/api/fr-campaigns", async (req: Request, res: Response) => {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const mode = String(b.mode || "fr_only");
    if (!["fr_only", "dm_then_fr", "fr_then_dm"].includes(mode))
      return res.status(400).json({ error: "invalid mode" });
    const campaign = await db.createFrCampaign({
      name,
      mode,
      guild_id: b.guild_id ? String(b.guild_id) : undefined,
      template: b.template ? String(b.template) : undefined,
      fr_per_account_per_day: Number(b.fr_per_account_per_day) || 20,
      min_interval_seconds: Number(b.min_interval_seconds) || 300,
      max_interval_seconds: Number(b.max_interval_seconds) || 900,
      combo_interval_seconds: Number(b.combo_interval_seconds) || 300,
      inter_send_seconds: Math.max(30, Number(b.inter_send_seconds) || 60),
    });
    res.json(campaign);
  });

  app.get("/api/fr-campaigns/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const c = await db.getFrCampaign(id);
    if (!c) return res.status(404).json({ error: "not found" });
    res.json(c);
  });

  app.patch("/api/fr-campaigns/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const c = await db.getFrCampaign(id);
    if (!c) return res.status(404).json({ error: "not found" });
    const b = req.body || {};
    await db.updateFrCampaign(id, {
      ...(b.name !== undefined && { name: String(b.name).trim() }),
      ...(b.template !== undefined && { template: b.template ? String(b.template) : null }),
      ...(b.guild_id !== undefined && { guild_id: b.guild_id ? String(b.guild_id) : null }),
    });
    res.json(await db.getFrCampaign(id));
  });

  app.delete("/api/fr-campaigns/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await db.deleteFrCampaign(id);
    res.json({ ok: true });
  });

  app.post("/api/fr-campaigns/:id/status", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const c = await db.getFrCampaign(id);
    if (!c) return res.status(404).json({ error: "not found" });
    const status = String(req.body?.status || "");
    if (!["running", "paused", "completed"].includes(status))
      return res.status(400).json({ error: "status must be running|paused|completed" });
    await db.updateFrCampaignStatus(id, status);
    res.json({ ok: true, status });
  });

  app.get("/api/fr-campaigns/:id/leads", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const c = await db.getFrCampaign(id);
    if (!c) return res.status(404).json({ error: "not found" });
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const offset = Number(req.query.offset) || 0;
    res.json(await db.listFrLeads(id, limit, offset));
  });

  app.post("/api/fr-campaigns/:id/leads", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const c = await db.getFrCampaign(id);
    if (!c) return res.status(404).json({ error: "not found" });

    let leads: Array<{ discord_user_id: string; display_name?: string; username?: string }> = [];
    if (Array.isArray(req.body?.leads)) {
      leads = (req.body.leads as any[]).map((l) => ({
        discord_user_id: String(l.discord_user_id || l.id || "").trim(),
        display_name: l.display_name ? String(l.display_name) : undefined,
        username: l.username ? String(l.username) : undefined,
      })).filter((l) => l.discord_user_id);
    } else if (typeof req.body?.leads === "string") {
      leads = req.body.leads.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean).map((uid: string) => ({ discord_user_id: uid }));
    }

    if (!leads.length) return res.status(400).json({ error: "no valid leads" });
    const inserted = await db.importFrLeads(id, leads);
    res.json({ ok: true, inserted, total: leads.length });
  });

  app.post("/api/fr-campaigns/:id/leads/:leadId/send-fr", async (req: Request, res: Response) => {
    const campaignId = String(req.params.id);
    const leadId = String(req.params.leadId);
    const result = await sendFrManual(campaignId, leadId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // One-off FR send from a specific account (no campaign required)
  app.post("/api/accounts/:accountId/send-fr", async (req: Request, res: Response) => {
    const accountId = String(req.params.accountId);
    const targetUsername = String(req.body?.username || req.body?.discord_username || "").trim();
    if (!targetUsername) return res.status(400).json({ error: "username required" });
    const token = _getCapturedToken(accountId);
    if (!token) return res.status(400).json({ error: "no token for account" });
    try {
      const r = await browserSendFriendRequest(accountId, token, targetUsername);
      if (r.ok || r.status === 204 || r.status === 200) return res.json({ ok: true });
      const text = await r.text().catch(() => "");
      return res.status(400).json({ ok: false, error: `HTTP ${r.status}: ${text.slice(0, 120)}` });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message ?? "browser send failed" });
    }
  });

  app.get("/api/fr-leads/by-discord-user/:discordUserId", async (req: Request, res: Response) => {
    const rows = await db.findFrLeadByDiscordUser(String(req.params.discordUserId));
    res.json(rows);
  });
}
