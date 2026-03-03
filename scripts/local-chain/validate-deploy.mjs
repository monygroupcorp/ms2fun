// scripts/local-chain/validate-deploy.mjs
//
// Pre-flight checks before running chain:start:
//
//   1. Forge script env vars — verifies that every vm.env*("VAR") call in each
//      forge deploy script is satisfied by what deploy-contracts.mjs passes.
//
//   2. Seed function signatures — verifies that every contract function called
//      by the seed scripts still exists in the compiled ABI with the exact
//      expected signature. Catches renamed/reordered/added parameters before
//      any transactions are sent.
//
// Run after `forge build`:
//   npm run chain:validate

import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Forge script env var validation
//
// Mirrors what deploy-contracts.mjs passes to each runForgeScript() call.
// Update this table when you update the corresponding runForgeScript() call.
// ─────────────────────────────────────────────────────────────────────────────

const FORGE_SCRIPT_CALLS = [
  {
    script: 'script/DeployMaster.s.sol',
    envVars: {},
  },
  {
    script: 'script/DeployERC1155Factory.s.sol',
    envVars: {
      MASTER_REGISTRY: '<address>',
      INSTANCE_TEMPLATE: '<address>',
      GLOBAL_MESSAGE_REGISTRY: '<address>',
    },
  },
  {
    script: 'script/DeployERC404Factory.s.sol',
    envVars: {
      MASTER_REGISTRY: '<address>',
      PROTOCOL: '<address>',
      COMPONENT_REGISTRY: '<address>',
      GLOBAL_MESSAGE_REGISTRY: '<address>',
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Seed function signature validation
//
// Lists every contract function called directly by seed-common.mjs and
// scenarios/*.mjs using positional arguments. If any signature changes
// (param added/removed/retyped/renamed), the entry here won't match the
// compiled ABI and validation fails before any transactions are sent.
//
// Format: canonical Solidity signature (name + comma-separated param types,
// no spaces, tuples as (type1,type2,...)).
//
// Update this table when you update a function call in the seed scripts.
// ─────────────────────────────────────────────────────────────────────────────

const SEED_FUNCTIONS = [
  {
    contract: 'ERC404BondingInstance',
    functions: [
      'buyBonding(uint256,uint256,bool,bytes32,bytes,uint256)',
      'setBondingOpenTime(uint256)',
      'setBondingActive(bool)',
      'setBondingMaturityTime(uint256)',
      'approve(address,uint256)',
      'transfer(address,uint256)',
      'transferOwnership(address)',
    ],
  },
  {
    contract: 'ERC1155Instance',
    functions: [
      'addEdition(string,uint256,uint256,string,uint8,uint256,uint256)',
      'mint(uint256,uint256,bytes32,bytes,uint256)',
      'withdraw(uint256)',
      'safeTransferFrom(address,address,uint256,uint256,bytes)',
      'transferOwnership(address)',
    ],
  },
  {
    contract: 'ERC404Factory',
    functions: [
      // Full overload signature used in seed-common.mjs createERC404Instance()
      'createInstance((string,string,string,address,address,uint256,uint8,uint8),string,address,address,(uint256,uint8))',
    ],
  },
  {
    contract: 'ERC1155Factory',
    functions: [
      // Full overload signature used in seed-common.mjs createERC1155Instance()
      'createInstance(string,string,address,address,string)',
    ],
  },
  {
    contract: 'MasterRegistryV1',
    functions: [
      'registerFactory(address,string,string,string,string,bytes32[])',
      'registerVault(address,address,string,string,uint256)',
      'setAlignmentRegistry(address)',
      'transferOwnership(address)',
    ],
  },
  {
    contract: 'AlignmentRegistryV1',
    functions: [
      'registerAlignmentTarget(string,string,string,(address,string,string,string)[])',
    ],
  },
  {
    contract: 'UltraAlignmentVault',
    functions: [
      'receiveInstance(address,uint256,address)',
      'convertAndAddLiquidity(uint256)',
      'recordAccumulatedFees(uint256)',
      'claimFees()',
      'calculateClaimableAmount(address)',
    ],
  },
  {
    contract: 'GlobalMessageRegistry',
    functions: [
      'post(address,uint8,uint256,bytes32,bytes32,string)',
    ],
  },
  {
    contract: 'FeaturedQueueManager',
    functions: [
      'initialize(address,address)',
    ],
  },
  {
    contract: 'QueryAggregator',
    functions: [
      'initialize(address,address,address,address)',
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractRequiredEnvVars(scriptPath) {
  const fullPath = path.join(CONTRACTS_DIR, scriptPath)
  const content = readFileSync(fullPath, 'utf8')
  const pattern = /vm\.env\w+\("([^"]+)"\)/g
  const required = []
  let match
  while ((match = pattern.exec(content)) !== null) {
    required.push(match[1])
  }
  return required
}

function loadAbi(contractName) {
  const artifactPath = path.join(CONTRACTS_DIR, 'out', `${contractName}.sol`, `${contractName}.json`)
  const raw = readFileSync(artifactPath, 'utf8')
  return JSON.parse(raw).abi
}

/**
 * Build a canonical function signature string from an ABI function entry.
 * Handles tuples and tuple arrays recursively.
 */
function buildSignature(fn) {
  function typeStr(input) {
    if (input.type === 'tuple') {
      return `(${input.components.map(typeStr).join(',')})`
    }
    if (input.type === 'tuple[]') {
      return `(${input.components.map(typeStr).join(',')})[]`
    }
    return input.type
  }
  return `${fn.name}(${fn.inputs.map(typeStr).join(',')})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Run validation
// ─────────────────────────────────────────────────────────────────────────────

let failed = false

// — Section 1: Forge env vars —
console.log('── Forge script env vars ────────────────────────────')
for (const { script, envVars } of FORGE_SCRIPT_CALLS) {
  const required = extractRequiredEnvVars(script)
  const provided = new Set([...Object.keys(envVars), 'PRIVATE_KEY'])
  const missing = required.filter(v => !provided.has(v))
  const extra = [...provided].filter(v => v !== 'PRIVATE_KEY' && !required.includes(v))

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${script}`)
  } else {
    console.error(`✗ ${script}`)
    if (missing.length > 0) console.error(`    Missing (required by script, not provided): ${missing.join(', ')}`)
    if (extra.length > 0) console.error(`    Extra (provided but script doesn't use): ${extra.join(', ')}`)
    failed = true
  }
}

// — Section 2: Seed function signatures —
console.log('\n── Seed function signatures ─────────────────────────')
for (const { contract, functions } of SEED_FUNCTIONS) {
  let abi
  try {
    abi = loadAbi(contract)
  } catch (e) {
    console.error(`✗ ${contract}: cannot load ABI (run forge build first)`)
    failed = true
    continue
  }

  const abiSignatures = new Set(
    abi.filter(e => e.type === 'function').map(buildSignature)
  )

  const missing = functions.filter(sig => !abiSignatures.has(sig))

  if (missing.length === 0) {
    console.log(`✓ ${contract} (${functions.length} function${functions.length !== 1 ? 's' : ''})`)
  } else {
    console.error(`✗ ${contract}`)
    for (const sig of missing) {
      console.error(`    Missing: ${sig}`)
      // Show close matches (same name, different params) to help diagnose
      const sameName = [...abiSignatures].filter(s => s.startsWith(sig.split('(')[0] + '('))
      if (sameName.length > 0) {
        console.error(`    Found:   ${sameName.join('\n             ')}`)
      }
    }
    failed = true
  }
}

if (failed) {
  console.error('\nPre-flight failed. Fix the mismatches above before running chain:start.')
  process.exit(1)
} else {
  console.log('\nAll checks passed. Deploy and seed scripts are in sync with contracts.')
}
