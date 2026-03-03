// scripts/local-chain/deploy-contracts.mjs
//
// Deploys all core contracts for the local dev chain.
// - Uses `forge script` (via execSync) for: DeployMaster, DeployERC1155Factory, DeployERC404Factory
// - Uses ethers.js v5 for everything else: AlignmentRegistryV1, GlobalMessageRegistry,
//   FeaturedQueueManager, UltraAlignmentHookFactory, UltraAlignmentVault instances, QueryAggregator
//
// Returns { core, factories, vaults, provider, deployer }

import { execSync } from 'child_process'
import { promises as fs, readFileSync } from 'fs'
import { ethers } from 'ethers'
import path from 'path'
import { fileURLToPath } from 'url'
import { mineHookSalt, decodeHookFlags } from './lib/hookSaltMiner.mjs'

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
    FOUNDRY_VIA_IR: 'false', // override via_ir=true in foundry.toml for local dev speed
    ...envVars,
  }
  execSync(
    `forge script ${scriptPath} --rpc-url ${RPC} --broadcast --chain-id ${CHAIN_ID}`,
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
  return broadcast.transactions
    .filter(tx => tx.transactionType === 'CREATE')
    .map(tx => ({ contractName: tx.contractName, address: tx.contractAddress }))
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
 * Phase 3  — UltraAlignmentHookFactory + Vaults (ethers.js)
 * Phase 4  — ERC1155Factory + ERC404Factory (forge scripts)
 *            QueryAggregator + factory registration
 *
 * @returns {Promise<{core: object, factories: object, provider: object, deployer: object}>}
 */
export async function deployContracts() {
  const provider = new ethers.providers.JsonRpcProvider(RPC)
  const deployer = new ethers.Wallet(ANVIL_KEY, provider)

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 1: MASTER REGISTRY (forge script)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 1: MASTER REGISTRY (forge script)')
  console.log('════════════════════════════════════════════════════')

  runForgeScript('script/DeployMaster.s.sol')

  // DeployMaster deploys MasterRegistryV1 (impl) first, then MasterRegistry (outer proxy wrapper).
  const masterDeployments = await readAllBroadcastAddresses('DeployMaster')
  const implDeployment = masterDeployments.find(d => d.contractName === 'MasterRegistryV1')
  const proxyDeployment = masterDeployments.find(d => d.contractName === 'MasterRegistry')

  if (!implDeployment) throw new Error('MasterRegistryV1 deployment not found in broadcast')
  if (!proxyDeployment) throw new Error('MasterRegistry proxy deployment not found in broadcast')

  const masterRegistryOuterProxy = proxyDeployment.address
  console.log('   MasterRegistryV1 impl:   ', implDeployment.address)
  console.log('   MasterRegistry outer proxy:', masterRegistryOuterProxy)

  // The outer MasterRegistry is a factory/wrapper that deploys an inner ERC1967 proxy via LibClone.
  // All actual registry calls must go to the INNER proxy (it holds the state).
  const outerAbi = await loadAbi('MasterRegistry')
  const outerContract = new ethers.Contract(masterRegistryOuterProxy, outerAbi, deployer)
  const innerProxyAddress = await outerContract.getProxyAddress()
  console.log('   MasterRegistry inner proxy:', innerProxyAddress)

  // Get MasterRegistryV1 ABI for all subsequent registry calls
  const registryAbi = await loadAbi('MasterRegistryV1')
  const registry = new ethers.Contract(innerProxyAddress, registryAbi, deployer)

  // Foundry nightly has a bug where vm.startBroadcast(key) encodes the wrong
  // msg.sender in the MasterRegistry wrapper's initialize(msg.sender) call,
  // resulting in the inner proxy being owned by an unexpected address.
  // Fix: use Anvil impersonation to transfer ownership to the deployer.
  const actualOwner = await registry.owner()
  if (actualOwner.toLowerCase() !== DEPLOYER_ADDRESS.toLowerCase()) {
    console.log(`   Owner mismatch: ${actualOwner} (expected ${DEPLOYER_ADDRESS})`)
    console.log('   Fixing via Anvil impersonation...')
    await provider.send('anvil_impersonateAccount', [actualOwner])
    await provider.send('anvil_setBalance', [actualOwner, '0x56BC75E2D63100000'])
    const registryAsOwner = new ethers.Contract(innerProxyAddress, registryAbi, provider.getSigner(actualOwner))
    await (await registryAsOwner.transferOwnership(DEPLOYER_ADDRESS)).wait()
    await provider.send('anvil_stopImpersonatingAccount', [actualOwner])
    console.log('   Ownership transferred to deployer')
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 1b: ALIGNMENT REGISTRY (ethers.js)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 1b: ALIGNMENT REGISTRY (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // AlignmentRegistryV1 is UUPS upgradeable. Deploy impl, then use MasterRegistry-style
  // LibClone ERC1967 proxy wrapper to create a proxy, then initialize.
  const alignRegAbi = await loadAbi('AlignmentRegistryV1')
  const alignRegBytecode = await loadBytecode('AlignmentRegistryV1')
  const alignRegFactory = new ethers.ContractFactory(alignRegAbi, alignRegBytecode, deployer)
  const alignRegImpl = await alignRegFactory.deploy()
  await alignRegImpl.deployed()
  console.log('   AlignmentRegistryV1 impl:', alignRegImpl.address)

  // Reuse the MasterRegistry wrapper pattern (LibClone.deployERC1967) to create ERC1967 proxy.
  // The MasterRegistry wrapper constructor takes (implementation, initData) and deploys an
  // inner ERC1967 proxy. We reuse it as a generic proxy factory.
  const proxyWrapperAbi = await loadAbi('MasterRegistry')
  const proxyWrapperBytecode = await loadBytecode('MasterRegistry')
  const proxyWrapperFactory = new ethers.ContractFactory(proxyWrapperAbi, proxyWrapperBytecode, deployer)

  const alignRegInitData = alignRegImpl.interface.encodeFunctionData('initialize', [DEPLOYER_ADDRESS])
  const alignRegProxy = await proxyWrapperFactory.deploy(alignRegImpl.address, alignRegInitData)
  await alignRegProxy.deployed()
  const alignRegInnerProxy = await alignRegProxy.getProxyAddress()
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

  // GlobalMessageRegistry — constructor(address _owner, address _masterRegistry)
  const gmrAbi = await loadAbi('GlobalMessageRegistry')
  const gmrBytecode = await loadBytecode('GlobalMessageRegistry')
  const gmrFactory = new ethers.ContractFactory(gmrAbi, gmrBytecode, deployer)
  const gmr = await gmrFactory.deploy(DEPLOYER_ADDRESS, innerProxyAddress)
  await gmr.deployed()
  console.log('   GlobalMessageRegistry:  ', gmr.address)

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
  const compRegProxy = await proxyWrapperFactory.deploy(compRegImpl.address, compRegInitData)
  await compRegProxy.deployed()
  const compRegInnerProxy = await compRegProxy.getProxyAddress()
  console.log('   ComponentRegistry proxy: ', compRegInnerProxy)

  const componentRegistry = new ethers.Contract(compRegInnerProxy, compRegAbi, deployer)

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 3: HOOK FACTORY (ethers.js) + VAULT DEPLOYMENT
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 3: HOOK FACTORY & VAULTS (ethers.js)')
  console.log('════════════════════════════════════════════════════')

  // UltraAlignmentHookFactory — constructor(address _hookTemplate)
  // We pass DEPLOYER_ADDRESS as a harmless placeholder (see original comments).
  const hookFactoryAbi = await loadAbi('UltraAlignmentHookFactory')
  const hookFactoryBytecode = await loadBytecode('UltraAlignmentHookFactory')
  const hookFactoryContractFactory = new ethers.ContractFactory(hookFactoryAbi, hookFactoryBytecode, deployer)
  const hookFactory = await hookFactoryContractFactory.deploy(DEPLOYER_ADDRESS)
  await hookFactory.deployed()
  console.log('   UltraAlignmentHookFactory:  ', hookFactory.address)

  // Load UltraAlignmentV4Hook bytecode for salt mining
  const hookArtifact = await loadArtifact('UltraAlignmentV4Hook')
  const hookCreationCode = hookArtifact.bytecode.object

  // Load UltraAlignmentVault artifact
  const vaultAbi = await loadAbi('UltraAlignmentVault')
  const vaultBytecode = await loadBytecode('UltraAlignmentVault')
  const vaultContractFactory = new ethers.ContractFactory(vaultAbi, vaultBytecode, deployer)

  // Helper: mine hook salt for a given vault address
  async function mineHookSaltForVault(vaultAddr, creator, vaultLabel) {
    console.log(`   Mining hook salt for ${vaultLabel}...`)
    const result = await mineHookSalt({
      hookFactoryAddress: hookFactory.address,
      hookCreationCode,
      poolManager: MAINNET_ADDRESSES.uniswapV4PoolManager,
      vault: vaultAddr,
      weth: MAINNET_ADDRESSES.weth,
      creator,
      hookFeeBips: 500,      // 5% — matches createHook() call below
      initialLpFeeRate: 3000, // matches createHook() call below
      onProgress: (iterations, rate) => {
        console.log(`      ... ${iterations.toLocaleString()} iterations (${rate.toLocaleString()}/sec)`)
      },
    })
    console.log(`   Found valid salt in ${result.iterations.toLocaleString()} iterations (${result.timeSeconds.toFixed(2)}s)`)
    const flags = decodeHookFlags(result.address)
    console.log(`   Hook flags: ${flags.rawFlags} (afterSwap: ${flags.afterSwap}, afterSwapReturnDelta: ${flags.afterSwapReturnDelta})`)
    return result.salt
  }

  // Register alignment targets on AlignmentRegistryV1 (previously on MasterRegistry).
  console.log('   Registering MS2 alignment target...')
  const registerMS2TargetTx = await alignmentRegistry.registerAlignmentTarget(
    'MS2',
    'Milady Station 2 community alignment target',
    'https://ms2.fun/metadata/target/ms2',
    [{ token: MAINNET_ADDRESSES.ms2Token, symbol: 'MS2', info: 'Milady Station 2 token', metadataURI: '' }]
  )
  const ms2TargetReceipt = await registerMS2TargetTx.wait()
  const ms2TargetEvent = ms2TargetReceipt.events?.find(e => e.event === 'AlignmentTargetRegistered')
  const ms2TargetId = ms2TargetEvent.args.targetId.toNumber()
  console.log(`   MS2 alignment target registered (targetId=${ms2TargetId})`)

  console.log('   Registering CULT alignment target...')
  const registerCULTTargetTx = await alignmentRegistry.registerAlignmentTarget(
    'CULT',
    'Cult DAO community alignment target',
    'https://ms2.fun/metadata/target/cult',
    [{ token: MAINNET_ADDRESSES.cultToken, symbol: 'CULT', info: 'Cult DAO token', metadataURI: '' }]
  )
  const cultTargetReceipt = await registerCULTTargetTx.wait()
  const cultTargetEvent = cultTargetReceipt.events?.find(e => e.event === 'AlignmentTargetRegistered')
  const cultTargetId = cultTargetEvent.args.targetId.toNumber()
  console.log(`   CULT alignment target registered (targetId=${cultTargetId})`)

  // Deploy UltraAlignmentVault #1 (MS2-aligned)
  // constructor(weth, poolManager, v3Router, v2Router, v2Factory, v3Factory, alignmentToken, factoryCreator, creatorYieldCutBps)
  console.log('   Deploying UltraAlignmentVault (MS2-aligned)...')
  const ms2Vault = await vaultContractFactory.deploy(
    MAINNET_ADDRESSES.weth,
    MAINNET_ADDRESSES.uniswapV4PoolManager,
    MAINNET_ADDRESSES.uniswapV3Router,
    MAINNET_ADDRESSES.uniswapV2Router,
    MAINNET_ADDRESSES.uniswapV2Factory,
    MAINNET_ADDRESSES.uniswapV3Factory,
    MAINNET_ADDRESSES.ms2Token,
    DEPLOYER_ADDRESS,  // factoryCreator
    250,               // creatorYieldCutBps (2.5%)
  )
  await ms2Vault.deployed()
  console.log('   UltraAlignmentVault (MS2):', ms2Vault.address)

  // Mine salt for MS2 vault hook
  const ms2VaultSalt = await mineHookSaltForVault(ms2Vault.address, DEPLOYER_ADDRESS, 'MS2-Vault')

  // createHook(poolManager, vault, wethAddr, creator, isCanonical, salt, hookFeeBips, initialLpFeeRate)
  const hookFee = await hookFactory.hookCreationFee()
  const createMS2HookTx = await hookFactory.createHook(
    MAINNET_ADDRESSES.uniswapV4PoolManager,
    ms2Vault.address,
    MAINNET_ADDRESSES.weth,
    DEPLOYER_ADDRESS,
    true,          // isCanonical
    ms2VaultSalt,
    500,           // hookFeeBips (5%)
    3000,          // initialLpFeeRate
    { value: hookFee }
  )
  const ms2HookReceipt = await createMS2HookTx.wait()
  const ms2HookEvent = ms2HookReceipt.events?.find(e => e.event === 'HookCreated')
  const ms2HookAddress = ms2HookEvent?.args?.hook
  console.log('   MS2 vault hook:', ms2HookAddress)

  // Register MS2 vault in MasterRegistry
  // registerVault(vault, creator, name, metadataURI, targetId)
  const registerMS2VaultTx = await registry.registerVault(
    ms2Vault.address,
    DEPLOYER_ADDRESS,
    'UltraAlignmentVault-MS2',
    'https://ms2.fun/metadata/vault/ultra-alignment-ms2',
    ms2TargetId
  )
  await registerMS2VaultTx.wait()
  console.log('   MS2 vault registered in MasterRegistry')

  // Deploy UltraAlignmentVault #2 (CULT-aligned)
  console.log('   Deploying UltraAlignmentVault (CULT-aligned)...')
  const cultVault = await vaultContractFactory.deploy(
    MAINNET_ADDRESSES.weth,
    MAINNET_ADDRESSES.uniswapV4PoolManager,
    MAINNET_ADDRESSES.uniswapV3Router,
    MAINNET_ADDRESSES.uniswapV2Router,
    MAINNET_ADDRESSES.uniswapV2Factory,
    MAINNET_ADDRESSES.uniswapV3Factory,
    MAINNET_ADDRESSES.cultToken,
    DEPLOYER_ADDRESS,  // factoryCreator
    250,               // creatorYieldCutBps (2.5%)
  )
  await cultVault.deployed()
  console.log('   UltraAlignmentVault (CULT):', cultVault.address)

  // Mine salt for CULT vault hook
  const cultVaultSalt = await mineHookSaltForVault(cultVault.address, DEPLOYER_ADDRESS, 'CULT-Vault')

  const createCULTHookTx = await hookFactory.createHook(
    MAINNET_ADDRESSES.uniswapV4PoolManager,
    cultVault.address,
    MAINNET_ADDRESSES.weth,
    DEPLOYER_ADDRESS,
    true,           // isCanonical
    cultVaultSalt,
    500,            // hookFeeBips (5%)
    3000,           // initialLpFeeRate
    { value: hookFee }
  )
  const cultHookReceipt = await createCULTHookTx.wait()
  const cultHookEvent = cultHookReceipt.events?.find(e => e.event === 'HookCreated')
  const cultHookAddress = cultHookEvent?.args?.hook
  console.log('   CULT vault hook:', cultHookAddress)

  // Register CULT vault in MasterRegistry
  const registerCULTVaultTx = await registry.registerVault(
    cultVault.address,
    DEPLOYER_ADDRESS,
    'UltraAlignmentVault-CULT',
    'https://ms2.fun/metadata/vault/ultra-alignment-cult',
    cultTargetId
  )
  await registerCULTVaultTx.wait()
  console.log('   CULT vault registered in MasterRegistry')

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 4: PROJECT FACTORIES (forge scripts)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 4: PROJECT FACTORIES (forge scripts)')
  console.log('════════════════════════════════════════════════════')

  // ERC1155Instance template — constructor signature changed:
  //   constructor(name, metadataURI, creator, factory, vault, styleUri, globalMessageRegistry, protocolTreasury)
  const erc1155InstanceAbi = await loadAbi('ERC1155Instance')
  const erc1155InstanceBytecode = await loadBytecode('ERC1155Instance')
  const erc1155InstanceContractFactory = new ethers.ContractFactory(erc1155InstanceAbi, erc1155InstanceBytecode, deployer)
  const erc1155Template = await erc1155InstanceContractFactory.deploy(
    'TEMPLATE',                    // _name
    '',                            // metadataURI
    DEPLOYER_ADDRESS,              // _creator
    DEPLOYER_ADDRESS,              // _factory (placeholder)
    DEPLOYER_ADDRESS,              // _vault (placeholder — must be non-zero)
    '',                            // _styleUri
    gmr.address,                   // _globalMessageRegistry
    DEPLOYER_ADDRESS               // _protocolTreasury (placeholder)
  )
  await erc1155Template.deployed()
  console.log('   ERC1155Instance template:   ', erc1155Template.address)

  // ERC1155Factory — constructor now takes globalMessageRegistry
  runForgeScript('script/DeployERC1155Factory.s.sol', {
    MASTER_REGISTRY: innerProxyAddress,
    INSTANCE_TEMPLATE: erc1155Template.address,
    CREATOR: DEPLOYER_ADDRESS,
    CREATOR_FEE_BPS: '250',
    GLOBAL_MESSAGE_REGISTRY: gmr.address,
  })
  const erc1155FactoryAddress = await readBroadcastAddress('DeployERC1155Factory')
  console.log('   ERC1155Factory:            ', erc1155FactoryAddress)

  // ERC404Factory — forge script now deploys ALL modules internally:
  //   ERC404BondingInstance impl, ERC404StakingModule, LiquidityDeployerModule,
  //   LaunchManager, CurveParamsComputer, then the factory itself.
  // No more ethers.js template deployment needed.
  // The INSTANCE_TEMPLATE env var is still used by the forge script for the Solady clone template.
  //
  // Deploy a minimal ERC404BondingInstance as clone template for LibClone.
  // The new constructor is zero-arg (just locks implementation).
  const erc404InstanceAbi = await loadAbi('ERC404BondingInstance')
  const erc404InstanceBytecode = await loadBytecode('ERC404BondingInstance')
  const erc404InstanceContractFactory = new ethers.ContractFactory(erc404InstanceAbi, erc404InstanceBytecode, deployer)
  const erc404Template = await erc404InstanceContractFactory.deploy()
  await erc404Template.deployed()
  console.log('   ERC404BondingInstance template:', erc404Template.address)

  runForgeScript('script/DeployERC404Factory.s.sol', {
    MASTER_REGISTRY: innerProxyAddress,
    INSTANCE_TEMPLATE: erc404Template.address,
    V4_POOL_MANAGER: MAINNET_ADDRESSES.uniswapV4PoolManager,
    WETH: MAINNET_ADDRESSES.weth,
    PROTOCOL: DEPLOYER_ADDRESS,
    CREATOR: DEPLOYER_ADDRESS,
    CREATOR_FEE_BPS: '100',
    CREATOR_GRADUATION_FEE_BPS: '200',
    GLOBAL_MESSAGE_REGISTRY: gmr.address,
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
  const registerERC404Tx = await registry.registerFactory(
    erc404FactoryAddress,
    'ERC404',
    'ERC404-Bonding-Curve-Factory',
    'ERC404 Bonding Curve',
    'https://ms2.fun/metadata/factory/erc404',
    []  // features (empty for now)
  )
  await registerERC404Tx.wait()
  console.log('   ERC404Factory registered (factoryId=1)')

  // Register ERC1155Factory in MasterRegistry (factoryId=2)
  const registerERC1155Tx = await registry.registerFactory(
    erc1155FactoryAddress,
    'ERC1155',
    'ERC1155-Edition-Factory',
    'ERC1155 Editions',
    'https://ms2.fun/metadata/factory/erc1155',
    []  // features (empty for now)
  )
  await registerERC1155Tx.wait()
  console.log('   ERC1155Factory registered (factoryId=2)')

  // Set protocol treasury on both factories (required before any instance can be created)
  const erc1155FactoryAbi = await loadAbi('ERC1155Factory')
  const erc1155FactoryContract = new ethers.Contract(erc1155FactoryAddress, erc1155FactoryAbi, deployer)
  await (await erc1155FactoryContract.setProtocolTreasury(DEPLOYER_ADDRESS)).wait()
  console.log('   ERC1155Factory treasury set:', DEPLOYER_ADDRESS)

  const erc404FactoryAbi = await loadAbi('ERC404Factory')
  const erc404FactoryContract = new ethers.Contract(erc404FactoryAddress, erc404FactoryAbi, deployer)
  await (await erc404FactoryContract.setProtocolTreasury(DEPLOYER_ADDRESS)).wait()
  console.log('   ERC404Factory treasury set:', DEPLOYER_ADDRESS)

  console.log('\n════════════════════════════════════════════════════')
  console.log('DEPLOYMENT COMPLETE')
  console.log('════════════════════════════════════════════════════')
  console.log('   masterRegistry (inner):  ', innerProxyAddress)
  console.log('   alignmentRegistry:       ', alignRegInnerProxy)
  console.log('   componentRegistry:       ', compRegInnerProxy)
  console.log('   globalMessageRegistry:   ', gmr.address)
  console.log('   featuredQueueManager:    ', fqm.address)
  console.log('   queryAggregator:         ', queryAgg.address)
  console.log('   hookFactory:             ', hookFactory.address)
  console.log('   vault (MS2):             ', ms2Vault.address, '  hook:', ms2HookAddress)
  console.log('   vault (CULT):            ', cultVault.address, '  hook:', cultHookAddress)
  console.log('   erc1155Factory:          ', erc1155FactoryAddress)
  console.log('   erc404Factory:           ', erc404FactoryAddress)

  return {
    core: {
      masterRegistry: innerProxyAddress,        // all calls use inner proxy
      masterRegistryOuter: masterRegistryOuterProxy, // kept for reference
      alignmentRegistry: alignRegInnerProxy,
      componentRegistry: compRegInnerProxy,
      globalMessageRegistry: gmr.address,
      featuredQueueManager: fqm.address,
      queryAggregator: queryAgg.address,
      hookFactory: hookFactory.address,
    },
    factories: {
      erc1155: erc1155FactoryAddress,
      erc404: erc404FactoryAddress,
    },
    vaults: [
      {
        address: ms2Vault.address,
        alignmentToken: MAINNET_ADDRESSES.ms2Token,
        hookAddress: ms2HookAddress,
      },
      {
        address: cultVault.address,
        alignmentToken: MAINNET_ADDRESSES.cultToken,
        hookAddress: cultHookAddress,
      },
    ],
    provider,
    deployer,
  }
}
