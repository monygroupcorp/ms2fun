# Local Chain Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic `scripts/deploy-local.mjs` with a modular system that uses forge scripts for contract deployment and supports swappable seeding scenarios.

**Architecture:** `run-local.mjs` orchestrates: (1) `deploy-contracts.mjs` shells out to `forge script` for contracts that have forge scripts (MasterRegistry, ERC1155Factory, ERC404Factory) and uses ethers.js for the rest (vaults, hook factory, aggregator); (2) a scenario module (`scenarios/default.mjs` etc.) handles seeding using building blocks from `seed-common.mjs`; (3) `write-config.mjs` writes `contracts.local.json`.

**Tech Stack:** Node.js ESM, ethers v5, forge (Foundry), Anvil

---

## Context You Need

- Old monolith: `scripts/deploy-local.mjs` (1881 lines) — **will be deleted at the end**
- Forge deployment scripts: `contracts/script/DeployMaster.s.sol`, `DeployERC1155Factory.s.sol`, `DeployERC404Factory.s.sol`
- Forge writes broadcast artifacts to: `contracts/broadcast/<ScriptName>.s.sol/1337/run-latest.json`
- All Anvil default private keys and addresses are in `deploy-local.mjs` lines 22-33
- Mainnet addresses (fork) are in `deploy-local.mjs` lines 35-49
- Hook salt miner: `scripts/lib/hookSaltMiner.mjs`
- Config output: `src/config/contracts.local.json`
- Chain ID used locally: `1337`

---

## Task 1: Fix Forge Scripts — Strip PRIVATE_KEY

The three forge deployment scripts read `vm.envUint("PRIVATE_KEY")` which means they require a private key in env. For production use with `--account keystore`, and for clean local use, the scripts should use bare `vm.startBroadcast()` — the key is provided by the caller via CLI flags.

**Files:**
- Modify: `contracts/script/DeployMaster.s.sol`
- Modify: `contracts/script/DeployERC1155Factory.s.sol`
- Modify: `contracts/script/DeployERC404Factory.s.sol`

**Step 1: Fix DeployMaster.s.sol**

Replace:
```solidity
uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
vm.startBroadcast(deployerPrivateKey);
```
With:
```solidity
vm.startBroadcast();
```
Remove the `deployerPrivateKey` variable entirely.

**Step 2: Fix DeployERC1155Factory.s.sol**

Same change: remove `uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");` and change `vm.startBroadcast(deployerPrivateKey)` to `vm.startBroadcast()`.

Keep all the other `vm.env*` calls (MASTER_REGISTRY, INSTANCE_TEMPLATE, etc.) — those will be set by `deploy-contracts.mjs` as env vars.

**Step 3: Fix DeployERC404Factory.s.sol**

Same change. Remove `deployerPrivateKey`, use `vm.startBroadcast()`.

**Step 4: Verify forge builds cleanly**

```bash
cd contracts && forge build
```
Expected: no errors.

**Step 5: Commit**

```bash
git add contracts/script/DeployMaster.s.sol contracts/script/DeployERC1155Factory.s.sol contracts/script/DeployERC404Factory.s.sol
git commit -m "fix: remove PRIVATE_KEY env reads from forge scripts, use caller-provided key"
```

---

## Task 2: Create Directory Structure

**Files:**
- Create: `scripts/local-chain/scenarios/` (directory)
- Create: `scripts/local-chain/lib/` (directory)
- Move: `scripts/lib/hookSaltMiner.mjs` → `scripts/local-chain/lib/hookSaltMiner.mjs`

**Step 1: Create directories and move hook miner**

```bash
mkdir -p scripts/local-chain/scenarios
mkdir -p scripts/local-chain/lib
cp scripts/lib/hookSaltMiner.mjs scripts/local-chain/lib/hookSaltMiner.mjs
```

**Step 2: Verify the copy**

```bash
ls scripts/local-chain/lib/
```
Expected: `hookSaltMiner.mjs`

**Step 3: Commit**

```bash
git add scripts/local-chain/
git commit -m "chore: create local-chain directory structure, move hookSaltMiner"
```

---

## Task 3: Create `write-config.mjs`

Extract config writing into a standalone module. This module takes all deployed addresses and state, and writes `src/config/contracts.local.json`.

**Files:**
- Create: `scripts/local-chain/write-config.mjs`

**Step 1: Create write-config.mjs**

Look at `deploy-local.mjs` lines ~1700-1790 to see the full config object structure, then create:

```javascript
// scripts/local-chain/write-config.mjs
import { promises as fs } from 'fs'

const CONFIG_PATH = 'src/config/contracts.local.json'

/**
 * Write contracts.local.json with all deployed addresses and state.
 *
 * @param {object} params
 * @param {object} params.core - Core contract addresses
 * @param {string} params.core.masterRegistry
 * @param {string} params.core.globalMessageRegistry
 * @param {string} params.core.featuredQueueManager
 * @param {string} params.core.queryAggregator
 * @param {string} params.core.hookFactory
 * @param {object} params.factories - Factory addresses { erc1155, erc404 }
 * @param {object[]} params.vaults - Array of vault info objects
 * @param {object[]} params.instances - Array of instance info objects
 * @param {object} params.testAccounts - Test account addresses
 * @param {object} params.mainnetAddresses - Mainnet fork addresses
 * @param {object} params.userHoldings - Summary of what USER_ADDRESS holds
 */
export async function writeConfig({
  core,
  factories,
  vaults,
  instances,
  testAccounts,
  mainnetAddresses,
  userHoldings,
}) {
  const config = {
    network: 'local',
    chainId: 1337,
    rpcUrl: 'http://127.0.0.1:8545',
    deployedAt: new Date().toISOString(),
    contracts: {
      masterRegistry: core.masterRegistry,
      globalMessageRegistry: core.globalMessageRegistry,
      featuredQueueManager: core.featuredQueueManager,
      queryAggregator: core.queryAggregator,
      hookFactory: core.hookFactory,
      erc1155Factory: factories.erc1155,
      erc404Factory: factories.erc404,
    },
    vaults,
    instances,
    testAccounts,
    mainnetAddresses,
    userHoldings,
  }

  await fs.mkdir('src/config', { recursive: true })
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
  console.log(`   ✓ Configuration written to ${CONFIG_PATH}`)
  return config
}
```

**Step 2: Commit**

```bash
git add scripts/local-chain/write-config.mjs
git commit -m "feat: extract write-config.mjs from deploy-local.mjs"
```

---

## Task 4: Create `deploy-contracts.mjs`

This module handles all contract deployment. It uses `forge script` for the three contracts that have forge scripts, and ethers.js for the rest (vaults, hook factory, aggregator, registration). It returns a `core` and `factories` addresses object.

**Files:**
- Create: `scripts/local-chain/deploy-contracts.mjs`

**Step 1: Create the file**

```javascript
// scripts/local-chain/deploy-contracts.mjs
import { execSync } from 'child_process'
import { promises as fs } from 'fs'
import { ethers } from 'ethers'
import { mineHookSalt } from './lib/hookSaltMiner.mjs'

const RPC = 'http://127.0.0.1:8545'
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const CHAIN_ID = '1337'

// Mainnet addresses available on fork
export const MAINNET_ADDRESSES = {
  execToken: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2',
  ms2Token: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820',
  cultToken: '0x0000000000c5dc95539589fbD24BE07c6C14eCa4',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  uniswapV4PoolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
  uniswapV4PositionManager: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e',
  uniswapV4Quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
  uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  uniswapV2Router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  uniswapV2Factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
}

/**
 * Run a forge script with the given env vars.
 * Caller provides key via --private-key (Anvil default account 0).
 */
function runForgeScript(scriptPath, envVars = {}) {
  const env = {
    ...process.env,
    ...envVars,
  }
  execSync(
    `forge script ${scriptPath} --rpc-url ${RPC} --private-key ${ANVIL_KEY} --broadcast --chain-id ${CHAIN_ID}`,
    { cwd: 'contracts', stdio: 'inherit', env }
  )
}

/**
 * Read the deployed address of the first contract created in a forge broadcast run.
 * Broadcast artifacts are at contracts/broadcast/<Script>.s.sol/<chainId>/run-latest.json
 */
async function readBroadcastAddress(scriptName) {
  const broadcastPath = `contracts/broadcast/${scriptName}.s.sol/${CHAIN_ID}/run-latest.json`
  const raw = await fs.readFile(broadcastPath, 'utf8')
  const broadcast = JSON.parse(raw)
  // transactions[0] is the first deployment; contractAddress is the deployed address
  const deployTx = broadcast.transactions.find(tx => tx.transactionType === 'CREATE')
  if (!deployTx) throw new Error(`No CREATE transaction found in ${broadcastPath}`)
  return deployTx.contractAddress
}

/**
 * Read ALL deployed addresses from a broadcast (for scripts that deploy multiple contracts).
 */
async function readAllBroadcastAddresses(scriptName) {
  const broadcastPath = `contracts/broadcast/${scriptName}.s.sol/${CHAIN_ID}/run-latest.json`
  const raw = await fs.readFile(broadcastPath, 'utf8')
  const broadcast = JSON.parse(raw)
  return broadcast.transactions
    .filter(tx => tx.transactionType === 'CREATE')
    .map(tx => ({ contractName: tx.contractName, address: tx.contractAddress }))
}

/**
 * Load ABI from forge build artifacts.
 */
async function loadAbi(contractName) {
  const artifactPath = `contracts/out/${contractName}.sol/${contractName}.json`
  const raw = await fs.readFile(artifactPath, 'utf8')
  return JSON.parse(raw).abi
}

/**
 * Deploy all contracts and return addresses.
 * Uses forge scripts where available, ethers.js for the rest.
 */
export async function deployContracts() {
  const provider = new ethers.providers.JsonRpcProvider(RPC)
  const deployer = new ethers.Wallet(ANVIL_KEY, provider)

  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 1: MASTER REGISTRY (forge script)')
  console.log('════════════════════════════════════════════════════')

  runForgeScript('script/DeployMaster.s.sol')

  // DeployMaster deploys impl first, then proxy
  const masterDeployments = await readAllBroadcastAddresses('DeployMaster')
  const implDeployment = masterDeployments.find(d => d.contractName === 'MasterRegistryV1')
  const proxyDeployment = masterDeployments.find(d => d.contractName === 'MasterRegistry')
  const masterRegistryProxy = proxyDeployment.address
  console.log('   ✓ MasterRegistry proxy:', masterRegistryProxy)

  // The outer MasterRegistry proxy wraps an inner ERC1967 proxy.
  // Call getProxyAddress() on the outer to get the inner (all calls go to inner).
  const outerAbi = await loadAbi('MasterRegistry')
  const outerContract = new ethers.Contract(masterRegistryProxy, outerAbi, deployer)
  const innerProxyAddress = await outerContract.getProxyAddress()
  console.log('   ✓ MasterRegistry inner proxy:', innerProxyAddress)

  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 2: SUPPORTING REGISTRIES (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // GlobalMessageRegistry
  const gmrAbi = await loadAbi('GlobalMessageRegistry')
  const gmrFactory = new ethers.ContractFactory(gmrAbi, (await fs.readFile('contracts/out/GlobalMessageRegistry.sol/GlobalMessageRegistry.json', 'utf8') |> JSON.parse).bytecode.object, deployer)
  const gmr = await gmrFactory.deploy()
  await gmr.deployed()
  console.log('   ✓ GlobalMessageRegistry:', gmr.address)

  // FeaturedQueueManager
  const fqmAbi = await loadAbi('FeaturedQueueManager')
  const fqmBytecode = JSON.parse(await fs.readFile('contracts/out/FeaturedQueueManager.sol/FeaturedQueueManager.json', 'utf8')).bytecode.object
  const fqmFactory = new ethers.ContractFactory(fqmAbi, fqmBytecode, deployer)
  const fqm = await fqmFactory.deploy()
  await fqm.deployed()
  console.log('   ✓ FeaturedQueueManager:', fqm.address)

  // Register GlobalMessageRegistry in MasterRegistry
  const registryAbi = await loadAbi('MasterRegistryV1')
  const registry = new ethers.Contract(innerProxyAddress, registryAbi, deployer)
  // (registration calls — check current MasterRegistryV1 interface for exact method)
  // await registry.setGlobalMessageRegistry(gmr.address)

  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 3: HOOK FACTORY & VAULTS (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // UltraAlignmentHookFactory
  const hookFactoryAbi = await loadAbi('UltraAlignmentHookFactory')
  const hookFactoryBytecode = JSON.parse(await fs.readFile('contracts/out/UltraAlignmentHookFactory.sol/UltraAlignmentHookFactory.json', 'utf8')).bytecode.object
  const hookFactoryContract = new ethers.ContractFactory(hookFactoryAbi, hookFactoryBytecode, deployer)
  const hookFactory = await hookFactoryContract.deploy(MAINNET_ADDRESSES.uniswapV4PoolManager)
  await hookFactory.deployed()
  console.log('   ✓ UltraAlignmentHookFactory:', hookFactory.address)

  // Deploy vaults (requires hook salt mining — see old deploy-local.mjs steps 5b/5c)
  // This section needs to be ported from deploy-local.mjs lines ~459-555
  // using mineHookSalt() from ./lib/hookSaltMiner.mjs
  // TODO: port vault deployment from deploy-local.mjs

  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 4: PROJECT FACTORIES (forge scripts)')
  console.log('════════════════════════════════════════════════════')

  // ERC1155Factory needs: masterRegistry, instanceTemplate, creator, creatorFeeBps
  // instanceTemplate = deploy ERC1155Instance first (ethers.js)
  const erc1155InstanceAbi = await loadAbi('ERC1155Instance')
  const erc1155InstanceBytecode = JSON.parse(await fs.readFile('contracts/out/ERC1155Instance.sol/ERC1155Instance.json', 'utf8')).bytecode.object
  const erc1155InstanceFactory = new ethers.ContractFactory(erc1155InstanceAbi, erc1155InstanceBytecode, deployer)
  const erc1155Template = await erc1155InstanceFactory.deploy()
  await erc1155Template.deployed()
  console.log('   ✓ ERC1155Instance template:', erc1155Template.address)

  runForgeScript('script/DeployERC1155Factory.s.sol', {
    MASTER_REGISTRY: innerProxyAddress,
    INSTANCE_TEMPLATE: erc1155Template.address,
    CREATOR: DEPLOYER_ADDRESS,
    CREATOR_FEE_BPS: '250',
  })
  const erc1155FactoryAddress = await readBroadcastAddress('DeployERC1155Factory')
  console.log('   ✓ ERC1155Factory:', erc1155FactoryAddress)

  // ERC404Factory needs: masterRegistry, instanceTemplate, v4PoolManager, weth, protocol, creator, creatorFeeBps, creatorGraduationFeeBps
  const erc404InstanceAbi = await loadAbi('ERC404BondingInstance')
  const erc404InstanceBytecode = JSON.parse(await fs.readFile('contracts/out/ERC404BondingInstance.sol/ERC404BondingInstance.json', 'utf8')).bytecode.object
  const erc404InstanceFactory = new ethers.ContractFactory(erc404InstanceAbi, erc404InstanceBytecode, deployer)
  const erc404Template = await erc404InstanceFactory.deploy()
  await erc404Template.deployed()
  console.log('   ✓ ERC404BondingInstance template:', erc404Template.address)

  runForgeScript('script/DeployERC404Factory.s.sol', {
    MASTER_REGISTRY: innerProxyAddress,
    INSTANCE_TEMPLATE: erc404Template.address,
    V4_POOL_MANAGER: MAINNET_ADDRESSES.uniswapV4PoolManager,
    WETH: MAINNET_ADDRESSES.weth,
    PROTOCOL: DEPLOYER_ADDRESS,
    CREATOR: DEPLOYER_ADDRESS,
    CREATOR_FEE_BPS: '100',
    CREATOR_GRADUATION_FEE_BPS: '200',
  })
  const erc404FactoryAddress = await readBroadcastAddress('DeployERC404Factory')
  console.log('   ✓ ERC404Factory:', erc404FactoryAddress)

  // TODO: Deploy QueryAggregator, register factories in MasterRegistry
  // (port from deploy-local.mjs phases 4 & 5)

  return {
    core: {
      masterRegistry: innerProxyAddress,
      globalMessageRegistry: gmr.address,
      featuredQueueManager: fqm.address,
      queryAggregator: null, // TODO
      hookFactory: hookFactory.address,
    },
    factories: {
      erc1155: erc1155FactoryAddress,
      erc404: erc404FactoryAddress,
    },
    provider,
    deployer,
  }
}
```

> **Note:** This file has TODOs for vault deployment and QueryAggregator. Those get filled in Task 5 by porting from the old deploy-local.mjs. The pipe operator (`|>`) used above is stage-2 syntax — replace with `JSON.parse(await fs.readFile(..., 'utf8'))` directly.

**Step 2: Commit skeleton**

```bash
git add scripts/local-chain/deploy-contracts.mjs
git commit -m "feat: add deploy-contracts.mjs skeleton with forge script integration"
```

---

## Task 5: Port Vault Deployment Into `deploy-contracts.mjs`

The vault deployment in `deploy-local.mjs` (lines ~459-555) is complex: it mines a hook salt, deploys UltraAlignmentVault, creates a hook via hookFactory, then registers the vault in MasterRegistry. Port this verbatim from the old script.

**Files:**
- Modify: `scripts/local-chain/deploy-contracts.mjs`

**Step 1: Read the vault deployment section**

Open `scripts/deploy-local.mjs` and read lines 459-555 carefully. You need to understand:
- What constructor args UltraAlignmentVault takes
- How `mineHookSalt()` is called
- How `hookFactory.createHook()` is called
- How vault registration in MasterRegistry works (which method on which contract)

**Step 2: Port vault deployment**

Replace the `// TODO: port vault deployment` comment in `deploy-contracts.mjs` with the ported code. Use the same pattern as the old script but adapted to the new module structure.

Helper for loading bytecode cleanly (add at top of file):

```javascript
async function loadArtifact(contractName, solFile) {
  const path = `contracts/out/${solFile || contractName + '.sol'}/${contractName}.json`
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

async function loadAbi(contractName, solFile) {
  return (await loadArtifact(contractName, solFile)).abi
}

async function loadBytecode(contractName, solFile) {
  return (await loadArtifact(contractName, solFile)).bytecode.object
}
```

**Step 3: Port QueryAggregator deployment and factory registration**

From `deploy-local.mjs` lines ~608-670, port:
- QueryAggregator deployment
- Factory registration in MasterRegistry (registering erc1155Factory and erc404Factory as approved factories)

**Step 4: Commit**

```bash
git add scripts/local-chain/deploy-contracts.mjs
git commit -m "feat: port vault deployment and factory registration into deploy-contracts.mjs"
```

---

## Task 6: Create `seed-common.mjs`

Extract all seeding building blocks from `deploy-local.mjs` into reusable functions.

**Files:**
- Create: `scripts/local-chain/seed-common.mjs`

**Step 1: Identify what to extract**

From `deploy-local.mjs`, extract these functions verbatim:
- `createERC404Instance()` (lines ~66-156)
- `getRandomMessage()` (lines ~157-170)
- `buyOnBondingCurve()` (lines ~171-199)
- `activateBondingCurve()` (lines ~200-230 approx)
- `createERC1155Instance()` (find the equivalent function)
- Any other helper functions used by the seeding phases

Also add a `fundAccounts()` helper that sends ETH from deployer to test accounts.

**Step 2: Create the file**

```javascript
// scripts/local-chain/seed-common.mjs
import { ethers } from 'ethers'
import { promises as fs } from 'fs'

export const TEST_ACCOUNTS = {
  owner:      { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' },
  trader:     { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' },
  collector:  { address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' },
  governance: { address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' },
}

// [Port createERC404Instance, buyOnBondingCurve, activateBondingCurve, etc. here]
// Export each function so scenarios can import them.

export async function fundAccounts(provider, deployer) {
  console.log('   Funding test accounts...')
  for (const [name, account] of Object.entries(TEST_ACCOUNTS)) {
    if (account.address === deployer.address) continue
    await deployer.sendTransaction({
      to: account.address,
      value: ethers.utils.parseEther('100'),
    })
    console.log(`   ✓ Funded ${name}: 100 ETH`)
  }
}

export async function loadAbi(contractName) {
  const path = `contracts/out/${contractName}.sol/${contractName}.json`
  return JSON.parse(await fs.readFile(path, 'utf8')).abi
}
```

**Step 3: Commit**

```bash
git add scripts/local-chain/seed-common.mjs
git commit -m "feat: extract seed-common.mjs building blocks from deploy-local.mjs"
```

---

## Task 7: Create Scenario Files

**Files:**
- Create: `scripts/local-chain/scenarios/default.mjs`
- Create: `scripts/local-chain/scenarios/empty.mjs`
- Create: `scripts/local-chain/scenarios/busy.mjs`
- Create: `scripts/local-chain/scenarios/proposal.mjs`

**Step 1: Create `scenarios/default.mjs`**

Port the seeding phases (6-11) from `deploy-local.mjs` lines ~674-1790. This creates the Demo-Gallery, Dynamic-Pricing, Mixed-Supply ERC1155s, and Early-Launch/Active-Project/Graduated ERC404s, does buys, mints, vault seeding, and ownership transfers to USER_ADDRESS.

```javascript
// scripts/local-chain/scenarios/default.mjs
import { ethers } from 'ethers'
import { TEST_ACCOUNTS, fundAccounts, createERC404Instance, createERC1155Instance, buyOnBondingCurve } from '../seed-common.mjs'

/**
 * Default scenario: minimal working state with a few instances at different stages.
 * Mirrors what deploy-local.mjs previously seeded.
 */
export async function seed(addresses, provider, deployer, userAddress) {
  await fundAccounts(provider, deployer)

  // Port seeding phases 6-11 from deploy-local.mjs here
  // Return instance summary for write-config
  return {
    instances: [],  // fill in
    userHoldings: {},
  }
}
```

**Step 2: Create `scenarios/empty.mjs`**

```javascript
// scripts/local-chain/scenarios/empty.mjs

/**
 * Empty scenario: contracts deployed, nothing seeded.
 * Useful for testing first-time user experience.
 */
export async function seed(_addresses, _provider, _deployer, _userAddress) {
  console.log('   Empty scenario: skipping seeding')
  return { instances: [], userHoldings: {} }
}
```

**Step 3: Create `scenarios/busy.mjs` and `scenarios/proposal.mjs` stubs**

```javascript
// scripts/local-chain/scenarios/busy.mjs
export async function seed(addresses, provider, deployer, userAddress) {
  throw new Error('busy scenario not yet implemented — coming soon')
}
```

```javascript
// scripts/local-chain/scenarios/proposal.mjs
export async function seed(addresses, provider, deployer, userAddress) {
  throw new Error('proposal scenario not yet implemented — coming soon')
}
```

**Step 4: Commit**

```bash
git add scripts/local-chain/scenarios/
git commit -m "feat: add scenario files (default, empty, busy stub, proposal stub)"
```

---

## Task 8: Create `run-local.mjs` Entrypoint

**Files:**
- Create: `scripts/local-chain/run-local.mjs`

**Step 1: Create the file**

```javascript
#!/usr/bin/env node
// scripts/local-chain/run-local.mjs
// Main entrypoint for local chain seeding. Called by start-chain.sh.
// Usage: node scripts/local-chain/run-local.mjs [--scenario <name>]

import { deployContracts, MAINNET_ADDRESSES } from './deploy-contracts.mjs'
import { writeConfig } from './write-config.mjs'
import { TEST_ACCOUNTS } from './seed-common.mjs'

const USER_ADDRESS = process.env.USER_ADDRESS
if (!USER_ADDRESS) {
  console.error('❌ USER_ADDRESS environment variable is required')
  console.error('   Set it to your wallet address to interact with the local chain')
  console.error('   Example: USER_ADDRESS=0x... npm run chain:start')
  process.exit(1)
}

const scenarioArg = process.argv.indexOf('--scenario')
const scenarioName = scenarioArg !== -1 ? process.argv[scenarioArg + 1] : 'default'

console.log(`\n🚀 Starting local chain deployment (scenario: ${scenarioName})`)

let scenario
try {
  scenario = await import(`./scenarios/${scenarioName}.mjs`)
} catch (e) {
  console.error(`❌ Unknown scenario: ${scenarioName}`)
  console.error('   Available: default, empty, busy, proposal')
  process.exit(1)
}

const { core, factories, provider, deployer } = await deployContracts()

console.log(`\n════════════════════════════════════════════════════`)
console.log(`SEEDING: scenario=${scenarioName}`)
console.log(`════════════════════════════════════════════════════`)

const { instances, userHoldings } = await scenario.seed(
  { core, factories },
  provider,
  deployer,
  USER_ADDRESS
)

await writeConfig({
  core,
  factories,
  vaults: [], // TODO: pass through from deployContracts
  instances,
  testAccounts: Object.fromEntries(
    Object.entries(TEST_ACCOUNTS).map(([k, v]) => [k, v.address])
  ),
  mainnetAddresses: MAINNET_ADDRESSES,
  userHoldings,
})

console.log('\n✅ Local chain ready!')
console.log(`   Scenario: ${scenarioName}`)
console.log(`   RPC: http://127.0.0.1:8545`)
console.log(`   Chain ID: 1337`)
```

**Step 2: Commit**

```bash
git add scripts/local-chain/run-local.mjs
git commit -m "feat: add run-local.mjs entrypoint with scenario dispatch"
```

---

## Task 9: Update `start-chain.sh`

**Files:**
- Modify: `scripts/local-chain/start-chain.sh`

**Step 1: Read current start-chain.sh**

Read the file to understand what needs to change. The key change: replace the call to `deploy-and-seed.sh` (which calls `scripts/deploy-local.mjs`) with a call to `node scripts/local-chain/run-local.mjs "$@"` so that `--scenario` arguments pass through.

**Step 2: Update the deploy call**

Find the line that calls `deploy-and-seed.sh` or `node scripts/deploy-local.mjs` and replace it with:

```bash
node scripts/local-chain/run-local.mjs "$@"
```

The `"$@"` forwards all arguments (like `--scenario busy`) from the npm script through to run-local.mjs.

**Step 3: Commit**

```bash
git add scripts/local-chain/start-chain.sh
git commit -m "feat: update start-chain.sh to use run-local.mjs with scenario passthrough"
```

---

## Task 10: Update `package.json`

**Files:**
- Modify: `package.json`

**Step 1: Update chain scripts**

Find the `chain:start` and `chain:reset` entries and verify they call `start-chain.sh`. No change needed if they already do. The `--scenario` flag works via `npm run chain:start -- --scenario busy`.

Optionally add convenience aliases:

```json
"chain:start": "bash scripts/local-chain/start-chain.sh",
"chain:start:empty": "bash scripts/local-chain/start-chain.sh --scenario empty",
"chain:start:busy": "bash scripts/local-chain/start-chain.sh --scenario busy",
"chain:start:proposal": "bash scripts/local-chain/start-chain.sh --scenario proposal",
"chain:reset": "bash scripts/local-chain/start-chain.sh"
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add chain:start:* scenario shortcut npm scripts"
```

---

## Task 11: Smoke Test

**Step 1: Ensure Anvil is running**

```bash
npm run chain:start
```

Watch for errors. The most likely failures will be in `deploy-contracts.mjs` where the contract interfaces may have changed since the old `deploy-local.mjs` was written. Fix each error as you go — check the current Solidity source for the correct method signatures.

**Step 2: Verify config was written**

```bash
cat src/config/contracts.local.json | head -30
```

Expected: JSON with `contracts`, `vaults`, `instances` keys populated.

**Step 3: Run verify script**

```bash
npm run chain:verify
```

Expected: reports vaults and instances found.

**Step 4: Test empty scenario**

```bash
npm run chain:start:empty
```

Expected: deploys contracts, skips seeding, writes config with empty instances array.

---

## Task 12: Delete Old Files

Only do this after the smoke test passes.

**Step 1: Delete the monolith and old lib**

```bash
git rm scripts/deploy-local.mjs
git rm scripts/lib/hookSaltMiner.mjs
# Only delete scripts/lib/ if it's now empty
rmdir scripts/lib 2>/dev/null || true
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: delete old deploy-local.mjs monolith, now replaced by local-chain/ modules"
```

---

## Notes for the Implementer

**The hardest part is Task 5 (vault deployment).** The vault requires hook salt mining which can take 30-120 seconds. Don't skip it — the hook address must encode the correct Uniswap V4 flags or the vault won't work. Port verbatim from `deploy-local.mjs` lines 459-555.

**Contract interfaces may have changed.** The contracts were recently overhauled. When a method call fails, check the current Solidity source in `contracts/src/` for the correct ABI. Don't guess method names.

**The outer/inner MasterRegistry proxy distinction is critical.** The outer `MasterRegistry` is a factory that deploys an inner ERC1967 proxy. Always use the inner proxy address for actual registry calls. The outer address is only used to call `getProxyAddress()`.

**Broadcast JSON format:** `run-latest.json` has a `transactions` array. Each entry has `transactionType` (CREATE or CALL), `contractName`, and `contractAddress`. Always filter by `transactionType === 'CREATE'` to find deployments.
