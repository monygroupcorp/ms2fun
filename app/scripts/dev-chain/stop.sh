#!/usr/bin/env bash
# Stop the local anvil dev fork on :8545. Run `pnpm chain:stop` when you're done for the day so the
# fork process isn't left running. (Disk-wise it's cheap — auto-mine means no empty blocks — but
# there's no reason to keep the process + its RPC connection alive.)
#
# ANVIL_PORT overrides the port, exactly as it does for `pnpm chain:fork`, and picks the matching
# ownership record; unset, this is the :8545 path unchanged.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# shellcheck disable=SC1091
. "$SCRIPT_DIR/port.sh"

PORT="$(dev_chain_port)"
PID_FILE="$(dev_chain_pid_file "$REPO_ROOT" "$PORT")"

held_pid=""
probe_rc=0
held_pid="$(port_holder_pid "$PORT")" || probe_rc=$?

if [ "$probe_rc" -eq 1 ]; then
  # Port verifiably free: the PID file, if any, is provably stale.
  echo "ℹ️  no anvil fork running on :$PORT"
  rm -f "$PID_FILE"
  exit 0
elif [ "$probe_rc" -eq 2 ]; then
  # Unknown: none of lsof/ss/fuser is installed, so we cannot tell whether the port is free or held.
  # Do NOT remove PID_FILE here — it is the only record of ownership, and treating "unknown" as
  # "free" would permanently orphan a fork this repo genuinely started.
  echo "❌ cannot determine what holds :$PORT — none of lsof/ss/fuser is installed. Install one (e.g. iproute2 for ss) or free the port by hand; refusing to guess." >&2
  exit 1
fi

# probe_rc == 0: port held. Only kill the process on the port if it's the one this repo started
# (tracked in PID_FILE). Refuse otherwise — an unmatched PID means the port is held by something
# this script did not start.
tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"

if [ -n "$tracked_pid" ] && [ "$held_pid" = "$tracked_pid" ] && kill -0 "$tracked_pid" 2>/dev/null; then
  kill -9 "$tracked_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "🛑 anvil fork stopped"
else
  echo "❌ :$PORT is held by PID $held_pid, which this repo did not start — refusing to kill it" >&2
  exit 1
fi
