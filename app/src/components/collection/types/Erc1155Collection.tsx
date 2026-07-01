/**
 * ERC1155 collection surface (W-B1) — the editions list + creator's add-edition form, extracted
 * verbatim from CollectionPage so the page can branch by type. W-B2 fills in the remaining ERC1155
 * actions here (free-mint claim, withdraw, claimVaultFees, updateEditionMetadata, gated/message mint).
 */
import { useState } from 'react'
import { EditionList } from '../EditionList'
import { AddEditionForm } from '../AddEditionForm'
import { CreatorAdminPanel } from '../erc1155/CreatorAdminPanel'
import { Disclosure } from '../../ui/Disclosure'
import { useOwnerGate } from '../../ui/useOwnerGate'
import styles from './TypeSection.module.css'

export interface Erc1155CollectionProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc1155Collection({ instance }: Erc1155CollectionProps) {
  // Gate the owner-only surfaces on the live owner() (which is transferable), NOT card.creator —
  // ownership can move (e.g. to an admin/agent) while creator stays the original deployer. addEdition
  // + the admin panel are owner-gated on-chain, so this matches the contract.
  const { isOwner } = useOwnerGate(instance)
  const [editionsKey, setEditionsKey] = useState(0) // bump to re-read editions after an add

  return (
    <section className={styles.section} data-testid="erc1155-collection">
      <h2 className={styles.title}>EDITIONS</h2>
      <EditionList key={editionsKey} instance={instance} />
      {isOwner && (
        <Disclosure summary="CREATOR ADMIN" testId="erc1155-creator-admin">
          <AddEditionForm instance={instance} onAdded={() => setEditionsKey((k) => k + 1)} />
          <CreatorAdminPanel instance={instance} />
        </Disclosure>
      )}
    </section>
  )
}
