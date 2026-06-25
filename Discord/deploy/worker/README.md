# discord-unibox-landing — Cloudflare Worker

Single-file Worker that serves the brand-themed preview as the public-facing v0.1 of `gg.linktree.bond`. Deployed via the Cloudflare MCP from this session.

## What's in here

- `worker.js` — the entire Worker. Inlines `theme/preview/index.html` (with `theme/tokens.css` merged in) as base64. Serves it for every request except `/healthz` and `/robots.txt`.
- This README — how to re-bind, redeploy, or replace.

## What got deployed

- **Worker name:** `discord-unibox-landing`
- **Source file:** `deploy/worker/worker.js`
- **Compatibility date:** 2025-01-01
- **Module syntax:** ES module (`export default { fetch }`)
- **Size:** ~20 KB
- **Routes claimed:** none yet — Worker is live on its `workers.dev` URL only.

Default URL pattern: `https://discord-unibox-landing.<account-subdomain>.workers.dev`.

The MCP's list/read responses are returning `[object Object]` in this harness, so the exact account subdomain can't be retrieved programmatically. Open the Cloudflare dashboard → Workers & Pages → `discord-unibox-landing` to see the URL.

## To bind it to `gg.linktree.bond`

The route bind step needs the **zone ID for `linktree.bond`** which can't be read here. Two ways to finish it:

### Option 1 — via the MCP, once the zone ID is known

```
mcp__cloudflare__route_create
  zoneId: <linktree.bond zone id>
  pattern: gg.linktree.bond/*
  scriptName: discord-unibox-landing
```

You also need a DNS record so the hostname actually resolves to a CF edge:

```
mcp__cloudflare__... (DNS create — depends on tool surface)
  type: A
  name: gg.linktree.bond
  content: 192.0.2.1   # any IP — proxied traffic short-circuits before reaching origin
  proxied: true
```

If `linktree.bond` is **not yet on the Cloudflare account**, do this first (browser):

1. Cloudflare dashboard → Add a site → enter `linktree.bond` → Free plan.
2. CF returns 2 nameservers — set them at the registrar.
3. Wait for status `Active` (usually <1 hr after NS propagation).
4. Then run the steps above.

### Option 2 — via wrangler CLI (no MCP)

```bash
cd "/home/claudeuser/Discord Account Manager"
npx wrangler login                      # browser OAuth
npx wrangler deploy deploy/worker/worker.js \
    --name discord-unibox-landing \
    --route 'gg.linktree.bond/*' \
    --zone linktree.bond
```

`wrangler deploy --route ... --zone ...` handles the route + DNS in one call. Requires the zone to already be on the account.

## Redeploying

After editing `theme/preview/index.html` or `theme/tokens.css`, rebuild and redeploy:

```bash
cd "/home/claudeuser/Discord Account Manager"
python3 - <<'PY'
import base64, re
from pathlib import Path
html = Path("theme/preview/index.html").read_text()
css  = Path("theme/tokens.css").read_text()
html = re.sub(r'<link[^>]+tokens\.css[^>]*/?>', f'<style>\n{css}\n</style>', html)
b64  = base64.b64encode(html.encode()).decode()
worker = Path("deploy/worker/worker.js").read_text()
worker = re.sub(r'const HTML_B64 = "[^"]+";', f'const HTML_B64 = "{b64}";', worker)
Path("deploy/worker/worker.js").write_text(worker)
PY
```

Then re-run `mcp__cloudflare__worker_deploy` with the same args, or `npx wrangler deploy ...`.

## When to retire this Worker

This is a v0.1 stopgap. Retire when the real app ships:

1. The React build in `app/dist/` gets deployed via **Cloudflare Pages** (needs a GitHub push + browser-side connect — see `deploy/cloudflare/zone-setup-runbook.md`).
2. The API + bridge stack on the VPS gets exposed via **Cloudflare Tunnel** to `api.gg.linktree.bond` and `ws.gg.linktree.bond`.
3. At that point: delete this Worker (`mcp__cloudflare__worker_delete name=discord-unibox-landing`), drop the route, and let Pages own the `gg.linktree.bond` apex.
