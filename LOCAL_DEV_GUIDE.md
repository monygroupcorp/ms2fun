# Local Development Guide

## Overview

This guide explains how to run ms2fun locally with real contracts deployed to an Anvil mainnet fork.

**Deployment Method:** Direct ethers.js deployment via `scripts/deploy-local.mjs`
- Contracts are deployed using ethers.js directly (similar to Colasseum betatype)
- Forge is used only for compilation (`forge build`)
- This approach avoids transaction broadcasting issues with `forge script`

**Note:** MasterRegistryV1 is 60KB (exceeds 24KB mainnet limit). Anvil uses `--code-size-limit 100000` to allow local deployment. See `contracts/CONTRACT_SIZE_REFACTOR_TASK.md` for refactoring requirements before mainnet deployment.

## Quick Start

### Prerequisites
- Node.js installed
- Foundry installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- Git submodules initialized
- Ethers.js v5 (already in package.json)

### Step 1: Start Local Blockchain (Terminal 1)

**Option A: Use Environment Variable**
```bash
# Set RPC URL in your shell
export MAINNET_RPC_URL="https://ethereum.publicnode.com"
npm run chain:start
```

**Option B: Use .env File**
```bash
# Create .env from example (one-time)
cp .env.example .env
# Edit .env to add your RPC URL

# Then just run (no export needed)
npm run chain:start
```

**The script automatically:**
- Checks for MAINNET_RPC_URL in environment
- If not found, loads from .env file
- Falls back to the value in .env if both exist

**What this does:**
- Kills any existing Anvil process on port 8545
- Starts Anvil as a mainnet fork
- Deploys MasterRegistry and GlobalMessageRegistry
- Writes contract addresses to `src/config/contracts.local.json`
- Takes about 30 seconds total

**Expected output:**
```
✅ Local chain ready at http://127.0.0.1:8545
📄 Contract addresses: src/config/contracts.local.json
```

### Step 2: Start Frontend (Terminal 2)

```bash
# Start the development server
npm run dev
```

**Expected output:**
```
Server running at http://localhost:3000
```

### Step 3: Open Browser

Navigate to: **http://localhost:3000**

## Network Modes

The frontend auto-detects which mode to use:

### 1. Local Development (Real Contracts)
- URL: `http://localhost:3000`
- Uses: Anvil fork on port 8545
- Contracts: Deployed locally (see `src/config/contracts.local.json`)
- ABIs: Read from `contracts/out/` (Forge build artifacts)
- Mock Mode: **OFF** ✅

### 2. Mock Mode (No Blockchain)
- URL: `http://localhost:3000?network=mock`
- Uses: Mock data (no chain required)
- Contracts: Fake addresses
- Mock Mode: **ON**

### 3. Mainnet (Production)
- URL: `https://ms2.fun` (when deployed)
- Uses: Real Ethereum mainnet
- Contracts: Production addresses (see `src/config/contracts.mainnet.json`)
- ABIs: Read from `contracts/abi/` (exported)

## Testing the Connection

### Verify Anvil is Running

```bash
# Check if Anvil is responding
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://127.0.0.1:8545

# Should return: {"jsonrpc":"2.0","id":1,"result":"0x539"}
# 0x539 = 1337 in decimal (Anvil's chain ID)
```

### Check Contract Addresses

```bash
# View deployed contract addresses
cat src/config/contracts.local.json | jq
```

### Browser Console Checks

Open DevTools (F12) and check the console:

```javascript
// Check network mode
const network = detectNetwork();
console.log('Network mode:', network.mode); // Should show: "local"

// Check if using mocks
console.log('Using mocks:', USE_MOCK_SERVICES); // Should show: false

// Check loaded contracts
console.log('Config loaded:', contractConfig);
```

## Troubleshooting

### Port 8545 Already in Use

```bash
# Kill existing Anvil process
lsof -ti:8545 | xargs kill -9

# Or restart chain (does this automatically)
npm run chain:start
```

### Contracts Not Deployed

```bash
# Check if contracts.local.json exists
ls -la src/config/contracts.local.json

# If missing, ensure Anvil is running, then re-run deployment
node scripts/deploy-local.mjs

# Or restart the entire chain (recommended)
npm run chain:start
```

### Frontend Shows Mock Data

Check the URL - if you see `?network=mock` in the URL, remove it:
- ❌ `http://localhost:3000?network=mock` (uses mocks)
- ✅ `http://localhost:3000` (uses Anvil)

### ABI Loading Errors

```bash
# Rebuild contracts to generate ABIs
cd contracts
forge build

# ABIs are in: contracts/out/ContractName.sol/ContractName.json
```

## Current Deployment Status

### ✅ Deployed (Phase 1)
- MasterRegistryV1 (with proxy)
- GlobalMessageRegistry
- FactoryApprovalGovernance (auto-deployed)
- VaultApprovalGovernance (auto-deployed)

### ⏳ Not Yet Deployed
- EXEC Token (exists on mainnet fork, just need address)
- UltraAlignmentVault templates
- ERC404Factory
- ERC1155Factory
- Test instances and seed data

## Resetting Everything

```bash
# Stop Anvil
lsof -ti:8545 | xargs kill -9

# Start fresh
npm run chain:start

# This creates a completely fresh state:
# - New contract addresses
# - Fresh mainnet fork
# - Empty transaction history
```

## EXEC Token on Mainnet Fork

Since we're forking mainnet, the real EXEC token already exists! We just need its address.

**To find it:**
```bash
# Check your EXEC404 directory for the address
# Or look it up on Etherscan
```

Once you have the address, you can interact with it directly on the fork.

## File Structure

```
ms2fun/
├── src/
│   ├── config/
│   │   ├── network.js              # Network detection
│   │   ├── contractConfig.js       # Address management
│   │   ├── contracts.local.json    # Auto-generated (Anvil)
│   │   └── contracts.mainnet.json  # Hand-maintained (production)
│   └── utils/
│       └── abiLoader.js            # Hybrid ABI loading
├── contracts/                       # Git submodule
│   ├── out/                        # Forge build artifacts (ABIs)
│   └── script/
│       └── DeployLocal.s.sol       # Deployment script
└── scripts/
    └── local-chain/
        ├── setup.sh                # One-time setup
        ├── start-chain.sh          # Start Anvil + deploy
        └── deploy-and-seed.sh      # Run deployment script
```

## Next Steps

1. **Test basic connection** - Verify frontend loads and connects to Anvil
2. **Add EXEC token address** - Use mainnet EXEC token on the fork
3. **Deploy vault templates** - With proper EXEC token reference
4. **Deploy factories** - ERC404Factory and ERC1155Factory
5. **Seed test data** - Create instances, vaults, and activity

## Useful Commands

```bash
# Start development
npm run chain:start   # Terminal 1 (leave running)
npm run dev          # Terminal 2

# Check status
ps aux | grep anvil                    # Is Anvil running?
lsof -i:8545                          # What's on port 8545?
curl http://127.0.0.1:8545            # Is RPC responding?

# Rebuild contracts
cd contracts && forge build

# Update contracts from upstream
npm run contracts:update

# Reset everything
npm run chain:reset  # Same as chain:start
```

## Support

If you encounter issues:
1. Check the console output from `npm run chain:start`
2. Look at browser DevTools console
3. Verify Anvil is running: `lsof -i:8545`
4. Check contract addresses: `cat src/config/contracts.local.json`
