// scripts/local-chain/deploy-contracts.mjs
//
// Deploys all core contracts for the local dev chain.
// - Uses `forge script` (via execSync) for: DeployMaster, DeployERC1155Factory, DeployERC404Factory
// - Uses ethers.js v5 for everything else: AlignmentRegistryV1, GlobalMessageRegistry,
//   FeaturedQueueManager, UniAlignmentVaultFactory + vault clones, QueryAggregator
//
// Returns { core, factories, vaults, provider, deployer }

import { execSync } from 'child_process'
import { promises as fs, readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { ethers } from 'ethers'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts')
const PROJECT_ROOT = path.resolve(__dirname, '../..')

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

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that all vm.env*("VAR") calls in a forge script are satisfied by the provided envVars.
 * Throws with a clear message listing missing or extra vars before forge is invoked.
 *
 * @param {string} scriptPath - Path relative to the contracts/ directory
 * @param {object} envVars - Env vars being passed to the forge script
 */
function validateForgeEnvVars(scriptPath, envVars) {
  const scriptFullPath = path.join(CONTRACTS_DIR, scriptPath)
  let content
  try {
    content = readFileSync(scriptFullPath, 'utf8')
  } catch (e) {
    throw new Error(`Pre-flight: cannot read forge script at ${scriptFullPath}`)
  }

  const pattern = /vm\.env\w+\("([^"]+)"\)/g
  const required = []
  let match
  while ((match = pattern.exec(content)) !== null) {
    required.push(match[1])
  }

  // PRIVATE_KEY is always injected by runForgeScript
  const provided = new Set([...Object.keys(envVars), 'PRIVATE_KEY'])
  const missing = required.filter(v => !provided.has(v))
  const extra = [...provided].filter(v => v !== 'PRIVATE_KEY' && !required.includes(v))

  if (missing.length > 0 || extra.length > 0) {
    const lines = [`\n✗ Pre-flight failed: ${scriptPath}`]
    if (missing.length > 0) lines.push(`  Missing (required by script, not provided): ${missing.join(', ')}`)
    if (extra.length > 0) lines.push(`  Extra (provided but script doesn't use): ${extra.join(', ')}`)
    throw new Error(lines.join('\n'))
  }
}

/**
 * Run a forge script with the given env vars.
 * Forge scripts use vm.envUint("PRIVATE_KEY") internally, so we pass it as env var.
 *
 * @param {string} scriptPath - Path relative to the contracts/ directory
 * @param {object} envVars - Extra environment variables to set for the forge process
 */
function runForgeScript(scriptPath, envVars = {}) {
  validateForgeEnvVars(scriptPath, envVars)
  const env = {
    ...process.env,
    PRIVATE_KEY: ANVIL_KEY,
    // via_ir required for ERC404Factory (stack-too-deep without it)
    ...envVars,
  }
  execSync(
    `forge script ${scriptPath} --rpc-url ${RPC} --broadcast --chain-id ${CHAIN_ID} --code-size-limit 30000`,
    { cwd: CONTRACTS_DIR, stdio: 'inherit', env }
  )
}

/**
 * Read ALL CREATE transactions from a forge broadcast run.
 * Broadcast artifacts live at:
 *   contracts/broadcast/<ScriptName>.s.sol/<chainId>/run-latest.json
 *
 * @param {string} scriptName - e.g. 'DeployMaster'
 * @returns {Promise<Array<{contractName: string, address: string}>>}
 */
async function readAllBroadcastAddresses(scriptName) {
  const broadcastPath = path.join(CONTRACTS_DIR, 'broadcast', `${scriptName}.s.sol`, CHAIN_ID, 'run-latest.json')
  const raw = await fs.readFile(broadcastPath, 'utf8')
  const broadcast = JSON.parse(raw)

  const results = []
  for (const tx of broadcast.transactions) {
    // Direct CREATE transactions (pre-CreateX style)
    if (tx.transactionType === 'CREATE' && tx.contractName) {
      results.push({ contractName: tx.contractName, address: tx.contractAddress })
    }
    // CREATE3 via CreateX: contracts land in additionalContracts
    for (const ac of tx.additionalContracts || []) {
      if ((ac.transactionType === 'CREATE' || ac.transactionType === 'CREATE2') && ac.contractName) {
        results.push({ contractName: ac.contractName, address: ac.address })
      }
    }
  }
  return results
}

/**
 * Read the address of the FIRST CREATE transaction from a forge broadcast run.
 *
 * @param {string} scriptName - e.g. 'DeployERC1155Factory'
 * @returns {Promise<string>}
 */
async function readBroadcastAddress(scriptName) {
  const deployments = await readAllBroadcastAddresses(scriptName)
  if (deployments.length === 0) {
    throw new Error(`No CREATE transactions found in broadcast for ${scriptName}`)
  }
  return deployments[0].address
}

/**
 * Load a forge build artifact (ABI + bytecode) for a contract.
 *
 * @param {string} contractName - e.g. 'GlobalMessageRegistry'
 * @param {string} [solFile] - Override the .sol filename (defaults to contractName.sol)
 * @returns {Promise<object>} Full artifact JSON
 */
async function loadArtifact(contractName, solFile) {
  const file = solFile || `${contractName}.sol`
  const artifactPath = path.join(CONTRACTS_DIR, 'out', file, `${contractName}.json`)
  const raw = await fs.readFile(artifactPath, 'utf8')
  return JSON.parse(raw)
}

/**
 * Load ABI from a forge build artifact.
 *
 * @param {string} contractName
 * @param {string} [solFile]
 * @returns {Promise<Array>}
 */
async function loadAbi(contractName, solFile) {
  return (await loadArtifact(contractName, solFile)).abi
}

/**
 * Load bytecode (hex string, no 0x prefix) from a forge build artifact.
 *
 * @param {string} contractName
 * @param {string} [solFile]
 * @returns {Promise<string>}
 */
async function loadBytecode(contractName, solFile) {
  return (await loadArtifact(contractName, solFile)).bytecode.object
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deploy all protocol contracts.
 *
 * Phase 1  — MasterRegistry (forge script) + AlignmentRegistry (ethers.js)
 * Phase 2  — GlobalMessageRegistry + FeaturedQueueManager (ethers.js)
 * Phase 3  — UniAlignmentVaultFactory + Vaults (ethers.js)
 * Phase 4  — ERC1155Factory + ERC404Factory (forge scripts)
 *            QueryAggregator + factory registration
 *
 * @returns {Promise<{core: object, factories: object, provider: object, deployer: object}>}
 */
export async function deployContracts() {
  const provider = new ethers.providers.JsonRpcProvider(RPC)
  const deployer = new ethers.Wallet(ANVIL_KEY, provider)

  // Clear code at Anvil default accounts (they have EIP-7702 delegations on mainnet,
  // which makes _safeMint revert with TransferToNonERC721ReceiverImplementer).
  const anvilAccounts = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
  ]
  for (const addr of anvilAccounts) {
    await provider.send('anvil_setCode', [addr, '0x'])
  }
  console.log('   Cleared EIP-7702 code from Anvil default accounts')

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 1: MASTER REGISTRY (forge script)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 1: MASTER REGISTRY (forge script)')
  console.log('════════════════════════════════════════════════════')

  runForgeScript('script/DeployMaster.s.sol', {
    MASTER_REGISTRY_IMPL_SALT: '0x' + randomBytes(32).toString('hex'),
    MASTER_REGISTRY_PROXY_SALT: '0x' + randomBytes(32).toString('hex'),
  })

  // DeployMaster deploys MasterRegistryV1 (impl) via CREATE3, then MasterRegistry (plain ERC1967 proxy) via CREATE3.
  const masterDeployments = await readAllBroadcastAddresses('DeployMaster')
  const implDeployment = masterDeployments.find(d => d.contractName === 'MasterRegistryV1')
  const proxyDeployment = masterDeployments.find(d => d.contractName === 'MasterRegistry')

  if (!implDeployment) throw new Error('MasterRegistryV1 deployment not found in broadcast')
  if (!proxyDeployment) throw new Error('MasterRegistry proxy deployment not found in broadcast')

  const innerProxyAddress = proxyDeployment.address
  console.log('   MasterRegistryV1 impl:   ', implDeployment.address)
  console.log('   MasterRegistry proxy:    ', innerProxyAddress)

  // MasterRegistry is now a plain ERC1967 proxy — interact directly using MasterRegistryV1 ABI
  const registryAbi = await loadAbi('MasterRegistryV1')
  const registry = new ethers.Contract(innerProxyAddress, registryAbi, deployer)

  // Verify ownership (initialize sets msg.sender as owner via vm.startBroadcast)
  // SafeOwnableUUPS (Solady) disables single-step transferOwnership — use 2-step handover:
  //   1. deployer calls requestOwnershipHandover() to express intent
  //   2. actualOwner (impersonated) calls completeOwnershipHandover(deployer)
  const actualOwner = await registry.owner()
  if (actualOwner.toLowerCase() !== DEPLOYER_ADDRESS.toLowerCase()) {
    console.log(`   Owner mismatch: ${actualOwner} (expected ${DEPLOYER_ADDRESS})`)
    console.log('   Fixing via Solady 2-step handover + Anvil impersonation...')

    // Step 1: deployer requests ownership handover
    await (await registry.requestOwnershipHandover()).wait()

    // Step 2: current owner completes the handover
    await provider.send('anvil_impersonateAccount', [actualOwner])
    await provider.send('anvil_setBalance', [actualOwner, '0x56BC75E2D63100000'])
    const registryAsOwner = new ethers.Contract(innerProxyAddress, registryAbi, provider.getSigner(actualOwner))
    await (await registryAsOwner.completeOwnershipHandover(DEPLOYER_ADDRESS)).wait()
    await provider.send('anvil_stopImpersonatingAccount', [actualOwner])
    console.log('   Ownership transferred to deployer')
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 1b: ALIGNMENT REGISTRY (ethers.js)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 1b: ALIGNMENT REGISTRY (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // AlignmentRegistryV1 is UUPS upgradeable. Deploy impl then a plain ERC1967 proxy (MasterRegistry pattern).
  const alignRegAbi = await loadAbi('AlignmentRegistryV1')
  const alignRegBytecode = await loadBytecode('AlignmentRegistryV1')
  const alignRegImplFactory = new ethers.ContractFactory(alignRegAbi, alignRegBytecode, deployer)
  const alignRegImpl = await alignRegImplFactory.deploy()
  await alignRegImpl.deployed()
  console.log('   AlignmentRegistryV1 impl:', alignRegImpl.address)

  // MasterRegistry is now a plain ERC1967 proxy — reuse it as a generic proxy for other UUPS contracts.
  const proxyAbi = await loadAbi('MasterRegistry')
  const proxyBytecode = await loadBytecode('MasterRegistry')
  const proxyFactory = new ethers.ContractFactory(proxyAbi, proxyBytecode, deployer)

  const alignRegInitData = alignRegImpl.interface.encodeFunctionData('initialize', [DEPLOYER_ADDRESS])
  const alignRegProxy = await proxyFactory.deploy(alignRegImpl.address, alignRegInitData)
  await alignRegProxy.deployed()
  const alignRegInnerProxy = alignRegProxy.address
  console.log('   AlignmentRegistry proxy: ', alignRegInnerProxy)

  const alignmentRegistry = new ethers.Contract(alignRegInnerProxy, alignRegAbi, deployer)

  // Wire AlignmentRegistry into MasterRegistry
  const setAlignRegTx = await registry.setAlignmentRegistry(alignRegInnerProxy)
  await setAlignRegTx.wait()
  console.log('   AlignmentRegistry wired to MasterRegistry')

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 2: SUPPORTING REGISTRIES (ethers.js)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 2: SUPPORTING REGISTRIES (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // GlobalMessageRegistry — constructor() then initialize(address _owner, address _masterRegistry)
  const gmrAbi = await loadAbi('GlobalMessageRegistry')
  const gmrBytecode = await loadBytecode('GlobalMessageRegistry')
  const gmrFactory = new ethers.ContractFactory(gmrAbi, gmrBytecode, deployer)
  const gmr = await gmrFactory.deploy()
  await gmr.deployed()
  console.log('   GlobalMessageRegistry:  ', gmr.address)

  // Initialize GlobalMessageRegistry
  const gmrInitTx = await gmr.initialize(DEPLOYER_ADDRESS, innerProxyAddress)
  await gmrInitTx.wait()
  console.log('   GlobalMessageRegistry initialized')

  // FeaturedQueueManager — constructor() (owner set to msg.sender)
  //   then call initialize(address _masterRegistry, address _owner) to wire up
  const fqmAbi = await loadAbi('FeaturedQueueManager')
  const fqmBytecode = await loadBytecode('FeaturedQueueManager')
  const fqmContractFactory = new ethers.ContractFactory(fqmAbi, fqmBytecode, deployer)
  const fqm = await fqmContractFactory.deploy()
  await fqm.deployed()
  console.log('   FeaturedQueueManager:   ', fqm.address)

  // Initialize FeaturedQueueManager: initialize(address _masterRegistry, address _owner)
  const initTx = await fqm.initialize(innerProxyAddress, DEPLOYER_ADDRESS)
  await initTx.wait()
  console.log('   FeaturedQueueManager initialized')

  // Set WETH for SmartTransferLib fallback (refunds to smart contract wallets)
  await (await fqm.setWeth(MAINNET_ADDRESSES.weth)).wait()
  console.log('   FeaturedQueueManager WETH set:', MAINNET_ADDRESSES.weth)

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 2b: COMPONENT REGISTRY (ethers.js)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 2b: COMPONENT REGISTRY (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // ComponentRegistry is UUPS upgradeable. Deploy impl, proxy, initialize.
  const compRegAbi = await loadAbi('ComponentRegistry')
  const compRegBytecode = await loadBytecode('ComponentRegistry')
  const compRegContractFactory = new ethers.ContractFactory(compRegAbi, compRegBytecode, deployer)
  const compRegImpl = await compRegContractFactory.deploy()
  await compRegImpl.deployed()
  console.log('   ComponentRegistry impl:  ', compRegImpl.address)

  const compRegInitData = compRegImpl.interface.encodeFunctionData('initialize', [DEPLOYER_ADDRESS])
  const compRegProxy = await proxyFactory.deploy(compRegImpl.address, compRegInitData)
  await compRegProxy.deployed()
  const compRegInnerProxy = compRegProxy.address
  console.log('   ComponentRegistry proxy: ', compRegInnerProxy)

  const componentRegistry = new ethers.Contract(compRegInnerProxy, compRegAbi, deployer)

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 3: VAULT DEPLOYMENT (ethers.js)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 3: VAULTS (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // ── UniAlignmentVaultFactory ──
  // constructor(weth, poolManager, zRouter, zRouterFee, zRouterTickSpacing, defaultPriceValidator, alignmentRegistry)
  const uniVaultFactoryAbi = await loadAbi('UniAlignmentVaultFactory')
  const uniVaultFactoryBytecode = await loadBytecode('UniAlignmentVaultFactory')
  const uniVaultFactory = await (new ethers.ContractFactory(uniVaultFactoryAbi, uniVaultFactoryBytecode, deployer)).deploy(
    MAINNET_ADDRESSES.weth,
    MAINNET_ADDRESSES.uniswapV4PoolManager,
    ethers.constants.AddressZero,  // zRouter (placeholder — no live swaps in local dev)
    3000,                          // zRouterFee (0.3%)
    60,                            // zRouterTickSpacing
    ethers.constants.AddressZero,  // defaultPriceValidator (placeholder)
    alignRegInnerProxy,            // alignmentRegistry
  )
  await uniVaultFactory.deployed()
  console.log('   UniAlignmentVaultFactory:   ', uniVaultFactory.address)

  // ── CypherAlignmentVaultFactory ──
  // Deploy implementation first (no constructor args), then factory(impl)
  const cypherVaultImplBytecode = await loadBytecode('CypherAlignmentVault')
  const cypherVaultImplAbi = await loadAbi('CypherAlignmentVault')
  const cypherVaultImpl = await (new ethers.ContractFactory(cypherVaultImplAbi, cypherVaultImplBytecode, deployer)).deploy()
  await cypherVaultImpl.deployed()
  console.log('   CypherAlignmentVault impl: ', cypherVaultImpl.address)

  const cypherVaultFactoryAbi = await loadAbi('CypherAlignmentVaultFactory')
  const cypherVaultFactoryBytecode = await loadBytecode('CypherAlignmentVaultFactory')
  const cypherVaultFactory = await (new ethers.ContractFactory(cypherVaultFactoryAbi, cypherVaultFactoryBytecode, deployer)).deploy(
    cypherVaultImpl.address,
  )
  await cypherVaultFactory.deployed()
  console.log('   CypherAlignmentVaultFactory:', cypherVaultFactory.address)

  // ── ZAMMAlignmentVaultFactory ──
  // constructor(zamm, zRouter, protocolTreasury)
  const zammVaultFactoryAbi = await loadAbi('ZAMMAlignmentVaultFactory')
  const zammVaultFactoryBytecode = await loadBytecode('ZAMMAlignmentVaultFactory')
  const zammVaultFactory = await (new ethers.ContractFactory(zammVaultFactoryAbi, zammVaultFactoryBytecode, deployer)).deploy(
    ethers.constants.AddressZero,  // zamm (placeholder — no live ZAMM in local dev)
    ethers.constants.AddressZero,  // zRouter (placeholder)
    DEPLOYER_ADDRESS,              // protocolTreasury
  )
  await zammVaultFactory.deployed()
  console.log('   ZAMMAlignmentVaultFactory:  ', zammVaultFactory.address)

  // Load vault ABIs for post-deploy calls
  const uniVaultAbi = await loadAbi('UniAlignmentVault')
  const cypherVaultAbi = await loadAbi('CypherAlignmentVault')
  const zammVaultAbi = await loadAbi('ZAMMAlignmentVault')

  // Register alignment targets on AlignmentRegistryV1
  console.log('   Registering MS2 alignment target...')
  const ms2TargetMeta = JSON.stringify({ name: 'MS2', description: 'Milady Station 2 community alignment target', symbol: 'MS2', token: MAINNET_ADDRESSES.ms2Token })
  const registerMS2TargetTx = await alignmentRegistry.registerAlignmentTarget(
    'MS2',
    'Milady Station 2 community alignment target',
    `data:application/json,${encodeURIComponent(ms2TargetMeta)}`,
    [{ token: MAINNET_ADDRESSES.ms2Token, symbol: 'MS2', info: 'Milady Station 2 token', metadataURI: '' }]
  )
  const ms2TargetReceipt = await registerMS2TargetTx.wait()
  const ms2TargetEvent = ms2TargetReceipt.events?.find(e => e.event === 'AlignmentTargetRegistered')
  const ms2TargetId = ms2TargetEvent.args.targetId.toNumber()
  console.log(`   MS2 alignment target registered (targetId=${ms2TargetId})`)

  console.log('   Registering CULT alignment target...')
  const cultTargetMeta = JSON.stringify({ name: 'CULT', description: 'Cult DAO community alignment target', symbol: 'CULT', token: MAINNET_ADDRESSES.cultToken })
  const registerCULTTargetTx = await alignmentRegistry.registerAlignmentTarget(
    'CULT',
    'Cult DAO community alignment target',
    `data:application/json,${encodeURIComponent(cultTargetMeta)}`,
    [{ token: MAINNET_ADDRESSES.cultToken, symbol: 'CULT', info: 'Cult DAO token', metadataURI: '' }]
  )
  const cultTargetReceipt = await registerCULTTargetTx.wait()
  const cultTargetEvent = cultTargetReceipt.events?.find(e => e.event === 'AlignmentTargetRegistered')
  const cultTargetId = cultTargetEvent.args.targetId.toNumber()
  console.log(`   CULT alignment target registered (targetId=${cultTargetId})`)

  // ── Vault deploy helpers (one per factory type) ──

  const VAULT_TYPE_DESCRIPTIONS = {
    'UNIv4': 'Routes fees through Uniswap V4 hooks to market-buy the alignment token and deposit into a full-range concentrated liquidity position. Deepens on-chain liquidity while strengthening price support.',
    'CYPHER': 'Uses Cypher\'s Algebra-based AMM to accumulate the alignment token via limit orders and TWAPs. Optimized for low-slippage acquisition on thinner books.',
    'ZAMM': 'Deposits into ZAMM pools for yield-bearing LP positions. Fees compound automatically, growing the vault\'s alignment token holdings over time.',
  }

  async function registerVault(vaultAddress, vaultAbi, name, alignmentToken, targetId, vaultType) {
    const vault = new ethers.Contract(vaultAddress, vaultAbi, deployer)
    const description = VAULT_TYPE_DESCRIPTIONS[vaultType] || ''
    console.log(`   ${vaultType} vault (${name}): ${vaultAddress}`)
    await (await registry.registerVault(
      vaultAddress,
      DEPLOYER_ADDRESS,
      name,
      `data:application/json,${encodeURIComponent(JSON.stringify({ name, alignmentToken, vaultType, description }))}`,
      targetId,
    )).wait()
    console.log(`   ${name} registered in MasterRegistry`)
    return vault
  }

  async function deployUniVault(alignmentToken, targetId, name) {
    const tx = await uniVaultFactory.deployVault(
      '0x' + randomBytes(32).toString('hex'),
      alignmentToken,
      targetId,
      ethers.constants.AddressZero,
    )
    const receipt = await tx.wait()
    const addr = receipt.events?.find(e => e.event === 'VaultDeployed')?.args?.vault
    return registerVault(addr, uniVaultAbi, name, alignmentToken, targetId, 'UNIv4')
  }

  async function deployCypherVault(alignmentToken, targetId, name) {
    const tx = await cypherVaultFactory.createVault(
      '0x' + randomBytes(32).toString('hex'),
      ethers.constants.AddressZero,  // positionManager (placeholder)
      ethers.constants.AddressZero,  // swapRouter (placeholder)
      MAINNET_ADDRESSES.weth,
      alignmentToken,
      DEPLOYER_ADDRESS,              // protocolTreasury
      ethers.constants.AddressZero,  // liquidityDeployer (placeholder)
    )
    const receipt = await tx.wait()
    const addr = receipt.events?.find(e => e.event === 'VaultDeployed')?.args?.vault
    return registerVault(addr, cypherVaultAbi, name, alignmentToken, targetId, 'CYPHER')
  }

  async function deployZammVault(alignmentToken, targetId, name) {
    const tx = await zammVaultFactory.deployVault(
      '0x' + randomBytes(32).toString('hex'),
      alignmentToken,
      { id0: 0, id1: 0, token0: ethers.constants.AddressZero, token1: ethers.constants.AddressZero, feeOrHook: 0 },
    )
    const receipt = await tx.wait()
    const addr = receipt.events?.find(e => e.event === 'VaultDeployed')?.args?.vault
    return registerVault(addr, zammVaultAbi, name, alignmentToken, targetId, 'ZAMM')
  }

  // Deploy 1 vault of each type per alignment target (6 total)
  console.log('   Deploying MS2-aligned vaults (UNIv4, CYPHER, ZAMM)...')
  const ms2Vault  = await deployUniVault(MAINNET_ADDRESSES.ms2Token, ms2TargetId, 'MS2 UNIv4')
  const ms2Vault2 = await deployCypherVault(MAINNET_ADDRESSES.ms2Token, ms2TargetId, 'MS2 CYPHER')
  const ms2Vault3 = await deployZammVault(MAINNET_ADDRESSES.ms2Token, ms2TargetId, 'MS2 ZAMM')

  console.log('   Deploying CULT-aligned vaults (UNIv4, CYPHER, ZAMM)...')
  const cultVault  = await deployUniVault(MAINNET_ADDRESSES.cultToken, cultTargetId, 'CULT UNIv4')
  const cultVault2 = await deployCypherVault(MAINNET_ADDRESSES.cultToken, cultTargetId, 'CULT CYPHER')
  const cultVault3 = await deployZammVault(MAINNET_ADDRESSES.cultToken, cultTargetId, 'CULT ZAMM')

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 4: PROJECT FACTORIES (forge scripts)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 4: PROJECT FACTORIES (forge scripts)')
  console.log('════════════════════════════════════════════════════')

  // ERC1155Factory — constructor(masterRegistry, globalMessageRegistry, componentRegistry, weth)
  // Factory deploys instances via CREATE3 directly (no template needed).
  runForgeScript('script/DeployERC1155Factory.s.sol', {
    MASTER_REGISTRY: innerProxyAddress,
    GLOBAL_MESSAGE_REGISTRY: gmr.address,
    COMPONENT_REGISTRY: compRegInnerProxy,
    WETH: MAINNET_ADDRESSES.weth,
  })
  const erc1155FactoryAddress = await readBroadcastAddress('DeployERC1155Factory')
  console.log('   ERC1155Factory:            ', erc1155FactoryAddress)

  // ERC404Factory — forge script deploys ERC404BondingInstance impl, LaunchManager,
  //   CurveParamsComputer, and the factory itself.
  runForgeScript('script/DeployERC404Factory.s.sol', {
    MASTER_REGISTRY: innerProxyAddress,
    PROTOCOL: DEPLOYER_ADDRESS,
    COMPONENT_REGISTRY: compRegInnerProxy,
    GLOBAL_MESSAGE_REGISTRY: gmr.address,
    WETH: MAINNET_ADDRESSES.weth,
  })

  // The forge script deploys multiple contracts; the ERC404Factory is the last CREATE.
  const erc404Deployments = await readAllBroadcastAddresses('DeployERC404Factory')
  const erc404FactoryDeployment = erc404Deployments.find(d => d.contractName === 'ERC404Factory')
  if (!erc404FactoryDeployment) throw new Error('ERC404Factory deployment not found in broadcast')
  const erc404FactoryAddress = erc404FactoryDeployment.address
  console.log('   ERC404Factory:             ', erc404FactoryAddress)

  // Log all ERC404 module addresses from broadcast
  for (const d of erc404Deployments) {
    if (d.contractName !== 'ERC404Factory') {
      console.log(`   ${d.contractName}:`, ' '.repeat(Math.max(0, 25 - d.contractName.length)), d.address)
    }
  }

  // Configure LaunchManager preset (required before any ERC404 instance creation)
  const launchManagerDeployment = erc404Deployments.find(d => d.contractName === 'LaunchManager')
  const curveComputerDeployment = erc404Deployments.find(d => d.contractName === 'CurveParamsComputer')
  if (!launchManagerDeployment) throw new Error('LaunchManager deployment not found in broadcast')
  if (!curveComputerDeployment) throw new Error('CurveParamsComputer deployment not found in broadcast')

  const launchManagerAbi = await loadAbi('LaunchManager')
  const launchManager = new ethers.Contract(launchManagerDeployment.address, launchManagerAbi, deployer)

  // Set preset 0 (NICHE): 5 ETH target, 1B units per NFT, 10% liquidity reserve
  await (await launchManager.setPreset(0, {
    targetETH: ethers.utils.parseEther('5'),
    unitPerNFT: 1_000_000_000,
    liquidityReserveBps: 1000,
    curveComputer: curveComputerDeployment.address,
    active: true,
  })).wait()
  console.log('   LaunchManager preset 0 configured (NICHE: 5 ETH, 1B/NFT, 10% reserve)')

  // Set preset 1 (STANDARD): 25 ETH target, 1M units per NFT, 10% liquidity reserve
  await (await launchManager.setPreset(1, {
    targetETH: ethers.utils.parseEther('25'),
    unitPerNFT: 1_000_000,
    liquidityReserveBps: 1000,
    curveComputer: curveComputerDeployment.address,
    active: true,
  })).wait()
  console.log('   LaunchManager preset 1 configured (STANDARD: 25 ETH, 1M/NFT, 10% reserve)')

  // Set preset 2 (HYPE): 50 ETH target, 1K units per NFT, 10% liquidity reserve
  await (await launchManager.setPreset(2, {
    targetETH: ethers.utils.parseEther('50'),
    unitPerNFT: 1_000,
    liquidityReserveBps: 1000,
    curveComputer: curveComputerDeployment.address,
    active: true,
  })).wait()
  console.log('   LaunchManager preset 2 configured (HYPE: 50 ETH, 1K/NFT, 10% reserve)')

  // Approve CurveParamsComputer in ComponentRegistry (wizard-facing components are seeded separately
  // by seedComponentRegistry in seed-common.mjs using keccak256 tags — do NOT add them here with
  // formatBytes32String, which produces a different bytes32 and breaks getApprovedComponentsByTag).
  const componentsToApprove = [
    { addr: curveComputerDeployment.address, tag: 'CurveComputer', name: 'CurveParamsComputer' },
  ]
  for (const { addr, tag, name } of componentsToApprove) {
    const alreadyApproved = await componentRegistry.isApprovedComponent(addr)
    if (!alreadyApproved) {
      await (await componentRegistry.approveComponent(
        addr, ethers.utils.formatBytes32String(tag), name
      )).wait()
      console.log(`   ComponentRegistry: approved ${name}`, addr)
    } else {
      console.log(`   ComponentRegistry: ${name} already approved`)
    }
  }

  // Deploy QueryAggregator
  // constructor() — zero-arg, then initialize(masterRegistry, featuredQueueManager, globalMessageRegistry, owner)
  const queryAggAbi = await loadAbi('QueryAggregator')
  const queryAggBytecode = await loadBytecode('QueryAggregator')
  const queryAggContractFactory = new ethers.ContractFactory(queryAggAbi, queryAggBytecode, deployer)
  const queryAgg = await queryAggContractFactory.deploy()
  await queryAgg.deployed()
  console.log('   QueryAggregator:            ', queryAgg.address)

  // Initialize QueryAggregator: initialize(masterRegistry, featuredQueueManager, globalMessageRegistry, owner)
  const initQueryAggTx = await queryAgg.initialize(
    innerProxyAddress,
    fqm.address,
    gmr.address,
    DEPLOYER_ADDRESS
  )
  await initQueryAggTx.wait()
  console.log('   QueryAggregator initialized')

  // Register ERC404Factory in MasterRegistry (factoryId=1)
  // registerFactory(factoryAddress, contractType, title, displayTitle, metadataURI, features)
  const erc404FactoryMeta = JSON.stringify({
    name: 'Pump Launch',
    subtitle: 'Bonding Curve · Dual Nature',
    tagline: 'Starts with a bonding curve price discovery phase. Each NFT is also a tradeable token — collectors can trade fractions or hold the whole piece.',
    badge: 'PUMP',
    recommendedFor: ['many'],
    tags: ['bonding-curve', 'dual-nature', 'token', 'nft'],
  })

  const registerERC404Tx = await registry.registerFactory(
    erc404FactoryAddress,
    'ERC404',
    'ERC404-Bonding-Curve-Factory',
    'ERC404 Bonding Curve',
    `data:application/json,${encodeURIComponent(erc404FactoryMeta)}`,
    []  // features (empty for now)
  )
  await registerERC404Tx.wait()
  console.log('   ERC404Factory registered (factoryId=1)')

  const erc1155FactoryMeta = JSON.stringify({
    name: 'Open Edition',
    subtitle: 'Few Pieces · Many Collectors',
    tagline: 'A small number of pieces where anyone can mint their own copy at a fixed price. Great for prints, zines, or limited runs.',
    badge: null,
    recommendedFor: ['some'],
    tags: ['open-edition', 'editions', 'fixed-price', 'multiple'],
  })

  // Register ERC1155Factory in MasterRegistry (factoryId=2)
  const registerERC1155Tx = await registry.registerFactory(
    erc1155FactoryAddress,
    'ERC1155',
    'ERC1155-Edition-Factory',
    'ERC1155 Editions',
    `data:application/json,${encodeURIComponent(erc1155FactoryMeta)}`,
    []  // features (empty for now)
  )
  await registerERC1155Tx.wait()
  console.log('   ERC1155Factory registered (factoryId=2)')

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 4b: ERC721 AUCTION FACTORY (ethers.js)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 4b: ERC721 AUCTION FACTORY (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  const erc721FactoryAbi = await loadAbi('ERC721AuctionFactory')
  const erc721FactoryBytecode = await loadBytecode('ERC721AuctionFactory')
  const erc721FactoryContractFactory = new ethers.ContractFactory(erc721FactoryAbi, erc721FactoryBytecode, deployer)
  const erc721FactoryContract = await erc721FactoryContractFactory.deploy(
    innerProxyAddress,  // _masterRegistry
    gmr.address,        // _globalMessageRegistry
    MAINNET_ADDRESSES.weth, // _weth
  )
  await erc721FactoryContract.deployed()
  const erc721FactoryAddress = erc721FactoryContract.address
  console.log('   ERC721AuctionFactory:      ', erc721FactoryAddress)

  // Set protocol treasury
  await (await erc721FactoryContract.setProtocolTreasury(DEPLOYER_ADDRESS)).wait()
  console.log('   ERC721AuctionFactory treasury set:', DEPLOYER_ADDRESS)

  // Register ERC721AuctionFactory in MasterRegistry (factoryId=3)
  const erc721FactoryMeta = JSON.stringify({
    name: 'Auction House',
    subtitle: 'Timed Auction · 1-of-1',
    tagline: 'Timed auctions for unique pieces. Artists queue works, collectors bid, highest bidder wins. Anti-snipe protection built in.',
    badge: 'AUCTION',
    recommendedFor: ['few'],
    tags: ['auction', '1-of-1', 'timed', 'nft'],
  })

  const registerERC721Tx = await registry.registerFactory(
    erc721FactoryAddress,
    'ERC721',
    'ERC721-Auction-Factory',
    'ERC721 Auction',
    `data:application/json,${encodeURIComponent(erc721FactoryMeta)}`,
    []  // features
  )
  await registerERC721Tx.wait()
  console.log('   ERC721AuctionFactory registered (factoryId=3)')

  // Set protocol treasury on both existing factories (required before any instance can be created)
  const erc1155FactoryAbi = await loadAbi('ERC1155Factory')
  const erc1155FactoryContract = new ethers.Contract(erc1155FactoryAddress, erc1155FactoryAbi, deployer)
  await (await erc1155FactoryContract.setProtocolTreasury(DEPLOYER_ADDRESS)).wait()
  console.log('   ERC1155Factory treasury set:', DEPLOYER_ADDRESS)

  // Deploy DynamicPricingModule and wire it to ERC1155Factory
  const dynPricingAbi = await loadAbi('DynamicPricingModule')
  const dynPricingBytecode = await loadBytecode('DynamicPricingModule')
  const dynPricingFactory = new ethers.ContractFactory(dynPricingAbi, dynPricingBytecode, deployer)
  const dynPricingModule = await dynPricingFactory.deploy()
  await dynPricingModule.deployed()
  console.log('   DynamicPricingModule:       ', dynPricingModule.address)

  // Approve in ComponentRegistry
  const dynAlreadyApproved = await componentRegistry.isApprovedComponent(dynPricingModule.address)
  if (!dynAlreadyApproved) {
    await (await componentRegistry.approveComponent(
      dynPricingModule.address, ethers.utils.formatBytes32String('DynamicPricing'), 'DynamicPricingModule'
    )).wait()
    console.log('   ComponentRegistry: approved DynamicPricingModule')
  }

  // Set on ERC1155Factory
  await (await erc1155FactoryContract.setDynamicPricingModule(dynPricingModule.address)).wait()
  console.log('   ERC1155Factory dynamicPricingModule set')

  const erc404FactoryAbi = await loadAbi('ERC404Factory')
  const erc404FactoryContract = new ethers.Contract(erc404FactoryAddress, erc404FactoryAbi, deployer)
  await (await erc404FactoryContract.setProtocolTreasury(DEPLOYER_ADDRESS)).wait()
  console.log('   ERC404Factory treasury set:', DEPLOYER_ADDRESS)

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 5: GOVERNANCE (Gnosis Safe + GrandCentral DAO + Conductors)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 5: GOVERNANCE (GrandCentral DAO)')
  console.log('════════════════════════════════════════════════════')

  // --- Deploy Gnosis Safe (1-of-1, deployer as sole owner) ---
  // Canonical Safe v1.3.0 addresses on mainnet (available on our fork)
  const SAFE_PROXY_FACTORY = '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2'
  const SAFE_SINGLETON = '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552'

  const safeProxyFactoryAbi = [
    'function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) returns (address proxy)'
  ]
  const safeSingletonAbi = [
    'function setup(address[] calldata _owners, uint256 _threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)',
    'function enableModule(address module)',
    'function isModuleEnabled(address module) view returns (bool)',
    'function getOwners() view returns (address[] memory)',
    'function getThreshold() view returns (uint256)',
    'function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes memory signatures) payable returns (bool success)',
  ]

  const safeFactory = new ethers.Contract(SAFE_PROXY_FACTORY, safeProxyFactoryAbi, deployer)
  const safeSetupIface = new ethers.utils.Interface(safeSingletonAbi)

  // Encode Safe.setup() call: 1-of-1, deployer as sole owner, no delegate call
  const safeInitializer = safeSetupIface.encodeFunctionData('setup', [
    [DEPLOYER_ADDRESS],           // owners
    1,                             // threshold
    ethers.constants.AddressZero,  // to (no delegate call)
    '0x',                          // data
    ethers.constants.AddressZero,  // fallbackHandler
    ethers.constants.AddressZero,  // paymentToken
    0,                             // payment
    ethers.constants.AddressZero,  // paymentReceiver
  ])

  const saltNonce = Date.now()
  const createSafeTx = await safeFactory.createProxyWithNonce(
    SAFE_SINGLETON, safeInitializer, saltNonce
  )
  const safeReceipt = await createSafeTx.wait()

  // Parse ProxyCreation event to get Safe address
  // Safe v1.3.0: event ProxyCreation(address proxy, address singleton) — neither param is indexed
  const proxyCreationTopic = ethers.utils.id('ProxyCreation(address,address)')
  const proxyEvent = safeReceipt.logs.find(l => l.topics[0] === proxyCreationTopic)
  const [safeAddress] = ethers.utils.defaultAbiCoder.decode(['address', 'address'], proxyEvent.data)
  console.log('   Gnosis Safe (1-of-1):      ', safeAddress)

  const safeContract = new ethers.Contract(safeAddress, safeSingletonAbi, deployer)

  // --- Deploy GrandCentral ---
  const grandCentralAbi = await loadAbi('GrandCentral')
  const grandCentralBytecode = await loadBytecode('GrandCentral')
  const grandCentralFactory = new ethers.ContractFactory(grandCentralAbi, grandCentralBytecode, deployer)

  const INITIAL_SHARES = ethers.utils.parseEther('1000')     // 1000 shares to founder
  const VOTING_PERIOD = 300                                    // 5 minutes (local dev)
  const GRACE_PERIOD = 120                                     // 2 minutes (local dev)
  const QUORUM_PERCENT = 1                                     // 1%
  const SPONSOR_THRESHOLD = ethers.utils.parseEther('1')       // 1 share to sponsor
  const MIN_RETENTION_PERCENT = 50                             // 50%

  const grandCentral = await grandCentralFactory.deploy(
    safeAddress,
    DEPLOYER_ADDRESS,
    INITIAL_SHARES,
    VOTING_PERIOD,
    GRACE_PERIOD,
    QUORUM_PERCENT,
    SPONSOR_THRESHOLD,
    MIN_RETENTION_PERCENT,
  )
  await grandCentral.deployed()
  console.log('   GrandCentral:               ', grandCentral.address)
  console.log(`   Founder shares: ${ethers.utils.formatEther(INITIAL_SHARES)} → ${DEPLOYER_ADDRESS}`)

  // --- Enable GrandCentral as Safe module ---
  const enableModuleData = safeSetupIface.encodeFunctionData('enableModule', [grandCentral.address])

  // Pre-approved signature format for 1-of-1 Safe: r=owner, s=0, v=1
  const ownerSig = ethers.utils.hexConcat([
    ethers.utils.hexZeroPad(DEPLOYER_ADDRESS, 32), // r = owner address padded to 32 bytes
    ethers.utils.hexZeroPad('0x00', 32),            // s = 0
    '0x01',                                          // v = 1 (pre-approved)
  ])

  const enableModuleTx = await safeContract.execTransaction(
    safeAddress,                    // to: the Safe itself
    0,                              // value
    enableModuleData,               // data: enableModule(grandCentral)
    0,                              // operation: Call
    0,                              // safeTxGas
    0,                              // baseGas
    0,                              // gasPrice
    ethers.constants.AddressZero,   // gasToken
    ethers.constants.AddressZero,   // refundReceiver
    ownerSig,                       // signatures
  )
  await enableModuleTx.wait()

  const isEnabled = await safeContract.isModuleEnabled(grandCentral.address)
  console.log('   GrandCentral enabled as Safe module:', isEnabled)

  // --- Deploy Conductors ---

  // RevenueConductor: splits incoming revenue to ragequit pool, claims pool, and reserves
  const revConductorAbi = await loadAbi('RevenueConductor')
  const revConductorBytecode = await loadBytecode('RevenueConductor')
  const revConductorFactory = new ethers.ContractFactory(revConductorAbi, revConductorBytecode, deployer)
  const revenueConductor = await revConductorFactory.deploy(
    grandCentral.address,           // _dao
    safeAddress,                    // _treasury (Safe holds funds)
    5000,                           // _dividendBps (50% to claims/dividends)
    3000,                           // _ragequitBps (30% to ragequit pool)
    2000,                           // _reserveBps (20% to reserves)
  )
  await revenueConductor.deployed()
  console.log('   RevenueConductor:           ', revenueConductor.address)

  // ShareOffering: manages tranche-based share sales
  const shareOfferingAbi = await loadAbi('ShareOffering', 'ShareOffering.sol')
  const shareOfferingBytecode = await loadBytecode('ShareOffering', 'ShareOffering.sol')
  const shareOfferingFactory = new ethers.ContractFactory(shareOfferingAbi, shareOfferingBytecode, deployer)
  const shareOffering = await shareOfferingFactory.deploy(grandCentral.address)
  await shareOffering.deployed()
  console.log('   ShareOffering:              ', shareOffering.address)

  // OTCShareEscrow: OTC share trading
  const otcEscrowAbi = await loadAbi('OTCShareEscrow')
  const otcEscrowBytecode = await loadBytecode('OTCShareEscrow')
  const otcEscrowFactory = new ethers.ContractFactory(otcEscrowAbi, otcEscrowBytecode, deployer)
  const otcEscrow = await otcEscrowFactory.deploy(grandCentral.address, MAINNET_ADDRESSES.weth)
  await otcEscrow.deployed()
  console.log('   OTCShareEscrow:             ', otcEscrow.address)

  // --- Register conductors on GrandCentral via proposal ---
  // Advance time so the share checkpoint (from constructor) is in the past.
  // submitVote snapshots at (votingStarts - 1); if shares were minted at the
  // same timestamp as the proposal, the snapshot misses them → NotMember().
  await provider.send('evm_increaseTime', [2])
  await provider.send('evm_mine', [])

  // setConductors is daoOnly — must go through proposal flow
  // Permission bitmask: 1=admin, 2=manager, 4=governor, 8=agentConductor
  const setConductorsCalldata = grandCentral.interface.encodeFunctionData('setConductors', [
    [shareOffering.address, revenueConductor.address, otcEscrow.address],
    [2, 2, 2]  // manager permission for all
  ])

  // Submit proposal (auto-sponsors since deployer has 1000 shares > sponsorThreshold of 1)
  const submitTx = await grandCentral.submitProposal(
    [grandCentral.address], [0], [setConductorsCalldata],
    0, // no expiration
    'Register conductors: ShareOffering, RevenueConductor, OTCShareEscrow'
  )
  const submitReceipt = await submitTx.wait()
  const submitEvent = submitReceipt.events?.find(e => e.event === 'ProposalSubmitted')
  const proposalId = submitEvent.args.proposalId.toNumber()

  // Vote yes
  await (await grandCentral.submitVote(proposalId, true)).wait()

  // Advance time past voting + grace period
  await provider.send('evm_increaseTime', [VOTING_PERIOD + GRACE_PERIOD + 1])
  await provider.send('evm_mine', [])

  // Process proposal (self-call: GrandCentral calls itself, satisfying daoOnly)
  await (await grandCentral.processProposal(
    proposalId, [grandCentral.address], [0], [setConductorsCalldata]
  )).wait()
  console.log('   Conductors registered via proposal (manager permission)')

  // MasterRegistry ownership stays with deployer for local dev
  console.log('   MasterRegistry ownership: deployer (will transfer to DAO in production)')

  console.log('\n════════════════════════════════════════════════════')
  console.log('DEPLOYMENT COMPLETE')
  console.log('════════════════════════════════════════════════════')
  console.log('   masterRegistry (inner):  ', innerProxyAddress)
  console.log('   alignmentRegistry:       ', alignRegInnerProxy)
  console.log('   componentRegistry:       ', compRegInnerProxy)
  console.log('   globalMessageRegistry:   ', gmr.address)
  console.log('   featuredQueueManager:    ', fqm.address)
  console.log('   queryAggregator:         ', queryAgg.address)
  console.log('   vault (MS2 UNIv4):       ', ms2Vault.address)
  console.log('   vault (MS2 CYPHER):      ', ms2Vault2.address)
  console.log('   vault (MS2 ZAMM):        ', ms2Vault3.address)
  console.log('   vault (CULT UNIv4):      ', cultVault.address)
  console.log('   vault (CULT CYPHER):     ', cultVault2.address)
  console.log('   vault (CULT ZAMM):       ', cultVault3.address)
  console.log('   erc1155Factory:          ', erc1155FactoryAddress)
  console.log('   erc404Factory:           ', erc404FactoryAddress)
  console.log('   erc721AuctionFactory:    ', erc721FactoryAddress)
  console.log('   gnosisSafe:              ', safeAddress)
  console.log('   grandCentral:            ', grandCentral.address)
  console.log('   shareOffering:           ', shareOffering.address)
  console.log('   revenueConductor:        ', revenueConductor.address)
  console.log('   otcShareEscrow:          ', otcEscrow.address)

  // Capture the block number at deploy time so the frontend can start
  // event log queries from here instead of block 0 (critical for mainnet forks).
  const deployBlock = await provider.getBlockNumber()

  return {
    core: {
      masterRegistry: innerProxyAddress,        // all calls use inner proxy
      alignmentRegistry: alignRegInnerProxy,
      componentRegistry: compRegInnerProxy,
      globalMessageRegistry: gmr.address,
      featuredQueueManager: fqm.address,
      queryAggregator: queryAgg.address,
      deployBlock,
    },
    factories: {
      erc1155: erc1155FactoryAddress,
      erc404: erc404FactoryAddress,
      erc721: erc721FactoryAddress,
    },
    vaults: [
      { address: ms2Vault.address,  alignmentToken: MAINNET_ADDRESSES.ms2Token,  name: 'MS2 UNIv4',   vaultType: 'UNIv4' },
      { address: ms2Vault2.address, alignmentToken: MAINNET_ADDRESSES.ms2Token,  name: 'MS2 CYPHER',  vaultType: 'CYPHER' },
      { address: ms2Vault3.address, alignmentToken: MAINNET_ADDRESSES.ms2Token,  name: 'MS2 ZAMM',    vaultType: 'ZAMM' },
      { address: cultVault.address,  alignmentToken: MAINNET_ADDRESSES.cultToken, name: 'CULT UNIv4',  vaultType: 'UNIv4' },
      { address: cultVault2.address, alignmentToken: MAINNET_ADDRESSES.cultToken, name: 'CULT CYPHER', vaultType: 'CYPHER' },
      { address: cultVault3.address, alignmentToken: MAINNET_ADDRESSES.cultToken, name: 'CULT ZAMM',   vaultType: 'ZAMM' },
    ],
    governance: {
      grandCentral: grandCentral.address,
      safe: safeAddress,
      shareOffering: shareOffering.address,
      revenueConductor: revenueConductor.address,
      otcShareEscrow: otcEscrow.address,
    },
    provider,
    deployer,
  }
}
