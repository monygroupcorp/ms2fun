import { CollectionCard } from './CollectionCard'
import { useCreatorCollections } from './useCreatorCollections'
import styles from './CreatorCollections.module.css'

interface CreatorCollectionsProps {
  creator: `0x${string}`
}

export function CreatorCollections({ creator }: CreatorCollectionsProps) {
  const { data, isPending, isError } = useCreatorCollections(creator)

  if (isPending) return <p className={styles.note}>loading collections…</p>
  if (isError) return <p className={styles.note}>couldn't load collections — is the fork up?</p>

  return (
    <section className={styles.section}>
      <h2 className={`${styles.heading} text-chromatic-medium`}>COLLECTIONS</h2>
      {data && data.length > 0 ? (
        <div className={styles.grid} data-testid="creator-collections">
          {data.map((c) => (
            <CollectionCard key={c.instance} card={c} />
          ))}
        </div>
      ) : (
        <p className={styles.note} data-testid="creator-collections-empty">
          no collections yet
        </p>
      )}
    </section>
  )
}
