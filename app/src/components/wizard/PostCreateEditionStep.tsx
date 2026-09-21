'use client'

import { useState } from 'react'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc1155InstanceAbi } from '../../generated/contracts'
import {
  editionDraftFromValues,
  editionDraftToAddEditionArgs,
  validateEditionDraft,
} from '../collection/erc1155/editionDraft'
import { collectDefaults, validateFields, type FieldSchema } from '../../lib/wizard/schema'
import type { forkChainId } from '../../lib/addresses'
import { SchemaForm } from './SchemaForm'
import styles from './PostCreateEditionStep.module.css'

export interface PostCreateEditionStepProps {
  /** The instance the wizard just deployed. */
  instance: `0x${string}`
  /** Narrowed to the chains wagmi is configured for, as `writeContract` requires. */
  chainId: typeof forkChainId
  /** `postCreate.title` — the step names itself out of the schema, not out of this file. */
  title: string
  /** `postCreate.fields` for the selected project type. */
  fields: FieldSchema[]
  /** Leave the wizard for the new collection: taken on a confirmed edition and on skip alike. */
  onDone: () => void
}

/**
 * The step `ProjectTypeSchema.postCreate` has declared since it was written and nothing rendered:
 * the first edition, created against the instance the wizard has just deployed.
 *
 * Why it exists at all, when `AddEditionForm` on the collection page creates editions perfectly
 * well: a timed drop is a thing a creator decides WHEN THEY DECIDE THE COLLECTION, which is how
 * every peer launchpad puts it, and a collection whose first edition is added in a separate visit
 * has no drop window at the moment anyone is told about it. So this is the same transaction offered
 * a step earlier, and skipping it is a first-class answer — an edition added later is not worse,
 * it is just later, and the collection page is right there.
 *
 * It shares every rule with `AddEditionForm` through `editionDraft.ts` and holds none of its own.
 */
export function PostCreateEditionStep({
  instance,
  chainId,
  title,
  fields,
  onDone,
}: PostCreateEditionStepProps) {
  const [values, setValues] = useState<Record<string, string>>(() => collectDefaults(fields))
  // Field-level errors stay hidden until the creator tries to submit, so a step they mean to skip
  // never turns red at them on the way past.
  const [attempted, setAttempted] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)

  const {
    writeContract,
    data: hash,
    isPending,
    isError: isWriteError,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract()
  const {
    isLoading: isConfirming,
    isSuccess,
    isError: isWaitError,
    error: waitError,
  } = useWaitForTransactionReceipt({ hash })

  const busy = isPending || isConfirming
  const fieldErrors = attempted ? validateFields(fields, values) : {}
  const txError = isWriteError ? writeError : isWaitError ? waitError : null

  // The redirect is the confirmed receipt's, not the click's: leaving on the click would drop the
  // creator onto a collection page whose edition has not been mined and is therefore not there.
  const [left, setLeft] = useState(false)
  if (isSuccess && !left) {
    setLeft(true)
    onDone()
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAttempted(true)

    if (Object.keys(validateFields(fields, values)).length > 0) {
      setClientError(null)
      return
    }
    const draft = editionDraftFromValues(values)
    const error = validateEditionDraft(draft)
    if (error) {
      setClientError(error)
      return
    }

    setClientError(null)
    resetWrite()
    writeContract({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'addEdition',
      args: editionDraftToAddEditionArgs(draft),
      chainId,
    })
  }

  return (
    <form className={styles.step} onSubmit={handleSubmit}>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.lede}>
        Your collection is deployed. Add its first edition now — including when minting closes and
        how many one wallet may take — or skip and add it from the collection page whenever you
        like.
      </p>

      <SchemaForm
        fields={fields}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        errors={fieldErrors}
      />

      {clientError !== null && (
        <div className={styles.errorBox} role="alert">
          {clientError}
        </div>
      )}

      {txError !== null && (
        <div className={styles.errorBox} role="alert">
          {txError.message.split('\n')[0]}
        </div>
      )}

      <div className={styles.actions}>
        <div className={styles.statusLine}>
          {isPending && <span>Waiting for wallet…</span>}
          {isConfirming && <span>Confirming transaction…</span>}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onDone}
          disabled={busy}
          data-testid="postcreate-skip"
        >
          Skip for now
        </button>
        <button type="submit" className="btn btn-primary btn-chromatic" disabled={busy}>
          {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Add edition'}
        </button>
      </div>
    </form>
  )
}
