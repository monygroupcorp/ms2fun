#!/usr/bin/env bash
# Start an anvil mainnet-fork on :8545 (chain id 1337) for local dev.
# Reads MAINNET_RPC_URL from the repo-root .env (never printed). After this is up,
# run `pnpm chain:deploy` to deploy the protocol and write the frontend config.
#
# ANVIL_PORT overrides the port for a second mainnet channel on one machine; unset, everything below
# is the :8545 loop unchanged. `pnpm chain:deploy`, `pnpm chain:check`, `pnpm chain:stop` and the
# dev server's `/__rpc/mainnet` proxy read the same variable, so one export moves the whole channel.
# Note :8546 already belongs to the SEPOLIA channel (`fork-sepolia.sh`) — pointing this one there
# while that one runs is refused by the port guard below, which is the intended outcome.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# shellcheck disable=SC1091
. "$SCRIPT_DIR/port.sh"

PORT="$(dev_chain_port)"
PID_FILE="$(dev_chain_pid_file "$REPO_ROOT" "$PORT")"

# Load MAINNET_RPC_URL from env or repo-root .env (value is never echoed).
if [ -z "${MAINNET_RPC_URL:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

if [ -z "${MAINNET_RPC_URL:-}" ]; then
  echo "❌ MAINNET_RPC_URL not set (export it or add it to $REPO_ROOT/.env)" >&2
  exit 1
fi
echo "✓ MAINNET_RPC_URL configured"

# If the port is already held, only free it when the holder is an anvil this script started
# (tracked in PID_FILE). Refuse otherwise — killing whatever happens to hold the port can tear
# down someone else's running fork with no way to recover it. A port state we cannot probe at all
# (no lsof/ss/fuser installed) is treated as "not ours", never as "free".
held_pid=""
probe_rc=0
held_pid="$(port_holder_pid "$PORT")" || probe_rc=$?

if [ "$probe_rc" -eq 0 ]; then
  tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$tracked_pid" ] && [ "$held_pid" = "$tracked_pid" ] && kill -0 "$tracked_pid" 2>/dev/null; then
    echo "⚠️  Killing existing process on :$PORT (PID $tracked_pid, started by this repo)"
    kill -9 "$tracked_pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    sleep 1
  else
    echo "❌ :$PORT is held by PID $held_pid, which this repo did not start — refusing to kill it" >&2
    exit 1
  fi
elif [ "$probe_rc" -eq 2 ]; then
  echo "❌ cannot determine what holds :$PORT — none of lsof/ss/fuser is installed. Install one (e.g. iproute2 for ss) or free the port by hand; refusing to start blind." >&2
  exit 1
fi
# probe_rc == 1: port verifiably free, proceed.

echo "🌐 Starting anvil fork (chain id 1337, :$PORT)…"
# NOTE: no `--block-time` on purpose — anvil defaults to AUTO-MINE (a block is produced only when a
# tx arrives), so the fork does NOT churn out empty blocks while it sits idle. Do NOT add interval
# mining or `--dump-state` (the inherited camel404 setup paired `--block-time 1` with a per-block
# state dump into .anvil-cache, which is what grew without bound). The only cache is the shared
# mainnet-state cache under ~/.foundry/cache, which is tiny. Stop the fork with `pnpm chain:stop`.
# --code-size-limit raised for the larger protocol contracts (over the 24KB Spurious Dragon limit).
anvil \
  --fork-url "$MAINNET_RPC_URL" \
  --chain-id 1337 \
  --port "$PORT" \
  --host 0.0.0.0 \
  --accounts 10 \
  --balance 10000 \
  --code-size-limit 30000 &
anvil_pid=$!
mkdir -p "$(dirname "$PID_FILE")"
echo "$anvil_pid" > "$PID_FILE"

# Preserve the previous foreground/Ctrl-C behaviour: forward the signal to anvil and clean up the
# PID file on exit, whether that's a normal exit, an interrupt, or a term.
cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}
trap cleanup INT TERM EXIT

wait "$anvil_pid"
