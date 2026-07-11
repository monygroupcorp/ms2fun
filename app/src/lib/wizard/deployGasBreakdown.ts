/**
 * Itemised gas breakdown for the Review step. The on-chain metadataURI is one JSON blob assembled by
 * `collectionToDataUri`; a creator pays for every byte of it at deploy. This splits that blob into the
 * fields a creator actually controls — cover image, banner image, and the text (name/description/links)
 * — by measuring the MARGINAL bytes each adds, using the same encoder that ships on-chain so the
 * numbers match reality (not an approximation of it).
 *
 * The gas model (SSTORE + calldata) is `embedGas`; see that file for the cost derivation.
 */

import { collectionToDataUri } from '../metadata/encode'
import type { CollectionMetadata } from '../metadata/schemas'
import { byteLen, estimateEmbedGas } from './embedGas'

export interface EmbedLine {
  key: 'cover' | 'banner' | 'text'
  label: string
  /** Marginal bytes this field adds to the serialized metadataURI. */
  bytes: number
  gas: number
  /** True when the field is embedded on-chain (a `data:` URI) rather than a hosted pointer. */
  embedded: boolean
}

export interface EmbedBreakdown {
  lines: EmbedLine[]
  /** Total bytes of the whole metadataURI blob. */
  totalBytes: number
  /** Total embedding gas for the metadataURI (cover + banner + text). */
  totalGas: number
}

const isDataUri = (v: string): boolean => v.trim().startsWith('data:')

/**
 * Marginal bytes a single field contributes: full blob minus the blob with that field blanked. Uses
 * the real encoder, so URL-encoding inflation and JSON punctuation are counted exactly as deployed.
 */
function marginal(meta: CollectionMetadata, blank: Partial<CollectionMetadata>): number {
  const full = byteLen(collectionToDataUri(meta))
  const without = byteLen(collectionToDataUri({ ...meta, ...blank }))
  return Math.max(0, full - without)
}

export function embedBreakdown(meta: CollectionMetadata): EmbedBreakdown {
  const totalBytes = byteLen(collectionToDataUri(meta))
  const coverBytes = meta.image ? marginal(meta, { image: '' }) : 0
  const bannerBytes = meta.banner ? marginal(meta, { banner: '' }) : 0
  // Whatever is left is the text envelope (name, description, links, category, JSON scaffolding).
  const textBytes = Math.max(0, totalBytes - coverBytes - bannerBytes)

  const lines: EmbedLine[] = [
    {
      key: 'cover',
      label: 'Cover image',
      bytes: coverBytes,
      gas: estimateEmbedGas(coverBytes),
      embedded: isDataUri(meta.image),
    },
    {
      key: 'banner',
      label: 'Banner image',
      bytes: bannerBytes,
      gas: estimateEmbedGas(bannerBytes),
      embedded: isDataUri(meta.banner),
    },
    {
      key: 'text',
      label: 'Name, description & links',
      bytes: textBytes,
      gas: estimateEmbedGas(textBytes),
      embedded: true,
    },
  ]

  return { lines, totalBytes, totalGas: lines.reduce((s, l) => s + l.gas, 0) }
}
