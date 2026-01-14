#!/bin/bash
set -e

echo "🔧 Setting up local development environment..."

# Check if Foundry is installed
if ! command -v forge &> /dev/null; then
    echo ""
    echo "❌ Foundry not found!"
    echo ""
    echo "Install Foundry:"
    echo "  curl -L https://foundry.paradigm.xyz | bash"
    echo "  foundryup"
    echo ""
    echo "Then run: npm run setup:local"
    exit 1
fi

echo "  ✓ Foundry installed ($(forge --version | head -n1))"

# Initialize git submodule
echo ""
echo "📦 Initializing contracts submodule..."
git submodule update --init --recursive

if [ ! -d "contracts/src" ]; then
    echo "❌ Contracts submodule not initialized correctly!"
    exit 1
fi

echo "  ✓ Submodule initialized"

# Build contracts
echo ""
echo "🔨 Building contracts..."
cd contracts
forge build

if [ ! -d "out" ]; then
    echo "❌ Contract build failed!"
    exit 1
fi

cd ..
echo "  ✓ Contracts built successfully"

# Create initial config directories
echo ""
echo "📁 Creating config directories..."
mkdir -p src/config
echo "  ✓ Config directories ready"

# Create .gitignore entry for local config
if ! grep -q "contracts.local.json" .gitignore 2>/dev/null; then
    echo ""
    echo "📝 Updating .gitignore..."
    echo "# Local development config (auto-generated)" >> .gitignore
    echo "src/config/contracts.local.json" >> .gitignore
    echo "  ✓ .gitignore updated"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. npm run chain:start  (Terminal 1)"
echo "  2. npm run dev          (Terminal 2)"
