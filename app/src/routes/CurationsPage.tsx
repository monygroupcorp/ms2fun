import { useState } from 'react'
import { Link } from 'wouter'
import { useAccount } from 'wagmi'
import { CurationCard } from '../components/curation/CurationCard'
import { CurationEditor } from '../components/curation/CurationEditor'
import {
  curationsAvailable,
  useCurationCount,
  useLatestCurations,
} from '../components/curation/useCurations'
import { StateBlock } from '../components/ui/StateBlock'
import { useTxAction } from '../components/ui/useTxAction'
import { curationRegistryAbi } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { curationToDataUri, type CurationMetadata } from '../lib/metadata'
import styles from './CurationsPage.module.css'

/**
 * How many curations the wall hangs. The contract pages (`latestCurations(offset, limit)`), so this
 * is a page size and not a ceiling — it is where a "show more" control would take its offset from
 * when the wall is long enough to need one.
 */
const PAGE_SIZE = 24

/**
 * The Curations wall — noesis's second discovery surface, and the first one nobody paid for.
 *
 * Everything the Featured grid shows is there because a slot was bought (`featuredRank` is a wei
 * score). Everything here is there because somebody assembled it, and it is ordered newest-first by
 * the chain's own `updatedAt` — see `lib/curation/curationOrder` for why that is the only ordering
 * this surface will take. The page states that difference in a line, because a visitor who has read
 * "paid placement, labelled" on the home page is owed the contrast in words rather than in tone.
 */
export function CurationsPage() {
  const { address: connected } = useAccount()
  const [creating, setCreating] = useState(false)

  const { data: curations, isPending, isError } = useLatestCurations(PAGE_SIZE)
  const published = useCurationCount()

  // Every read on this page is a read of the curation registry, so the shared invalidation seam —
  // "invalidate every cached query touching this address" — is exactly the refetch this needs.
  const tx = useTxAction({
    instance: forkAddresses.CurationRegistry,
    onSuccess: () => setCreating(false),
  })

  const publish = (metadata: CurationMetadata) => {
    tx.send({
      address: forkAddresses.CurationRegistry,
      abi: curationRegistryAbi,
      functionName: 'createCuration',
      args: [curationToDataUri(metadata)],
      chainId: forkChainId,
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className="noesis-kicker">
            Explore · Curations
            {published !== undefined && ` · ${published} published`}
          </p>
          <h1 className={styles.title}>Curations</h1>
          <p className={styles.lede}>
            Sets assembled by whoever cared enough to assemble them. Anyone with a wallet can
            publish one, nobody pays to be here, and the order is simply what was worked on most
            recently.
          </p>
        </div>
        {!creating && curationsAvailable && (
          <div className={styles.headActions}>
            {connected ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Create a curation
              </button>
            ) : (
              <span className={styles.connectHint}>Connect a wallet to create one.</span>
            )}
          </div>
        )}
      </header>

      {!curationsAvailable && (
        <StateBlock variant="empty" boxed testId="curations-unavailable">
          <span className="big">Not on this network</span>
          <span className="cap">
            This build&rsquo;s deployment carries no curation registry, so there is nothing to read
            or publish here yet.
          </span>
        </StateBlock>
      )}

      {creating && curationsAvailable && (
        <section className={styles.composer}>
          <h2 className={styles.composerTitle}>New curation</h2>
          <CurationEditor
            onSave={publish}
            onCancel={() => setCreating(false)}
            saving={tx.isBusy}
            saveLabel="Publish curation"
          />
          {tx.state === 'error' && (
            <StateBlock variant="error">{tx.reason ?? 'the curation was not published'}</StateBlock>
          )}
        </section>
      )}

      {curationsAvailable && (
        <>
          {isPending && <StateBlock variant="loading">reading the wall…</StateBlock>}
          {isError && (
            <StateBlock variant="error">
              discovery unreachable — no response from the network.
            </StateBlock>
          )}

          {!isPending && !isError && curations !== undefined && curations.length === 0 && (
            <StateBlock variant="empty" boxed testId="curations-empty">
              <span className="big">No curations yet</span>
              <span className="cap">
                Nobody has hung a set. The first one costs a signature and nothing else.
              </span>
              <span className="act">
                <Link href="/collections">Browse the collections →</Link>
              </span>
            </StateBlock>
          )}

          {curations !== undefined && curations.length > 0 && (
            <div className={styles.grid} data-testid="curations-grid">
              {curations.map((row, i) => (
                <CurationCard
                  key={row.id.toString()}
                  id={row.id}
                  curation={row.curation}
                  variant={i === 0 ? 'lead' : 'card'}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
