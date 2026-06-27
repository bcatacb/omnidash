#!/usr/bin/env bash
# bootstrap.sh — one-shot VPS provisioner for Discord Unibox prod.
#
# Idempotent: safe to re-run. Each step checks first.
#
# Usage:
#   sudo ./deploy/vps/bootstrap.sh [REPO_URL] [REPO_REF]
#
# Args:
#   REPO_URL  Git URL to clone (default: $UNIBOX_REPO_URL or the TODO below)
#   REPO_REF  Branch/tag/sha to check out (default: main)
#
# Env knobs:
#   UNIBOX_REPO_URL          override the default repo URL
#   UNIBOX_INSTALL_DIR       where to clone (default /opt/discord-unibox)
#   POSTGRES_PASSWORD        passed through to docker compose
#   SKIP_TUNNEL_INSTALL      set to 1 to skip cloudflared install (e.g. testing)
#   SKIP_DOCKER_INSTALL      set to 1 to skip docker install
#
# Exit codes:
#   0  ok
#   1  must run as root
#   2  unsupported OS
#   3  required env missing

set -euo pipefail

# ---------- helpers ----------
log()  { printf '[bootstrap] %s\n' "$*" >&2; }
fail() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------- root check ----------
if [ "$(id -u)" -ne 0 ]; then
  fail "must run as root (try: sudo $0)" 1
fi

# ---------- OS check ----------
if ! [ -f /etc/os-release ]; then
  fail "cannot detect OS — /etc/os-release missing" 2
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) :;;
  *) fail "unsupported OS: ${ID:-unknown} (this script targets ubuntu/debian)" 2;;
esac

# ---------- inputs ----------
REPO_URL="${1:-${UNIBOX_REPO_URL:-https://github.com/surafelamare76-star/GG.git}}"
REPO_REF="${2:-master}"
INSTALL_DIR="${UNIBOX_INSTALL_DIR:-/opt/discord-unibox}"

if [ "${REPO_URL}" = "https://github.com/REPLACE_ME/discord-unibox.git" ]; then
  log "WARNING: REPO_URL is the placeholder. Pass the real URL as arg 1 or"
  log "         export UNIBOX_REPO_URL before re-running. Continuing anyway."
fi

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  fail "POSTGRES_PASSWORD must be exported before running this script" 3
fi

log "repo:    ${REPO_URL} @ ${REPO_REF}"
log "install: ${INSTALL_DIR}"

# ---------- 1. Docker ----------
if [ "${SKIP_DOCKER_INSTALL:-0}" != "1" ]; then
  if have docker && docker compose version >/dev/null 2>&1; then
    log "docker + compose plugin already installed — skipping"
  else
    log "installing docker engine + compose plugin"
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
      curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    arch="$(dpkg --print-architecture)"
    codename="${VERSION_CODENAME:-$(lsb_release -cs)}"
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${codename} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
  fi
else
  log "SKIP_DOCKER_INSTALL=1 — skipping docker install"
fi

# ---------- 2. cloudflared ----------
if [ "${SKIP_TUNNEL_INSTALL:-0}" != "1" ]; then
  if have cloudflared; then
    log "cloudflared already installed — skipping"
  else
    log "installing cloudflared (.deb from CF releases)"
    arch="$(dpkg --print-architecture)"
    tmp="$(mktemp -d)"
    trap 'rm -rf "${tmp}"' EXIT
    curl -fsSL -o "${tmp}/cloudflared.deb" \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
    dpkg -i "${tmp}/cloudflared.deb"
  fi

  # Dedicated user (matches systemd unit).
  if ! id -u cloudflared >/dev/null 2>&1; then
    log "creating cloudflared system user"
    useradd --system --no-create-home --shell /usr/sbin/nologin cloudflared
  fi
  install -d -m 0755 -o cloudflared -g cloudflared /etc/cloudflared
else
  log "SKIP_TUNNEL_INSTALL=1 — skipping cloudflared install"
fi

# ---------- 3. Clone / update the repo ----------
if [ -d "${INSTALL_DIR}/.git" ]; then
  log "repo already present — fetching latest"
  git -C "${INSTALL_DIR}" fetch --all --prune
  git -C "${INSTALL_DIR}" checkout "${REPO_REF}"
  git -C "${INSTALL_DIR}" pull --ff-only origin "${REPO_REF}" || true
else
  log "cloning repo"
  install -d -m 0755 "$(dirname "${INSTALL_DIR}")"
  git clone "${REPO_URL}" "${INSTALL_DIR}"
  git -C "${INSTALL_DIR}" checkout "${REPO_REF}"
fi

# ---------- 4. Install cloudflared config + unit ----------
if [ "${SKIP_TUNNEL_INSTALL:-0}" != "1" ]; then
  log "installing cloudflared config + systemd unit"
  install -m 0644 -o cloudflared -g cloudflared \
    "${INSTALL_DIR}/deploy/cloudflare/tunnel-config.yaml" \
    /etc/cloudflared/config.yml
  install -m 0644 \
    "${INSTALL_DIR}/deploy/vps/systemd/cloudflared.service" \
    /etc/systemd/system/cloudflared.service
  systemctl daemon-reload

  if [ ! -f /etc/cloudflared/discord-unibox-prod.json ]; then
    log "WARNING: /etc/cloudflared/discord-unibox-prod.json missing."
    log "         Run 'cloudflared tunnel login && cloudflared tunnel create"
    log "         discord-unibox-prod', move the creds file into place, then"
    log "         re-run this script (or just: systemctl enable --now cloudflared)."
  else
    systemctl enable --now cloudflared
  fi
fi

# ---------- 5. Bring up the stack ----------
log "starting docker compose stack"
cd "${INSTALL_DIR}"
docker compose -f deploy/vps/docker-compose.prod.yml pull || true
docker compose -f deploy/vps/docker-compose.prod.yml up -d --remove-orphans

# ---------- 6. Smoke / report ----------
log ""
log "============================================================"
log " bootstrap complete"
log "============================================================"
log " repo:        ${INSTALL_DIR}"
log " compose:     deploy/vps/docker-compose.prod.yml"
log " tunnel:      systemctl status cloudflared"
log " app stack:   docker compose -f deploy/vps/docker-compose.prod.yml ps"
log ""
log " URLs (once DNS + tunnel are live):"
log "   https://gg.linktree.bond/             (frontend, CF Pages)"
log "   https://api.gg.linktree.bond/health   (api, via tunnel)"
log "   wss://ws.gg.linktree.bond/ws          (websocket, via tunnel)"
log ""
