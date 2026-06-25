# GG Multi-Account Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator open their captured Discord accounts (50+) in their real Chrome browser by clicking links in the gg.linktree.bond UI, with one-token-active-per-tab + ~3 s reload to switch. Tokens fetched from server on demand, held only in extension service-worker memory, never written to operator's disk.

**Architecture:** A Chrome Manifest-V3 extension acts as the bridge between gg.linktree.bond (where the operator clicks "Activate @account") and the operator's discord.com tab (where `localStorage.token` is written). Backend stores account groups (manual operator-created), serves a token bundle endpoint authenticated by the operator's existing gg session cookie. Discord cookies + IndexedDB stay in the operator's Chrome profile — warm DM channels persist across switches.

**Tech Stack:** Chrome Manifest V3, TypeScript, Node 20 + Express (gg-api), React + Vite (gg-app), Postgres (`account_groups` + `account_group_members` tables).

**Out of scope for this plan** (separate workstreams, prereqs to ship at scale):
- **Per-account proxy assignment** — at 10+ accounts the operator's home IP becomes a cluster-ban risk. Should land before this extension ships to production, but the extension itself doesn't depend on the proxy work.
- **Bulk token import UI** — onboarding 50 accounts via the current QR flow is painful. Separate plan.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `db/migrations/0012_account_groups.sql` | create | Schema for groups + group↔account membership |
| `app/server/groups.ts` | create | Groups CRUD + token-bundle handler |
| `app/server/api-types.ts` | modify | Export `AccountGroup` + `AccountGroupMember` types |
| `app/server/index.ts` | modify | Mount `/api/groups/*` routes |
| `app/server/db.ts` | modify | DB helpers: `listGroups`, `getGroup`, `createGroup`, `addAccountToGroup`, `removeAccountFromGroup`, `deleteGroup`, `getGroupTokenBundle` |
| `app/src/pages/BrowserSessions.tsx` | create | New "Browser Sessions" page (list groups, drag accounts in, click to activate) |
| `app/src/pages/sessions/GroupCard.tsx` | create | Single-group card with member rows + activate buttons |
| `app/src/pages/sessions/AddAccountPicker.tsx` | create | Modal/popover that lists captured accounts not yet in this group |
| `app/src/api-types.ts` | modify | Mirror `AccountGroup` + `AccountGroupMember` on frontend |
| `app/src/App.tsx` | modify | Route `/app/sessions` → `BrowserSessions` |
| `app/src/components/layout/Sidebar.tsx` | modify | Nav item "Browser Sessions" |
| `extension/manifest.json` | create | MV3 manifest, permissions, externally_connectable to gg.linktree.bond |
| `extension/background.ts` | create | Service worker: token-bundle fetch, message handlers, activate logic |
| `extension/content-script.ts` | create | Runs on discord.com: writes `localStorage.token` on instruction, reloads |
| `extension/options.html` | create | Static options page (status, gg.linktree.bond URL config, last-fetched-at) |
| `extension/options.ts` | create | Options page logic |
| `extension/popup.html` | create | Browser-action popup (status indicator, last-activated account) |
| `extension/popup.ts` | create | Popup logic |
| `extension/tsconfig.json` | create | TS config targeting browser globals |
| `extension/package.json` | create | esbuild devDep + build script |
| `extension/README.md` | create | Install/sideload instructions for the operator |
| `extension/build.sh` | create | Bundle TS → JS, copy static files to `dist/` |
| `deploy/DEPLOYED.md` | modify | v0.30 section: migration command, extension install steps |

---

## Honest constraints (read before starting)

- **Chrome only initially.** Brave + Edge use the same extension runtime so they should work, but we're not committing to test all three until v1.1.
- **Same-origin auth requirement.** The extension calls `fetch('https://gg.linktree.bond/api/groups/:id/token-bundle', { credentials: 'include' })` to get tokens. This relies on the operator already having an active gg session cookie. If their gg cookie expires, the extension fetch returns 401 and they need to log into gg.linktree.bond first.
- **discord.com cookie jar conflict.** All accounts share the operator's single Chrome cookie jar. When activating @accountB while a @accountA cookie set is present, Discord receives both — the `localStorage.token` we write wins because it determines what the SPA identifies as, but Discord's gateway WS may see stale cookies on the first reconnect. Reload after write resolves it (Discord re-handshakes with the new token). This is acceptable for v1.
- **Chrome Web Store review takes 1–3 days.** For dev/test we'll sideload via Developer Mode → "Load unpacked". Production install ships after Web Store approval — flag this to the operator before any deploy claim.
- **Tokens leave the server only on explicit operator click.** No server-push, no background polling. The extension is dumb until told to act.

---

## Task 1: DB migration — `account_groups` + `account_group_members`

**Files:**
- Create: `db/migrations/0012_account_groups.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0012_account_groups.sql
-- Operator-created groupings of captured Discord accounts for the GG browser
-- extension. A group is the unit the extension fetches as a token bundle and
-- renders as a row of "Activate" buttons.
SET search_path = tenant_main;

CREATE TABLE IF NOT EXISTS account_groups (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  -- Operator notes, e.g. "Poker outreach pool" or "Gaming socials".
  description text DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_group_members (
  group_id   text NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  -- Display order within the group's UI row. Lower = leftmost.
  position   int  NOT NULL DEFAULT 0,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_agm_account ON account_group_members(account_id);
```

- [ ] **Step 2: Apply the migration to the live DB**

```bash
psql "$DATABASE_URL" -f db/migrations/0012_account_groups.sql
```

Expected: `CREATE TABLE` × 2 + `CREATE INDEX` × 1, no errors. If `tenant_main` schema doesn't exist locally, copy the schema setup from `0001_*.sql`.

- [ ] **Step 3: Verify shape**

```bash
psql "$DATABASE_URL" -c "\\d tenant_main.account_groups"
psql "$DATABASE_URL" -c "\\d tenant_main.account_group_members"
```

Expected: both tables exist with the columns above.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0012_account_groups.sql
git commit -m "v0.30: account_groups + account_group_members tables"
```

---

## Task 2: Backend types

**Files:**
- Modify: `app/server/api-types.ts` — add new types

- [ ] **Step 1: Append type definitions**

At the bottom of `app/server/api-types.ts` (before any trailing exports), add:

```typescript
// ───── Account Groups (browser-extension multi-account) ──────────────────────
// An AccountGroup is a manual operator-defined bundle of captured accounts.
// The GG browser extension fetches a group as a token bundle and renders
// "Activate" buttons for each member. There is NO Discord-imposed limit on
// group size — we let the operator pick — though ~5-10 keeps the row visually
// scannable.
export interface AccountGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface AccountGroupMember {
  accountId: string;
  position: number;
  addedAt: string;
}

export interface AccountGroupWithMembers extends AccountGroup {
  members: AccountGroupMember[];
}

// Returned by GET /api/groups/:id/token-bundle. The extension holds this in
// service-worker memory only and writes one token at a time to
// localStorage.token on discord.com. Tokens are full master credentials —
// never log this payload.
export interface AccountTokenEntry {
  accountId: string;
  username: string;
  label: string;
  token: string;
}

export interface GroupTokenBundle {
  groupId: string;
  groupName: string;
  fetchedAt: string;
  entries: AccountTokenEntry[];
}
```

- [ ] **Step 2: Mirror to frontend**

In `app/src/api-types.ts`, add the same four type blocks at the bottom (excluding `AccountTokenEntry` / `GroupTokenBundle` — frontend never reads the bundle; only the extension does).

```typescript
// ───── Account Groups (browser-extension multi-account) ──────────────────────
export interface AccountGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface AccountGroupMember {
  accountId: string;
  position: number;
  addedAt: string;
}

export interface AccountGroupWithMembers extends AccountGroup {
  members: AccountGroupMember[];
}
```

- [ ] **Step 3: Type-check both sides**

```bash
cd app/server && npx tsc --noEmit -p tsconfig.json
cd ../ && npx tsc -p tsconfig.app.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/server/api-types.ts app/src/api-types.ts
git commit -m "v0.30: type defs for AccountGroup + token bundle"
```

---

## Task 3: DB helpers for groups

**Files:**
- Modify: `app/server/db.ts`

- [ ] **Step 1: Add helpers**

Append to `app/server/db.ts`:

```typescript
// ───── Account Groups ───────────────────────────────────────────────────────
import type { AccountGroup, AccountGroupMember, AccountGroupWithMembers } from './api-types';

function rowToGroup(r: any): AccountGroup {
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function listGroups(): Promise<AccountGroupWithMembers[]> {
  const groupRows = await query<any>(
    'SELECT id, name, description, created_at FROM tenant_main.account_groups ORDER BY created_at ASC',
  );
  const memberRows = await query<any>(
    'SELECT group_id, account_id, position, added_at FROM tenant_main.account_group_members ORDER BY position ASC',
  );
  const membersByGroup = new Map<string, AccountGroupMember[]>();
  for (const m of memberRows) {
    const list = membersByGroup.get(m.group_id) || [];
    list.push({
      accountId: m.account_id,
      position: Number(m.position) || 0,
      addedAt: m.added_at instanceof Date ? m.added_at.toISOString() : String(m.added_at),
    });
    membersByGroup.set(m.group_id, list);
  }
  return groupRows.map((g) => ({
    ...rowToGroup(g),
    members: membersByGroup.get(g.id) || [],
  }));
}

export async function getGroup(id: string): Promise<AccountGroupWithMembers | null> {
  const rows = await query<any>(
    'SELECT id, name, description, created_at FROM tenant_main.account_groups WHERE id = $1',
    [id],
  );
  if (rows.length === 0) return null;
  const members = await query<any>(
    'SELECT account_id, position, added_at FROM tenant_main.account_group_members WHERE group_id = $1 ORDER BY position ASC',
    [id],
  );
  return {
    ...rowToGroup(rows[0]),
    members: members.map((m) => ({
      accountId: m.account_id,
      position: Number(m.position) || 0,
      addedAt: m.added_at instanceof Date ? m.added_at.toISOString() : String(m.added_at),
    })),
  };
}

export async function createGroup(group: Omit<AccountGroup, 'createdAt'>): Promise<void> {
  await query(
    'INSERT INTO tenant_main.account_groups (id, name, description) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    [group.id, group.name, group.description || ''],
  );
}

export async function updateGroup(id: string, name: string, description: string): Promise<void> {
  await query(
    'UPDATE tenant_main.account_groups SET name = $2, description = $3 WHERE id = $1',
    [id, name, description],
  );
}

export async function deleteGroup(id: string): Promise<void> {
  await query('DELETE FROM tenant_main.account_groups WHERE id = $1', [id]);
}

export async function addAccountToGroup(groupId: string, accountId: string, position: number): Promise<void> {
  await query(
    'INSERT INTO tenant_main.account_group_members (group_id, account_id, position) VALUES ($1, $2, $3) ON CONFLICT (group_id, account_id) DO NOTHING',
    [groupId, accountId, position],
  );
}

export async function removeAccountFromGroup(groupId: string, accountId: string): Promise<void> {
  await query(
    'DELETE FROM tenant_main.account_group_members WHERE group_id = $1 AND account_id = $2',
    [groupId, accountId],
  );
}

export async function reorderGroupMembers(groupId: string, accountIdsInOrder: string[]): Promise<void> {
  for (let i = 0; i < accountIdsInOrder.length; i++) {
    await query(
      'UPDATE tenant_main.account_group_members SET position = $3 WHERE group_id = $1 AND account_id = $2',
      [groupId, accountIdsInOrder[i], i],
    );
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd app/server && npx tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/server/db.ts
git commit -m "v0.30: db helpers for account_groups CRUD"
```

---

## Task 4: Backend route module — `groups.ts`

**Files:**
- Create: `app/server/groups.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * Account-groups API routes.
 *
 * Groups bundle captured Discord accounts together for the GG browser
 * extension to switch between in the operator's real browser. Each group
 * exposes a token-bundle endpoint that returns the bare tokens for every
 * member — the extension holds those in service-worker memory only.
 *
 * Routes:
 *   GET    /api/groups                       → AccountGroupWithMembers[]
 *   POST   /api/groups                       → AccountGroupWithMembers
 *   GET    /api/groups/:id                   → AccountGroupWithMembers
 *   PATCH  /api/groups/:id                   → AccountGroupWithMembers
 *   DELETE /api/groups/:id                   → { ok: true }
 *   POST   /api/groups/:id/members           → AccountGroupWithMembers
 *   DELETE /api/groups/:id/members/:accountId → AccountGroupWithMembers
 *   PUT    /api/groups/:id/members/order     → AccountGroupWithMembers
 *   GET    /api/groups/:id/token-bundle      → GroupTokenBundle  (extension-only)
 */
import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import * as db from './db';
import { _getCapturedToken, state as discordMockState } from './discord-mock';
import type { GroupTokenBundle, AccountTokenEntry } from './api-types';

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
    const g = await db.getGroup(req.params.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    res.json(g);
  });

  app.patch('/api/groups/:id', async (req: Request, res: Response) => {
    const existing = await db.getGroup(req.params.id);
    if (!existing) return res.status(404).json({ error: 'group not found' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    const description = req.body?.description !== undefined ? String(req.body.description).slice(0, 500) : existing.description;
    await db.updateGroup(req.params.id, name, description);
    res.json(await db.getGroup(req.params.id));
  });

  app.delete('/api/groups/:id', async (req: Request, res: Response) => {
    await db.deleteGroup(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/groups/:id/members', async (req: Request, res: Response) => {
    const accountId = String(req.body?.accountId || '');
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    const group = await db.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'group not found' });
    if (group.members.some((m) => m.accountId === accountId)) {
      return res.status(409).json({ error: 'account already in group' });
    }
    const position = group.members.length;
    await db.addAccountToGroup(req.params.id, accountId, position);
    res.json(await db.getGroup(req.params.id));
  });

  app.delete('/api/groups/:id/members/:accountId', async (req: Request, res: Response) => {
    await db.removeAccountFromGroup(req.params.id, req.params.accountId);
    res.json(await db.getGroup(req.params.id));
  });

  app.put('/api/groups/:id/members/order', async (req: Request, res: Response) => {
    const order: string[] = Array.isArray(req.body?.accountIds) ? req.body.accountIds.map(String) : [];
    if (order.length === 0) return res.status(400).json({ error: 'accountIds required' });
    await db.reorderGroupMembers(req.params.id, order);
    res.json(await db.getGroup(req.params.id));
  });

  // Token bundle — the ONE endpoint the extension calls. We deliberately do
  // not log this response. We resolve username + label from in-memory state
  // so the extension can render labels without a second round-trip.
  app.get('/api/groups/:id/token-bundle', async (req: Request, res: Response) => {
    const group = await db.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'group not found' });
    const entries: AccountTokenEntry[] = [];
    for (const m of group.members) {
      const token = _getCapturedToken(m.accountId);
      if (!token) continue;
      const acct = discordMockState.accounts.find((a) => a.id === m.accountId);
      entries.push({
        accountId: m.accountId,
        username: acct?.username || m.accountId,
        label: acct?.label || acct?.username || m.accountId,
        token,
      });
    }
    const bundle: GroupTokenBundle = {
      groupId: group.id,
      groupName: group.name,
      fetchedAt: new Date().toISOString(),
      entries,
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(bundle);
  });
}
```

- [ ] **Step 2: Wire into `index.ts`**

In `app/server/index.ts`, find the existing `app.use(...)` middleware block near the top and add the import + registration. Around line 50–60 (where other imports live), add:

```typescript
import { registerGroupRoutes } from './groups';
```

Then near the bottom of the route-registration section (after the conversations routes), add:

```typescript
registerGroupRoutes(app);
```

- [ ] **Step 3: Type-check**

```bash
cd app/server && npx tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Smoke-test endpoints (after rebuild)**

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"name":"Smoke group","description":"test"}' \
  'http://localhost:4000/api/groups' | jq .
curl -s 'http://localhost:4000/api/groups' | jq .
```

Expected: a single group returned with no members.

- [ ] **Step 5: Commit**

```bash
git add app/server/groups.ts app/server/index.ts
git commit -m "v0.30: /api/groups routes + token-bundle endpoint"
```

---

## Task 5: Frontend nav + route

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add the route**

In `app/src/App.tsx`, find the Routes block. Add:

```tsx
<Route path="/app/sessions" element={<BrowserSessions />} />
```

And import at the top:

```tsx
import BrowserSessions from "./pages/BrowserSessions"
```

- [ ] **Step 2: Add the sidebar item**

In `app/src/components/layout/Sidebar.tsx`, find the existing nav items (Unibox, Accounts, Campaigns, etc) and add a new one between Accounts and Campaigns:

```tsx
{ to: "/app/sessions", label: "Browser sessions", icon: <Globe className="h-4 w-4" /> },
```

Adjust the import: `import { ... Globe ... } from "lucide-react"`.

- [ ] **Step 3: Stub the page so the route resolves**

Create `app/src/pages/BrowserSessions.tsx` with a minimal placeholder so the route renders (we flesh it out in Task 6):

```tsx
export default function BrowserSessions() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Browser sessions</h1>
      <p className="text-sm text-muted-foreground mt-1">Loading…</p>
    </div>
  )
}
```

- [ ] **Step 4: Type-check + load**

```bash
cd app && npx tsc -p tsconfig.app.json --noEmit
npm run build
```

Expected: no errors. Browse to `/app/sessions` and see the placeholder.

- [ ] **Step 5: Commit**

```bash
git add app/src/App.tsx app/src/components/layout/Sidebar.tsx app/src/pages/BrowserSessions.tsx
git commit -m "v0.30: /app/sessions route + sidebar nav (stub page)"
```

---

## Task 6: BrowserSessions page — list + create groups

**Files:**
- Modify: `app/src/pages/BrowserSessions.tsx`

- [ ] **Step 1: Rewrite with full list/create UI**

Replace the placeholder with:

```tsx
import { useCallback, useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AccountGroupWithMembers, DiscordAccount } from "@/api-types"
import GroupCard from "./sessions/GroupCard"

export default function BrowserSessions() {
  const [groups, setGroups] = useState<AccountGroupWithMembers[]>([])
  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [gRes, aRes] = await Promise.all([
        fetch("/api/groups").then((r) => r.json()),
        fetch("/api/accounts").then((r) => r.json()),
      ])
      setGroups(Array.isArray(gRes) ? gRes : [])
      setAccounts(Array.isArray(aRes) ? aRes : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const createGroup = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await fetch("/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
      setNewName("")
      await refresh()
    } finally {
      setCreating(false)
    }
  }

  const deleteGroup = async (id: string) => {
    if (!confirm("Delete this group? Accounts themselves are not deleted.")) return
    await fetch(`/api/groups/${id}`, { method: "DELETE" })
    await refresh()
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Browser sessions</h1>
      </div>
      <p className="text-[12px] text-muted-foreground mb-5">
        Group captured accounts here, then click any "Activate" button to load that account in your
        real Chrome via the GG extension. Tokens are fetched on demand and held only in the
        extension's memory.
      </p>

      <div className="mb-6 flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Group name (e.g. Poker outreach)"
          className="max-w-sm"
        />
        <Button onClick={createGroup} disabled={creating || !newName.trim()}>
          <Plus className="h-4 w-4" /> New group
        </Button>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!loading && groups.length === 0 && (
        <div className="rounded-md border border-dashed border-input p-8 text-center text-sm text-muted-foreground">
          No groups yet. Create one above to start grouping accounts.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            accounts={accounts}
            onChange={refresh}
            onDelete={() => deleteGroup(g.id)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd app && npx tsc -p tsconfig.app.json --noEmit
```

Expected: error on missing `GroupCard` import — that's fine, we create it next task.

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/BrowserSessions.tsx
git commit -m "v0.30: BrowserSessions page list/create UI (GroupCard pending)"
```

---

## Task 7: `GroupCard` + add/remove members + activate buttons

**Files:**
- Create: `app/src/pages/sessions/GroupCard.tsx`
- Create: `app/src/pages/sessions/AddAccountPicker.tsx`

- [ ] **Step 1: Write GroupCard**

```tsx
// app/src/pages/sessions/GroupCard.tsx
import { useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AccountGroupWithMembers, DiscordAccount } from "@/api-types"
import AddAccountPicker from "./AddAccountPicker"

// Chrome extension id of the published GG extension. Until we publish to the
// Web Store, this is the ID of the sideloaded unpacked extension — which is
// derived from the public key in extension/manifest.json. The operator's
// install will print this id; we store it in localStorage for subsequent
// sessions. See extension/README.md for the install procedure.
const EXTENSION_ID_KEY = "gg-extension-id"

function activateAccount(groupId: string, accountId: string): { ok: boolean; reason?: string } {
  const extensionId = localStorage.getItem(EXTENSION_ID_KEY) || ""
  if (!extensionId) {
    return { ok: false, reason: "Extension not configured — see Setup instructions on this page." }
  }
  const chrome = (window as any).chrome
  if (!chrome?.runtime?.sendMessage) {
    return { ok: false, reason: "chrome.runtime not available — install the GG extension in Chrome/Brave/Edge." }
  }
  try {
    chrome.runtime.sendMessage(extensionId, { type: "activate", groupId, accountId }, (response: any) => {
      if (chrome.runtime.lastError) {
        console.warn("[gg] activate error:", chrome.runtime.lastError.message)
        return
      }
      console.log("[gg] activate response:", response)
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

export default function GroupCard({
  group, accounts, onChange, onDelete,
}: {
  group: AccountGroupWithMembers
  accounts: DiscordAccount[]
  onChange: () => void | Promise<void>
  onDelete: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activateStatus, setActivateStatus] = useState<Record<string, string>>({})

  const memberAccounts = group.members
    .map((m) => ({ ...m, account: accounts.find((a) => a.id === m.accountId) }))
    .filter((m) => m.account)
  const availableAccounts = accounts.filter(
    (a) => !group.members.some((m) => m.accountId === a.id),
  )

  const removeMember = async (accountId: string) => {
    await fetch(`/api/groups/${group.id}/members/${accountId}`, { method: "DELETE" })
    await onChange()
  }

  const onActivate = (accountId: string) => {
    const result = activateAccount(group.id, accountId)
    setActivateStatus((s) => ({ ...s, [accountId]: result.ok ? "✓ Activating…" : `× ${result.reason}` }))
    window.setTimeout(() => {
      setActivateStatus((s) => {
        const next = { ...s }
        delete next[accountId]
        return next
      })
    }, 4000)
  }

  return (
    <div className="rounded-card border border-bg-tertiary bg-bg-secondary p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{group.name}</h2>
          <p className="text-[11px] text-muted-foreground">
            {group.members.length} account{group.members.length === 1 ? "" : "s"} ·{" "}
            {group.description || "no description"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} disabled={availableAccounts.length === 0}>
            <Plus className="h-3.5 w-3.5" /> Add account
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} className="text-red hover:bg-red/10 hover:text-red">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {memberAccounts.length === 0 ? (
        <div className="rounded-md border border-dashed border-input p-4 text-center text-xs text-muted-foreground">
          No accounts in this group. Click "Add account" to pick from your captured accounts.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {memberAccounts.map((m) => (
            <li key={m.accountId} className="flex items-center justify-between gap-2 rounded-md border border-bg-tertiary bg-bg-tertiary/30 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">@{m.account!.username}</div>
                <div className="text-[10px] text-muted-foreground">{m.account!.label || ""}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activateStatus[m.accountId] && (
                  <span className={cn("text-[10px]", activateStatus[m.accountId]?.startsWith("×") ? "text-red" : "text-emerald-500")}>
                    {activateStatus[m.accountId]}
                  </span>
                )}
                <Button size="sm" onClick={() => onActivate(m.accountId)}>
                  Activate
                </Button>
                <button
                  type="button"
                  onClick={() => removeMember(m.accountId)}
                  aria-label="Remove from group"
                  className="text-muted-foreground hover:text-red"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pickerOpen && (
        <AddAccountPicker
          groupId={group.id}
          available={availableAccounts}
          onClose={() => setPickerOpen(false)}
          onAdded={async () => { setPickerOpen(false); await onChange() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write AddAccountPicker**

```tsx
// app/src/pages/sessions/AddAccountPicker.tsx
import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DiscordAccount } from "@/api-types"

export default function AddAccountPicker({
  groupId, available, onClose, onAdded,
}: {
  groupId: string
  available: DiscordAccount[]
  onClose: () => void
  onAdded: () => void | Promise<void>
}) {
  const [adding, setAdding] = useState<string | null>(null)

  const add = async (accountId: string) => {
    setAdding(accountId)
    try {
      await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      })
      await onAdded()
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card border border-bg-tertiary bg-bg-floating p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Add account to group</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">No more accounts available — every captured account is already in this group.</p>
        ) : (
          <ul className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {available.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2">
                <div>
                  <div className="text-[13px] font-medium">@{a.username}</div>
                  <div className="text-[10px] text-muted-foreground">{a.label || ""}</div>
                </div>
                <Button size="sm" disabled={adding === a.id} onClick={() => add(a.id)}>
                  {adding === a.id ? "Adding…" : "Add"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check + build**

```bash
cd app && npx tsc -p tsconfig.app.json --noEmit && npm run build
```

Expected: no errors. Build emits.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/sessions/
git commit -m "v0.30: GroupCard + AddAccountPicker (member CRUD + Activate buttons)"
```

---

## Task 8: Extension scaffold

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/build.sh`
- Create: `extension/README.md`

- [ ] **Step 1: Manifest**

```json
{
  "manifest_version": 3,
  "name": "GG Account Switcher",
  "version": "0.1.0",
  "description": "Switch between captured Discord accounts via gg.linktree.bond.",
  "permissions": ["storage", "scripting", "tabs", "alarms"],
  "host_permissions": ["https://discord.com/*", "https://gg.linktree.bond/*"],
  "externally_connectable": {
    "matches": ["https://gg.linktree.bond/*"]
  },
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["https://discord.com/*"],
    "js": ["content-script.js"],
    "run_at": "document_start"
  }],
  "action": { "default_popup": "popup.html", "default_title": "GG Account Switcher" },
  "options_page": "options.html"
}
```

- [ ] **Step 2: Build tooling**

`extension/package.json`:

```json
{
  "name": "gg-extension",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "bash build.sh",
    "watch": "esbuild background.ts content-script.ts options.ts popup.ts --bundle --outdir=dist --target=chrome120 --format=esm --watch"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "typescript": "^5.5.0"
  }
}
```

`extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": ["chrome"]
  },
  "include": ["*.ts"]
}
```

`extension/build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist
npx esbuild background.ts content-script.ts options.ts popup.ts \
  --bundle --outdir=dist --target=chrome120 --format=esm
cp manifest.json dist/
cp options.html dist/
cp popup.html dist/
echo "Built to extension/dist/ — load this folder via chrome://extensions → Load unpacked"
```

`chmod +x extension/build.sh`.

- [ ] **Step 3: README**

```markdown
# GG Account Switcher

Chrome/Brave/Edge extension that pairs with [gg.linktree.bond](https://gg.linktree.bond)
to switch between captured Discord accounts.

## Install (development, sideload)

1. Clone this repo, then:
   ```bash
   cd extension
   npm install
   ./build.sh
   ```
2. Open `chrome://extensions`.
3. Toggle **Developer mode** in the top-right.
4. Click **Load unpacked** and select `extension/dist/`.
5. Copy the extension ID Chrome assigns.
6. Open gg.linktree.bond → Browser sessions page → Setup → paste the ID.

## How it works

- The extension keeps **no persistent token storage**.
- When you click "Activate @account" in gg, the web app posts a message to the extension.
- Extension calls `https://gg.linktree.bond/api/groups/:id/token-bundle` using your gg session cookie.
- It picks the token for that one account and writes it to `localStorage.token` on your discord.com tab.
- Reloads the tab. You're logged in as that account.
- Browser close → tokens evicted from extension memory.

## Permissions explained

| Permission | Why |
|------------|-----|
| `storage` | Saves only the extension settings (gg URL). No tokens persisted. |
| `scripting` | Inject the token-write script into discord.com. |
| `tabs` | Find your discord.com tab to inject into. |
| `host_permissions: discord.com` | Needed to write to discord.com's localStorage. |
| `host_permissions: gg.linktree.bond` | Fetch the token bundle from gg using your session cookie. |
| `externally_connectable: gg.linktree.bond` | Accept "activate" messages only from gg. |
```

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json extension/package.json extension/tsconfig.json extension/build.sh extension/README.md
git commit -m "v0.30: extension scaffold (manifest, build, README)"
```

---

## Task 9: Extension background service worker

**Files:**
- Create: `extension/background.ts`

- [ ] **Step 1: Write the service worker**

```typescript
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
const GG_ORIGIN_DEFAULT = "https://gg.linktree.bond";

async function getGgOrigin(): Promise<string> {
  const stored = await chrome.storage.local.get(GG_ORIGIN_KEY);
  return stored[GG_ORIGIN_KEY] || GG_ORIGIN_DEFAULT;
}

async function fetchBundle(groupId: string): Promise<TokenBundle> {
  const now = Date.now();
  const cached = cache.get(groupId);
  if (cached && now - cached.cachedAtMs < CACHE_TTL_MS) return cached.bundle;

  const origin = await getGgOrigin();
  const r = await fetch(`${origin}/api/groups/${encodeURIComponent(groupId)}/token-bundle`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`fetch ${groupId} token bundle: HTTP ${r.status} (are you logged into gg?)`);
  const bundle = (await r.json()) as TokenBundle;
  cache.set(groupId, { bundle, cachedAtMs: now });
  return bundle;
}

async function findOrCreateDiscordTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ url: "https://discord.com/*" });
  if (tabs.length > 0) return tabs[0];
  return await chrome.tabs.create({ url: "https://discord.com/channels/@me", active: true });
}

async function writeTokenAndReload(tabId: number, token: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (t: string) => {
      try { window.localStorage.setItem("token", JSON.stringify(t)); } catch {}
    },
    args: [token],
  });
  await chrome.tabs.reload(tabId);
}

interface ActivateMessage { type: "activate"; groupId: string; accountId: string }
interface PingMessage { type: "ping" }
type IncomingMessage = ActivateMessage | PingMessage;

// Messages from gg.linktree.bond (externally_connectable). We deliberately
// do NOT accept any other senders.
chrome.runtime.onMessageExternal.addListener((msg: IncomingMessage, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "ping") {
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
        return;
      }
      if (msg.type === "activate") {
        const bundle = await fetchBundle(msg.groupId);
        const entry = bundle.entries.find((e) => e.accountId === msg.accountId);
        if (!entry) { sendResponse({ ok: false, error: "account not in group bundle" }); return; }
        const tab = await findOrCreateDiscordTab();
        if (!tab.id) { sendResponse({ ok: false, error: "no discord tab id" }); return; }
        await writeTokenAndReload(tab.id, entry.token);
        sendResponse({ ok: true, accountId: msg.accountId, username: entry.username });
        return;
      }
      sendResponse({ ok: false, error: "unknown message type" });
    } catch (err: any) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true; // async sendResponse
});
```

- [ ] **Step 2: Build and verify the bundle**

```bash
cd extension && npm install && ./build.sh
ls dist/
```

Expected: `manifest.json`, `background.js`, `content-script.js`, `options.html`, `options.js`, `popup.html`, `popup.js` in `dist/` (the .ts files we haven't written yet will produce empty .js stubs — that's fine for this task).

- [ ] **Step 3: Commit**

```bash
git add extension/background.ts
git commit -m "v0.30: extension background service worker (activate + token-bundle fetch)"
```

---

## Task 10: Content script + options + popup

**Files:**
- Create: `extension/content-script.ts`
- Create: `extension/options.html`
- Create: `extension/options.ts`
- Create: `extension/popup.html`
- Create: `extension/popup.ts`

- [ ] **Step 1: Content script (minimal — most work happens via executeScript)**

```typescript
// extension/content-script.ts
// We don't actually need a persistent content script — the activate flow uses
// chrome.scripting.executeScript injected on demand. This file exists only so
// chrome shows the extension as "active" on discord.com tabs. Console log so
// the operator can confirm install when troubleshooting.
console.log("[GG Account Switcher] content script loaded on", location.host);
```

- [ ] **Step 2: Options page**

`extension/options.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GG Account Switcher — Options</title>
  <style>
    body { font: 13px/1.4 -apple-system, system-ui, sans-serif; padding: 24px; max-width: 480px; color: #ddd; background: #1f1f23; }
    label { display: block; margin-top: 12px; font-weight: 600; }
    input[type=text] { width: 100%; padding: 6px 8px; background: #2a2a30; color: #fff; border: 1px solid #3a3a40; border-radius: 4px; }
    button { margin-top: 12px; padding: 6px 12px; background: #5865F2; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
    .ok { color: #4ade80; }
    .err { color: #ef4444; }
    .muted { color: #888; }
  </style>
</head>
<body>
  <h1>GG Account Switcher</h1>
  <p class="muted">This extension switches your Discord browser session between captured accounts on gg.linktree.bond.</p>
  <label for="origin">gg origin URL</label>
  <input id="origin" type="text" placeholder="https://gg.linktree.bond">
  <button id="save">Save</button>
  <span id="status"></span>
  <p class="muted" style="margin-top:18px">No tokens are stored by this extension. They're fetched on demand from the URL above using your existing browser session cookie.</p>
  <script type="module" src="options.js"></script>
</body>
</html>
```

`extension/options.ts`:

```typescript
const GG_ORIGIN_KEY = "gg-origin";
const GG_ORIGIN_DEFAULT = "https://gg.linktree.bond";

const input = document.getElementById("origin") as HTMLInputElement;
const status = document.getElementById("status")!;

chrome.storage.local.get(GG_ORIGIN_KEY).then((s) => {
  input.value = s[GG_ORIGIN_KEY] || GG_ORIGIN_DEFAULT;
});

document.getElementById("save")!.addEventListener("click", async () => {
  const v = input.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(v)) {
    status.textContent = "× Must start with http:// or https://";
    status.className = "err";
    return;
  }
  await chrome.storage.local.set({ [GG_ORIGIN_KEY]: v });
  status.textContent = "✓ Saved";
  status.className = "ok";
});
```

- [ ] **Step 3: Popup**

`extension/popup.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font: 13px/1.4 -apple-system, system-ui, sans-serif; width: 240px; padding: 12px; color: #ddd; background: #1f1f23; }
    .ok { color: #4ade80; }
    .err { color: #ef4444; }
    a { color: #5865F2; }
  </style>
</head>
<body>
  <strong>GG Account Switcher</strong>
  <p id="status" class="muted">Checking…</p>
  <p><a href="#" id="open-gg">Open gg.linktree.bond</a></p>
  <p><a href="#" id="open-options">Settings</a></p>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

`extension/popup.ts`:

```typescript
const status = document.getElementById("status")!;

async function checkSession() {
  try {
    const { "gg-origin": origin = "https://gg.linktree.bond" } = await chrome.storage.local.get("gg-origin");
    const r = await fetch(`${origin}/api/groups`, { credentials: "include" });
    if (r.ok) {
      status.textContent = "✓ Connected to gg.linktree.bond";
      status.className = "ok";
    } else if (r.status === 401) {
      status.textContent = "× Not logged into gg — open it and sign in.";
      status.className = "err";
    } else {
      status.textContent = `× gg HTTP ${r.status}`;
      status.className = "err";
    }
  } catch (err: any) {
    status.textContent = `× ${err?.message || "fetch failed"}`;
    status.className = "err";
  }
}

document.getElementById("open-gg")!.addEventListener("click", async (e) => {
  e.preventDefault();
  const { "gg-origin": origin = "https://gg.linktree.bond" } = await chrome.storage.local.get("gg-origin");
  chrome.tabs.create({ url: origin });
});
document.getElementById("open-options")!.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

void checkSession();
```

- [ ] **Step 4: Rebuild and verify dist/**

```bash
cd extension && ./build.sh
```

Expected: `dist/background.js`, `dist/content-script.js`, `dist/options.js`, `dist/popup.js`, plus the HTML + manifest copied in.

- [ ] **Step 5: Commit**

```bash
git add extension/content-script.ts extension/options.html extension/options.ts extension/popup.html extension/popup.ts
git commit -m "v0.30: extension content script + options + popup"
```

---

## Task 11: Manual end-to-end smoke

**Files:** none

- [ ] **Step 1: Deploy backend with the new routes**

```bash
cd app && sudo docker build -f Dockerfile.backend -t gg-api:v0.30 .
sudo docker rm -f gg-api
sudo docker run -d --name gg-api --network coolify --restart unless-stopped \
  -e PORT=4000 -e NODE_ENV=production \
  -e DATABASE_URL="$DATABASE_URL" \
  -e WEBSHARE_PROXY_URL="$WEBSHARE_PROXY_URL" \
  -e TOKEN_ENCRYPTION_KEY="$TOKEN_ENCRYPTION_KEY" \
  -e TOKEN_STORE_DIR=/data/gg-api/tokens \
  -e DISPLAY=:99 -e PLAYWRIGHT_BROWSERS_PATH=0 \
  -v /data/gg-api:/data/gg-api \
  gg-api:v0.30
```

Then rsync the new frontend bundle:

```bash
cd app && npm run build && sudo rsync -a --delete dist/ /data/discord-unibox/landing/
```

Expected: `https://gg.linktree.bond/app/sessions` renders the Browser Sessions page.

- [ ] **Step 2: Create a group from the UI**

In Browser, go to `/app/sessions`. Type a group name. Click "New group". Add 2 accounts to it via "Add account".

Expected: the group card shows 2 member rows with "Activate" buttons.

- [ ] **Step 3: Install the extension**

```bash
cd extension && ./build.sh
```

Open `chrome://extensions` → enable Developer mode → Load unpacked → select `extension/dist/`. Copy the assigned extension ID (shown on the extension card).

In `/app/sessions`, open browser DevTools console and run:

```javascript
localStorage.setItem("gg-extension-id", "PASTE_EXTENSION_ID_HERE")
```

Reload the page.

- [ ] **Step 4: Activate an account**

Click "Activate" next to one of the members. Watch for:
- Browser briefly flashes (token write + reload)
- discord.com tab navigates / re-renders as the chosen account
- Extension popup (click the toolbar icon) shows "✓ Connected to gg.linktree.bond"

Expected: discord.com renders as the chosen account within ~3 seconds.

- [ ] **Step 5: Switch to a different account**

Click "Activate" on the second member. Same expectation.

Expected: discord.com re-renders as the second account.

- [ ] **Step 6: Record the result**

Append to `deploy/DEPLOYED.md` under a new v0.30 section:

```markdown
## v0.30 — Multi-account browser extension (date)

GG Account Switcher published as sideload extension; gg.linktree.bond grows a Browser Sessions tab. Operator's Chrome holds Discord cookies; tokens fetched on demand from gg, lived only in extension service-worker memory.

Verified live: created a group with 2 accounts, installed the extension, clicked Activate on each — discord.com reloaded as the right account in both cases.

Image: gg-api:v0.30 (db migration 0012 applied).
```

Commit.

```bash
git add deploy/DEPLOYED.md
git commit -m "v0.30: document multi-account browser extension"
```

---

## Self-review

**1. Spec coverage:**
- "save sessions on a browser not on the server" → Tokens never persist in extension storage (Task 9 in-memory only) ✓
- "tokens and legit methods" → just sets `localStorage.token`, same as Discord's own login (Task 9) ✓
- "clickable link" → Activate button per account in GroupCard (Task 7) ✓
- "switch 5 of them" → no actual limit; group size is operator's choice (Task 1 schema has no upper bound) ✓
- "Chrome Web Store" → README points at sideload for v0.1; Web Store listing is a follow-up (called out in honest-constraints up front) ✓
- "manual grouping" → AddAccountPicker + ordered membership (Tasks 6–7) ✓
- "push tokens up-front for faster switching" → bundle endpoint serves all tokens at once, extension caches 5 minutes (Task 9 CACHE_TTL_MS) ✓

**2. Placeholder scan:** none.

**3. Type/identifier consistency:**
- `AccountGroup`, `AccountGroupMember`, `AccountGroupWithMembers`, `AccountTokenEntry`, `GroupTokenBundle` — defined Task 2, used consistently in Tasks 3, 4, 6, 7, 9 ✓
- Endpoint paths — `/api/groups`, `/api/groups/:id/members`, `/api/groups/:id/token-bundle` — all match between Task 4 server, Task 6/7 frontend, Task 9 extension ✓
- Extension message types — `{ type: "activate", groupId, accountId }` and `{ type: "ping" }` — defined Task 9, called from Task 7 ✓
- `EXTENSION_ID_KEY = "gg-extension-id"` and `GG_ORIGIN_KEY = "gg-origin"` — consistent across Tasks 7, 9, 10 ✓
