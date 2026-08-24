/**
 * Shared helpers for the Algebra standup tooling: artifact IO, bytecode arithmetic, the
 * immutable/link mask derivation, and the address-substitution engine.
 *
 * Nothing here embeds any third-party bytecode. Everything operates on artifacts fetched at run
 * time into the gitignored `artifacts/` directory.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Role } from './manifest.ts'

export type Hex = `0x${string}`

const HERE = dirname(fileURLToPath(import.meta.url))

export const ARTIFACT_DIR = resolve(HERE, 'artifacts')

export interface MainnetArtifact {
  role: Role
  label: string
  address: Hex
  /** Explorer-reported contract name, when verified. */
  contractName: string | null
  verified: boolean
  compilerVersion: string | null
  optimizationRuns: number | null
  /** Full creation input: constructor code + runtime template + ABI-encoded constructor arguments. */
  creationInput: Hex
  /** Runtime code at the address, cross-checked between explorer metadata and eth_getCode. */
  runtime: Hex
  /** Explorer-reported constructor arguments, when the contract is verified. */
  constructorArgs: Hex | null
  /** Decoded constructor arguments, name + type + value, when the contract is verified. */
  decodedConstructorArgs: { name: string; type: string; value: string }[] | null
  /** Linked libraries reported by the explorer, name -> mainnet address. */
  linkedLibraries: { name: string; address: Hex }[]
  fetchedAt: string
  source: { explorer: string; rpc: string; blockNumber: string }
}

export interface ResolvedFacts {
  /** Roles discovered at fetch time rather than pinned in the manifest. */
  addresses: Partial<Record<Role, Hex>>
  /** The account that created the published set on mainnet; its role is reproduced by the runner. */
  originalDeployer: Hex
  /** Wrapped-native token the mainnet set was constructed against. */
  mainnetWNative: Hex
  /** Native-currency symbol string the token descriptor was constructed with. */
  nativeCurrencySymbol: string
  /**
   * Community-vault configuration read from mainnet.
   *
   * The fee REGIME is what a standup reproduces — the fee value and the roles that govern it. The
   * mainnet role HOLDERS are third-party accounts with no test-network counterpart, so they are
   * recorded here as context and the runner points the same roles at operator-supplied addresses.
   */
  vaultConfig: {
    /** Fee-manager account the vault was constructed against; the runner substitutes it. */
    constructorFeeManager: Hex
    /** Account currently holding the fee-manager role. The role is transferable. */
    currentFeeManager: Hex
    /** Algebra's share of a community-fee withdrawal, in thousandths. */
    algebraFee: number
    algebraFeeReceiver: Hex
    communityFeeReceiver: Hex
  }
  /** Factory configuration read from mainnet, reproduced by the runner where reproducible. */
  factoryConfig: {
    defaultPluginFactory: Hex
    vaultFactory: Hex
    defaultFee: number
    defaultTickspacing: number
    defaultCommunityFee: number
    owner: Hex
    poolInitCodeHash: Hex
  }
}

export interface DeployedContract {
  role: Role
  label: string
  address: Hex
  txHash: Hex
  /** keccak of the creation input actually broadcast, so a run is reproducible from its record. */
  creationInputHash: Hex
}

export interface DeploymentRecord {
  chainId: number
  rpc: string
  deployer: Hex
  wnative: Hex
  proxyAdmin: Hex
  /** Operator address the community vault's fee-manager role was constructed against. */
  algebraFeeManager: Hex
  /** Operator addresses the vault's two receiver roles were pointed at. */
  algebraFeeReceiver: Hex
  communityFeeReceiver: Hex
  startedAt: string
  contracts: DeployedContract[]
  wiringTxs: { call: string; txHash: Hex }[]
  deviations: string[]
}

// ---------------------------------------------------------------------------
// hex helpers
// ---------------------------------------------------------------------------

export function strip0x(hex: string): string {
  return hex.replace(/^0x/i, '').toLowerCase()
}

export function toBytes(hex: string): Uint8Array {
  const body = strip0x(hex)
  if (body.length % 2 !== 0) throw new Error('odd-length hex string')
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toHex(bytes: Uint8Array): Hex {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return `0x${out}`
}

export function isAddress(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

export function normalizeAddress(value: string): Hex {
  if (!isAddress(value)) throw new Error(`not an address: ${value}`)
  return value.toLowerCase() as Hex
}

// ---------------------------------------------------------------------------
// artifact IO
// ---------------------------------------------------------------------------

export function artifactPath(role: Role): string {
  return join(ARTIFACT_DIR, 'mainnet', `${role}.json`)
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function readArtifact(role: Role): MainnetArtifact {
  const path = artifactPath(role)
  try {
    return readJson<MainnetArtifact>(path)
  } catch {
    throw new Error(`missing artifact for ${role} (${path}) — run fetch.ts first`)
  }
}

export function resolvedPath(): string {
  return join(ARTIFACT_DIR, 'resolved.json')
}

export function readResolved(): ResolvedFacts {
  try {
    return readJson<ResolvedFacts>(resolvedPath())
  } catch {
    throw new Error(`missing ${resolvedPath()} — run fetch.ts first`)
  }
}

/** Newest deployment record in the artifacts directory, or the one named explicitly. */
export function latestDeployment(explicit?: string): DeploymentRecord {
  if (explicit) return readJson<DeploymentRecord>(resolve(explicit))
  const dir = join(ARTIFACT_DIR, 'deployments')
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    throw new Error(`no deployments found under ${dir} — run deploy.ts first`)
  }
  if (names.length === 0) throw new Error(`no deployments found under ${dir}`)
  names.sort()
  return readJson<DeploymentRecord>(join(dir, names[names.length - 1]))
}

// ---------------------------------------------------------------------------
// substitution
// ---------------------------------------------------------------------------

export interface Substitution {
  what: string
  from: Hex
  to: Hex
  /**
   * Restrict this substitution to one contract's creation input.
   *
   * Needed where two roles are held by the SAME mainnet account but are separate roles on the
   * target chain: the proxy admin and the community vault's fee manager are one account on
   * mainnet, so an unscoped rewrite of that address would let whichever substitution ran first
   * claim both constructor arguments and silently drop the other role's operator address.
   */
  only?: Role
}

/** The substitutions that apply to one role's creation input. */
export function scopedTo(subs: readonly Substitution[], role: Role): Substitution[] {
  return subs.filter((s) => s.only === undefined || s.only === role)
}

/**
 * Replace every occurrence of each 20-byte source address inside a blob.
 *
 * Applied to the whole creation input, which covers all three places a mainnet address can sit:
 * ABI-encoded constructor arguments, linked-library references inside the code, and constructor
 * arguments baked into an unverified proxy's creation input. Replacement counts are returned so
 * the runner can print them and a caller can assert on them.
 */
export function substituteAddresses(
  blob: Hex,
  subs: readonly Substitution[],
): { out: Hex; counts: Record<string, number> } {
  let body = strip0x(blob)
  const counts: Record<string, number> = {}
  for (const sub of subs) {
    const from = strip0x(sub.from)
    const to = strip0x(sub.to)
    if (from.length !== 40 || to.length !== 40) throw new Error('substitution needs 20-byte values')
    let count = 0
    let idx = body.indexOf(from)
    while (idx !== -1) {
      count++
      idx = body.indexOf(from, idx + 40)
    }
    if (count > 0) body = body.split(from).join(to)
    counts[sub.what] = count
  }
  return { out: `0x${body}`, counts }
}

// ---------------------------------------------------------------------------
// runtime template + masks
// ---------------------------------------------------------------------------

export interface MaskRange {
  /** Byte offset into the runtime code. */
  start: number
  /** Inclusive end offset. */
  end: number
  kind: 'immutable' | 'substituted'
  /** Bytes held at this range in the mainnet runtime. */
  mainnetValue: Hex
  /** When the mainnet value is a known substituted address, the value the deployment must hold. */
  expected?: Hex
  expectedWhat?: string
}

/**
 * Locate the runtime template inside a creation input.
 *
 * Solidity emits the runtime code verbatim inside the creation code with every immutable slot left
 * as zero bytes; the constructor writes the real values in before the code is returned. Finding
 * that window gives an exact, auditable derivation of which runtime bytes are immutables — no
 * compiler metadata required, and no guessing.
 *
 * The window is accepted only if every differing byte in the template is zero. A non-zero
 * difference would mean the deployed code is not the code the creation input carries, which is a
 * fidelity failure rather than something to mask.
 */
export function findRuntimeTemplate(
  creationInput: Hex,
  runtime: Hex,
): { offset: number; template: Uint8Array } {
  const creation = toBytes(creationInput)
  const run = toBytes(runtime)
  if (run.length === 0) throw new Error('empty runtime')
  if (creation.length < run.length) throw new Error('creation input shorter than runtime')
  for (let offset = creation.length - run.length; offset >= 0; offset--) {
    let ok = true
    for (let i = 0; i < run.length; i++) {
      const c = creation[offset + i]
      if (c !== run[i] && c !== 0) {
        ok = false
        break
      }
    }
    if (ok) return { offset, template: creation.subarray(offset, offset + run.length) }
  }
  throw new Error('could not locate the runtime template inside the creation input')
}

/** PUSH32 opcode. Solidity reserves one PUSH32 with a zero operand per immutable reference. */
const PUSH32 = 0x7f
const IMMUTABLE_SLOT_BYTES = 32

/**
 * Every immutable slot in a runtime template: a PUSH32 whose 32-byte operand is entirely zero.
 *
 * Deriving whole slots rather than the bytes that happen to differ matters — an immutable whose
 * mainnet value contains zero bytes (a hash, a packed pair, a small integer) would otherwise leave
 * holes in the mask and report a spurious difference at exactly those bytes.
 */
function immutableSlots(template: Uint8Array): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  for (let i = 0; i + IMMUTABLE_SLOT_BYTES < template.length; i++) {
    if (template[i] !== PUSH32) continue
    let zero = true
    for (let j = 1; j <= IMMUTABLE_SLOT_BYTES; j++) {
      if (template[i + j] !== 0) {
        zero = false
        break
      }
    }
    if (zero) out.push({ start: i + 1, end: i + IMMUTABLE_SLOT_BYTES })
  }
  return out
}

/**
 * Derive every runtime byte range that is allowed to differ between the mainnet deployment and a
 * re-deployment of the same creation input elsewhere:
 *
 *  - `immutable` — zero in the creation-embedded template, written by the constructor.
 *  - `substituted` — a mainnet address the runner rewrote (linked library, or a cross-reference
 *    baked into the code rather than an immutable).
 *
 * Both are printed by the verifier, and both carry the value the deployment is required to hold
 * whenever the mainnet value is one of the addresses the runner substituted.
 */
export function deriveMasks(
  artifact: MainnetArtifact,
  subs: readonly Substitution[],
): { masks: MaskRange[]; templateOffset: number } {
  const { offset, template } = findRuntimeTemplate(artifact.creationInput, artifact.runtime)
  const run = toBytes(artifact.runtime)

  const byStart = new Map<number, MaskRange>()
  const slots = immutableSlots(template)

  // A byte that differs between the template and the mainnet runtime must sit inside an immutable
  // slot. Anything else would mean the runtime is not the code the creation input carries, which is
  // a fidelity failure and must never be masked away.
  const covered = new Uint8Array(run.length)
  for (const slot of slots) for (let i = slot.start; i <= slot.end; i++) covered[i] = 1
  for (let i = 0; i < run.length; i++) {
    if (template[i] !== run[i] && !covered[i]) {
      throw new Error(
        `${artifact.label}: runtime byte ${i} differs from the creation template outside any immutable slot`,
      )
    }
  }

  const expectationFor = (value: Hex): { expected?: Hex; expectedWhat?: string } => {
    const body = strip0x(value)
    // An address immutable occupies the low 20 bytes of its 32-byte slot.
    const low = body.length === 64 && /^0{24}/.test(body) ? `0x${body.slice(24)}` : value
    const hit = subs.find((s) => strip0x(s.from) === strip0x(low))
    if (!hit) return {}
    const to = strip0x(normalizeAddress(hit.to))
    const expected = (body.length === 64 ? `0x${'0'.repeat(24)}${to}` : `0x${to}`) as Hex
    return { expected, expectedWhat: hit.what }
  }

  for (const slot of slots) {
    const value = toHex(run.subarray(slot.start, slot.end + 1))
    // A PUSH32 with a zero operand is also how a plain zero constant is compiled. Where mainnet
    // holds zero the slot is left unmasked: the re-deployment has to hold zero there too, so a
    // code constant cannot become a blind spot. A genuine immutable that mainnet set to zero would
    // report a difference rather than pass quietly.
    if (/^0x0+$/.test(value)) continue
    byStart.set(slot.start, {
      ...slot,
      kind: 'immutable',
      mainnetValue: value,
      ...expectationFor(value),
    })
  }

  const runHex = strip0x(artifact.runtime)
  for (const sub of subs) {
    const needle = strip0x(sub.from)
    let idx = runHex.indexOf(needle)
    while (idx !== -1) {
      if (idx % 2 === 0) {
        const start = idx / 2
        if (!covered[start]) {
          byStart.set(start, {
            start,
            end: start + 19,
            kind: 'substituted',
            mainnetValue: normalizeAddress(sub.from),
            expected: normalizeAddress(sub.to),
            expectedWhat: sub.what,
          })
        }
      }
      idx = runHex.indexOf(needle, idx + 1)
    }
  }

  const masks = [...byStart.values()].sort((a, b) => a.start - b.start)
  return { masks, templateOffset: offset }
}

// ---------------------------------------------------------------------------
// tiny argv parser
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

export function requireString(
  args: Record<string, string | true>,
  key: string,
  hint: string,
): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`--${key} is required (${hint})`)
  return value
}
