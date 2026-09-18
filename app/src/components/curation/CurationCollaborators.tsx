import { useState } from 'react'
import { useAccount } from 'wagmi'
import { StateBlock } from '../ui/StateBlock'
import { useCurationCanEdit } from './useCurations'
import { useTxAction } from '../ui/useTxAction'
import { curationRegistryAbi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { truncateAddress } from '../../lib/format'
import styles from './CurationCollaborators.module.css'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * The curator's control over who else may assemble this curation.
 *
 * Collaboration is a grant per address per curation, held on-chain as a mapping — there is no list
 * to enumerate, by design: storing one would mean an unbounded array that every grant and every
 * revoke has to keep in step, for a set that is small and that the curator already knows. So this
 * panel is a grant/revoke control plus a lookup, not a roster. A curator who wants to check an
 * address types it; the answer comes from `canEdit`, the same read the edit controls are drawn
 * from, so the panel can never claim access the contract would refuse.
 */
export function CurationCollaborators({ id, curator }: { id: bigint; curator: `0x${string}` }) {
  const { address: connected } = useAccount()
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  const candidate = ADDRESS_RE.test(input.trim()) ? (input.trim() as `0x${string}`) : undefined
  const { data: candidateMayEdit } = useCurationCanEdit(id, candidate)

  const tx = useTxAction({ instance: forkAddresses.CurationRegistry })

  function send(allowed: boolean) {
    if (candidate === undefined) {
      setError('that is not an address')
      return
    }
    if (candidate.toLowerCase() === curator.toLowerCase()) {
      setError('you are the curator — you already edit this, and cannot revoke yourself')
      return
    }
    setError('')
    tx.send({
      address: forkAddresses.CurationRegistry,
      abi: curationRegistryAbi,
      functionName: 'setCollaborator',
      args: [id, candidate, allowed],
      chainId: forkChainId,
    })
  }

  const isSelf = candidate !== undefined && candidate.toLowerCase() === connected?.toLowerCase()

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>Collaborators</h2>
      <p className={styles.lede}>
        Anyone you grant here can add, remove and reorder picks. Only you can take the curation off
        view or change this list.
      </p>

      <div className={styles.row}>
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError('')
          }}
          placeholder="0x…"
          aria-label="Collaborator address"
        />
        <button
          type="button"
          className="btn"
          onClick={() => send(true)}
          disabled={tx.isBusy || candidate === undefined}
        >
          Grant
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => send(false)}
          disabled={tx.isBusy || candidate === undefined}
        >
          Revoke
        </button>
      </div>

      {candidate !== undefined && (
        <p className={styles.status} data-testid="collaborator-status">
          {truncateAddress(candidate)}
          {isSelf && ' (you)'} —{' '}
          {candidateMayEdit === undefined
            ? 'checking…'
            : candidateMayEdit
              ? 'can edit this curation'
              : 'cannot edit this curation'}
        </p>
      )}

      {error !== '' && <StateBlock variant="error">{error}</StateBlock>}
      {tx.state === 'error' && (
        <StateBlock variant="error">{tx.reason ?? 'the change was not saved'}</StateBlock>
      )}
      {tx.state === 'success' && <StateBlock variant="empty">saved.</StateBlock>}
    </section>
  )
}
