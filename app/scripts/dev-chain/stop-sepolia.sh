#!/usr/bin/env bash
# Stop the Sepolia-fork dev channel on :8546. The mainnet channel on :8545 is untouched — stop that
# one with `pnpm chain:stop`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# Runtime ownership record. It lives under the repo-root `.cache/` (already ignored) so the
# channel leaves no untracked file beside the tracked ones; `fork.sh`'s own is `/.anvil.pid`.
PID_DIR="$REPO_ROOT/.cache"
PID_FILE="$PID_DIR/anvil-sepolia.pid"
PORT=8546

# shellcheck disable=SC1091
. "$SCRIPT_DIR/port.sh"

held_pid=""
probe_rc=0
held_pid="$(port_holder_pid "$PORT")" || probe_rc=$?

if [ "$probe_rc" -eq 1 ]; then
  echo "ℹ️  no anvil fork running on :$PORT"
  rm -f "$PID_FILE"
  exit 0
elif [ "$probe_rc" -eq 2 ]; then
  # Unknown is not free: PID_FILE is the only ownership record, and discarding it here would orphan
  # a fork this repo genuinely started.
  echo "❌ cannot determine what holds :$PORT — none of lsof/ss/fuser is installed. Install one (e.g. iproute2 for ss) or free the port by hand; refusing to guess." >&2
  exit 1
fi

tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"

if [ -n "$tracked_pid" ] && [ "$held_pid" = "$tracked_pid" ] && kill -0 "$tracked_pid" 2>/dev/null; then
  kill -9 "$tracked_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "🛑 Sepolia-fork channel stopped"
else
  echo "❌ :$PORT is held by PID $held_pid, which this repo did not start — refusing to kill it" >&2
  exit 1
fi
