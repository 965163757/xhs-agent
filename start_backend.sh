#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/backend"

read_dotenv_value() {
  local key="$1"
  local env_file="$ROOT_DIR/backend/.env"
  [ -f "$env_file" ] || return 0
  grep -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" 2>/dev/null \
    | tail -n 1 \
    | sed -E "s/^[^=]*=//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^['\\\"]//; s/['\\\"]$//"
}

# Runtime data must live outside the git checkout in production.  Many deploy
# scripts use `git clean -fdx`, rebuild containers, or replace the whole source
# directory; anything under backend/data can disappear.  Prefer an explicit
# XHS_DATA_DIR, otherwise use a stable per-user directory outside the repo.
if [ -z "${XHS_DATA_DIR:-}" ]; then
  if [ -n "${XHS_AGENT_DATA_DIR:-}" ]; then
    export XHS_DATA_DIR="$XHS_AGENT_DATA_DIR"
  elif [ -n "${DATA_DIR:-}" ]; then
    export XHS_DATA_DIR="$DATA_DIR"
  else
    DOTENV_DATA_DIR="$(read_dotenv_value XHS_DATA_DIR || true)"
    DOTENV_AGENT_DATA_DIR="$(read_dotenv_value XHS_AGENT_DATA_DIR || true)"
    DOTENV_LEGACY_DATA_DIR="$(read_dotenv_value DATA_DIR || true)"
    export XHS_DATA_DIR="${DOTENV_DATA_DIR:-${DOTENV_AGENT_DATA_DIR:-${DOTENV_LEGACY_DATA_DIR:-$HOME/.local/share/xhs-agent}}}"
  fi
fi
mkdir -p "$XHS_DATA_DIR"

# One-time safe migration from the old repo-local data directory.  We only copy
# when the new persistent directory looks empty, so reruns never overwrite newer
# server data.
LEGACY_DATA_DIR="$ROOT_DIR/backend/data"
if [ -d "$LEGACY_DATA_DIR" ] \
  && [ ! -e "$XHS_DATA_DIR/xhs_agent.db" ] \
  && [ ! -e "$XHS_DATA_DIR/settings.json" ] \
  && [ ! -d "$XHS_DATA_DIR/images" ]; then
  echo "📦 检测到旧数据目录，正在迁移到持久化目录：$XHS_DATA_DIR"
  cp -a "$LEGACY_DATA_DIR"/. "$XHS_DATA_DIR"/
fi
echo "📦 后端数据目录：$XHS_DATA_DIR"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --disable-pip-version-check -q -r requirements.txt
if [ ! -f .env ]; then
  cp .env.example .env
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8787}" --reload
