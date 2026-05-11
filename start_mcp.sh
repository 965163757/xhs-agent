#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --disable-pip-version-check -q -r requirements.txt >/dev/null
exec python -m app.mcp_server.server
