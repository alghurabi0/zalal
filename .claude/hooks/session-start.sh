#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (docs/claude-code-setup.md §3.1).
# Installs packages, starts Docker, then starts local Supabase in the background
# so the session doesn't wait on the image pull. Safe to run more than once.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# The default Supabase image registry (AWS ECR) is blocked here; Docker Hub works.
# The pre-installed Chromium doesn't match the pinned Playwright version.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io'
    echo 'export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium'
  } >> "$CLAUDE_ENV_FILE"
fi

pnpm install --frozen-lockfile

# Docker is installed but its daemon isn't running at session start.
if ! docker info > /dev/null 2>&1; then
  nohup dockerd > /tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 60); do
    docker info > /dev/null 2>&1 && break
    sleep 1
  done
fi

# Start Supabase detached; progress goes to /tmp/supabase-start.log.
nohup setsid "$CLAUDE_PROJECT_DIR/.claude/hooks/start-supabase.sh" > /tmp/supabase-start.log 2>&1 < /dev/null &

echo "Supabase is starting in the background (log: /tmp/supabase-start.log)."
