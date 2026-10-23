#!/bin/bash
# Started in the background by session-start.sh. Starts local Supabase, then
# writes .env.local from its (throwaway, local-only) keys if it doesn't exist.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"
export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io

if ! docker info > /dev/null 2>&1; then
  echo "Docker isn't running; skipping Supabase." >&2
  exit 1
fi

pnpm db:start

node scripts/write-env-local.mjs

echo "Supabase is ready."
