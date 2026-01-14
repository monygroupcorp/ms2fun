#!/bin/bash
set -e

echo "🚀 Starting local Anvil chain..."

# Try to load MAINNET_RPC_URL from environment or .env file
if [ -z "$MAINNET_RPC_URL" ]; then
    # Try to load from .env file if it exists
    if [ -f .env ]; then
        echo "  Loading environment from .env file..."
        export $(cat .env | grep -v '^#' | xargs)
    fi
fi

# Check if MAINNET_RPC_URL is now set
if [ -z "$MAINNET_RPC_URL" ]; then
    echo ""
    echo "❌ MAINNET_RPC_URL not found!"
    echo ""
    echo "Options to fix:"
    echo ""
    echo "  Option 1: Set environment variable"
    echo "    export MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
    echo "    npm run chain:start"
    echo ""
    echo "  Option 2: Create .env file"
    echo "    cp .env.example .env"
    echo "    # Edit .env and add your RPC URL"
    echo "    npm run chain:start"
    echo ""
    echo "Get a free RPC URL from:"
    echo "  - Alchemy: https://www.alchemy.com/"
    echo "  - Infura: https://www.infura.io/"
    echo "  - Or use public endpoint: https://ethereum.publicnode.com"
    echo ""
    exit 1
else
    echo "  ✓ MAINNET_RPC_URL configured"
fi

# Check for existing process on port 8545
echo "🔧 Checking for existing Anvil process..."
if lsof -ti:8545 > /dev/null 2>&1; then
    echo "  ⚠️  Killing existing process on port 8545..."
    lsof -ti:8545 | xargs kill -9 2>/dev/null || true
    sleep 1
    echo "  ✓ Port 8545 cleared"
else
    echo "  ✓ Port 8545 available"
fi

# Start Anvil fork
echo ""
echo "🌐 Starting Anvil fork from mainnet..."
echo "  Fork URL: ${MAINNET_RPC_URL:0:40}..."
echo "  Chain ID: 1337"
echo "  Port: 8545"
echo ""

# Start Anvil in background with unlocked accounts
# Using Anvil's default test accounts with known private keys
# Note: --code-size-limit increased to allow deployment of MasterRegistryV1 (60KB)
#       This is for local testing only - mainnet deployment requires refactoring
anvil \
    --fork-url "$MAINNET_RPC_URL" \
    --chain-id 1337 \
    --port 8545 \
    --host 127.0.0.1 \
    --accounts 10 \
    --balance 10000 \
    --code-size-limit 100000 \
    > /tmp/anvil.log 2>&1 &

ANVIL_PID=$!
echo "  ✓ Anvil started (PID: $ANVIL_PID)"

# Wait for RPC to be ready
echo ""
echo "⏳ Waiting for RPC to be ready..."
for i in {1..30}; do
    if curl -s -X POST \
        -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        http://127.0.0.1:8545 > /dev/null 2>&1; then
        echo "  ✓ RPC ready!"
        break
    fi

    if [ $i -eq 30 ]; then
        echo "  ❌ RPC failed to start within 30 seconds"
        echo ""
        echo "Check Anvil logs:"
        echo "  tail /tmp/anvil.log"
        kill $ANVIL_PID 2>/dev/null || true
        exit 1
    fi

    sleep 1
done

# Build contracts
echo ""
echo "🔨 Building contracts..."
cd contracts
forge build
if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Contract build failed!"
    echo ""
    echo "Check compilation errors above and fix them before deploying."
    echo ""
    kill $ANVIL_PID 2>/dev/null || true
    exit 1
fi
cd ..
echo "  ✓ Contracts built successfully"

# Run deployment and seeding
echo ""
bash scripts/local-chain/deploy-and-seed.sh

echo ""
echo "✅ Local chain ready at http://127.0.0.1:8545"
echo "📄 Contract addresses: src/config/contracts.local.json"
echo ""
echo "🎯 Next step: npm run dev"
echo ""
echo "To stop Anvil:"
echo "  kill $ANVIL_PID"
