/**
 * Resolve a collection's per-type surfaces into the three page regions CollectionPage lays out:
 *   Primary — the action, inside the shell's "works" column (buy/sell for 404, bid for 721; the
 *             1155 has none since minting is per-edition in the gallery).
 *   Gallery — the pieces, as a uniform grid below the shell (global treatment, N10).
 *   Admin   — creator admin, below the featured queue and outside the shell (N5); self-hides
 *             unless the connected wallet is the owner.
 * A component is `null` when a type has no surface for that region.
 */
import type { ComponentType } from 'react'
import {
  Erc1155Admin,
  Erc1155Gallery,
  Erc1155Primary,
  type Erc1155SurfaceProps,
} from './Erc1155Collection'
import { Erc721Admin, Erc721Gallery, Erc721Primary } from './Erc721Collection'
import {
  Erc404Admin,
  Erc404ChartsSection,
  Erc404Gallery,
  Erc404PortfolioSection,
  Erc404Primary,
} from './Erc404Collection'

export interface CollectionSurfaceProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export interface CollectionSurfaces {
  Primary: ComponentType<CollectionSurfaceProps> | null
  /** Full-width region between the shell and the gallery (ERC404 curve + candles). */
  Charts: ComponentType<CollectionSurfaceProps> | null
  /** Holder's own pieces + reroll (ERC404); self-hides when disconnected / empty. */
  Portfolio: ComponentType<CollectionSurfaceProps> | null
  Gallery: ComponentType<CollectionSurfaceProps> | null
  Admin: ComponentType<CollectionSurfaceProps> | null
}

// The three surface prop types are structurally identical (instance + creator), so a single
// CollectionSurfaceProps stands in for all of them.
type Surface = ComponentType<Erc1155SurfaceProps>

export function resolveCollectionSurfaces(contractType: string): CollectionSurfaces {
  switch (contractType) {
    case 'ERC1155':
      return { Primary: Erc1155Primary as Surface, Charts: null, Portfolio: null, Gallery: Erc1155Gallery, Admin: Erc1155Admin }
    case 'ERC721':
      return { Primary: Erc721Primary, Charts: null, Portfolio: null, Gallery: Erc721Gallery, Admin: Erc721Admin }
    case 'ERC404':
      return {
        Primary: Erc404Primary,
        Charts: Erc404ChartsSection,
        Portfolio: Erc404PortfolioSection,
        Gallery: Erc404Gallery,
        Admin: Erc404Admin,
      }
    default:
      return { Primary: null, Charts: null, Portfolio: null, Gallery: null, Admin: null }
  }
}
