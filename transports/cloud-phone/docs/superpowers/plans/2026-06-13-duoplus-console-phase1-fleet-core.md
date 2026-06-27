# DuoPlus Cloud Phone Console — Phase 1 (Fleet Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable, tested cloud-phone console that lists the DuoPlus fleet with live status, performs batch power operations, and opens a device detail drawer — wired through a thin auth-holding proxy, developed against a mock upstream.

**Architecture:** npm-workspaces monorepo with four packages: `shared` (TS types), `mock-server` (stands in for the DuoPlus upstream during dev/test), `proxy` (Fastify; holds the API key, exposes a clean `/api/*` REST surface, maps the DuoPlus envelope/fields in one isolated module), and `web` (React + Vite + TS SPA using TanStack Query + Zustand + Tailwind). The proxy's auth header/scheme and upstream base URL are env-driven, so confirming the real DuoPlus contract is a config + single-mapper change, not a rewrite.

**Tech Stack:** TypeScript, Fastify, Vite, React, TanStack Query, React Router, Zustand, Tailwind, Vitest, Testing Library, Supertest-style Fastify `inject`.

---

## Assumed DuoPlus Upstream Contract (to confirm in Task 12 spike)

Documented here so mock and proxy agree. The proxy's `upstream` module is the ONLY code that depends on these shapes.

- `GET {BASE}/cloudphone/list?page={n}&pageSize={n}` → `{ "code": 0, "msg": "ok", "data": { "list": CloudPhoneRaw[], "total": number } }`
- `POST {BASE}/cloudphone/power` body `{ "ids": string[], "action": "on"|"off"|"restart" }` → `{ "code": 0, "msg": "ok", "data": { "results": [{ "id": string, "success": boolean, "message": string }] } }`
- `GET {BASE}/cloudphone/detail?id={id}` → `{ "code": 0, "msg": "ok", "data": CloudPhoneRaw }`
- `CloudPhoneRaw = { "id": string, "name": string, "status": "running"|"stopped"|"starting", "groupId": string|null, "groupName": string|null, "proxyId": string|null, "tags": string[], "resolution": string, "root": boolean }`
- Auth: a single request header, name + scheme from env (`DUOPLUS_AUTH_HEADER`, default `Authorization`; `DUOPLUS_AUTH_SCHEME`, default `Bearer`). Sent as `Header: Scheme {key}` (scheme omitted if empty).
- Non-zero `code` means an error; proxy maps it to HTTP 502 with `{ error, upstreamCode, upstreamMsg }`.

---

## File Structure

```
package.json                         # workspaces root, shared scripts
tsconfig.base.json                   # shared TS compiler options
.gitignore                           # (exists)
.env.example                         # documents proxy env vars

shared/
  package.json
  src/index.ts                       # all shared types + the public contract

mock-server/
  package.json
  src/data.ts                        # seed fleet (12 fake phones)
  src/server.ts                      # Fastify app implementing the upstream contract
  src/start.ts                       # listen on PORT (default 4100)
  test/server.test.ts

proxy/
  package.json
  src/config.ts                      # env parsing (base url, key, auth header/scheme, port)
  src/upstream.ts                    # ONLY file that knows DuoPlus shapes (map raw<->clean)
  src/app.ts                         # Fastify app exposing /api/* clean REST
  src/start.ts                       # listen on PORT (default 4000)
  test/upstream.test.ts
  test/app.test.ts

web/
  package.json
  index.html
  vite.config.ts                     # dev proxy /api -> proxy:4000
  tailwind.config.js
  postcss.config.js
  src/main.tsx                       # React root + QueryClientProvider + Router
  src/index.css                      # tailwind directives
  src/lib/queryClient.ts             # QueryClient + polling defaults
  src/api/client.ts                  # fetch wrapper (throws ApiError)
  src/api/cloudPhone.ts              # listPhones / batchPower / getPhone
  src/store/fleetStore.ts            # Zustand: selection + filters
  src/features/fleet/useFleet.ts     # query + mutation hooks
  src/features/fleet/FleetGrid.tsx
  src/features/fleet/BatchActionBar.tsx
  src/features/fleet/FleetPage.tsx
  src/features/device/DeviceDrawer.tsx
  src/features/device/useDevice.ts
  src/components/Layout.tsx           # app shell + nav
  src/App.tsx                         # routes
  src/test/setup.ts                   # testing-library + jsdom setup
  src/test/mswHandlers.ts             # MSW handlers mirroring /api/*
  (colocated *.test.ts(x) files)
```

---

## Task 1: Monorepo scaffold + shared TS config

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.env.example`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "duoplus-console",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["shared", "mock-server", "proxy", "web"],
  "scripts": {
    "build:shared": "npm run build -w shared",
    "dev:mock": "npm run dev -w mock-server",
    "dev:proxy": "npm run dev -w proxy",
    "dev:web": "npm run dev -w web",
    "test": "npm run test -w shared && npm run test -w mock-server && npm run test -w proxy && npm run test -w web"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `.env.example`**

```
# Proxy → DuoPlus upstream
DUOPLUS_BASE_URL=http://localhost:4100
DUOPLUS_API_KEY=dev-mock-key
DUOPLUS_AUTH_HEADER=Authorization
DUOPLUS_AUTH_SCHEME=Bearer
PROXY_PORT=4000
MOCK_PORT=4100
```

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.base.json .env.example
git commit -m "chore: scaffold duoplus-console monorepo root"
```

---

## Task 2: Shared types package

**Files:**
- Create: `shared/package.json`, `shared/src/index.ts`
- Test: `shared/src/index.test.ts`

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "@duoplus/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Also create `shared/tsconfig.json`:

```json
{ "extends": "../tsconfig.base.json", "include": ["src"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 2: Write the failing test `shared/src/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { isPowerState, POWER_ACTIONS } from "./index";

describe("shared contract", () => {
  it("recognizes valid power states", () => {
    expect(isPowerState("on")).toBe(true);
    expect(isPowerState("off")).toBe(true);
    expect(isPowerState("nope")).toBe(false);
  });
  it("exposes the three power actions", () => {
    expect(POWER_ACTIONS).toEqual(["on", "off", "restart"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm install && npm run test -w shared`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 4: Write `shared/src/index.ts`**

```ts
export type PhonePowerState = "on" | "off" | "booting" | "unknown";
export type PowerAction = "on" | "off" | "restart";

export const POWER_ACTIONS: PowerAction[] = ["on", "off", "restart"];

const POWER_STATES: PhonePowerState[] = ["on", "off", "booting", "unknown"];
export function isPowerState(v: string): v is PhonePowerState {
  return (POWER_STATES as string[]).includes(v);
}

export interface CloudPhone {
  id: string;
  name: string;
  powerState: PhonePowerState;
  groupId: string | null;
  groupName: string | null;
  proxyId: string | null;
  tags: string[];
  resolution: string;
  rootEnabled: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BatchOpResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface BatchResponse {
  results: BatchOpResult[];
}

export interface ApiErrorBody {
  error: string;
  upstreamCode?: number;
  upstreamMsg?: string;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add shared
git commit -m "feat(shared): define cloud phone contract types"
```

---

## Task 3: Mock upstream server

**Files:**
- Create: `mock-server/package.json`, `mock-server/src/data.ts`, `mock-server/src/server.ts`, `mock-server/src/start.ts`
- Test: `mock-server/test/server.test.ts`

- [ ] **Step 1: Create `mock-server/package.json`**

```json
{
  "name": "@duoplus/mock-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/start.ts",
    "test": "vitest run"
  },
  "dependencies": { "fastify": "^4.28.0" },
  "devDependencies": { "tsx": "^4.16.0", "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

- [ ] **Step 2: Create `mock-server/src/data.ts`**

```ts
export interface CloudPhoneRaw {
  id: string;
  name: string;
  status: "running" | "stopped" | "starting";
  groupId: string | null;
  groupName: string | null;
  proxyId: string | null;
  tags: string[];
  resolution: string;
  root: boolean;
}

export function seedPhones(): CloudPhoneRaw[] {
  const groups = [
    ["g1", "US Warmup"],
    ["g2", "EU Pool"],
    [null, null],
  ] as const;
  return Array.from({ length: 12 }, (_, i) => {
    const [groupId, groupName] = groups[i % groups.length];
    return {
      id: `cp-${100 + i}`,
      name: `Phone ${100 + i}`,
      status: (["running", "stopped", "starting"] as const)[i % 3],
      groupId,
      groupName,
      proxyId: i % 2 === 0 ? `px-${i}` : null,
      tags: i % 4 === 0 ? ["priority"] : [],
      resolution: "720x1280",
      root: i % 5 === 0,
    };
  });
}
```

- [ ] **Step 3: Write the failing test `mock-server/test/server.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildMock } from "../src/server";

describe("mock upstream", () => {
  let app: ReturnType<typeof buildMock>;
  beforeEach(() => { app = buildMock(); });

  it("lists phones in the DuoPlus envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/cloudphone/list?page=1&pageSize=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data.list).toHaveLength(5);
    expect(body.data.total).toBe(12);
  });

  it("powers phones and returns per-id results", async () => {
    const res = await app.inject({
      method: "POST", url: "/cloudphone/power",
      payload: { ids: ["cp-100", "cp-101"], action: "on" },
    });
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data.results).toEqual([
      { id: "cp-100", success: true, message: "ok" },
      { id: "cp-101", success: true, message: "ok" },
    ]);
  });

  it("returns a single detail", async () => {
    const res = await app.inject({ method: "GET", url: "/cloudphone/detail?id=cp-100" });
    expect(res.json().data.id).toBe("cp-100");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm install && npm run test -w mock-server`
Expected: FAIL — cannot find `../src/server`.

- [ ] **Step 5: Create `mock-server/src/server.ts`**

```ts
import Fastify, { FastifyInstance } from "fastify";
import { seedPhones } from "./data.js";

export function buildMock(): FastifyInstance {
  const app = Fastify();
  const phones = seedPhones();

  app.get("/cloudphone/list", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "10");
    const start = (page - 1) * pageSize;
    return { code: 0, msg: "ok", data: { list: phones.slice(start, start + pageSize), total: phones.length } };
  });

  app.get("/cloudphone/detail", async (req, reply) => {
    const { id } = req.query as { id?: string };
    const phone = phones.find((p) => p.id === id);
    if (!phone) return reply.send({ code: 404, msg: "not found", data: null });
    return { code: 0, msg: "ok", data: phone };
  });

  app.post("/cloudphone/power", async (req) => {
    const { ids, action } = req.body as { ids: string[]; action: string };
    for (const id of ids) {
      const phone = phones.find((p) => p.id === id);
      if (phone) phone.status = action === "off" ? "stopped" : action === "on" ? "running" : "starting";
    }
    return { code: 0, msg: "ok", data: { results: ids.map((id) => ({ id, success: true, message: "ok" })) } };
  });

  return app;
}
```

- [ ] **Step 6: Create `mock-server/src/start.ts`**

```ts
import { buildMock } from "./server.js";
const port = Number(process.env.MOCK_PORT ?? "4100");
buildMock().listen({ port }).then(() => console.log(`mock upstream on :${port}`));
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -w mock-server`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add mock-server
git commit -m "feat(mock): DuoPlus upstream stand-in with list/power/detail"
```

---

## Task 4: Proxy upstream mapper (the isolated DuoPlus-shape module)

**Files:**
- Create: `proxy/package.json`, `proxy/tsconfig.json`, `proxy/src/config.ts`, `proxy/src/upstream.ts`
- Test: `proxy/test/upstream.test.ts`

- [ ] **Step 1: Create `proxy/package.json`**

```json
{
  "name": "@duoplus/proxy",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/start.ts",
    "test": "vitest run"
  },
  "dependencies": { "fastify": "^4.28.0", "@duoplus/shared": "*" },
  "devDependencies": { "tsx": "^4.16.0", "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

Create `proxy/tsconfig.json`:

```json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Create `proxy/src/config.ts`**

```ts
export interface ProxyConfig {
  baseUrl: string;
  apiKey: string;
  authHeader: string;
  authScheme: string;
  port: number;
}

export function loadConfig(env = process.env): ProxyConfig {
  return {
    baseUrl: env.DUOPLUS_BASE_URL ?? "http://localhost:4100",
    apiKey: env.DUOPLUS_API_KEY ?? "dev-mock-key",
    authHeader: env.DUOPLUS_AUTH_HEADER ?? "Authorization",
    authScheme: env.DUOPLUS_AUTH_SCHEME ?? "Bearer",
    port: Number(env.PROXY_PORT ?? "4000"),
  };
}

export function authHeaders(cfg: ProxyConfig): Record<string, string> {
  const value = cfg.authScheme ? `${cfg.authScheme} ${cfg.apiKey}` : cfg.apiKey;
  return { [cfg.authHeader]: value };
}
```

- [ ] **Step 3: Write the failing test `proxy/test/upstream.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mapPhone, mapBatch, UpstreamError, unwrap } from "../src/upstream";

describe("upstream mapper", () => {
  it("maps raw phone status to clean power state", () => {
    const clean = mapPhone({
      id: "cp-1", name: "P", status: "running", groupId: "g1", groupName: "G",
      proxyId: null, tags: [], resolution: "720x1280", root: true,
    });
    expect(clean.powerState).toBe("on");
    expect(clean.rootEnabled).toBe(true);
  });

  it("maps starting -> booting and stopped -> off", () => {
    expect(mapPhone({ id: "a", name: "a", status: "starting", groupId: null, groupName: null, proxyId: null, tags: [], resolution: "x", root: false }).powerState).toBe("booting");
    expect(mapPhone({ id: "b", name: "b", status: "stopped", groupId: null, groupName: null, proxyId: null, tags: [], resolution: "x", root: false }).powerState).toBe("off");
  });

  it("maps batch results into ok/error shape", () => {
    const out = mapBatch({ results: [
      { id: "a", success: true, message: "ok" },
      { id: "b", success: false, message: "boom" },
    ] });
    expect(out.results).toEqual([
      { id: "a", ok: true, error: undefined },
      { id: "b", ok: false, error: "boom" },
    ]);
  });

  it("unwrap throws UpstreamError on non-zero code", () => {
    expect(() => unwrap({ code: 5, msg: "bad", data: null })).toThrow(UpstreamError);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm install && npm run test -w proxy`
Expected: FAIL — cannot find `../src/upstream`.

- [ ] **Step 5: Create `proxy/src/upstream.ts`**

```ts
import type { CloudPhone, BatchResponse, PhonePowerState } from "@duoplus/shared";

export interface CloudPhoneRaw {
  id: string; name: string; status: "running" | "stopped" | "starting";
  groupId: string | null; groupName: string | null; proxyId: string | null;
  tags: string[]; resolution: string; root: boolean;
}
export interface Envelope<T> { code: number; msg: string; data: T; }

export class UpstreamError extends Error {
  constructor(public code: number, public upstreamMsg: string) {
    super(`upstream code ${code}: ${upstreamMsg}`);
  }
}

export function unwrap<T>(env: Envelope<T>): T {
  if (env.code !== 0) throw new UpstreamError(env.code, env.msg);
  return env.data;
}

const STATUS_MAP: Record<CloudPhoneRaw["status"], PhonePowerState> = {
  running: "on", stopped: "off", starting: "booting",
};

export function mapPhone(raw: CloudPhoneRaw): CloudPhone {
  return {
    id: raw.id, name: raw.name, powerState: STATUS_MAP[raw.status] ?? "unknown",
    groupId: raw.groupId, groupName: raw.groupName, proxyId: raw.proxyId,
    tags: raw.tags, resolution: raw.resolution, rootEnabled: raw.root,
  };
}

export function mapBatch(data: { results: { id: string; success: boolean; message: string }[] }): BatchResponse {
  return { results: data.results.map((r) => ({ id: r.id, ok: r.success, error: r.success ? undefined : r.message })) };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w proxy`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add proxy/package.json proxy/tsconfig.json proxy/src/config.ts proxy/src/upstream.ts proxy/test/upstream.test.ts
git commit -m "feat(proxy): isolated DuoPlus upstream mapper + config"
```

---

## Task 5: Proxy app exposing clean `/api/*`

**Files:**
- Create: `proxy/src/app.ts`, `proxy/src/start.ts`
- Test: `proxy/test/app.test.ts`

- [ ] **Step 1: Write the failing test `proxy/test/app.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildMock } from "../../mock-server/src/server";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

describe("proxy /api", () => {
  let upstream: ReturnType<typeof buildMock>;
  let baseUrl: string;

  beforeEach(async () => {
    upstream = buildMock();
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://localhost:${port}`;
  });
  afterEach(async () => { await upstream.close(); });

  it("GET /api/phones returns clean paginated phones", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/api/phones?page=1&pageSize=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(5);
    expect(body.total).toBe(12);
    expect(body.items[0].powerState).toMatch(/on|off|booting/);
  });

  it("POST /api/phones/power returns ok/error results", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
    const res = await app.inject({
      method: "POST", url: "/api/phones/power",
      payload: { ids: ["cp-100"], action: "off" },
    });
    expect(res.json().results[0]).toEqual({ id: "cp-100", ok: true, error: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w proxy`
Expected: FAIL — cannot find `../src/app`.

- [ ] **Step 3: Create `proxy/src/app.ts`**

```ts
import Fastify, { FastifyInstance } from "fastify";
import type { Paginated, CloudPhone } from "@duoplus/shared";
import { ProxyConfig, authHeaders } from "./config.js";
import { CloudPhoneRaw, Envelope, mapPhone, mapBatch, unwrap, UpstreamError } from "./upstream.js";

export function buildApp(cfg: ProxyConfig): FastifyInstance {
  const app = Fastify();

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...authHeaders(cfg), ...(init?.headers ?? {}) },
    });
    const env = (await res.json()) as Envelope<T>;
    return unwrap(env);
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UpstreamError) {
      return reply.status(502).send({ error: "upstream error", upstreamCode: err.code, upstreamMsg: err.upstreamMsg });
    }
    return reply.status(500).send({ error: err.message });
  });

  app.get("/api/phones", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: CloudPhoneRaw[]; total: number }>(
      `/cloudphone/list?page=${page}&pageSize=${pageSize}`,
    );
    const out: Paginated<CloudPhone> = { items: data.list.map(mapPhone), page, pageSize, total: data.total };
    return out;
  });

  app.get("/api/phones/:id", async (req) => {
    const { id } = req.params as { id: string };
    const raw = await call<CloudPhoneRaw>(`/cloudphone/detail?id=${encodeURIComponent(id)}`);
    return mapPhone(raw);
  });

  app.post("/api/phones/power", async (req) => {
    const body = req.body as { ids: string[]; action: string };
    const data = await call<{ results: { id: string; success: boolean; message: string }[] }>(
      `/cloudphone/power`, { method: "POST", body: JSON.stringify(body) },
    );
    return mapBatch(data);
  });

  return app;
}
```

- [ ] **Step 4: Create `proxy/src/start.ts`**

```ts
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
const cfg = loadConfig();
buildApp(cfg).listen({ port: cfg.port }).then(() => console.log(`proxy on :${cfg.port} -> ${cfg.baseUrl}`));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w proxy`
Expected: PASS (upstream.test 4 + app.test 2).

- [ ] **Step 6: Commit**

```bash
git add proxy/src/app.ts proxy/src/start.ts proxy/test/app.test.ts
git commit -m "feat(proxy): clean /api REST surface over DuoPlus upstream"
```

---

## Task 6: Web app scaffold (Vite + React + Tailwind + Query + Router)

**Files:**
- Create: `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/tailwind.config.js`, `web/postcss.config.js`, `web/src/index.css`, `web/src/lib/queryClient.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/test/setup.ts`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "@duoplus/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@duoplus/shared": "*",
    "@tanstack/react-query": "^5.51.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^24.1.0",
    "msw": "^2.3.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>DuoPlus Console</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:4000" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"] },
});
```

- [ ] **Step 4: Create Tailwind config files**

`web/tailwind.config.js`:
```js
export default { content: ["./index.html", "./src/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] };
```
`web/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```
`web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Create `web/src/lib/queryClient.ts`**

```ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 2000 } },
});
```

- [ ] **Step 6: Create `web/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 7: Create `web/src/App.tsx` and `web/src/main.tsx`**

`web/src/App.tsx`:
```tsx
export default function App() {
  return <div className="p-4 text-xl font-semibold">DuoPlus Console</div>;
}
```
`web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 8: Verify it builds and dev server boots**

Run: `npm install && npm run build -w web`
Expected: build succeeds (no type errors).

- [ ] **Step 9: Commit**

```bash
git add web
git commit -m "chore(web): scaffold Vite React app with Query, Router, Tailwind"
```

---

## Task 7: Typed API client

**Files:**
- Create: `web/src/api/client.ts`, `web/src/api/cloudPhone.ts`, `web/src/test/mswHandlers.ts`
- Test: `web/src/api/cloudPhone.test.ts`

- [ ] **Step 1: Create `web/src/test/mswHandlers.ts`**

```ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/phones", () =>
    HttpResponse.json({
      items: [
        { id: "cp-1", name: "P1", powerState: "on", groupId: null, groupName: null, proxyId: null, tags: [], resolution: "720x1280", rootEnabled: false },
      ],
      page: 1, pageSize: 20, total: 1,
    }),
  ),
  http.post("/api/phones/power", async ({ request }) => {
    const body = (await request.json()) as { ids: string[] };
    return HttpResponse.json({ results: body.ids.map((id) => ({ id, ok: true })) });
  }),
];
```

- [ ] **Step 2: Write the failing test `web/src/api/cloudPhone.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../test/mswHandlers";
import { listPhones, batchPower } from "./cloudPhone";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("cloudPhone api", () => {
  it("listPhones returns typed paginated data", async () => {
    const res = await listPhones({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0].powerState).toBe("on");
  });
  it("batchPower posts ids + action", async () => {
    const res = await batchPower(["cp-1"], "off");
    expect(res.results[0]).toEqual({ id: "cp-1", ok: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — cannot find `./cloudPhone`.

- [ ] **Step 4: Create `web/src/api/client.ts`**

```ts
import type { ApiErrorBody } from "@duoplus/shared";

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody | null) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try { body = (await res.json()) as ApiErrorBody; } catch { /* non-json */ }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 5: Create `web/src/api/cloudPhone.ts`**

```ts
import type { Paginated, CloudPhone, BatchResponse, PowerAction } from "@duoplus/shared";
import { apiFetch } from "./client";

export function listPhones(params: { page: number; pageSize: number }): Promise<Paginated<CloudPhone>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch<Paginated<CloudPhone>>(`/api/phones?${qs}`);
}

export function getPhone(id: string): Promise<CloudPhone> {
  return apiFetch<CloudPhone>(`/api/phones/${encodeURIComponent(id)}`);
}

export function batchPower(ids: string[], action: PowerAction): Promise<BatchResponse> {
  return apiFetch<BatchResponse>(`/api/phones/power`, { method: "POST", body: JSON.stringify({ ids, action }) });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w web`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/api web/src/test/mswHandlers.ts web/src/api/cloudPhone.test.ts
git commit -m "feat(web): typed cloud phone API client"
```

---

## Task 8: Fleet selection store

**Files:**
- Create: `web/src/store/fleetStore.ts`
- Test: `web/src/store/fleetStore.test.ts`

- [ ] **Step 1: Write the failing test `web/src/store/fleetStore.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useFleetStore } from "./fleetStore";

describe("fleetStore", () => {
  beforeEach(() => useFleetStore.getState().clearSelection());

  it("toggles a phone in and out of selection", () => {
    const s = useFleetStore.getState();
    s.toggle("cp-1");
    expect(useFleetStore.getState().selected.has("cp-1")).toBe(true);
    useFleetStore.getState().toggle("cp-1");
    expect(useFleetStore.getState().selected.has("cp-1")).toBe(false);
  });

  it("selectAll replaces selection; clearSelection empties it", () => {
    useFleetStore.getState().selectAll(["a", "b"]);
    expect(useFleetStore.getState().selected.size).toBe(2);
    useFleetStore.getState().clearSelection();
    expect(useFleetStore.getState().selected.size).toBe(0);
  });

  it("setStatusFilter stores the filter", () => {
    useFleetStore.getState().setStatusFilter("on");
    expect(useFleetStore.getState().statusFilter).toBe("on");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — cannot find `./fleetStore`.

- [ ] **Step 3: Create `web/src/store/fleetStore.ts`**

```ts
import { create } from "zustand";
import type { PhonePowerState } from "@duoplus/shared";

interface FleetState {
  selected: Set<string>;
  statusFilter: PhonePowerState | "all";
  search: string;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setStatusFilter: (s: PhonePowerState | "all") => void;
  setSearch: (s: string) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  selected: new Set(),
  statusFilter: "all",
  search: "",
  toggle: (id) => set((st) => {
    const next = new Set(st.selected);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selected: next };
  }),
  selectAll: (ids) => set({ selected: new Set(ids) }),
  clearSelection: () => set({ selected: new Set() }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSearch: (search) => set({ search }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/store
git commit -m "feat(web): fleet selection + filter store"
```

---

## Task 9: Fleet data hooks (query + power mutation with polling)

**Files:**
- Create: `web/src/features/fleet/useFleet.ts`
- Test: `web/src/features/fleet/useFleet.test.tsx`

- [ ] **Step 1: Write the failing test `web/src/features/fleet/useFleet.test.tsx`**

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../test/mswHandlers";
import { usePhones } from "./useFleet";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("usePhones", () => {
  it("loads phones", async () => {
    const { result } = renderHook(() => usePhones({ page: 1, pageSize: 20 }), { wrapper });
    await waitFor(() => expect(result.current.data?.total).toBe(1));
    expect(result.current.data?.items[0].name).toBe("P1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — cannot find `./useFleet`.

- [ ] **Step 3: Create `web/src/features/fleet/useFleet.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PowerAction } from "@duoplus/shared";
import { listPhones, batchPower } from "../../api/cloudPhone";

export function phonesKey(params: { page: number; pageSize: number }) {
  return ["phones", params.page, params.pageSize] as const;
}

export function usePhones(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: phonesKey(params),
    queryFn: () => listPhones(params),
    refetchInterval: 8000,
  });
}

export function useBatchPower(params: { page: number; pageSize: number }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: PowerAction }) => batchPower(ids, action),
    onSettled: () => qc.invalidateQueries({ queryKey: phonesKey(params) }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/fleet/useFleet.ts web/src/features/fleet/useFleet.test.tsx
git commit -m "feat(web): fleet query + batch power mutation hooks"
```

---

## Task 10: Fleet grid + batch action bar UI

**Files:**
- Create: `web/src/features/fleet/FleetGrid.tsx`, `web/src/features/fleet/BatchActionBar.tsx`, `web/src/features/fleet/FleetPage.tsx`
- Test: `web/src/features/fleet/FleetPage.test.tsx`

- [ ] **Step 1: Write the failing test `web/src/features/fleet/FleetPage.test.tsx`**

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../test/mswHandlers";
import { useFleetStore } from "../../store/fleetStore";
import { FleetPage } from "./FleetPage";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); useFleetStore.getState().clearSelection(); });
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><FleetPage /></QueryClientProvider>);
}

describe("FleetPage", () => {
  it("renders phones from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("P1")).toBeInTheDocument());
  });

  it("enables batch bar after selecting a phone", async () => {
    renderPage();
    await waitFor(() => screen.getByText("P1"));
    await userEvent.click(screen.getByRole("checkbox", { name: /select cp-1/i }));
    expect(screen.getByRole("button", { name: /power on/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — cannot find `./FleetPage`.

- [ ] **Step 3: Create `web/src/features/fleet/FleetGrid.tsx`**

```tsx
import type { CloudPhone } from "@duoplus/shared";
import { useFleetStore } from "../../store/fleetStore";

const STATUS_COLOR: Record<string, string> = {
  on: "text-green-600", off: "text-gray-400", booting: "text-amber-500", unknown: "text-gray-400",
};

export function FleetGrid({ phones, onOpen }: { phones: CloudPhone[]; onOpen: (id: string) => void }) {
  const selected = useFleetStore((s) => s.selected);
  const toggle = useFleetStore((s) => s.toggle);
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-gray-500">
        <th className="p-2"></th><th className="p-2">Name</th><th className="p-2">Status</th>
        <th className="p-2">Group</th><th className="p-2">Tags</th>
      </tr></thead>
      <tbody>
        {phones.map((p) => (
          <tr key={p.id} className="border-t hover:bg-gray-50">
            <td className="p-2">
              <input type="checkbox" aria-label={`select ${p.id}`}
                checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            </td>
            <td className="p-2">
              <button className="text-blue-600 hover:underline" onClick={() => onOpen(p.id)}>{p.name}</button>
            </td>
            <td className={`p-2 font-medium ${STATUS_COLOR[p.powerState]}`}>{p.powerState}</td>
            <td className="p-2">{p.groupName ?? "—"}</td>
            <td className="p-2">{p.tags.join(", ") || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Create `web/src/features/fleet/BatchActionBar.tsx`**

```tsx
import type { PowerAction } from "@duoplus/shared";
import { useFleetStore } from "../../store/fleetStore";
import { useBatchPower } from "./useFleet";

export function BatchActionBar({ params }: { params: { page: number; pageSize: number } }) {
  const selected = useFleetStore((s) => s.selected);
  const power = useBatchPower(params);
  const ids = [...selected];
  const disabled = ids.length === 0 || power.isPending;

  const run = (action: PowerAction) => power.mutate({ ids, action });

  return (
    <div className="flex items-center gap-2 p-2 border-b bg-white sticky top-0">
      <span className="text-sm text-gray-600">{ids.length} selected</span>
      <button className="px-3 py-1 rounded bg-green-600 text-white disabled:opacity-40"
        disabled={disabled} onClick={() => run("on")}>Power On</button>
      <button className="px-3 py-1 rounded bg-gray-700 text-white disabled:opacity-40"
        disabled={disabled} onClick={() => run("off")}>Power Off</button>
      <button className="px-3 py-1 rounded bg-amber-500 text-white disabled:opacity-40"
        disabled={disabled} onClick={() => run("restart")}>Restart</button>
      {power.data && (
        <span className="text-sm text-gray-600">
          {power.data.results.filter((r) => r.ok).length} ok,{" "}
          {power.data.results.filter((r) => !r.ok).length} failed
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `web/src/features/fleet/FleetPage.tsx`**

```tsx
import { useState } from "react";
import { usePhones } from "./useFleet";
import { FleetGrid } from "./FleetGrid";
import { BatchActionBar } from "./BatchActionBar";
import { DeviceDrawer } from "../device/DeviceDrawer";

export function FleetPage() {
  const params = { page: 1, pageSize: 20 };
  const { data, isLoading, isError } = usePhones(params);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <BatchActionBar params={params} />
      {isLoading && <p className="p-4 text-gray-500">Loading fleet…</p>}
      {isError && <p className="p-4 text-red-600">Failed to load fleet.</p>}
      {data && <FleetGrid phones={data.items} onOpen={setOpenId} />}
      {openId && <DeviceDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
```

- [ ] **Step 6: Create a stub `web/src/features/device/DeviceDrawer.tsx` so the page compiles**

```tsx
export function DeviceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l shadow-lg p-4" role="dialog" aria-label="device detail">
      <button className="text-gray-500" onClick={onClose}>Close</button>
      <p className="mt-2">Device {id}</p>
    </div>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -w web`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add web/src/features/fleet web/src/features/device/DeviceDrawer.tsx
git commit -m "feat(web): fleet grid, batch action bar, fleet page"
```

---

## Task 11: Device detail drawer (real data)

**Files:**
- Create: `web/src/features/device/useDevice.ts`
- Modify: `web/src/features/device/DeviceDrawer.tsx` (replace stub), `web/src/test/mswHandlers.ts` (add detail handler)
- Test: `web/src/features/device/DeviceDrawer.test.tsx`

- [ ] **Step 1: Add a detail handler to `web/src/test/mswHandlers.ts`**

Append to the `handlers` array:
```ts
  http.get("/api/phones/:id", ({ params }) =>
    HttpResponse.json({
      id: params.id, name: `Name-${params.id}`, powerState: "on",
      groupId: "g1", groupName: "US Warmup", proxyId: "px-1",
      tags: ["priority"], resolution: "720x1280", rootEnabled: true,
    }),
  ),
```
(Add `http` and `HttpResponse` are already imported at the top of the file.)

- [ ] **Step 2: Write the failing test `web/src/features/device/DeviceDrawer.test.tsx`**

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../test/mswHandlers";
import { DeviceDrawer } from "./DeviceDrawer";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderDrawer(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeviceDrawer id={id} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("DeviceDrawer", () => {
  it("shows fetched device details", async () => {
    renderDrawer("cp-1");
    await waitFor(() => expect(screen.getByText("Name-cp-1")).toBeInTheDocument());
    expect(screen.getByText(/US Warmup/)).toBeInTheDocument();
    expect(screen.getByText(/720x1280/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — `Name-cp-1` not found (stub renders only the id).

- [ ] **Step 4: Create `web/src/features/device/useDevice.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { getPhone } from "../../api/cloudPhone";

export function useDevice(id: string) {
  return useQuery({ queryKey: ["phone", id], queryFn: () => getPhone(id) });
}
```

- [ ] **Step 5: Replace `web/src/features/device/DeviceDrawer.tsx`**

```tsx
import { useDevice } from "./useDevice";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 border-b text-sm">
      <span className="text-gray-500">{label}</span><span className="font-medium">{value}</span>
    </div>
  );
}

export function DeviceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError } = useDevice(id);
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l shadow-lg p-4 overflow-y-auto"
      role="dialog" aria-label="device detail">
      <button className="text-gray-500 hover:text-gray-800" onClick={onClose}>Close</button>
      {isLoading && <p className="mt-4 text-gray-500">Loading…</p>}
      {isError && <p className="mt-4 text-red-600">Failed to load device.</p>}
      {data && (
        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">{data.name}</h2>
          <Row label="Status" value={data.powerState} />
          <Row label="Group" value={data.groupName ?? "—"} />
          <Row label="Proxy" value={data.proxyId ?? "—"} />
          <Row label="Resolution" value={data.resolution} />
          <Row label="Root" value={data.rootEnabled ? "enabled" : "disabled"} />
          <Row label="Tags" value={data.tags.join(", ") || "—"} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w web`
Expected: PASS (1 test) and the Task 10 tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/device web/src/test/mswHandlers.ts
git commit -m "feat(web): device detail drawer with live data"
```

---

## Task 12: App shell, routing, and live spike doc

**Files:**
- Create: `web/src/components/Layout.tsx`, `docs/superpowers/SPIKE-duoplus-auth.md`, `README.md`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create `web/src/components/Layout.tsx`**

```tsx
import { NavLink } from "react-router-dom";

const link = "px-3 py-2 rounded text-sm hover:bg-gray-100";
const active = "bg-gray-100 font-semibold";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <nav className="w-48 border-r p-3 space-y-1">
        <div className="font-bold mb-3">DuoPlus</div>
        <NavLink to="/" className={({ isActive }) => `${link} block ${isActive ? active : ""}`}>Fleet</NavLink>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Replace `web/src/App.tsx`**

```tsx
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { FleetPage } from "./features/fleet/FleetPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<FleetPage />} />
      </Routes>
    </Layout>
  );
}
```

- [ ] **Step 3: Create `docs/superpowers/SPIKE-duoplus-auth.md`** (the live-API confirmation checklist)

```markdown
# Spike: confirm DuoPlus live auth + shapes

Run when a real API key is available. No app code changes expected — only `.env` + possibly `proxy/src/upstream.ts` field names.

1. Put real values in `proxy/.env`: DUOPLUS_BASE_URL, DUOPLUS_API_KEY, DUOPLUS_AUTH_HEADER, DUOPLUS_AUTH_SCHEME.
2. Find the real list endpoint in https://help.duoplus.net/docs/api-reference and curl it with the auth header. Confirm:
   - exact path + query params (does it match `/cloudphone/list?page=&pageSize=`?)
   - envelope shape (is it `{code,msg,data:{list,total}}`?)
   - raw phone field names + status enum values
3. Update `proxy/src/upstream.ts` (`CloudPhoneRaw`, `STATUS_MAP`, paths in `proxy/src/app.ts`) to match reality. Tests + mock update alongside.
4. Re-run `npm run test -w proxy`; then `npm run dev:proxy` against the live base URL and load the web app.
```

- [ ] **Step 4: Create `README.md`**

```markdown
# DuoPlus Cloud Phone Console

Single-user dashboard over the DuoPlus cloud-phone API. Phase 1: fleet list, batch power, device detail.

## Run (mock upstream)
```
npm install
npm run dev:mock     # terminal 1 — fake DuoPlus on :4100
npm run dev:proxy    # terminal 2 — proxy on :4000
npm run dev:web      # terminal 3 — Vite on :5173
```
Open http://localhost:5173.

## Run against live DuoPlus
Copy `.env.example` to `proxy/.env`, fill real values, then run the spike in `docs/superpowers/SPIKE-duoplus-auth.md`. Start proxy + web only (no mock).

## Test
```
npm test
```
```

- [ ] **Step 5: Verify build + full test suite**

Run: `npm run build -w web && npm test`
Expected: web build succeeds; all package test suites PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx docs/superpowers/SPIKE-duoplus-auth.md README.md
git commit -m "feat(web): app shell + routing; add live-API spike + README"
```

---

## Done criteria for Phase 1

- `npm test` is green across all four packages.
- `npm run dev:mock` + `dev:proxy` + `dev:web` shows a fleet of 12 phones, lets you select and power on/off/restart with a per-batch ok/failed summary, polls status, and opens a device detail drawer.
- Switching to the live API is env + one-mapper work, documented in the spike.

## Follow-up plans (not in this phase)

Each is its own spec→plan→build cycle, reusing this foundation (proxy `call()` helper, mapper pattern, fleet patterns):
- Proxies & Groups management
- Apps (catalog + batch install/uninstall/start/close)
- Cloud Drive (file list/upload/push/delete)
- Automation (templates, scheduled/loop tasks, reports)
- CloudNumber (numbers + SMS)
- ADB console, live screen/stream, sharing, SMS inbox, reset/regenerate (device-detail deepening)
- Account/orders, buy/renew, subscription startup
