#!/usr/bin/env bash
# Stop the local anvil dev fork on :8545. Run `pnpm chain:stop` when you're done for the day so the
# fork process isn't left running. (Disk-wise it's cheap — auto-mine means no empty blocks — but
# there's no reason to keep the process + its RPC connection alive.)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PID_FILE="$REPO_ROOT/.anvil.pid"

# shellcheck disable=SC1091
. "$SCRIPT_DIR/port.sh"

held_pid=""
probe_rc=0
held_pid="$(port_holder_pid 8545)" || probe_rc=$?

if [ "$probe_rc" -eq 1 ]; then
  # Port verifiably free: the PID file, if any, is provably stale.
  echo "ℹ️  no anvil fork running on :8545"
  rm -f "$PID_FILE"
  exit 0
elif [ "$probe_rc" -eq 2 ]; then
  # Unknown: none of lsof/ss/fuser is installed, so we cannot tell whether :8545 is free or held.
  # Do NOT remove PID_FILE here — it is the only record of ownership, and treating "unknown" as
  # "free" would permanently orphan a fork this repo genuinely started.
  echo "❌ cannot determine what holds :8545 — none of lsof/ss/fuser is installed. Install one (e.g. iproute2 for ss) or free the port by hand; refusing to guess." >&2
  exit 1
fi

# probe_rc == 0: port held. Only kill the process on :8545 if it's the one this repo started
# (tracked in PID_FILE). Refuse otherwise — an unmatched PID means the port is held by something
# this script did not start.
tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"

if [ -n "$tracked_pid" ] && [ "$held_pid" = "$tracked_pid" ] && kill -0 "$tracked_pid" 2>/dev/null; then
  kill -9 "$tracked_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "🛑 anvil fork stopped"
else
  echo "❌ :8545 is held by PID $held_pid, which this repo did not start — refusing to kill it" >&2
  exit 1
fi
