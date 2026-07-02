/**
 * ERC1155 collection surfaces (W-B1), split into the page regions CollectionPage composes.
 * An 1155's "pieces" and its mint action are the same thing — the per-edition cards — so there is
 * no separate Primary action in the shell (the cover is enough); the editions render as the grid
 * gallery below the shell, and the creator admin drops below the featured queue.
 */
import { useQueryClient } from '@tanstack/react-query'
import { EditionList } from '../EditionList'
import { AddEditionForm } from '../AddEditionForm'
import { CreatorAdminPanel } from '../erc1155/CreatorAdminPanel'
import { Disclosure } from '../../ui/Disclosure'
import { useOwnerGate } from '../../ui/useOwnerGate'
import styles from './TypeSection.module.css'

export interface Erc1155SurfaceProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

/** No standalone shell action — minting happens per-edition in the gallery below. */
export function Erc1155Primary(_props: Erc1155SurfaceProps) {
  return null
}

export function Erc1155Gallery({ instance }: Erc1155SurfaceProps) {
  return (
    <section className={styles.section} data-testid="erc1155-collection">
      <h2 className={styles.title}>EDITIONS</h2>
      <EditionList instance={instance} />
    </section>
  )
}

export function Erc1155Admin({ instance }: Erc1155SurfaceProps) {
  // Gate on the live owner() (transferable), NOT card.creator: addEdition + the admin panel are
  // owner-gated on-chain, so this matches the contract.
  const { isOwner } = useOwnerGate(instance)
  const queryClient = useQueryClient()
  if (!isOwner) return null
  return (
    <Disclosure summary="CREATOR ADMIN" testId="erc1155-creator-admin">
      {/* The editions gallery now lives in a separate page region, so refresh its reads by
          invalidating the query cache on add rather than remounting a shared subtree. */}
      <AddEditionForm instance={instance} onAdded={() => void queryClient.invalidateQueries()} />
      <CreatorAdminPanel instance={instance} />
    </Disclosure>
  )
}
