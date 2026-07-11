import { useMemo } from 'react'
import type { CollectionMetadata } from '../../lib/metadata'
import { CollectionHero, type CollectionHeroCard } from '../collection/CollectionHero'
import { IframeCanvas } from './IframeCanvas'

const MOCK_ADDR = '0x1111111111111111111111111111111111111111' as const
const MOCK_VAULT = '0x2222222222222222222222222222222222222222' as const

export interface CollectionHeroPreviewProps {
  name?: string | undefined
  description?: string | undefined
  image?: string | undefined
  /** Contract-type label shown in the hero facts; defaults to ERC1155. */
  contractType?: string | undefined
  /** Vault name shown in the alignment bind; empty hides the alignment block. */
  vaultName?: string | undefined
  /** Optional theme CSS overlaid last (the creator's styleUri). */
  creatorCss?: string | undefined
  className?: string | undefined
  /** Render at this virtual width and scale to fit — a desktop-layout window. Default 1024. */
  virtualWidth?: number | undefined
}

/**
 * Renders the REAL collection hero with mock data inside an isolated, app-styled iframe — the shared
 * canvas behind both the style-preview and the review-step preview. Portals keep React context so the
 * actual component (and its CSS-module classes) render pixel-accurately.
 */
export function CollectionHeroPreview({
  name,
  description,
  image,
  contractType = 'ERC1155',
  vaultName = 'Milady',
  creatorCss = '',
  className,
  virtualWidth = 1024,
}: CollectionHeroPreviewProps) {
  const card: CollectionHeroCard = useMemo(
    () => ({
      name: name?.trim() || 'Your Collection',
      creator: MOCK_ADDR,
      isActive: true,
      currentPrice: 1_000_000_000n,
      totalSupply: 3n,
      maxSupply: 100n,
      vault: vaultName ? MOCK_VAULT : ('0x0000000000000000000000000000000000000000' as const),
      vaultName,
      contractType,
      factoryTitle: contractType,
    }),
    [name, vaultName, contractType],
  )

  const meta: CollectionMetadata = useMemo(
    () => ({
      schemaVersion: 1,
      name: name?.trim() || 'Your Collection',
      description: description?.trim() || 'Your collection description appears here.',
      image: image?.trim() || '',
      banner: '',
      category: '',
      links: [],
    }),
    [name, description, image],
  )

  return (
    <IframeCanvas creatorCss={creatorCss} className={className} virtualWidth={virtualWidth}>
      <div style={{ padding: '20px' }}>
        <CollectionHero instance={MOCK_ADDR} card={card} metadata={meta} />
      </div>
    </IframeCanvas>
  )
}
