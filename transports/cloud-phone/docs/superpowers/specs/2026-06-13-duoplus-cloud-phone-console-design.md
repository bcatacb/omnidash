# DuoPlus Cloud Phone Console — Design Spec

**Date:** 2026-06-13
**Status:** Approved (design)
**Author:** brainstorming session

## 1. Purpose

A single-user web dashboard that leverages the [DuoPlus API](https://help.duoplus.net/docs/api-reference)
to its fullest extent, centered on **cloud phone** fleet management. DuoPlus is a
cloud-phone platform (remote virtual Android devices). The console makes the cloud
phone the hub and pulls in every adjacent capability that serves it: groups, proxies,
apps, cloud drive, automation/RPA, CloudNumber (SMS), and account/orders.

### Goals
- Manage a fleet of cloud phones from one screen (status, power, config).
- Make every batch operation the DuoPlus API exposes available through a batch-first UI.
- Reflect live device state via polling.
- Cover the full API surface, prioritizing anything touching cloud phones.

### Non-goals
- Multi-user / roles / multi-tenant (single operator, single API key).
- Mobile-native app (responsive web is enough).
- Reimplementing DuoPlus business logic; we are a client over its API.

## 2. Architecture

A **React + Vite + TypeScript SPA** plus a **thin Node backend proxy**.

```
Browser (React SPA) ──/api/*──► Node proxy (holds API key) ──► DuoPlus API
```

The proxy is required because the DuoPlus API key is a secret (cannot live in browser
code) and the API is not expected to permit direct browser/CORS calls. Proxy
responsibilities:

- Hold the API key in an env var; attach DuoPlus auth to every outbound request.
- Forward `/api/*` to the DuoPlus base URL — a single choke point. The browser never
  knows the real DuoPlus URL.
- Centralize batch handling, polling fan-out, and rate-limit backoff.
- Light server-side cache for slow-changing reference data (tags, resolutions, groups,
  resource list).

### Stack
- **Frontend:** React + Vite + TypeScript.
- **Server state / polling:** TanStack Query (React Query).
- **Routing:** React Router.
- **Styling:** Tailwind CSS.
- **Local UI state:** Zustand (selection, filters, drawer open state).
- **Proxy:** Fastify (small, typed; shares TS types with the frontend).
- **Shared types:** a `shared/` types package consumed by both proxy and SPA.

## 3. Scope & Screens

The cloud phone is the hub; everything else hangs off it.

### Fleet (home)
The device grid/table — every cloud phone with live status (on/off/booting), group,
proxy, tags, resolution. Multi-select with a **batch action bar**:
- Power on / off / restart
- Set root
- Modify parameters (batch)
- Move to group
- Install / uninstall app
- Push file
- Run automation task
- Reset / regenerate device
- Write SMS

Filter by group / tag / status; free-text search; pagination.

### Device detail (drawer over the fleet context)
- Status & details
- Live screen (stream / scan-code) and screen control
- ADB console: execute / enable / disable ADB; advanced commands (UIAutomator dump,
  accessibility-service hiding)
- Installed apps: list, start, close, uninstall
- SMS: inbox view + write SMS
- Assigned proxy (view / change)
- Cloud drive files for this device (list / push / delete)
- Reset / regenerate
- Sharing: change sharing password, connected member list, share

### Groups
Create / edit / delete groups; batch add / move phones to groups; group list.

### Proxies
Proxy list; batch add / delete; refresh URLs; modify; assign to phones.

### Apps
Platform app list + team app list (catalogs); batch install / uninstall / start / close
across selected phones; installed-app list.

### Cloud Drive
File list; upload local files; push files to phones; delete cloud drive files.

### Automation
Custom + official template lists; scheduled tasks; loop tasks; task management
(create / edit / pause / execute / delete); scheduled task reports.

### CloudNumber
Cloud number list; cloud number SMS; purchase/renewal package details; purchase / renew
cloud numbers.

### Subscription & Account
Subscription startup list; create / renew subscription startup; team order list;
buy / renew cloud phones; reference data (tag list, resource list, resolution list).

## 4. Key UX Patterns

- **Batch-first.** Most DuoPlus writes are batch endpoints, so selection + bulk action is
  the core interaction. Single-device actions are batch-of-one.
- **Live status via polling.** React Query refetches phone status on an interval
  (default 5–10s). Poll faster while a batch op is in flight, then settle back.
- **Optimistic + reconcile.** Fire a batch op, show pending state immediately, reconcile
  against the next status poll. Surface partial failures per device.
- **Live screen / control** via the streaming + scan-code endpoints in the detail view.

## 5. Data Flow & State

- One typed API client under `src/api/`, a function per endpoint, organized by category
  (cloud-phone, proxy, group, app, drive, automation, cloudnumber, account).
- The client calls `/api/...` only; the proxy maps those to real DuoPlus endpoints.
- React Query keys are structured by resource + filter so cache invalidation after a
  mutation is targeted (e.g. invalidate phone-status after a power op).
- Zustand holds ephemeral UI state only (current selection set, active filters, open
  drawer). Nothing that belongs to the server lives there.

## 6. Error Handling & Resilience

- **Batch partial failure is the primary error case.** Render a per-device result summary
  ("8 ok, 2 failed: …"), never one opaque error.
- **401** (bad/expired key): global notice prompting key check.
- **429** (rate limit): exponential backoff in the proxy; user-facing "slowing down" notice.
- **Network / 5xx:** retry with backoff for idempotent reads; explicit retry affordance
  for writes.
- Every mutation reports success/failure distinctly; no silent failures.

## 7. Testing

- Unit-test the API client against a **mock DuoPlus server**, so development proceeds
  before the live key/auth is confirmed.
- Component tests for the fleet grid, batch action bar, and device detail drawer with
  mocked React Query.
- One thin integration smoke test through the proxy.

## 8. Implementation Notes / Open Items

- **API spike first.** Exact base URL, auth header, and request/response shapes per
  endpoint are not extractable from the JS-rendered docs. The first implementation step
  is a spike: call a couple of real endpoints with the user's API key to confirm auth +
  response shapes, then codify TypeScript types in `shared/`. Nothing else in the design
  depends on this resolving first — the mock server lets the rest proceed in parallel.
- **Secrets.** API key lives only in the proxy's environment (`.env`, never committed).
- **Decisions locked:** Fastify proxy; device detail as a drawer (not a full page).

## 9. Directory Sketch (indicative)

```
/                     repo root
  shared/             TS types shared by proxy + SPA
  proxy/              Fastify proxy (holds API key, forwards /api/*)
  web/                React + Vite SPA
    src/
      api/            typed client, one module per DuoPlus category
      features/
        fleet/        grid + batch action bar
        device/       detail drawer
        groups/
        proxies/
        apps/
        drive/
        automation/
        cloudnumber/
        account/
      store/          Zustand UI state
      lib/            React Query setup, polling helpers
  mock-server/        mock DuoPlus for tests/dev
```
