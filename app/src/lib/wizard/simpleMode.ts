/**
 * Simple mode — the wizard's default view of a launch.
 *
 * A first-time creator meets the fields that every launch needs, and nothing else. Settings a
 * newcomer has no reason to touch (the creator-carve disclosure, the metadata resolver, Token Tiers,
 * the artist overlay and its commission policy) are marked `advanced` on the schema and only render
 * once the creator turns Advanced settings on.
 *
 * Hidden is not reset. A value the creator set under Advanced keeps submitting after Advanced is
 * turned off again, and `advancedInEffect` names each one so the wizard can say so instead of
 * deploying settings the creator can no longer see.
 *
 * Pure TS (no React/wagmi) so the rules are unit-testable on their own.
 */

import type { FieldSchema, ModuleSlot, ProjectTypeSchema } from './schema'
import { collectDefaults } from './schema'
import { ZERO_ADDRESS } from './submit'

/** The fields to render: all of them under Advanced, otherwise only the non-advanced ones. */
export function visibleFields(fields: FieldSchema[], advanced: boolean): FieldSchema[] {
  return advanced ? fields : fields.filter((f) => !f.advanced)
}

/** The module slots to render, by the same rule as `visibleFields`. */
export function visibleSlots(slots: ModuleSlot[], advanced: boolean): ModuleSlot[] {
  return advanced ? slots : slots.filter((s) => !s.advanced)
}

/** Whether a project type has anything for the Advanced toggle to reveal. */
export function hasAdvancedSettings(pt: ProjectTypeSchema): boolean {
  return pt.coreFields.some((f) => f.advanced) || pt.moduleSlots.some((s) => s.advanced)
}

/** Keys of the advanced slots of a project type (for routing their errors and selections). */
export function advancedSlotKeys(pt: ProjectTypeSchema): string[] {
  return pt.moduleSlots.filter((s) => s.advanced).map((s) => s.key)
}

/**
 * Labels of the advanced settings that currently differ from what an untouched simple-mode launch
 * would submit: an advanced core field whose value is not its default, and an advanced slot with a
 * module selected. Empty means a simple-mode launch is exactly what will deploy.
 */
export function advancedInEffect(
  pt: ProjectTypeSchema,
  values: Record<string, string>,
  modules: Record<string, string | undefined>,
): string[] {
  const out: string[] = []
  const advancedFields = pt.coreFields.filter((f) => f.advanced)
  const defaults = collectDefaults(advancedFields)
  for (const f of advancedFields) {
    const current = (values[f.key] ?? '').trim()
    const fallback = (defaults[f.key] ?? '').trim()
    // Blank submits the default too (the builder applies it), so blank is not a change.
    if (current !== '' && current !== fallback) out.push(f.label)
  }
  for (const s of pt.moduleSlots) {
    if (!s.advanced) continue
    const sel = modules[s.key]
    if (sel && sel.toLowerCase() !== ZERO_ADDRESS) out.push(s.label)
  }
  return out
}

/**
 * The liquidity deployer to pre-select: the chain's Uniswap V4 deployer, but only when the
 * ComponentRegistry currently approves it for the `liquidity` tag. A zero `preferred` (no V4
 * deployer in this chain's deployment file) or one missing from the approved list returns
 * undefined, and the slot is left for the creator to choose rather than guessed at — the factory
 * reverts on an unapproved module.
 */
export function defaultLiquidityDeployer(
  approved: readonly { address: `0x${string}` }[] | undefined,
  preferred: `0x${string}`,
): `0x${string}` | undefined {
  if (!approved || preferred.toLowerCase() === ZERO_ADDRESS) return undefined
  const match = approved.find((o) => o.address.toLowerCase() === preferred.toLowerCase())
  return match?.address
}
