#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --disable-pip-version-check -q -r requirements.txt
if [ ! -f .env ]; then
  cp .env.example .env
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8787}" --reload
