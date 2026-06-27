# Security & Ban-Risk Hardening — apply DURING the merge

Source: three audits (Telegram ban-risk, TokTik C2 security, Discord Unibox security),
provided 2026-06-26/27. These are **requirements to satisfy as each component is
absorbed/built** — not a separate project. Check off as the relevant phase touches each.

## platforms/tiktok (absorbed c2) — security
- [ ] **Auth middleware before all `/api`** (only `/api/auth/signin` public) — currently only `/api/auth/me` checks a token; everything else is open.
- [ ] **Lock CORS** to the shell origin only (currently open `cors()`).
- [ ] **TLS only** — serve exclusively via the Cloudflare tunnel; **shut the open `c2.effortlessmetaphor.org`** door (no-auth/no-TLS public exposure).
- [ ] **Kill `admin/admin` default + base64 token** → signed, expiring JWT (server secret).
- [ ] **Least-privilege DB role** for the app (not the superuser `pg.Pool`).
- [ ] **Allowlist sortable/column identifiers** before interpolating into `ORDER BY`/`SELECT` (injection risk on `.eq()`-builder identifier paths).
- [ ] **Encrypt proxy creds + lead PII at rest**.

## platforms/discord (source) — secrets leak (highest urgency)
- [ ] **Rotate all 3 secrets**: `TOKEN_ENCRYPTION_KEY`, Postgres password, proxy credential — and **re-encrypt** stored tokens under the new key.
- [ ] **Purge from git history** (`env.gg-api.download`, `proxy-webshare.download`) and **revoke the third-party GitHub account** (`surafelamare76-star/GG`) that holds them.
- [ ] **Fix the `.gitignore` footgun** (patterns didn't match the real filenames) + add a **pre-commit secret scanner**.
- [ ] **Unbind per-account ports** — map `4002-4099` to `127.0.0.1`/internal Docker net, not `0.0.0.0`.
- [ ] Review `hungryshim` Matrix auth for constant-time token comparison.

## platforms/telegram + packages/core — ban-risk (deliverability)
- [ ] **Per-account proxies actually load** — install **PySocks**; one residential/mobile proxy per account (fleet currently egresses from one datacenter IP).
- [ ] **Stop sharing one API key** across the fleet; verify the current key isn't already flagged.
- [ ] **Enforce a real daily cap** — refuse to launch a campaign with cap 0; start low (~20–40/day, less for new accounts).
- [ ] **Human-cadence sending** — wider randomization, no 24/7 blasting; longer warmup before any cold send.
- [ ] **Vary message content** (templating; identical bodies flag instantly).
- [ ] **Shift toward opt-in / warm targeting** — the only lever that truly stops bans.

## Cross-cutting (the Cloudflare layer makes these defaults)
- [ ] **Cloudflare Access** in front of every dashboard (one auth wall) — fixes the c2 no-auth + general exposure.
- [ ] **Secrets live in Cloudflare (not git)** — env injected at deploy; repo tree never holds real keys.
- [ ] **Everything behind tunnels** (TLS at the edge); no raw public ports.
- [ ] Pre-commit **secret scanner** in CI.

> Principle: per-account proxy + daily cap + warmup + opt-in targeting belong in `packages/core`
> so **every** platform inherits safe-by-default behavior, not just the one that was audited.
