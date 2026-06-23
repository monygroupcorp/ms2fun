/**
 * Per-module config forms (ADR-0005) — keyed by the `configType` a module's on-chain metadata
 * names. Also exports a lenient parser for that metadata so the wizard can display module options
 * without throwing on untrusted on-chain JSON.
 *
 * CONFIG_SCHEMAS describes the client-side input fields for each module's constructor args. The
 * wizard's renderer drives the form from these descriptors; NOEMA can introspect them for guided
 * creation. Adding a new module on-chain only requires adding its entry here — no other changes.
 */

import type { ConfigSchema } from './schema'

// ── ComponentModuleMeta ──────────────────────────────────────────────────────

/** The parsed shape of a component module's on-chain `metadataURI` JSON. */
export interface ComponentModuleMeta {
  name: string
  subtitle: string
  description: string
  badge: string
  configType: string
}

/** Lenient coercion helper — mirrors the `str()` pattern from `../metadata/schemas.ts`. */
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/** Coerce arbitrary JSON into a safe ComponentModuleMeta. Never throws. Missing fields → ''. */
export function parseComponentMeta(json: unknown): ComponentModuleMeta {
  const o = (json ?? {}) as Record<string, unknown>
  return {
    name: str(o['name']),
    subtitle: str(o['subtitle']),
    description: str(o['description']),
    badge: str(o['badge']),
    configType: str(o['configType']),
  }
}

// ── CONFIG_SCHEMAS ────────────────────────────────────────────────────────────

/**
 * Typed config forms for each known `configType`. The wizard's submit-builder maps the resulting
 * values onto the module's `createInstance` constructor args. Extend here when new modules ship.
 */
export const CONFIG_SCHEMAS: ConfigSchema[] = [
  {
    configType: 'password-tier-gating',
    title: 'Password tiers',
    // On-chain shape: TierConfig{ tierType, passwordHashes[], volumeCaps[], tierUnlockTimes[] }
    // passwordHashes are computed client-side (keccak256) at submit — the form takes plaintext.
    fields: [
      {
        key: 'tierType',
        label: 'Tier type',
        kind: 'select',
        default: '0',
        options: [
          { value: '0', label: 'Volume cap' },
          { value: '1', label: 'Time-based' },
        ],
        validation: { required: true },
      },
      {
        key: 'passwords',
        label: 'Passwords',
        kind: 'list',
        help: 'Hashed (keccak256) at submit; one per tier',
        item: {
          key: 'password',
          label: 'Password',
          kind: 'text',
        },
      },
      {
        key: 'volumeCaps',
        label: 'Volume caps',
        kind: 'list',
        item: {
          key: 'volumeCap',
          label: 'Volume cap',
          kind: 'number',
          unit: 'count',
        },
        visibleWhen: { field: 'tierType', equals: '0' },
      },
      {
        key: 'tierUnlockTimes',
        label: 'Tier unlock times',
        kind: 'list',
        help: 'Relative to bonding open',
        item: {
          key: 'tierUnlockTime',
          label: 'Tier unlock time',
          kind: 'number',
          unit: 'seconds',
        },
        visibleWhen: { field: 'tierType', equals: '1' },
      },
    ],
  },
  {
    configType: 'merkle-allowlist-gating',
    title: 'Allowlist',
    fields: [
      {
        key: 'addresses',
        label: 'Allowlisted addresses',
        kind: 'list',
        help: 'Merkle root computed client-side at submit',
        item: {
          key: 'address',
          label: 'Address',
          kind: 'address',
        },
        validation: { min: 1 },
      },
    ],
  },
  {
    configType: 'launch-profile',
    title: 'Liquidity profile',
    // The DEX deployer's pool params are fixed at module construction; selecting the module IS the
    // choice. No per-instance inputs — the wizard shows the title/description from module metadata.
    fields: [],
  },
]

// ── Lookup ───────────────────────────────────────────────────────────────────

/** Return the ConfigSchema for a given `configType`, or undefined if not (yet) registered. */
export function getConfigSchema(configType: string): ConfigSchema | undefined {
  return CONFIG_SCHEMAS.find((s) => s.configType === configType)
}
