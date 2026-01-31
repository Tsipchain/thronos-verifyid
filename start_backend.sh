#!/usr/bin/env bash
set -euo pipefail

# If repo root, jump into backend/
if [ -d "backend" ] && [ -f "backend/main.py" ]; then
  cd backend
fi

: "${PORT:=8000}"
: "${HOST:=0.0.0.0}"

echo "[INFO] Starting verifyid on ${HOST}:${PORT} (cwd=$(pwd))"
exec uvicorn main:app --host "$HOST" --port "$PORT"
