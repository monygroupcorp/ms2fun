#!/usr/bin/env bash
# Stop the local anvil dev fork on :8545. Run `pnpm chain:stop` when you're done for the day so the
# fork process isn't left running. (Disk-wise it's cheap — auto-mine means no empty blocks — but
# there's no reason to keep the process + its RPC connection alive.)
set -euo pipefail

killed=0
# Prefer matching the exact fork process; fall back to whatever holds the port.
if pids=$(pgrep -f 'anvil --fork-url' 2>/dev/null) && [ -n "$pids" ]; then
  echo "$pids" | xargs kill -9 2>/dev/null || true
  killed=1
elif command -v lsof >/dev/null 2>&1 && lsof -ti:8545 >/dev/null 2>&1; then
  lsof -ti:8545 | xargs kill -9 2>/dev/null || true
  killed=1
fi

if [ "$killed" = "1" ]; then
  echo "🛑 anvil fork stopped"
else
  echo "ℹ️  no anvil fork running on :8545"
fi
