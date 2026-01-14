#!/bin/bash
set -e

# Run the Node.js deployment script
node scripts/deploy-local.mjs

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Contract deployment failed!"
    echo ""
    echo "Possible causes:"
    echo "  - Contract compilation errors (run: cd contracts && forge build)"
    echo "  - Anvil not running on port 8545"
    echo "  - Missing node modules (run: npm install)"
    echo ""
    exit 1
fi

# Verify config was created
if [ ! -f "src/config/contracts.local.json" ]; then
    echo ""
    echo "⚠️  Warning: contracts.local.json not found"
    echo "   The deployment script should have created this file"
    exit 1
fi

echo "  ✓ Configuration verified"
