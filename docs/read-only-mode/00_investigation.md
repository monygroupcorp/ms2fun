# Read-Only Mode Investigation Report

**Date:** 2024  
**Branch:** `feature/read-only-mode`  
**Status:** Investigation Complete

## Executive Summary

This document investigates the current MS2.FUN architecture to identify entry points, wallet dependencies, and integration points for a parallel "Read-Only Mode" that allows blockchain reads without wallet connection.

## Current System Architecture

### Entry Points

1. **Primary Entry:** `index.html`
   - Loads critical CSS and JavaScript modules
   - Initializes theme system, marble config, and app.js
   - Main application entry via `src/index.js`

2. **Application Bootstrap:** `src/index.js`
   - Initializes `WalletService`
   - Sets up Router with multiple routes
   - Handles service initialization via `initializeServices()`
   - Emits events via `EventBus` for wallet state changes

3. **Wallet Gating:** `src/components/WalletSplash/WalletSplash.js`
   - Blocks UI until wallet is connected
   - Shows "Connect Your Wallet" splash screen
   - Auto-reconnects to last used wallet if available
   - Listens for `wallet:connected` and `wallet:disconnected` events

### Wallet Dependencies

#### `window.ethereum` Usage

**Primary References:**
- `src/services/WalletService.js` (lines 20-41, 63-78, 290-398)
  - Checks `typeof window.ethereum !== 'undefined'`
  - Uses `window.ethereum.request({ method: 'eth_requestAccounts' })`
  - Detects wallet types: `isRabby`, `isRainbow`, `isMetaMask`
  - Listens to `chainChanged` and `accountsChanged` events

- `src/services/BlockchainService.js` (lines 125-202, 523-789)
  - Creates `ethers.providers.Web3Provider(window.ethereum)`
  - Falls back to `JsonRpcProvider` if `window.ethereum` is undefined (line 200-201)
  - Uses `window.ethereum.request({ method: 'eth_chainId' })` for network detection
  - Handles network switching via `wallet_switchEthereumChain`

- `src/components/WalletConnector/WalletConnector.js` (lines 583-614)
  - Direct `window.ethereum` access for MetaMask
  - Creates `ethers.providers.Web3Provider(window.ethereum)`

- `src/routes/CultExecsPage.js` (lines 429-489)
  - Checks `window.ethereum` for existing accounts
  - Uses `window.ethereum.request({ method: 'eth_accounts' })` for auto-reconnect

#### Connect Wallet Button Logic

**Location:** `src/components/WalletConnector/WalletConnector.js`
- `handleConnectClick()` method (lines 381-421)
- Opens wallet selection modal
- Calls `handleWalletSelection(walletType)` (lines 526-697)
- Integrates with `WalletService.selectWallet()` and `WalletService.connect()`

**Alternative:** `src/components/WalletSplash/WalletSplash.js`
- Renders "SELECT WALLET" button in splash screen (line 215)
- Uses `WalletModal` component for selection
- Handles wallet connection via `handleWalletSelection()` (lines 413-434)

### Existing Provider Initialization

**Ethers.js Usage:**
- Imported via CDN: `https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js`
- Used in `WalletService.js` and `BlockchainService.js`
- Creates `Web3Provider` when `window.ethereum` exists
- Falls back to `JsonRpcProvider` with public RPC in `BlockchainService` (line 201):
  ```javascript
  const rpcUrl = this.networkConfig?.rpcUrl || 'https://ethereum.publicnode.com';
  this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  ```

**Note:** The fallback in `BlockchainService.initializeProvider()` already supports read-only mode, but it's only used when `window.ethereum` is undefined AND the service is initialized. The wallet gating prevents this path from being accessible.

### DOM Hooks & Scripts Assuming Wallet Presence

1. **WalletSplash Component:**
   - Blocks entire UI until `walletConnected === true`
   - Renders splash screen if wallet not connected
   - Prevents any content from loading

2. **Event Bus Dependencies:**
   - Components listen for `wallet:connected`, `wallet:detected`, `wallet:notdetected`
   - `BlockchainService` emits `blockchain:initialized` after provider setup
   - Many components assume wallet connection for contract interactions

3. **Route Handlers:**
   - `CultExecsPage.js` checks wallet connection before rendering
   - `HomePage.js` may have wallet dependencies (needs verification)

## Files to Modify/Augment

### Core Changes Required

1. **`index.html`**
   - Add CDN script tags for Helios and viem (after ethers.js, before app.js)
   - Include SRI hashes for security
   - Add script tag to load read-only mode bootstrap module

2. **New File: `src/services/ReadOnlyService.js`**
   - Initialize Helios light client (2s timeout)
   - Fallback to public RPC (viem) if Helios fails or exceeds timeout
   - Implement health-check rotation for RPC endpoints
   - Poll block numbers and log to console
   - Emit events for read-only state changes

3. **`src/index.js`**
   - Initialize `ReadOnlyService` in parallel with `WalletService`
   - Don't block app initialization on read-only mode
   - Allow read-only mode to run even when wallet is not connected

4. **`src/components/WalletSplash/WalletSplash.js`** (Optional Enhancement)
   - Add "Read-Only Mode" badge/indicator when active
   - Don't block UI if read-only mode is active (future enhancement)
   - For now, read-only mode runs in background and logs to console

### Integration Points

**Low-Risk Integration:**
- Read-only mode runs independently in background
- No changes to existing wallet flow required
- Console logging only (no UI changes in Phase 1)

**Future Integration Points:**
- Replace wallet gating with "Read-Only Mode" option
- Show block info in UI when in read-only mode
- Allow contract reads via read-only provider

## Current Blocking Points

1. **WalletSplash Component:**
   - Currently blocks all content until wallet connected
   - Read-only mode will run in background but won't bypass this gate (Phase 1)

2. **Service Initialization Order:**
   - `WalletService.initialize()` is called in `initializeServices()`
   - Read-only mode should initialize in parallel, not sequentially

3. **Provider Selection:**
   - `BlockchainService` prefers `window.ethereum` when available
   - Read-only mode needs separate provider instance

## Recommended Approach

1. **Phase 1 (Current):** Read-only mode runs in background, logs to console
2. **Phase 2 (Future):** Add UI indicator for read-only mode
3. **Phase 3 (Future):** Allow read-only mode to bypass wallet gate for viewing only

## Dependencies Analysis

**Current CDN Dependencies:**
- `ethers@5.2.0` (already loaded)
- `merkletreejs@latest` (already loaded)

**New Dependencies Required:**
- `@a16z/helios@latest` (light client, WASM-based)
- `viem@latest` (public RPC client, smaller than ethers)

**Bundle Size Impact:**
- Helios: ~500-800 KB (WASM + JS)
- viem: ~200-300 KB (minified)
- Total: ~700-1100 KB additional (acceptable for Phase 1)

## Network Configuration

**Current RPC Usage:**
- `BlockchainService` uses `https://ethereum.publicnode.com` as fallback
- Network config loaded from `/EXEC404/switch.json`
- Defaults to mainnet (chainId: 1) or Sepolia (chainId: 11155111)

**Read-Only Mode RPC Endpoints:**
1. `https://cloudflare-eth.com` (Cloudflare Ethereum Gateway)
2. `https://ethereum.publicnode.com` (PublicNode)
3. `https://rpc.ankr.com/eth` (Ankr Public RPC)

## Security Considerations

- No API keys required (public RPCs)
- SRI hashes for CDN scripts (prevent MITM)
- Read-only mode cannot sign transactions (safe)
- Helios light client verifies consensus (trustless reads)

## Next Steps

1. Create `ReadOnlyService.js` implementation
2. Add CDN script tags to `index.html`
3. Initialize read-only mode in `src/index.js`
4. Test with no wallet, wallet installed but not connected, and wallet connected scenarios

