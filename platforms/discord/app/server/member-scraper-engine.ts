import * as db from "./db";
import { scrapeGuildMembersSmart } from "./discord-scrape";
import { _getCapturedToken } from "./discord-mock";
import { isGatewayOpen, getAccountGuilds, gatewayStatus } from "./discord-gateway";

// Cache of scraper-assigned account IDs so the fallback only borrows from
// other decoy accounts, never from outreach/campaign accounts.
let scraperAccountsCache: { ids: Set<string>; at: number } | null = null;
async function loadScraperAccountIds(): Promise<Set<string>> {
  const now = Date.now();
  if (scraperAccountsCache && now - scraperAccountsCache.at < 60_000) return scraperAccountsCache.ids;
  const ids = await db.getScraperAccountIds().catch(() => new Set<string>());
  scraperAccountsCache = { ids, at: now };
  return ids;
}

const TICK_MS = 60_000;
let engineRunning = false;

export function startMemberScraperEngine(): void {
  if (engineRunning) return;
  engineRunning = true;
  console.log("[member-scraper] engine started");
  setInterval(() => { runTick().catch((e) => console.error("[member-scraper] tick error:", e?.message || e)); }, TICK_MS);
  // Run immediately on start
  runTick().catch((e) => console.error("[member-scraper] initial tick error:", e?.message || e));
}

async function runTick(): Promise<void> {
  const dueJobs = await db.listDueScraperJobs();
  if (dueJobs.length === 0) return;
  console.log(`[member-scraper] ${dueJobs.length} job(s) due`);

  for (const job of dueJobs) {
    await runJob(job).catch((e) => {
      console.error(`[member-scraper] job=${job.id} guild=${job.guild_id} error:`, e?.message || e);
    });
  }
}

async function runJob(job: db.ScraperJobRow): Promise<void> {
  const token = _getCapturedToken(job.account_id);
  if (!token) {
    await db.updateScraperJob(job.id, {
      status: "error",
      error_message: "No token — account may be disconnected or token revoked",
    });
    return;
  }

  // Pick the account to scrape with. Use the assigned account if its WebSocket
  // is actually OPEN (readyState=1). If not, fall back to any other account
  // whose gateway is open AND whose READY included this guild.
  // We check readyState directly via isGatewayOpen — conn.closed is a logical
  // flag that doesn't track WebSocket drops, so it's not reliable here.
  const scraperIds = await loadScraperAccountIds();
  const resolveAccount = (): { accountId: string; token: string } | null => {
    if (isGatewayOpen(job.account_id)) return { accountId: job.account_id, token };
    // Primary down — fall back to another SCRAPER account that's open and in this guild.
    // Never borrow a campaign/outreach account: mixing scraper + sender roles is a flag risk.
    const others = gatewayStatus().filter(
      (s) => s.accountId !== job.account_id && isGatewayOpen(s.accountId) && scraperIds.has(s.accountId),
    );
    for (const s of others) {
      const guilds = getAccountGuilds(s.accountId);
      if (!guilds.some((g) => g.id === job.guild_id)) continue;
      const t = _getCapturedToken(s.accountId);
      if (t) return { accountId: s.accountId, token: t };
    }
    return null;
  };

  const resolved = resolveAccount();
  if (!resolved) {
    // Short retry — gateway usually reconnects within seconds after a restart.
    // Don't use the full interval here or jobs silently disappear for an hour.
    const retryMs = 2 * 60_000;
    await db.updateScraperJob(job.id, {
      next_scrape_at: new Date(Date.now() + retryMs).toISOString(),
      error_message: "No account with an open gateway is in this server — retrying in 2 min",
    });
    console.warn(`[member-scraper] job=${job.id} guild=${job.guild_id} — no open gateway, retry in 2m`);
    return;
  }

  const { accountId: scrapeAccountId, token: scrapeToken } = resolved;
  if (scrapeAccountId !== job.account_id) {
    console.warn(`[member-scraper] job=${job.id} assigned account=${job.account_id} gateway not OPEN — scraping via ${scrapeAccountId}`);
  }

  console.log(`[member-scraper] job=${job.id} scraping guild=${job.guild_id} account=${scrapeAccountId}`);

  try {
    const result = await scrapeGuildMembersSmart(scrapeAccountId, job.guild_id, null, scrapeToken);
    const humanMembers = result.members.filter((m) => !m.bot);

    const toInsert = humanMembers.map((m) => ({
      job_id: job.id,
      guild_id: job.guild_id,
      guild_name: job.guild_name ?? null,
      discord_user_id: m.id,
      username: m.username,
      global_name: m.globalName ?? null,
      avatar_url: m.avatarUrl ?? null,
    }));

    const newCount = await db.upsertScrapedMembers(toInsert);
    const nextScrape = new Date(Date.now() + job.interval_minutes * 60_000).toISOString();

    await db.updateScraperJob(job.id, {
      last_scraped_at: new Date().toISOString(),
      next_scrape_at: nextScrape,
      members_new: newCount,
      members_total: job.members_total + newCount,
      error_message: null,
    });
    db.logActivity(scrapeAccountId, "scrape_session", { jobId: job.id, guildId: job.guild_id, memberCount: humanMembers.length, newCount, via: result.via });

    console.log(
      `[member-scraper] job=${job.id} guild=${job.guild_id}: ${humanMembers.length} members scraped, ${newCount} new, via=${result.via}`,
    );
  } catch (err: any) {
    const msg = err?.message || String(err);
    // Transient (gateway drop, timeout) → short retry so we don't sit idle for an hour.
    // Permanent errors (bad guild ID etc.) → full interval.
    const transient = msg.includes("gateway not connected") || msg.includes("timeout");
    const retryMs = transient ? 2 * 60_000 : job.interval_minutes * 60_000;
    await db.updateScraperJob(job.id, {
      error_message: msg.slice(0, 500),
      next_scrape_at: new Date(Date.now() + retryMs).toISOString(),
    });
    throw err;
  }
}
