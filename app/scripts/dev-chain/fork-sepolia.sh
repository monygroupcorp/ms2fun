#!/usr/bin/env bash
# Start an anvil SEPOLIA-fork on :8546 — the second dev channel.
#
# This is a sibling of fork.sh, not a replacement for it. fork.sh forks MAINNET on :8545 at chain id
# 1337 and is what `pnpm chain:fork` still starts; this one forks SEPOLIA on :8546 and keeps anvil's
# forked chain id (11155111). Both can run at once; the channels are told apart by PORT.
#
# WHY THE CHAIN ID IS NOT OVERRIDDEN. The Sepolia deploy and seed scripts hard-require chain 11155111
# (`SeedSepolia.s.sol`, `SeedSepoliaShared.sol`), and the point of this channel is to see exactly what
# the public testnet will hold — so the fork keeps the id it forked. Never pass `--chain-id` here.
#
# --auto-impersonate is load-bearing: `DeploySepolia.run()` requires `msg.sender` to be the address
# the CreateX salts are bound to, and nobody holds that key. The deploy orchestrator funds it with
# `anvil_setBalance` and forge signs `--unlocked`.
#
# Reads SEPOLIA_RPC_URL from env or the repo-root .env (the value is never printed). It must be an
# ARCHIVE endpoint: the deploy and seed read historical state, and a non-archive, load-balanced
# public endpoint fails partway through with missing-trie-node errors.
#
# After this is up: `pnpm chain:deploy:sepolia`, then `pnpm chain:check:sepolia`.
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

# Load SEPOLIA_RPC_URL from env or repo-root .env (value is never echoed).
if [ -z "${SEPOLIA_RPC_URL:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

if [ -z "${SEPOLIA_RPC_URL:-}" ]; then
  echo "❌ SEPOLIA_RPC_URL not set (export it or add it to $REPO_ROOT/.env)" >&2
  echo "   It must be an ARCHIVE Sepolia endpoint; a non-archive one fails mid-deploy." >&2
  exit 1
fi
echo "✓ SEPOLIA_RPC_URL configured"

# Same port-ownership rule as fork.sh: only reclaim :8546 when the holder is an anvil this repo
# started (tracked in PID_FILE), and never guess when no probe tool is installed.
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

echo "🌐 Starting anvil Sepolia fork (chain id 11155111, :$PORT)…"
# Auto-mine on purpose (no --block-time), exactly as the mainnet channel: the fork produces a block
# when a transaction arrives and sits idle otherwise. --code-size-limit is raised for the protocol
# contracts, which exceed the Spurious Dragon limit. Stop with `pnpm chain:stop:sepolia`.
anvil \
  --fork-url "$SEPOLIA_RPC_URL" \
  --port "$PORT" \
  --host 0.0.0.0 \
  --accounts 10 \
  --balance 10000 \
  --auto-impersonate \
  --code-size-limit 30000 &
anvil_pid=$!
mkdir -p "$PID_DIR"
echo "$anvil_pid" > "$PID_FILE"

cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}
trap cleanup INT TERM EXIT

wait "$anvil_pid"
