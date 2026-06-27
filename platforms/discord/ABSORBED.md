# discord (absorbed source from `/opt/discord-unibox`)

Absorbed 2026-06-27 — **source only**. The Discord Unibox **runtime stays as the
6-container Docker stack** on its server (api + postgres + nats + orchestrator +
hungryshim + nginx; Playwright + Matrix bridge). This folder is the canonical
*source*; deploys still use the container stack (Phase 6 wires deploy from here).

Replaces the stale vendored copy at `omnibox/Discord/` (now deprecated).

## Security applied on absorption (per docs/SECURITY_HARDENING.md)
- **Removed the leaked-secret files** that were committed in the original repo:
  `env.gg-api.download`, `proxy-webshare.download`, and `deploy/vps/.env`. They are
  NOT in this copy.
- ⚠️ **Still required (operational, on the live stack):** the leaked secrets are already
  exposed, so they must be **rotated**: `TOKEN_ENCRYPTION_KEY` (then re-encrypt stored
  tokens), the Postgres password, and the proxy credential — and the third-party
  GitHub account (`surafelamare76-star/GG`) revoked. Removing the files here prevents
  re-leaking; it does not undo the original exposure.

## Status / next
- Source = canonical here. Runtime = container stack (unchanged).
- Wire into omnibox via the `PlatformTransformer` (the shell's `dc-api` adapter already works against it through the tunnel).
