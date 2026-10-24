#!/bin/bash
# Started in the background by session-start.sh. Starts local Supabase, then
# writes .env.local from its (throwaway, local-only) keys if it doesn't exist.
#
# On a resumed session Docker brings the old Supabase containers back by
# itself (restart policy unless-stopped), and `supabase start` gives up at
# once while the database is still booting ("supabase_db_<project> container
# is not ready: starting"). So after a failed start this waits for the
# database to report healthy, then tries again.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"
export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io

attempts=3
health_wait_s=120

if ! docker info > /dev/null 2>&1; then
  echo "Docker isn't running; skipping Supabase." >&2
  exit 1
fi

project_id=$(sed -n 's/^project_id = "\(.*\)"$/\1/p' supabase/config.toml)
db_container="supabase_db_${project_id}"

# Returns once the database container is healthy, or after health_wait_s.
# Returns at once if the container doesn't exist yet.
wait_for_db() {
  local status
  for _ in $(seq 1 "$health_wait_s"); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$db_container" 2> /dev/null) || return 0
    [ "$status" = "healthy" ] && return 0
    sleep 1
  done
}

for attempt in $(seq 1 "$attempts"); do
  if pnpm db:start; then
    node scripts/write-env-local.mjs
    echo "Supabase is ready."
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "Supabase didn't start (attempt $attempt of $attempts); waiting for the database, then retrying." >&2
    wait_for_db
  fi
done

echo "Supabase failed to start after $attempts attempts; run 'pnpm db:start' to see why." >&2
exit 1
