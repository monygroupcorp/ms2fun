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
    configType: 'merkle-allowlist-gating',
    title: 'Allowlist',
    fields: [
      {
        key: 'addresses',
        label: 'Allowlisted addresses',
        kind: 'list',
        help: 'Merkle root computed client-side at submit',
        learnMore: 'merkle-allowlist',
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
  {
    configType: 'metadata-overlay',
    title: 'Artist overlay',
    // On-chain shape: initConfig(instance, autoLatest, defaultPayout). The overlay's CONTENT (event
    // waves, paid commissions) is authored POST-create by the creator-admin panel, never here — only
    // the two immutable-at-create policy flags are set in the create tx.
    fields: [
      {
        key: 'overlayAutoLatest',
        label: 'Auto-apply latest wave',
        kind: 'bool',
        default: false,
        help: 'When on, the newest eligible event wave shows automatically until a holder pins a version',
      },
      {
        key: 'overlayDefaultPayout',
        label: 'Default commission payout',
        kind: 'select',
        default: '0',
        options: [
          {
            value: '0',
            label: 'Artist',
            description: 'Commission revenue goes entirely to the artist',
          },
          {
            value: '1',
            label: 'Split',
            description: 'Apply the protocol/vault/artist revenue split',
          },
        ],
      },
    ],
  },
  {
    configType: 'metadata-tier',
    // Token Tiers. A tier NFT is a coin DENOMINATION and its art is STATIC: an id in band N shows
    // band N's art, unconditionally — no holdings threshold, no locked/teaser art.
    // On-chain shape: MetadataConfig.tiers, a TierSpec{ weight, count, baseURI } list. The creator
    // supplies the LADDER only; the factory derives every id range from it and seals the instance's
    // economic ladder and the resolver's art table from the same ranges, packed above the NFT supply
    // (the auto-mint never emits an id past the id ceiling, which is what keeps band ids reserved and
    // unbuyable). The renderer has no list-of-group, so the ladder is captured as PARALLEL lists
    // zipped by row index at submit (mirrors password-tier-gating). The derived ranges are shown
    // read-only by TierSupplyHelper — they are never typed and never submitted.
    // Frozen at create — no post-create authoring (mutable rarity = rug).
    title: 'Tier ladder',
    fields: [
      {
        key: 'tierWeights',
        label: 'Denomination (coin units per NFT)',
        kind: 'list',
        help: 'One row per tier; at least 2, and climbing — each tier is worth more than the one below',
        item: { key: 'tierWeight', label: 'Weight', kind: 'number' },
        validation: { min: 1 },
      },
      {
        key: 'tierCounts',
        label: 'How many (blank = as many as the supply allows)',
        kind: 'list',
        help: 'Cap this tier below supply ÷ weight to make it scarce; it then sells out and reopens when a holder mints down',
        item: { key: 'tierCount', label: 'Count', kind: 'number' },
      },
      {
        key: 'tierBaseURIs',
        label: 'Band base URI',
        kind: 'list',
        help: 'Token id is appended to this prefix for every id in the band; blank falls through to the collection base',
        item: { key: 'tierBaseURI', label: 'Band URI', kind: 'text' },
      },
    ],
  },
]

// ── Lookup ───────────────────────────────────────────────────────────────────

/** Return the ConfigSchema for a given `configType`, or undefined if not (yet) registered. */
export function getConfigSchema(configType: string): ConfigSchema | undefined {
  return CONFIG_SCHEMAS.find((s) => s.configType === configType)
}
