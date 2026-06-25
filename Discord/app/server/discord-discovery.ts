/**
 * Discord Server Discovery proxy.
 *
 * Surfaces the same data Discord's in-app "Explore Public Servers" uses:
 *   GET  /api/v9/discovery/categories          → top-level categories
 *   GET  /api/v9/discoverable-guilds?...       → discoverable guild list
 *   PUT  /api/v9/guilds/{id}/members/@me       → join a discoverable guild
 *
 * Calls are made with one of the user's captured tokens, through the residential
 * proxy. The discoverable-guilds endpoint is keyed to Discord's recommendations
 * for that account, so per-account variation is expected.
 */

import { discordHeaders, tlsFetch } from "./discord-http";

async function HEADERS(token: string, withBody = false): Promise<Record<string, string>> {
  const h = await discordHeaders(token, withBody);
  // Discovery uses a slightly different referer than channels.
  h.referer = "https://discord.com/guild-discovery";
  return h;
}

export interface DiscoveryCategory {
  id: number;
  name: string;
  isPrimary: boolean;
}

export async function listCategories(token: string): Promise<DiscoveryCategory[]> {
  try {
    const r = await tlsFetch("https://discord.com/api/v9/discovery/categories?primary_only=false&locale=en-US", {
      method: "GET",
      headers: await HEADERS(token),
      timeoutMs: 12_000,
    });
    if (!r.ok) return [];
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr)) return [];
    return arr.map((c) => ({
      id: Number(c.id),
      name: String(c.name?.default || c.name?.localizations?.en || c.name || ""),
      isPrimary: !!c.is_primary,
    }));
  } catch {
    return [];
  }
}

export interface DiscoverableGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  splashUrl: string | null;
  description: string | null;
  approximateMemberCount: number | null;
  approximatePresenceCount: number | null;
  vanityUrlCode: string | null;
  features: string[];
  primaryCategoryId: number | null;
}

export interface DiscoverResult {
  guilds: DiscoverableGuild[];
  total: number;
  offset: number;
  limit: number;
}

const guildIcon = (id: string, hash: string | null | undefined) =>
  hash ? `https://cdn.discordapp.com/icons/${id}/${hash}.png?size=64` : null;
const guildSplash = (id: string, hash: string | null | undefined) =>
  hash ? `https://cdn.discordapp.com/splashes/${id}/${hash}.png?size=480` : null;

export async function searchDiscoverableGuilds(
  token: string,
  opts: { categoryId?: number; query?: string; limit?: number; offset?: number } = {},
): Promise<DiscoverResult> {
  const limit = Math.min(opts.limit ?? 24, 48);
  const offset = opts.offset ?? 0;
  // Two distinct Discord endpoints — pick based on whether the user typed a query:
  //   With query  → /discovery/search?query=...  (text relevance ranking)
  //   No query    → /discoverable-guilds         (popularity ranking by category)
  const trimmed = opts.query?.trim() || "";
  let url: string;
  if (trimmed) {
    const p = new URLSearchParams({ query: trimmed, limit: String(limit), offset: String(offset) });
    if (opts.categoryId) p.set("categories", String(opts.categoryId));
    url = `https://discord.com/api/v9/discovery/search?${p}`;
  } else {
    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (opts.categoryId) p.set("categories", String(opts.categoryId));
    url = `https://discord.com/api/v9/discoverable-guilds?${p}`;
  }

  try {
    const r = await tlsFetch(url, {
      method: "GET",
      headers: await HEADERS(token),
      timeoutMs: 15_000,
    });
    if (!r.ok) {
      const body = await r.text();
      console.warn(`[discover] ${url} HTTP ${r.status} body=${body.slice(0, 160)}`);
      return { guilds: [], total: 0, offset, limit };
    }
    const j = (await r.json()) as any;
    const rawGuilds: any[] = Array.isArray(j?.guilds)
      ? j.guilds
      : Array.isArray(j?.hits)
        ? j.hits
        : [];
    const guilds: DiscoverableGuild[] = rawGuilds.map((g: any): DiscoverableGuild => ({
      id: String(g.id),
      name: String(g.name || ""),
      iconUrl: guildIcon(String(g.id), g.icon),
      splashUrl: guildSplash(String(g.id), g.splash),
      description: g.description || null,
      approximateMemberCount: typeof g.approximate_member_count === "number" ? g.approximate_member_count : null,
      approximatePresenceCount: typeof g.approximate_presence_count === "number" ? g.approximate_presence_count : null,
      vanityUrlCode: g.vanity_url_code || null,
      features: Array.isArray(g.features) ? g.features : [],
      primaryCategoryId: g.primary_category_id ?? null,
    }));
    return {
      guilds,
      total: typeof j?.total === "number" ? j.total : typeof j?.nbHits === "number" ? j.nbHits : guilds.length,
      offset,
      limit,
    };
  } catch (err: any) {
    console.warn(`[discover] threw: ${err?.message || err}`);
    return { guilds: [], total: 0, offset, limit };
  }
}

/**
 * Join a discoverable guild directly — no invite link needed.
 * PUT /guilds/{id}/members/@me is what Discord's web client uses when you click
 * "Join Server" from the Explore page.
 */
export async function joinDiscoverableGuild(
  token: string,
  guildId: string,
): Promise<{ ok: boolean; httpStatus?: number; error?: string }> {
  try {
    const r = await tlsFetch(`https://discord.com/api/v9/guilds/${encodeURIComponent(guildId)}/members/@me`, {
      method: "PUT",
      headers: await HEADERS(token, true),
      body: JSON.stringify({}),
      timeoutMs: 15_000,
    });
    if (r.ok || r.status === 204) return { ok: true, httpStatus: r.status };
    const body = await r.text();
    return { ok: false, httpStatus: r.status, error: body.slice(0, 200) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}
