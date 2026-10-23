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

if [ ! -f .env.local ]; then
  pnpm exec supabase status -o json 2> /dev/null | node -e '
    const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(
      `NEXT_PUBLIC_SUPABASE_URL=${s.API_URL}\n` +
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${s.PUBLISHABLE_KEY}\n` +
      `SUPABASE_SECRET_KEY=${s.SECRET_KEY}\n`,
    );
  ' > .env.local
  echo "Wrote .env.local from local Supabase."
fi

echo "Supabase is ready."
