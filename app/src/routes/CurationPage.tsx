import { useState } from 'react'
import { Link, useParams } from 'wouter'
import { useAccount } from 'wagmi'
import { CurationEditor } from '../components/curation/CurationEditor'
import { CurationPicks } from '../components/curation/CurationPicks'
import { CurationCollaborators } from '../components/curation/CurationCollaborators'
import {
  curationsAvailable,
  useCuration,
  useCurationCanEdit,
  useCurationMetadata,
} from '../components/curation/useCurations'
import { StateBlock } from '../components/ui/StateBlock'
import { useTxAction } from '../components/ui/useTxAction'
import { curationRegistryAbi } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { truncateAddress } from '../lib/format'
import { curationToDataUri, type CurationMetadata } from '../lib/metadata'
import styles from './CurationPage.module.css'

/** A route param to a curation id: positive decimal only, so `/curation/abc` is a 404, not a read. */
function toCurationId(raw: string | undefined): bigint | undefined {
  if (raw === undefined || !/^[0-9]{1,20}$/.test(raw)) return undefined
  const id = BigInt(raw)
  return id > 0n ? id : undefined
}

/**
 * One curation, hung.
 *
 * Read-path is wallet-independent — a curation is a public wall label and a set of links, and a
 * visitor with no wallet sees all of it. The editing controls appear for the addresses the contract
 * would actually accept: the curator gets all of them, a collaborator gets the editor and not the
 * retire switch, and everyone else gets none.
 */
export function CurationPage() {
  const params = useParams<{ id?: string }>()
  const { address: connected } = useAccount()
  const id = toCurationId(params.id)

  const { data: curation, isPending, isError } = useCuration(id)
  const metadata = useCurationMetadata(curation?.uri)
  // The record read resolves fast; the JSON behind it lands later. Editing before it does would
  // open the form blank and let a save overwrite the set with nothing.
  const metadataPending = curation !== undefined && metadata === undefined

  const [editing, setEditing] = useState(false)

  const tx = useTxAction({
    instance: forkAddresses.CurationRegistry,
    onSuccess: () => setEditing(false),
  })

  const isCurator =
    connected !== undefined &&
    curation !== undefined &&
    connected.toLowerCase() === curation.curator.toLowerCase()

  // A collaborator is anyone the contract would let repoint this curation who is not its curator.
  // Asked of the contract rather than inferred, so the button set can never be wider than the rules.
  const { data: mayEdit } = useCurationCanEdit(id, connected)
  const isCollaborator = mayEdit === true && !isCurator

  function saveEdit(m: CurationMetadata) {
    if (id === undefined) return
    tx.send({
      address: forkAddresses.CurationRegistry,
      abi: curationRegistryAbi,
      functionName: 'setCurationURI',
      args: [id, curationToDataUri(m)],
      chainId: forkChainId,
    })
  }

  function setRetired(retired: boolean) {
    if (id === undefined) return
    tx.send({
      address: forkAddresses.CurationRegistry,
      abi: curationRegistryAbi,
      functionName: 'setRetired',
      args: [id, retired],
      chainId: forkChainId,
    })
  }

  if (!curationsAvailable) {
    return (
      <Frame>
        <StateBlock variant="empty" boxed>
          <span className="big">Not on this network</span>
          <span className="cap">This build&rsquo;s deployment carries no curation registry.</span>
        </StateBlock>
      </Frame>
    )
  }

  if (id === undefined) {
    return (
      <Frame>
        <StateBlock variant="empty" boxed testId="curation-bad-id">
          <span className="big">Not a curation</span>
          <span className="cap">
            A curation is numbered. &ldquo;{params.id}&rdquo; is not a number.
          </span>
          <span className="act">
            <Link href="/curations">See what is hung →</Link>
          </span>
        </StateBlock>
      </Frame>
    )
  }

  if (isPending) {
    return (
      <Frame>
        <StateBlock variant="loading">reading the wall label…</StateBlock>
      </Frame>
    )
  }

  // `getCuration` reverts on an id nobody published, so a read error here IS "no such curation".
  if (isError || curation === undefined) {
    return (
      <Frame>
        <StateBlock variant="empty" boxed testId="curation-not-found">
          <span className="big">No curation #{id.toString()}</span>
          <span className="cap">Nobody has published one at this number.</span>
          <span className="act">
            <Link href="/curations">See what is hung →</Link>
          </span>
        </StateBlock>
      </Frame>
    )
  }

  const title = metadata?.name || `Curation #${id}`

  return (
    <Frame>
      <header className={styles.head}>
        <p className="noesis-kicker">
          Curation · {curation.retired ? 'off view' : 'on view'} · updated{' '}
          {new Date(Number(curation.updatedAt) * 1000).toLocaleDateString()}
        </p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.by}>
          assembled by{' '}
          <Link href={`/profile/${curation.curator}`} className={styles.curator}>
            {truncateAddress(curation.curator)}
          </Link>
        </p>
        {metadata !== undefined && metadata.description !== '' && (
          <p className={styles.note}>{metadata.description}</p>
        )}
      </header>

      {curation.retired && (
        <StateBlock variant="empty" testId="curation-retired">
          The curator has taken this off view. It stays readable at its own link.
        </StateBlock>
      )}

      {(isCurator || isCollaborator) && !editing && (
        <div className={styles.ownerBar}>
          <button
            type="button"
            className="btn"
            onClick={() => setEditing(true)}
            disabled={metadataPending}
          >
            Edit
          </button>
          {isCurator && (
            <button
              type="button"
              className="btn"
              onClick={() => setRetired(!curation.retired)}
              disabled={tx.isBusy}
            >
              {curation.retired ? 'Put back on view' : 'Take off view'}
            </button>
          )}
          {metadataPending && <span className={styles.ownerHint}>reading the set…</span>}
          {isCollaborator && <span className={styles.ownerHint}>you are a collaborator here</span>}
        </div>
      )}

      {tx.state === 'error' && (
        <StateBlock variant="error">{tx.reason ?? 'the change was not saved'}</StateBlock>
      )}

      {editing ? (
        <section className={styles.composer}>
          <CurationEditor
            initial={metadata}
            onSave={saveEdit}
            onCancel={() => setEditing(false)}
            saving={tx.isBusy}
            saveLabel="Save curation"
          />
        </section>
      ) : metadata === undefined ? (
        <StateBlock variant="loading">hanging the picks…</StateBlock>
      ) : (
        <CurationPicks items={metadata.items} />
      )}

      {isCurator && <CurationCollaborators id={id} curator={curation.curator} />}
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/curations" className={styles.back}>
          ← curations
        </Link>
      </nav>
      {children}
    </div>
  )
}
