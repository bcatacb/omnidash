/**
 * Telegram notifier for inbound replies (manageable scope).
 *
 * - Only real 1:1 DMs (no guild/server messages, no group DMs).
 * - Only external (skips when one of our bridged accounts DMs another — e.g. warmups).
 * - Lead first-reply: always does status upgrade + dm_replied publish.
 * - TG notification: first inbound + throttled by per-conv cooldown (default 10min, override via TELEGRAM_NOTIFY_COOLDOWN_MINUTES).
 * - Enabled only when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set.
 *
 * Setup (env vars only):
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=-100xxxxxxxxx
 *
 * Add to deploy/vps/.env (never commit the real values).
 * Uses only the public Bot API via fetch — no extra deps.
 */

import * as db from "./db";
import { publishExternalEvent } from "./realtime";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const COOLDOWN_MINUTES = Math.max(0, Number(process.env.TELEGRAM_NOTIFY_COOLDOWN_MINUTES || "10"));
const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;

// Per-conversation throttle to keep the group manageable.
// Keyed by conversationId. Cleared on process restart (acceptable).
const lastNotifiedAt = new Map<string, number>();

let enabled = false;

export function initTelegramNotifier(): void {
  enabled = !!(TG_TOKEN && TG_CHAT_ID);
  if (enabled) {
    console.log(`[telegram] notifier enabled — 1:1 DMs only, external accounts only, 10min default cooldown (env TELEGRAM_NOTIFY_COOLDOWN_MINUTES=${COOLDOWN_MINUTES}). Lead first-replies always surface.`);
  } else {
    console.log("[telegram] notifier disabled (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID not set)");
  }
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface InboundLeadParams {
  accountId: string;
  accountUsername?: string | null;
  peerDiscordUserId: string;
  peerDisplayName: string;
  body: string;
  conversationId: string;
  sentAt: string;
}

export async function handleInboundMessage(params: InboundLeadParams): Promise<void> {
  const lead = await db.findLeadByDiscordUserId(params.accountId, params.peerDiscordUserId);

  // Upgrade status + emit the dm_replied event only on first reply (only for campaign leads).
  // This runs for external leads even if TG is throttled or disabled.
  if (lead && lead.status !== "replied") {
    try {
      await db.setLeadStatus(lead.id, "replied", params.accountId);
      if (lead.campaignId) {
        await db.bumpCampaignTotal(lead.campaignId, "replied");
      }
      publishExternalEvent({
        type: "dm_replied",
        campaignId: lead.campaignId || "",
        leadId: lead.id,
        conversationId: params.conversationId,
        ts: params.sentAt,
      });
    } catch (err: any) {
      console.warn(`[telegram] failed to mark lead ${lead.id} as replied: ${err?.message || err}`);
    }
  }

  if (!enabled) return;

  // Per-conv cooldown (10min default). First message for a conv always goes through.
  const now = Date.now();
  const last = lastNotifiedAt.get(params.conversationId) || 0;
  if (COOLDOWN_MS > 0 && now - last < COOLDOWN_MS) {
    return;
  }

  let campaignName = "";
  if (lead?.campaignId) {
    try {
      const camp = await db.getCampaign(lead.campaignId);
      campaignName = camp?.name || "";
    } catch {}
  }

  const isCampaign = !!lead?.campaignId;
  const title = isCampaign ? "🔔 New reply from campaign lead" : "🔔 New message in Unibox";
  const acctLabel = params.accountUsername || params.accountId.slice(0, 8);
  const snippet = params.body.length > 600 ? params.body.slice(0, 600) + "…" : params.body;

  const text =
    `${title}\n\n` +
    `<b>Lead:</b> ${escapeHtml(params.peerDisplayName)}\n` +
    `<b>${isCampaign ? "Campaign" : "Source"}:</b> ${escapeHtml(campaignName || "Unibox / External DM")}\n` +
    `<b>Account:</b> ${escapeHtml(String(acctLabel))}\n\n` +
    `<b>They said:</b>\n` +
    `<blockquote>${escapeHtml(snippet)}</blockquote>\n\n` +
    `<b>Conv:</b> <code>${escapeHtml(params.conversationId)}</code>`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[telegram] sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
    } else {
      lastNotifiedAt.set(params.conversationId, now);
      console.log(`[telegram] notification sent (cooldown ${COOLDOWN_MINUTES}m) peer=${params.peerDiscordUserId}`);
    }
  } catch (err: any) {
    console.warn(`[telegram] notify error: ${err?.message || err}`);
  }
}
