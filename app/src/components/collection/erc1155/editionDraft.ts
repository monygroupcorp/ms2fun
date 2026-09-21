/**
 * One edition, as the creator is part-way through describing it, plus the rules `addEdition` will
 * hold it to. Pure functions over a plain bag of strings, so every surface that creates an edition
 * refuses the same transaction for the same reason and none of them has to spend gas to find out.
 *
 * There are two such surfaces: `AddEditionForm` on the collection page, and the wizard's post-create
 * Editions step, which renders the `postCreate` schema in `lib/wizard/projectTypes.ts`. They look
 * nothing alike — one is a hand-written form, the other is generated from a field schema — and that
 * is exactly why the rules live here rather than in either of them.
 */

import { parseEther } from 'viem'

/** Pricing models as `ERC1155Instance.PricingModel` orders them. */
export type PricingModel = 0 | 1 | 2

export interface EditionDraft {
  pieceTitle: string
  basePrice: string
  supply: string
  metadataURI: string
  pricingModel: PricingModel
  priceIncreaseRate: string
  openTime: string
  freeMintAllocation: string
  closeTime: string
  maxPerWallet: string
}

export function emptyEditionDraft(): EditionDraft {
  return {
    pieceTitle: '',
    basePrice: '',
    supply: '',
    metadataURI: '',
    pricingModel: 0,
    priceIncreaseRate: '',
    openTime: '0',
    freeMintAllocation: '',
    closeTime: '0',
    maxPerWallet: '0',
  }
}

/**
 * The first reason this draft would be refused, or null if it would not be. Ordered the way a
 * creator fills the form so the message names the field they are looking at.
 */
export function validateEditionDraft(form: EditionDraft): string | null {
  if (form.pieceTitle.trim() === '') return 'Piece title is required'
  const price = parseFloat(form.basePrice)
  if (!form.basePrice || isNaN(price) || price <= 0) return 'Base price must be greater than 0'
  if (form.pricingModel === 0) {
    const sup = form.supply.trim()
    if (sup !== '' && sup !== '0')
      return 'Unlimited pricing requires supply = 0 (leave blank or enter 0)'
  }
  if (form.pricingModel === 1 || form.pricingModel === 2) {
    const sup = parseInt(form.supply, 10)
    if (!form.supply || isNaN(sup) || sup <= 0) return 'Limited editions require supply > 0'
  }
  if (form.pricingModel === 2) {
    const rate = parseInt(form.priceIncreaseRate, 10)
    if (!form.priceIncreaseRate || isNaN(rate) || rate <= 0)
      return 'Dynamic pricing requires price increase rate > 0 basis points'
  }
  // Mirrors `_validateSchedule` in ERC1155Instance: a close time has to fall after the edition
  // opens, so the form refuses the window the contract would revert on rather than spending a
  // transaction to find out. `0` is "never closes" on both sides.
  const closeRaw = form.closeTime.trim()
  if (closeRaw !== '' && closeRaw !== '0') {
    const close = Number(closeRaw)
    if (!Number.isInteger(close) || close < 0) return 'Close time must be a whole number of seconds'
    const open = Number(form.openTime.trim() || '0')
    const opensAt = open === 0 ? Math.floor(Date.now() / 1000) : open
    if (close <= opensAt)
      return open === 0
        ? 'Close time must be in the future'
        : 'Close time must be after the open time'
  }
  const capRaw = form.maxPerWallet.trim()
  if (capRaw !== '') {
    const cap = Number(capRaw)
    if (!Number.isInteger(cap) || cap < 0) return 'Per-wallet limit must be a whole number ≥ 0'
  }
  const allocRaw = form.freeMintAllocation.trim()
  if (allocRaw !== '') {
    const alloc = parseInt(allocRaw, 10)
    if (isNaN(alloc) || alloc < 0 || String(alloc) !== allocRaw)
      return 'Free-mint allocation must be a whole number ≥ 0'
    // Reserve-from-supply cap (noesis-135): for a limited edition the free allocation is drawn from
    // supply, so it cannot exceed it. Unlimited editions (supply 0) accept any allocation.
    if (form.pricingModel !== 0) {
      const sup = parseInt(form.supply, 10)
      if (!isNaN(sup) && sup > 0 && alloc > sup)
        return 'Free-mint allocation cannot exceed the edition supply'
    }
  }
  return null
}

/**
 * `addEdition`'s ten arguments, in its order. Supply is forced to 0 for an unlimited edition and the
 * increase rate to 0 for anything but dynamic pricing, because those are the pairings the contract
 * accepts and a stale value left in a hidden field must not reach the call.
 */
export function editionDraftToAddEditionArgs(
  form: EditionDraft,
): [string, bigint, bigint, string, PricingModel, bigint, bigint, bigint, bigint, bigint] {
  return [
    form.pieceTitle.trim(),
    parseEther(form.basePrice),
    form.pricingModel === 0 ? BigInt(0) : BigInt(form.supply),
    form.metadataURI.trim(),
    form.pricingModel,
    form.pricingModel === 2 ? BigInt(form.priceIncreaseRate) : BigInt(0),
    BigInt(form.openTime.trim() || '0'),
    BigInt(form.freeMintAllocation.trim() || '0'),
    BigInt(form.closeTime.trim() || '0'),
    BigInt(form.maxPerWallet.trim() || '0'),
  ]
}

/**
 * A draft out of the string bag `SchemaForm` keeps, for the schema-driven wizard step. Every key the
 * schema does not declare falls back to the empty draft's value — `freeMintAllocation` is the one
 * that matters today: the wizard's Editions step does not collect it, and an edition created there
 * reserves nothing, which is what a blank allocation means on the collection page too.
 */
export function editionDraftFromValues(values: Record<string, string>): EditionDraft {
  const base = emptyEditionDraft()
  const pick = (key: keyof EditionDraft): string => {
    const v = values[key]
    return v === undefined ? (base[key] as string) : v
  }
  const model = Number(values.pricingModel ?? base.pricingModel)
  return {
    pieceTitle: pick('pieceTitle'),
    basePrice: pick('basePrice'),
    supply: pick('supply'),
    metadataURI: pick('metadataURI'),
    pricingModel: (model === 1 || model === 2 ? model : 0) as PricingModel,
    priceIncreaseRate: pick('priceIncreaseRate'),
    openTime: pick('openTime'),
    freeMintAllocation: pick('freeMintAllocation'),
    closeTime: pick('closeTime'),
    maxPerWallet: pick('maxPerWallet'),
  }
}
