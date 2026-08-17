#!/usr/bin/env bash
# Stop the local anvil dev fork on :8545. Run `pnpm chain:stop` when you're done for the day so the
# fork process isn't left running. (Disk-wise it's cheap — auto-mine means no empty blocks — but
# there's no reason to keep the process + its RPC connection alive.)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PID_FILE="$REPO_ROOT/.anvil.pid"

if ! command -v lsof >/dev/null 2>&1 || ! lsof -ti:8545 >/dev/null 2>&1; then
  echo "ℹ️  no anvil fork running on :8545"
  rm -f "$PID_FILE"
  exit 0
fi

# Only kill the process on :8545 if it's the one this repo started (tracked in PID_FILE). Refuse
# otherwise — an unmatched PID means the port is held by something this script did not start.
held_pid="$(lsof -ti:8545 | head -n1)"
tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"

if [ -n "$tracked_pid" ] && [ "$held_pid" = "$tracked_pid" ] && kill -0 "$tracked_pid" 2>/dev/null; then
  kill -9 "$tracked_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "🛑 anvil fork stopped"
else
  echo "❌ :8545 is held by PID $held_pid, which this repo did not start — refusing to kill it" >&2
  exit 1
fi
