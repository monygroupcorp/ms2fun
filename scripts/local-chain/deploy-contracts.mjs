// scripts/local-chain/deploy-contracts.mjs
//
// Deploys all core contracts for the local dev chain via DeployAnvil.s.sol.
// Runs forge script script/DeployAnvil.s.sol --broadcast, reads deployments/anvil.json,
// and returns { core, factories, vaults, governance: null, provider, deployer }.


import { execSync } from 'child_process'
import { promises as fs, readFileSync } from 'fs'
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
 * Deploy all protocol contracts via DeployAnvil.s.sol.
 *
 * Runs forge script, reads contracts/deployments/anvil.json, maps keys to
 * the shape expected by run-local.mjs, write-config.mjs, and seed scenarios.
 *
 * @returns {Promise<{core: object, factories: object, vaults: Array, governance: null, provider: object, deployer: object}>}
 */
export async function deployContracts() {
  const provider = new ethers.providers.JsonRpcProvider(RPC)
  const deployer = new ethers.Wallet(ANVIL_KEY, provider)

  // ───────────────────────────────────────────────────────────────────────────
  // Pre-flight: clear EIP-7702 delegations from Anvil default accounts
  // (mainnet fork has these; they cause _safeMint to revert)
  // ───────────────────────────────────────────────────────────────────────────
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
  // Run DeployAnvil.s.sol — single forge script deploys everything
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('DEPLOYING: forge script script/DeployAnvil.s.sol')
  console.log('════════════════════════════════════════════════════')

  const forgeEnv = {
    ...process.env,
    PRIVATE_KEY: ANVIL_KEY,
  }
  execSync(
    `forge script script/DeployAnvil.s.sol --rpc-url ${RPC} --broadcast --chain-id ${CHAIN_ID} --code-size-limit 30000`,
    { cwd: CONTRACTS_DIR, stdio: 'inherit', env: forgeEnv }
  )

  // ───────────────────────────────────────────────────────────────────────────
  // Read deployments/anvil.json written by DeployCore Phase 11
  // ───────────────────────────────────────────────────────────────────────────
  const anvil_jsonPath = path.join(CONTRACTS_DIR, 'deployments', 'anvil.json')
  const raw = await fs.readFile(anvil_jsonPath, 'utf8')
  const deployed = JSON.parse(raw)
  console.log('\n   ✓ Read deployments/anvil.json')

  const c = deployed.contracts
  const f = deployed.factories

  // Map PascalCase JSON keys → camelCase shape expected by run-local / write-config / scenarios
  const core = {
    masterRegistry:       c.MasterRegistry,
    globalMessageRegistry: c.GlobalMessageRegistry,
    featuredQueueManager: c.FeaturedQueueManager,
    alignmentRegistry:    c.AlignmentRegistry,
    componentRegistry:    c.ComponentRegistry,
    queryAggregator:      c.QueryAggregator,
    protocolTreasury:     c.ProtocolTreasury,
    deployBlock:          0,
  }

  const factories = {
    erc404: f.ERC404,
    erc1155: f.ERC1155,
    erc721: f.ERC721 || null,
  }

  // Normalize vault shape: DeployCore uses { type, targetId } but frontend expects { vaultType, name }
  const TOKEN_NAMES = {
    [MAINNET_ADDRESSES.ms2Token.toLowerCase()]: 'MS2',
    [MAINNET_ADDRESSES.cultToken.toLowerCase()]: 'CULT',
  }
  const rawVaults = typeof deployed.vaults === 'string' ? JSON.parse(deployed.vaults) : (deployed.vaults || [])
  const vaults = rawVaults.map(v => {
    const tokenName = TOKEN_NAMES[v.alignmentToken?.toLowerCase()] || `Target${v.targetId}`
    return {
      address: v.address,
      alignmentToken: v.alignmentToken,
      vaultType: v.type,
      name: `${tokenName} ${v.type}`,
    }
  })

  console.log('   core.masterRegistry:       ', core.masterRegistry)
  console.log('   core.queryAggregator:       ', core.queryAggregator)
  console.log('   core.componentRegistry:     ', core.componentRegistry)
  console.log('   factories.erc404:           ', factories.erc404)
  console.log('   factories.erc1155:          ', factories.erc1155)
  console.log('   vaults:                     ', vaults.length)

  return {
    core,
    factories,
    vaults,
    governance: null,
    provider,
    deployer,
  }
}

