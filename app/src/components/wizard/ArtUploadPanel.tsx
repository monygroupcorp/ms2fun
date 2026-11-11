/**
 * "Upload art" — the alternative to pasting an IPFS link for a collection's piece art.
 *
 * The first creator to launch here said the hardest part was setting up IPFS before they could
 * start. This takes their image files instead: it packs them into IPFS directories in the browser,
 * signs in with their wallet, uploads the result to the art host, and fills the piece-art base with
 * the hosted link. The paste field stays exactly where it was; this sits beside it.
 *
 * WHAT THE CREATOR IS TOLD, and it is the honest version: hosting is temporary. The art is stored
 * under its IPFS address, so the link keeps working once the art is on IPFS, and it should be moved
 * there after the collection graduates. An upload no collection uses is deleted after a week.
 *
 * Rendered only when the build names an art host (`VITE_ART_HOST`); with none, the wizard is the
 * paste field alone, as it was.
 */
import { useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'

import { forkChainId } from '../../lib/addresses'
import type { BuiltUpload, BuildStage, UploadPlan } from '../../lib/art/buildUpload'
import { HOSTING_LIMITS } from '../../lib/art/hostingLimits'
import { ArtHostError, signIn, uploadCar } from '../../lib/art/hostClient'
import styles from './ArtUploadPanel.module.css'

export interface ArtUploadPanelProps {
  /** The art host's origin. */
  host: string
  /** Called with the per-token base once the upload is hosted. */
  onUploaded: (baseUri: string) => void
  /** The collection's NFT supply as typed, to warn when there are fewer images than pieces. */
  supply?: string
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'planned'; plan: UploadPlan<File> }
  | { kind: 'building'; stage: BuildStage }
  | { kind: 'signing' }
  | { kind: 'uploading'; fraction: number }
  | { kind: 'done'; built: BuiltUpload; expiresAt: number | null }
  | { kind: 'failed'; message: string; plan: UploadPlan<File> | null }

const STAGE_LABEL: Record<BuildStage, string> = {
  reading: 'Reading your images…',
  images: 'Building the image directory…',
  metadata: 'Writing one metadata file per piece…',
  car: 'Packing the upload…',
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif'

const mib = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`

function hostName(host: string): string {
  try {
    return new URL(host).host
  } catch {
    return host
  }
}

export function ArtUploadPanel({ host, onUploaded, supply }: ArtUploadPanelProps) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const busy = phase.kind === 'building' || phase.kind === 'signing' || phase.kind === 'uploading'
  const plan = phase.kind === 'planned' ? phase.plan : phase.kind === 'failed' ? phase.plan : null

  async function choose(list: FileList | null) {
    if (list === null || list.length === 0) return
    // The packer is loaded on first use, so a creator who pastes a link never downloads it.
    const { planUpload } = await import('../../lib/art/buildUpload')
    setPhase({ kind: 'planned', plan: planUpload([...list]) })
  }

  async function start(plan: UploadPlan<File>) {
    if (address === undefined) {
      setPhase({ kind: 'failed', message: 'Connect a wallet first — it is how you sign in.', plan })
      return
    }
    try {
      const { buildUpload } = await import('../../lib/art/buildUpload')
      setPhase({ kind: 'building', stage: 'reading' })
      const built = await buildUpload(plan, host, (stage) => setPhase({ kind: 'building', stage }))
      setPhase({ kind: 'signing' })
      const token = await signIn(host, address, forkChainId, (message) =>
        signMessageAsync({ message }),
      )
      setPhase({ kind: 'uploading', fraction: 0 })
      const draft = await uploadCar(host, token, built.car, (fraction) =>
        setPhase({ kind: 'uploading', fraction }),
      )
      onUploaded(built.baseUri)
      setPhase({ kind: 'done', built, expiresAt: draft.expiresAt })
    } catch (error) {
      const message =
        error instanceof ArtHostError || error instanceof Error
          ? error.message
          : 'The upload did not complete.'
      setPhase({ kind: 'failed', message, plan })
    }
  }

  const pieces = plan?.pieces.length ?? 0
  const supplyCount = Number.parseInt(supply ?? '', 10)
  const short = pieces > 0 && Number.isInteger(supplyCount) && supplyCount > pieces

  return (
    <section className={styles.panel} aria-labelledby="art-upload-title">
      <h4 id="art-upload-title" className={styles.title}>
        Or upload your art
      </h4>
      <p className={styles.note}>
        No IPFS setup needed. Choose one image per piece — PNG, JPEG, WebP or GIF, up to 10 MiB
        each. Pieces are numbered in file-name order.
      </p>
      <p className={styles.notice}>
        <strong>Hosting is temporary.</strong> Your art is stored at {hostName(host)} under its IPFS
        address, so the link keeps working after it moves. Move it to IPFS once your collection
        graduates. Uploads that no launched collection uses are deleted after{' '}
        {HOSTING_LIMITS.draftTtlDays} days.
      </p>

      <input
        className={styles.file}
        type="file"
        accept={ACCEPT}
        multiple
        disabled={busy}
        aria-label="Choose image files"
        onChange={(e) => void choose(e.target.files)}
      />

      {plan !== null && (
        <div className={styles.summary}>
          <p className={styles.note}>
            {pieces} image{pieces === 1 ? '' : 's'}, {mib(plan.bytes)}
          </p>
          {plan.problems.length > 0 && (
            <ul className={styles.problems} role="alert">
              {plan.problems.slice(0, 8).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
              {plan.problems.length > 8 && <li>…and {plan.problems.length - 8} more</li>}
            </ul>
          )}
          {short && (
            <p className={styles.note}>
              That is fewer images than the {supplyCount} NFTs this collection will have: pieces
              past #{pieces} will have no art.
            </p>
          )}
          {phase.kind !== 'done' && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || plan.problems.length > 0}
              onClick={() => void start(plan)}
            >
              Sign in and upload
            </button>
          )}
        </div>
      )}

      {phase.kind === 'building' && <p className={styles.status}>{STAGE_LABEL[phase.stage]}</p>}
      {phase.kind === 'signing' && (
        <p className={styles.status}>
          Sign the message in your wallet to upload. It costs nothing.
        </p>
      )}
      {phase.kind === 'uploading' && (
        <div className={styles.status}>
          <progress className={styles.progress} max={1} value={phase.fraction} />
          <span>Uploading… {Math.round(phase.fraction * 100)}%</span>
        </div>
      )}
      {phase.kind === 'failed' && (
        <p className={styles.error} role="alert">
          {phase.message}
        </p>
      )}
      {phase.kind === 'done' && (
        <div className={styles.summary}>
          <p className={styles.status}>
            Uploaded {phase.built.pieces} piece{phase.built.pieces === 1 ? '' : 's'}. The piece-art
            link above now points at them.
          </p>
          <p className={styles.note}>
            Images <code>{phase.built.imgCid}</code>
            <br />
            Metadata <code>{phase.built.metaCid}</code>
          </p>
          <p className={styles.note}>
            Keep a copy to pin on IPFS later:{' '}
            <a href={`${host}/car/${phase.built.metaCid}`} download>
              download the CAR
            </a>
            .
            {phase.expiresAt !== null &&
              ` Launch by ${new Date(phase.expiresAt).toLocaleDateString()}, or the upload is deleted.`}
          </p>
        </div>
      )}
    </section>
  )
}
