#!/usr/bin/env bash
set -euo pipefail

echo "[INFO] boot verifyid backend..."

# Αν το script τρέχει από repo root, μπες στο backend/
# Αν ήδη είσαι μέσα στο backend/, μην αλλάξεις dir.
if [ -d "./backend" ] && [ -f "./backend/main.py" ]; then
  cd backend
elif [ -f "./main.py" ]; then
  : # ήδη στο backend
else
  echo "[ERROR] Can't find backend/main.py or ./main.py from: $(pwd)"
  echo "[ERROR] Make sure Railway Root Directory is repo root OR backend contains main.py"
  exit 1
fi

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

echo "[INFO] starting uvicorn on ${HOST}:${PORT} (cwd=$(pwd))"
exec uvicorn main:app --host "$HOST" --port "$PORT"
