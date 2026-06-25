/**
 * Account-groups API routes.
 *
 * Groups bundle captured Discord accounts together for the GG browser
 * extension to switch between in the operator's real browser. Each group
 * exposes a token-bundle endpoint that returns the bare tokens for every
 * member — the extension holds those in service-worker memory only.
 *
 * Routes:
 *   GET    /api/groups                         → AccountGroupWithMembers[]
 *   POST   /api/groups                         → AccountGroupWithMembers
 *   GET    /api/groups/:id                     → AccountGroupWithMembers
 *   PATCH  /api/groups/:id                     → AccountGroupWithMembers
 *   DELETE /api/groups/:id                     → { ok: true }
 *   POST   /api/groups/:id/members             → AccountGroupWithMembers
 *   DELETE /api/groups/:id/members/:accountId  → AccountGroupWithMembers
 *   PUT    /api/groups/:id/members/order       → AccountGroupWithMembers
 *   GET    /api/groups/:id/token-bundle        → GroupTokenBundle  (extension-only)
 */
import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import * as db from './db';
import { _getCapturedToken, state as discordMockState } from './discord-mock';
import { invalidateProxyCache } from './discord-http';
import type { GroupTokenBundle, AccountTokenEntry } from './api-types';

/**
 * Parse a single proxy line into a canonical http://user:pass@host:port URL.
 * Accepts two formats:
 *   A) ip:port:user:pass  — Webshare table-paste. Passwords may contain colons;
 *      only the first two colons (host:port) are used as delimiters.
 *   B) http(s)://[user:pass@]host:port  — full URL, stored as-is.
 * Throws a descriptive Error if the line is malformed or produces an invalid URL.
 */
function parseProxyLine(raw: string): string {
  const line = raw.trim();
  if (!line) throw new Error('empty line');

  if (/^https?:\/\//.test(line)) {
    // Format B — full URL. Validate it parses cleanly.
    const u = new URL(line);
    if (!u.hostname) throw new Error('URL has no hostname');
    return line;
  }

  // Format A — ip:port:user:pass[with possible colons in pass]
  const firstColon = line.indexOf(':');
  if (firstColon === -1) throw new Error('expected ip:port:user:pass or http://... URL');
  const secondColon = line.indexOf(':', firstColon + 1);
  if (secondColon === -1) throw new Error('expected ip:port:user:pass — missing port or credentials');
  const thirdColon = line.indexOf(':', secondColon + 1);
  if (thirdColon === -1) throw new Error('expected ip:port:user:pass — missing credentials');

  const host = line.slice(0, firstColon);
  const port = line.slice(firstColon + 1, secondColon);
  const user = line.slice(secondColon + 1, thirdColon);
  const pass = line.slice(thirdColon + 1); // everything after the third colon is the password

  if (!host) throw new Error('host is empty');
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) throw new Error(`invalid port "${port}" — must be 1–65535`);
  if (!user) throw new Error('username is empty');

  const url = `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  // Final sanity check — new URL() will throw if anything is still malformed.
  new URL(url);
  return url;
}

export function registerGroupRoutes(app: Express): void {
  app.get('/api/groups', async (_req: Request, res: Response) => {
    const groups = await db.listGroups();
    res.json(groups);
  });

  app.post('/api/groups', async (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const description = String(req.body?.description || '').slice(0, 500);
    const id = `grp_${crypto.randomBytes(6).toString('hex')}`;
    await db.createGroup({ id, name, description });
    const fresh = await db.getGroup(id);
    res.json(fresh);
  });

  app.get('/api/groups/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const g = await db.getGroup(id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    res.json(g);
  });

  app.patch('/api/groups/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const existing = await db.getGroup(id);
    if (!existing) return res.status(404).json({ error: 'group not found' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    const description = req.body?.description !== undefined ? String(req.body.description).slice(0, 500) : existing.description;
    await db.updateGroup(id, name, description);
    res.json(await db.getGroup(id));
  });

  app.delete('/api/groups/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await db.deleteGroup(id);
    res.json({ ok: true });
  });

  app.post('/api/groups/:id/members', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const accountId = String(req.body?.accountId || '');
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    const group = await db.getGroup(id);
    if (!group) return res.status(404).json({ error: 'group not found' });
    if (group.members.some((m) => m.accountId === accountId)) {
      return res.status(409).json({ error: 'account already in group' });
    }
    const position = group.members.length;
    await db.addAccountToGroup(id, accountId, position);
    res.json(await db.getGroup(id));
  });

  app.delete('/api/groups/:id/members/:accountId', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const accountId = String(req.params.accountId);
    await db.removeAccountFromGroup(id, accountId);
    res.json(await db.getGroup(id));
  });

  app.put('/api/groups/:id/members/order', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const order: string[] = Array.isArray(req.body?.accountIds) ? req.body.accountIds.map(String) : [];
    if (order.length === 0) return res.status(400).json({ error: 'accountIds required' });
    await db.reorderGroupMembers(id, order);
    res.json(await db.getGroup(id));
  });

  // Token bundle — the ONE endpoint the extension calls. We deliberately do
  // not log this response. We resolve username + label from in-memory state
  // so the extension can render labels without a second round-trip. Each
  // entry also includes its assigned proxy URL (if any) so the extension can
  // route that account's browser traffic through the right Webshare IP.
  // Cache-Control: no-store prevents any intermediate caching of credentials.
  app.get('/api/groups/:id/token-bundle', async (req: Request, res: Response) => {
    const id = String(req.params.id);

    // v0.33: the extension's `activate` message is hardcoded to hit this
    // `/api/groups/:id/token-bundle` URL. To let the campaign-start guided
    // wave use the same extension without a re-publish, we treat any id with
    // the `camp_` prefix as a synthetic group composed of that campaign's
    // accounts. The bundle shape is identical so the extension is none-the-
    // wiser.
    let accountIds: string[] = [];
    let groupName = '';
    let groupIdOut = id;
    if (id.startsWith('camp_')) {
      const camp = await db.getCampaign(id);
      if (!camp) return res.status(404).json({ error: 'campaign not found' });
      accountIds = camp.accountIds;
      groupName = `campaign:${camp.name}`;
    } else if (id.startsWith('account-')) {
      // v0.38: single-account synthetic bundle. Lets the Unibox "wave this
      // chat" banner trigger Activate without needing a campaign or group
      // context — just an account id.
      const accountId = id.slice('account-'.length);
      if (!discordMockState.accounts.find((a) => a.id === accountId)) {
        return res.status(404).json({ error: 'account not found' });
      }
      accountIds = [accountId];
      groupName = `account:${accountId}`;
    } else {
      const group = await db.getGroup(id);
      if (!group) return res.status(404).json({ error: 'group not found' });
      accountIds = group.members.map((m) => m.accountId);
      groupName = group.name;
      groupIdOut = group.id;
    }

    const proxyMap = await db.getAccountProxyMap();
    const proxyUrls = new Map<string, string>();
    if (proxyMap.size > 0) {
      const allProxies = await db.listProxies();
      const urlById = new Map(allProxies.map((p) => [p.id, p.url]));
      for (const [accountId, proxyId] of proxyMap.entries()) {
        const url = urlById.get(proxyId);
        if (url) proxyUrls.set(accountId, url);
      }
    }
    // v0.68 — pull pending recipients per account so the extension can
    // batch-create all empty DMs on first Open-in-Discord click. One key call
    // for the operator (open this lead's chat) actually opens *every* pending
    // chat under that account, while egressing from their IP (no burn).
    const pendingByAccount = new Map<string, string[]>();
    try {
      const pending = await db.listActivePendingLeads();
      const wanted = new Set(accountIds);
      const liveKeys = new Set<string>();
      for (const c of discordMockState.conversations) {
        if (wanted.has(c.accountId)) liveKeys.add(`${c.accountId}::${c.peer?.discordUserId || ''}`);
      }
      for (const p of pending) {
        if (!wanted.has(p.accountId)) continue;
        if (liveKeys.has(`${p.accountId}::${p.discordUserId}`)) continue;
        const list = pendingByAccount.get(p.accountId) || [];
        list.push(p.discordUserId);
        pendingByAccount.set(p.accountId, list);
      }
    } catch (e: any) {
      console.warn(`[token-bundle] pending lookup failed: ${e?.message || e}`);
    }

    const entries: AccountTokenEntry[] = [];
    for (const accountId of accountIds) {
      const token = _getCapturedToken(accountId);
      if (!token) continue;
      const acct = discordMockState.accounts.find((a) => a.id === accountId);
      entries.push({
        accountId,
        username: acct?.username || accountId,
        label: acct?.label || acct?.username || accountId,
        token,
        proxyUrl: proxyUrls.get(accountId),
        pendingRecipientIds: pendingByAccount.get(accountId) || [],
      });
    }
    const bundle: GroupTokenBundle = {
      groupId: groupIdOut,
      groupName,
      fetchedAt: new Date().toISOString(),
      entries,
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(bundle);
  });

  // ───── Proxies CRUD ───────────────────────────────────────────────────────
  app.get('/api/proxies', async (_req: Request, res: Response) => {
    const proxies = await db.listProxies();
    const assignments = await db.getAccountProxyMap();
    // Group accounts by proxy for the UI.
    const byProxy = new Map<string, string[]>();
    for (const [accountId, proxyId] of assignments.entries()) {
      const list = byProxy.get(proxyId) || [];
      list.push(accountId);
      byProxy.set(proxyId, list);
    }
    res.json(proxies.map((p) => ({ ...p, accountIds: byProxy.get(p.id) || [] })));
  });

  app.post('/api/proxies', async (req: Request, res: Response) => {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url required' });
    const label = String(req.body?.label || '').slice(0, 120);
    const geo = String(req.body?.geo || '').slice(0, 32);
    const crypto = require('crypto');
    const id = `prx_${crypto.randomBytes(6).toString('hex')}`;
    await db.createProxy({ id, label, url, geo });
    res.json({ id, label, url, geo, createdAt: new Date().toISOString() });
  });

  // Bulk create — operator pastes the multi-line Webshare proxy list and we
  // parse each line. Accepts either "ip:port:user:pass" (Webshare default) or
  // "http://user:pass@ip:port".
  app.post('/api/proxies/bulk', async (req: Request, res: Response) => {
    const input = String(req.body?.input || '');
    const lines = input.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'no proxies provided' });
    if (lines.length > 200) return res.status(400).json({ error: 'max 200 per call' });
    const crypto = require('crypto');
    const created: any[] = [];
    const failed: { line: string; error: string }[] = [];
    for (const line of lines) {
      try {
        const url = parseProxyLine(line);
        const id = `prx_${crypto.randomBytes(6).toString('hex')}`;
        await db.createProxy({ id, label: '', url, geo: '' });
        created.push({ id, url });
      } catch (err: any) {
        failed.push({ line, error: err?.message || String(err) });
      }
    }
    res.json({ created, failed });
  });

  // GET /api/proxies/parse-preview — validate lines without saving (used by the UI live preview)
  app.post('/api/proxies/parse-preview', (req: Request, res: Response) => {
    const input = String(req.body?.input || '');
    const lines = input.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    const result = lines.map((line) => {
      try {
        const url = parseProxyLine(line);
        const u = new URL(url);
        return { line, ok: true, host: u.hostname, port: u.port };
      } catch (err: any) {
        return { line, ok: false, error: err?.message || String(err) };
      }
    });
    res.json(result);
  });

  // POST /api/proxies/:id/test — fire a real HTTP request through the proxy and return the exit IP.
  // Uses undici ProxyAgent (same as file-send path) so it validates the URL is actually routable.
  app.post('/api/proxies/:id/test', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const proxies = await db.listProxies();
    const proxy = proxies.find((p) => p.id === id);
    if (!proxy) return res.status(404).json({ error: 'proxy not found' });

    // Validate the stored URL is parseable before even trying to connect.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(proxy.url);
      if (!parsedUrl.hostname) throw new Error('no hostname');
    } catch (err: any) {
      return res.json({ ok: false, error: `stored URL is malformed: ${err?.message || proxy.url}` });
    }

    try {
      const { ProxyAgent, fetch: undiciFetch } = await import('undici');
      const dispatcher = new ProxyAgent(proxy.url);
      const r = await undiciFetch('https://api.ipify.org?format=json', {
        dispatcher,
        signal: AbortSignal.timeout(12_000),
      } as any);
      if (!r.ok) return res.json({ ok: false, error: `HTTP ${r.status} from ipify` });
      const body = await r.json() as any;
      return res.json({ ok: true, ip: String(body?.ip || '?') });
    } catch (err: any) {
      return res.json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.delete('/api/proxies/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await db.deleteProxy(id);
    invalidateProxyCache(); // all assignments for this proxy are gone
    res.json({ ok: true });
  });

  app.post('/api/proxies/:id/assign', async (req: Request, res: Response) => {
    const proxyId = String(req.params.id);
    const accountId = String(req.body?.accountId || '');
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    await db.assignProxy(accountId, proxyId);
    invalidateProxyCache(accountId);
    res.json({ ok: true });
  });

  app.delete('/api/proxies/assignments/:accountId', async (req: Request, res: Response) => {
    const accountId = String(req.params.accountId);
    await db.unassignProxy(accountId);
    invalidateProxyCache(accountId);
    res.json({ ok: true });
  });
}
