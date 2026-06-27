# DuoPlus Full API Buildout — Implementation Plan

> Executes against the verified contract in `docs/superpowers/specs/duoplus-api-inventory.md`. REQUIRED SUB-SKILL: superpowers:test-driven-development.

**Goal:** Cover the entire DuoPlus API in the console: organization (proxies/groups), apps, cloud drive, device actions (ADB/root/sharing/SMS/reset/live/scan/details), automation, cloud numbers, and account/orders — reusing the Phase-1 foundation.

**Strategy:** First refactor the proxy to a modular, generic core so each new domain is a thin route file. Then build each domain as a vertical slice (proxy route → shared types → web client → web page + nav → tests), TDD, against the mock mirroring real shapes. Read-only list endpoints are live-verified; mutations are NOT exercised live.

---

## Architecture (established in Cluster 0)

### Proxy
- `proxy/src/core.ts` — exports `makeCaller(cfg)` returning `call<T>(path, body?) => Promise<T>` that: enforces per-path 1-QPS throttle, POSTs with auth + `Lang` headers, checks `res.ok` (throws `HttpStatusError`), unwraps the `{code,message,data}` envelope (throws `UpstreamError` if code!==200), returns `data`. Also exports `registerErrorHandler(app)` (the 401/429/502/500 mapping) and re-exports `HttpStatusError`, `UpstreamError`.
- `proxy/src/upstream.ts` — keeps the cloudPhone-specific raw types + `mapPhone`/`mapBatch` (used by the fleet routes). Envelope/error classes move to `core.ts`; `upstream.ts` re-imports them.
- `proxy/src/routes/<domain>.ts` — each exports `register<Domain>Routes(app, call)`. Domains: `cloudPhone` (existing list/power), `device` (info/root/share/sms/reset/live/scan/adb), `org` (proxy+group), `apps`, `drive`, `automation`, `cloudNumber`, `account`.
- `proxy/src/app.ts` — builds Fastify, registers error handler, creates `call = makeCaller(cfg)`, registers all route modules.

### Clean REST surface (what the web calls)
Each route unwraps the envelope and returns the upstream `data` (optionally light-mapped). Naming: `/api/<domain>/<resource>`. Examples: `/api/proxies` (GET list, POST add, etc.), `/api/groups`, `/api/apps/platform`, `/api/drive/files`, `/api/automation/templates`, `/api/numbers`, `/api/orders`, `/api/phones/:id/adb`, `/api/phones/root`, etc. Pagination passes through `page`/`pageSize` → upstream `page`/`pagesize`.

### Web
- `web/src/api/<domain>.ts` — typed client functions (one per endpoint) using `apiFetch`.
- `web/src/lib/usePaginatedList.ts` — generic hook wrapping useQuery for `{list,total,page}` endpoints.
- `web/src/components/DataTable.tsx` — generic columns+rows table (reused across pages).
- `web/src/components/BatchResultToast.tsx` — renders `{success,fail}` summaries.
- `web/src/features/<domain>/<Domain>Page.tsx` — page; add a `<NavLink>` in `Layout.tsx` and a `<Route>` in `App.tsx`.
- Shared types for each domain in `shared/src/index.ts` (or `shared/src/<domain>.ts` re-exported from index).

### Mock
- `mock-server/src/server.ts` grows endpoints mirroring each real path with realistic seed data, so proxy integration tests and local dev work without the live key.

---

## Cluster 0 — Proxy core refactor (infra, no new features)

- Extract `core.ts` (`makeCaller`, `registerErrorHandler`, error classes) from `app.ts`.
- Rewrite `app.ts` to use them; existing `/api/phones*` routes move into `proxy/src/routes/cloudPhone.ts` as `registerCloudPhoneRoutes(app, call)`.
- All existing proxy tests must still pass (adjust imports only; behavior identical). Add a `core.test.ts` covering throttle spacing (two calls to same path are ≥ the interval apart) and envelope unwrap/HTTP-error throwing.
- Commit: `refactor(proxy): modular core caller + route modules`.

## Cluster 1 — Organization: Proxies + Groups

- Proxy routes (`routes/org.ts`): `/api/proxies` GET(list)/POST(add)/DELETE-style POST(`/api/proxies/delete`)/`/api/proxies/refresh`/`/api/proxies/update`; `/api/groups` GET(list)/create/edit/delete + `/api/groups/assign` (addToGroup) + `/api/groups/move` (moveToGroup).
- Shared types: `Proxy`, `Group`, plus existing `Paginated`.
- Web: `ProxiesPage` (table + add form + delete/refresh/modify), `GroupsPage` (table + create/edit/delete). Nav links.
- Fleet integration: add "Move to group" to the fleet batch bar (calls `/api/groups/move`).
- Mock + tests. Commit per page area.

## Cluster 2 — Apps + Cloud Drive

- Proxy routes (`routes/apps.ts`, `routes/drive.ts`): app platform/team lists, install/uninstall/start/stop, installedList; drive list/push/delete; upload signed-URL mint (`/api/drive/upload-url`) — the actual OSS PUT is done client-side or documented as a follow-up (mark clearly).
- Shared types: `AppItem`, `DriveFile`.
- Web: `AppsPage` (catalog + install to selected phones), `DrivePage` (file list + push + delete). Fleet batch bar: "Install app". Nav links.
- Mock + tests.

## Cluster 3 — Device actions (drawer deepening + batch)

- Proxy routes (`routes/device.ts`): `/api/phones/:id` (info), `/api/phones/root` (batchRoot), `/api/phones/share`, `/api/phones/share-password`, `/api/phones/write-sms`, `/api/phones/reset` (newPhone), `/api/phones/live`, `/api/phones/scan`, `/api/phones/adb` (command), `/api/phones/adb/enable` (openAdb), `/api/phones/adb/disable` (closeAdb), `/api/phones/members` (linkUserList).
- Web: enrich `DeviceDrawer` with tabs — Details (info), ADB console (command runner + enable/disable + UIAutomator dump + hideAccb buttons), Actions (set root, reset, share, write SMS). Fleet batch bar: set root, enable/disable ADB.
- The drawer currently renders from list data; the Details tab fetches `/api/phones/:id` (info) lazily for the rich fields.
- Mock + tests.

## Cluster 4 — Automation

- Proxy routes (`routes/automation.ts`): templates (custom/official), scheduled `taskList`, loop `planList`, `addTask`, `addPlan`, `setPlanStatus`, `deletePlan`, `taskLogList`, `setTaskStatus`, `updateTaskTime`.
- Web: `AutomationPage` with two tabs (Scheduled tasks, Loop tasks) + Templates list; create-task drawer; pause/execute/delete actions; task report viewer. Nav link.
- Note required date range for `taskList` (default to last 30 days). Mock + tests.

## Cluster 5 — CloudNumber + Account/Orders + Subscription

- Proxy routes (`routes/account.ts`, `routes/cloudNumber.ts`): numbers list/SMS/package/purchase/renew; team order list; subscription list/purchase/renew.
- Web: `NumbersPage` (list + SMS drawer), `OrdersPage` (order history with required date range), `SubscriptionsPage` (list). Nav links.
- Mock + tests.

---

## Done criteria
- `npm test` green across all packages; `npm run build -w web` clean.
- Every endpoint in the inventory is reachable through the proxy and surfaced in some UI control.
- Live read-only verification of the new list endpoints (proxies, groups, apps, drive, numbers, templates, orders) through the proxy.
- All mutations gated behind explicit user action in the UI; nothing destructive auto-runs.
