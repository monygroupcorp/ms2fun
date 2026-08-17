#!/usr/bin/env bash
# Start an anvil mainnet-fork on :8545 (chain id 1337) for local dev.
# Reads MAINNET_RPC_URL from the repo-root .env (never printed). After this is up,
# run `pnpm chain:deploy` to deploy the protocol and write the frontend config.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PID_FILE="$REPO_ROOT/.anvil.pid"

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

# If port 8545 is already held, only free it when the holder is an anvil this script started
# (tracked in PID_FILE). Refuse otherwise — killing whatever happens to hold the port can tear
# down someone else's running fork with no way to recover it.
if lsof -ti:8545 >/dev/null 2>&1; then
  held_pid="$(lsof -ti:8545 | head -n1)"
  tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$tracked_pid" ] && [ "$held_pid" = "$tracked_pid" ] && kill -0 "$tracked_pid" 2>/dev/null; then
    echo "⚠️  Killing existing process on :8545 (PID $tracked_pid, started by this repo)"
    kill -9 "$tracked_pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    sleep 1
  else
    echo "❌ :8545 is held by PID $held_pid, which this repo did not start — refusing to kill it" >&2
    exit 1
  fi
fi

echo "🌐 Starting anvil fork (chain id 1337, :8545)…"
# NOTE: no `--block-time` on purpose — anvil defaults to AUTO-MINE (a block is produced only when a
# tx arrives), so the fork does NOT churn out empty blocks while it sits idle. Do NOT add interval
# mining or `--dump-state` (the inherited camel404 setup paired `--block-time 1` with a per-block
# state dump into .anvil-cache, which is what grew without bound). The only cache is the shared
# mainnet-state cache under ~/.foundry/cache, which is tiny. Stop the fork with `pnpm chain:stop`.
# --code-size-limit raised for the larger protocol contracts (over the 24KB Spurious Dragon limit).
anvil \
  --fork-url "$MAINNET_RPC_URL" \
  --chain-id 1337 \
  --port 8545 \
  --host 0.0.0.0 \
  --accounts 10 \
  --balance 10000 \
  --code-size-limit 30000 &
anvil_pid=$!
echo "$anvil_pid" > "$PID_FILE"

# Preserve the previous foreground/Ctrl-C behaviour: forward the signal to anvil and clean up the
# PID file on exit, whether that's a normal exit, an interrupt, or a term.
cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}
trap cleanup INT TERM EXIT

wait "$anvil_pid"
