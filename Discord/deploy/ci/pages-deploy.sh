#!/usr/bin/env bash
# pages-deploy.sh — push the frontend build to Cloudflare Pages.
#
# Designed to run from either:
#   - a developer laptop with `wrangler` and CF_API_TOKEN set, OR
#   - a GitHub Actions runner (see SETUP NOTES at the bottom).
#
# What it does:
#   1. cd into app/
#   2. npm ci (cached install)
#   3. npm run build (Vite → app/dist)
#   4. wrangler pages deploy app/dist --project-name=discord-unibox
#
# Required env:
#   CF_API_TOKEN       Cloudflare API token with Pages:Edit + Account:Read
#   CF_ACCOUNT_ID      Cloudflare account id
#
# Optional env:
#   PAGES_BRANCH       Override target branch (default: current git branch,
#                      or "main" if not in a git repo)
#   PAGES_COMMIT_DIRTY Set to 1 to allow uncommitted changes (default 0)

set -euo pipefail

log()  { printf '[pages-deploy] %s\n' "$*" >&2; }
fail() { printf '[pages-deploy] ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

# ---------- env check ----------
: "${CF_API_TOKEN:?CF_API_TOKEN must be set}"
: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID must be set}"

# ---------- locate repo root ----------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
APP_DIR="${REPO_ROOT}/app"
[ -d "${APP_DIR}" ] || fail "app/ not found at ${APP_DIR}"

# ---------- dirty-tree guard ----------
if [ "${PAGES_COMMIT_DIRTY:-0}" != "1" ]; then
  if git -C "${REPO_ROOT}" diff --quiet && git -C "${REPO_ROOT}" diff --cached --quiet; then
    :
  else
    fail "working tree is dirty — commit first, or set PAGES_COMMIT_DIRTY=1"
  fi
fi

# ---------- branch ----------
BRANCH="${PAGES_BRANCH:-$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"
COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo unknown)"
log "deploying branch=${BRANCH} commit=${COMMIT}"

# ---------- build ----------
cd "${APP_DIR}"
log "installing deps"
npm ci

log "building (Vite)"
npm run build

[ -d "${APP_DIR}/dist" ] || fail "build did not produce app/dist"

# ---------- wrangler ----------
if ! command -v wrangler >/dev/null 2>&1; then
  log "wrangler not on PATH — installing via npx fallback"
  WRANGLER="npx -y wrangler@latest"
else
  WRANGLER="wrangler"
fi

log "deploying to CF Pages project 'discord-unibox'"
${WRANGLER} pages deploy "${APP_DIR}/dist" \
  --project-name=discord-unibox \
  --branch="${BRANCH}" \
  --commit-hash="${COMMIT}" \
  --commit-message="ci: pages deploy ${COMMIT}"

log "done"

# -----------------------------------------------------------------------------
# SETUP NOTES — GitHub Actions secret
# -----------------------------------------------------------------------------
#
# v1 of Discord Unibox does NOT ship a GH Actions workflow file (deferred to
# v1.1). To wire one up later:
#
# 1. Create a scoped CF API token at:
#       https://dash.cloudflare.com/profile/api-tokens
#    Template: "Edit Cloudflare Workers" — narrow it to:
#       Permissions:
#         - Account / Cloudflare Pages / Edit
#         - Account / Account Settings / Read
#       Account resources: include only your account
#
# 2. In the GitHub repo: Settings → Secrets and variables → Actions → New
#    repository secret:
#       Name:  CF_API_TOKEN
#       Value: <token from step 1>
#    Add a second secret:
#       Name:  CF_ACCOUNT_ID
#       Value: <account id, visible in CF dashboard sidebar>
#
# 3. Add a workflow file `.github/workflows/pages.yml` (when ready). The
#    relevant step would be:
#
#       - name: Deploy to Cloudflare Pages
#         env:
#           CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
#           CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
#         run: ./deploy/ci/pages-deploy.sh
