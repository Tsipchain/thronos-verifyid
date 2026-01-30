#!/bin/bash

# Simple backend startup script that always uses port 8000
set -e

BACKEND_DIR="/workspace/app/backend"
cd "$BACKEND_DIR"

echo "[INFO] Starting backend on port 8000..."

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Start uvicorn on port 8000
uvicorn main:app --host 0.0.0.0 --port 8000 --reload