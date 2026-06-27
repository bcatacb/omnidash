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
Copy `.env.example` to `proxy/.env` and fill real values:
```
DUOPLUS_BASE_URL=https://openapi.duoplus.net
DUOPLUS_API_KEY=<your real key>
```
The proxy auto-loads `proxy/.env` on start (`process.loadEnvFile`) and sends
`DuoPlus-API-Key`, `Content-Type: application/json`, and `Lang: en` on every POST.
Calls are serialized to 1 QPS per endpoint to honor the upstream rate limit.

Start proxy + web only (no mock):
```
npm run dev:proxy    # terminal 1 — proxy on :4000 -> openapi.duoplus.net
npm run dev:web      # terminal 2 — Vite on :5173
```
Read-only check (does not mutate devices):
```
curl "http://localhost:4000/api/phones?pageSize=3"
```
Power on/off/restart mutate real phones — exercise them deliberately.

## Test
```
npm test
```

## Production / Deployment

### Single-process mode (`SERVE_WEB=1`)
The proxy can serve both the JSON API and the built web bundle from one process.
Build the web app, then start the proxy with `SERVE_WEB=1`:
```
npm run build:shared
npm run build -w web        # emits web/dist
SERVE_WEB=1 npm run dev:proxy   # or: SERVE_WEB=1 npx tsx proxy/src/start.ts
```
The proxy serves `web/dist` at `/` (SPA fallback to `index.html`) and the API at
`/api/*`. If `web/dist` exists it is served automatically even without the flag;
`SERVE_WEB=1` makes the intent explicit. `GET /health` returns `{"ok":true}` and
is always unauthenticated (use it for liveness probes).

### Console token (`CONSOLE_TOKEN`)
By default `/api/*` is open (local single-user dev). To require a shared secret,
set `CONSOLE_TOKEN` on the proxy. Every `/api/*` request must then send a
matching `x-console-token` header or it gets `401`. `/health` stays open.

The web app sends that header automatically when built with `VITE_CONSOLE_TOKEN`
(baked in at build time — it is NOT a runtime value):
```
CONSOLE_TOKEN=some-long-secret           # proxy side (server)
VITE_CONSOLE_TOKEN=some-long-secret npm run build -w web   # web side (must match)
```
The token gates access to the console; the **DuoPlus API key itself never leaves
the proxy** — it lives in `proxy/.env` (`DUOPLUS_API_KEY`) and is sent only on
upstream calls. Never ship `proxy/.env` or bake the API key into the web bundle.

### Rate limiting
Upstream calls are serialized to 1 QPS per endpoint. On an upstream `429` the
proxy retries up to 3 times with exponential backoff before surfacing the error
(tune the base delay with `RETRY_BACKOFF_MS`).

### Docker (DuoPlus console only)
A multi-stage `Dockerfile` at the repo root builds shared + web and runs the
proxy in single-process mode (`SERVE_WEB=1`, port 4000). The build context is the
whole monorepo, so `.dockerignore` trims it to the DuoPlus workspaces.
```
# build (optionally bake the web token):
docker build -t duoplus-console \
  --build-arg VITE_CONSOLE_TOKEN=some-long-secret .

# run (provide the API key + console token at runtime):
docker run --rm -p 4000:4000 \
  -e DUOPLUS_API_KEY=your-real-key \
  -e CONSOLE_TOKEN=some-long-secret \
  duoplus-console
```
Open http://localhost:4000.

### HTTPS
The app speaks plain HTTP. Terminate TLS at a reverse proxy (nginx, Caddy,
Cloudflare, a cloud load balancer) in front of the container.
