/**
 * ArtPointerNotice (noesis-384) — tell the creator, on their own admin view, that their collection's
 * art pointer is not reaching anyone.
 *
 * A refused or unresolvable pointer is invisible from the outside: every viewer sees the fallback
 * tile and nobody tells the creator. This is the creator-side half only. rth ruled 2026-08-21 that
 * the public browse grid gets nothing — a viewer cannot act on a broken pointer, and a warning they
 * cannot act on is noise.
 */
import { ActionRow } from '../ui/AdminSection'
import { useCollection } from '../useCollection'
import { useCollectionMetadata } from '../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from './useCollectionChain'
import { useArtPointerVerdict } from './useArtPointerVerdict'
import styles from './ArtPointerNotice.module.css'

export function ArtPointerNotice({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { data: card } = useCollection(instance, { chainId, addresses })
  const metadata = useCollectionMetadata(card?.metadataURI)
  const verdict = useArtPointerVerdict(metadata)

  if (verdict !== 'refused' && verdict !== 'unreachable') return null

  return (
    <ActionRow
      label="collection art"
      hint={
        verdict === 'refused'
          ? 'this pointer is not a scheme the app will render'
          : 'no gateway served this pointer'
      }
    >
      <p className={styles.notice} data-testid="art-pointer-notice">
        {verdict === 'refused'
          ? 'every viewer sees the fallback tile. write a new collection image — ipfs://, ar://, https:// or data: — to fix it.'
          : 'every viewer sees the fallback tile. re-pin the content, or write a new collection image to fix it.'}
      </p>
    </ActionRow>
  )
}
