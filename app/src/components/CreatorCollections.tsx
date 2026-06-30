import { CollectionCard } from './CollectionCard'
import { useCreatorCollections } from './useCreatorCollections'
import { StateBlock } from './ui/StateBlock'
import styles from './CreatorCollections.module.css'

interface CreatorCollectionsProps {
  creator: `0x${string}`
}

/** The "Made" tab body of the profile plate — the collections this address deployed, as a gallery
 * hang of NOESIS work cards. (The section heading lives in the tab; this just renders the grid.) */
export function CreatorCollections({ creator }: CreatorCollectionsProps) {
  const { data, isPending, isError } = useCreatorCollections(creator)

  if (isPending) return <StateBlock variant="loading">hanging the work…</StateBlock>
  if (isError)
    return <StateBlock variant="error">couldn&apos;t load collections — is the fork up?</StateBlock>

  if (!data || data.length === 0) {
    return (
      <StateBlock variant="empty" boxed testId="creator-collections-empty">
        nothing made yet — this wall is empty.
      </StateBlock>
    )
  }

  return (
    <div className={styles.grid} data-testid="creator-collections">
      {data.map((c) => (
        <CollectionCard key={c.instance} card={c} />
      ))}
    </div>
  )
}
