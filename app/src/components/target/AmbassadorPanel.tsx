/**
 * AmbassadorPanel — the appointed ambassador's controls on a community's page (`/target/:id`).
 *
 * `AlignmentRegistryV1.updateAlignmentTarget` is `onlyOwnerOrAmbassador(targetId)`: it is the one
 * power the ambassador seat exists to grant, and until now the app called it from exactly one place
 * — the protocol admin console, which returns null for anyone who is not the registry owner. So the
 * seat could be granted on-chain and then only used by hand-writing a contract call. This is that
 * surface, gated on the same authority the contract checks (`isAmbassador`, read live) rather than
 * on ownership.
 *
 * Two deliberate departures from the admin console's version of the same write:
 *
 *  - **The fields are prefilled with what is stored.** The write overwrites BOTH `description` and
 *    `metadataURI` unconditionally, so submitting a blank metadata field silently clears the
 *    community's logo pointer. Blank inputs make that the default outcome of a description edit;
 *    prefilled ones make an erasure something you have to actually do.
 *  - **The metadata pointer is checked before it is sent** against the same allowlist the contract
 *    enforces, so a bad scheme costs a disabled button instead of a reverted transaction.
 *
 * What this surface does NOT offer, and says so: ambassadorship of a CURATED target also authorises
 * `AlignmentEndowmentVault.execute` on that community's yield-family vaults — an arbitrary external
 * call spending up to the vested corpus. That is a sovereign-capital action, not metadata, and it is
 * not given a button here. De-curating the target freezes that power (the vault reads
 * `isAlignmentTargetActive` alongside `isAmbassador`) while leaving these fields working, so this
 * panel is exactly the part of the seat that survives.
 */
import { useState } from 'react'
import { alignmentRegistryV1Abi } from '../../generated/contracts'
import { AdminSection, ActionRow } from '../ui/AdminSection'
import { Disclosure } from '../ui/Disclosure'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import { isStorableMetadataURI } from '../../lib/metadata/registryUri'
import { useAmbassadorTargets } from '../../lib/vaults/useAmbassadorTargets'
import type { AlignmentTargetRow } from '../../lib/vaults/useAlignmentTargets'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { venueLabel } from '../../lib/vaults/acquireVenues'
import styles from './AmbassadorPanel.module.css'

const REGISTRY = forkAddresses.AlignmentRegistryV1

export function AmbassadorPanel({
  targets,
  venueByTargetId,
}: {
  /** Every registry target this community is curated under. */
  targets: readonly AlignmentTargetRow[]
  /** Venue per target id, so a two-venue community's rows say which one they edit. */
  venueByTargetId?: ReadonlyMap<string, number>
}) {
  const { targetIds } = useAmbassadorTargets(targets.map((t) => t.id))
  const mine = targets.filter((t) => targetIds.some((id) => id === t.id))
  if (mine.length === 0) return null
  // `groupTargetsByToken` sorts by id, so the community's header text and logo come from the lowest
  // id — which a seat-holder on a second venue's target does not necessarily hold.
  const primaryId = targets[0]?.id

  return (
    <Disclosure summary="AMBASSADOR" testId="target-ambassador">
      <AdminSection title="your seat on this community" testId="ambassador-seat">
        <p className={styles.scope}>
          You are an appointed ambassador here, so the registry lets you maintain this
          community&apos;s <strong>description and metadata pointer</strong> — the text and logo
          this page and the alignment index render. The title is sealed at registration and no one
          can change it.
        </p>
        <p className={styles.scope}>
          The seat carries more than these fields: for as long as the protocol curates this
          community, it also authorises deploying <strong>vested</strong> principal from its
          endowment vaults by arbitrary call. That is not offered here. Two things end it: the
          platform owner can revoke the seat at any time, and de-curating the community freezes
          every seat&apos;s spending at once while leaving these fields alone. This surface asks the
          registry who holds the seat rather than trusting a stored list, so a revoked seat loses
          its controls.
        </p>
        {mine.map((t) => (
          <UpdateTargetRow
            key={t.id.toString()}
            target={t}
            venue={venueByTargetId?.get(t.id.toString())}
            multi={targets.length > 1}
            isPrimary={t.id === primaryId}
          />
        ))}
      </AdminSection>
    </Disclosure>
  )
}

function UpdateTargetRow({
  target,
  venue,
  multi,
  isPrimary,
}: {
  target: AlignmentTargetRow
  venue: number | undefined
  /** True when the community is curated under more than one target, so rows must be told apart. */
  multi: boolean
  /** True for the target whose text and logo this community page actually renders. */
  isPrimary: boolean
}) {
  // Seeded from the chain, then owned by the form. The stored values are what a description edit
  // should preserve, so they are the starting point rather than an empty box.
  const [description, setDescription] = useState(target.description)
  const [metadataURI, setMetadataURI] = useState(target.metadataURI)
  // Invalidates every cached read of the registry when the receipt lands, so this page's target
  // list re-reads rather than rendering the pre-edit text until something else refetches.
  const tx = useTxAction({ instance: REGISTRY })

  const nextDescription = description.trim()
  const nextURI = metadataURI.trim()
  const uriOk = isStorableMetadataURI(nextURI)
  const unchanged = nextDescription === target.description && nextURI === target.metadataURI
  const clearsPointer = target.metadataURI !== '' && nextURI === ''

  const label = multi
    ? `update ${venue !== undefined ? venueLabel(venue) : `target ${target.id}`}`
    : 'update this community'

  return (
    <ActionRow
      label={label}
      hint={`registry target ${target.id} — description and metadata pointer`}
    >
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="description"
          disabled={tx.isBusy}
          aria-label={`description for target ${target.id}`}
        />
        <input
          className={`${styles.input} ${uriOk ? '' : styles.invalid}`}
          type="text"
          value={metadataURI}
          onChange={(e) => setMetadataURI(e.target.value)}
          placeholder="metadata pointer (ipfs://, ar://, https://, data:)"
          disabled={tx.isBusy}
          aria-label={`metadata pointer for target ${target.id}`}
          aria-invalid={!uriOk}
        />
        {!uriOk && (
          <span className={styles.fieldNote} role="alert">
            the registry stores only ipfs://, ar://, https:// and data: image or JSON pointers —
            this one would be refused on-chain
          </span>
        )}
        {multi && !isPrimary && (
          <span className={styles.fieldNote}>
            this community&apos;s page renders the lowest-numbered target&apos;s text and logo, so
            this edit changes what reads off target {target.id} rather than the header above
          </span>
        )}
        {uriOk && clearsPointer && (
          <span className={styles.fieldNote}>
            this clears the stored pointer, so the community loses its logo until one is set again
          </span>
        )}
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!uriOk) return
            tx.send({
              address: REGISTRY,
              abi: alignmentRegistryV1Abi,
              functionName: 'updateAlignmentTarget',
              args: [target.id, nextDescription, nextURI],
              chainId: forkChainId,
            })
          }}
          label={label}
          className="btn btn-secondary"
          successLabel="community updated — tx confirmed."
          onReset={tx.reset}
          disabled={!uriOk || unchanged}
          {...(unchanged ? { disabledHint: 'edit a field to submit' } : {})}
          errorText={tx.reason ?? 'update failed — try again'}
          testId={`ambassador-update-${target.id}`}
        />
      </div>
    </ActionRow>
  )
}
