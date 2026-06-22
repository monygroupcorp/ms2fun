#!/usr/bin/env bash
# Start an anvil mainnet-fork on :8545 (chain id 1337) for local dev.
# Reads MAINNET_RPC_URL from the repo-root .env (never printed). After this is up,
# run `pnpm chain:deploy` to deploy the protocol and write the frontend config.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

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

# Free port 8545 if something is already on it.
if lsof -ti:8545 >/dev/null 2>&1; then
  echo "⚠️  Killing existing process on :8545"
  lsof -ti:8545 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo "🌐 Starting anvil fork (chain id 1337, :8545)…"
# --code-size-limit raised for the larger protocol contracts (over the 24KB Spurious Dragon limit).
exec anvil \
  --fork-url "$MAINNET_RPC_URL" \
  --chain-id 1337 \
  --port 8545 \
  --host 127.0.0.1 \
  --accounts 10 \
  --balance 10000 \
  --code-size-limit 30000
