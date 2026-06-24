/**
 * ERC1155 collection surface (W-B1) — the editions list + creator's add-edition form, extracted
 * verbatim from CollectionPage so the page can branch by type. W-B2 fills in the remaining ERC1155
 * actions here (free-mint claim, withdraw, claimVaultFees, updateEditionMetadata, gated/message mint).
 */
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { EditionList } from '../EditionList'
import { AddEditionForm } from '../AddEditionForm'
import styles from './TypeSection.module.css'

export interface Erc1155CollectionProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc1155Collection({ instance, creator }: Erc1155CollectionProps) {
  const { address: connected } = useAccount()
  const [editionsKey, setEditionsKey] = useState(0) // bump to re-read editions after an add
  const isCreator = !!connected && connected.toLowerCase() === creator.toLowerCase()

  return (
    <section className={styles.section} data-testid="erc1155-collection">
      <h2 className={styles.title}>EDITIONS</h2>
      <EditionList key={editionsKey} instance={instance} />
      {isCreator && (
        <AddEditionForm instance={instance} onAdded={() => setEditionsKey((k) => k + 1)} />
      )}
    </section>
  )
}
