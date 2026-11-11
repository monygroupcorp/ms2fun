/**
 * "Upload art" — the alternative to pasting an IPFS link for a collection's piece art.
 *
 * The first creator to launch here said the hardest part was setting up IPFS before they could
 * start. This takes what a generator or an artist already has — a zip, a folder or loose files of
 * images, with their own metadata as per-piece JSON, one metadata list, or a spreadsheet — and
 * shows it back in full before anything is sent: the pieces, their traits, and every problem. Then
 * it packs the art into IPFS directories in the browser, signs in with the wallet, uploads it in
 * resumable parts, and fills the piece-art base with the hosted link. The creator's metadata is
 * hosted as they wrote it; only each piece's `image` link changes, to point at the hosted copy.
 *
 * When every piece's `image` already links art on IPFS, it offers to skip hosting: the metadata,
 * named by token id, is packed into a CAR to pin, and the paste field gets its `ipfs://` base.
 *
 * WHAT THE CREATOR IS TOLD, and it is the honest version: hosting is a convenience for launching
 * without IPFS, not a promise to keep the art forever. The policy is that art belongs on IPFS; the
 * art is stored under its IPFS address so it can move there without changing identity, and the
 * collection page walks the creator through the move, recommending it once the collection
 * graduates. An upload no collection uses is deleted after a week.
 *
 * Rendered only when the build names an art host (`VITE_ART_HOST`); with none, the wizard is the
 * paste field alone, as it was.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useAccount, useSignMessage } from 'wagmi'

import { forkChainId } from '../../lib/addresses'
import type { BuildStage, BuiltUpload, MetadataOnly } from '../../lib/art/buildUpload'
import { HOSTING_LIMITS } from '../../lib/art/hostingLimits'
import {
  ArtHostError,
  deleteDraft,
  listDrafts,
  signIn,
  uploadResumable,
  type HostedDraft,
  type UploadProgress,
} from '../../lib/art/hostClient'
import type { ArtPlan } from '../../lib/art/layout'
import type { Dropped } from '../../lib/art/sources'
import { ArtReview } from './ArtReview'
import { LearnLink } from './LearnLink'
import styles from './ArtUploadPanel.module.css'

export interface ArtUploadPanelProps {
  /** The art host's origin. */
  host: string
  /** Called with the per-token base once the upload is hosted (or the IPFS base is chosen). */
  onUploaded: (baseUri: string) => void
  /** The collection's NFT supply as typed, which every piece count is checked against. */
  supply?: string
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'planned' }
  | { kind: 'building'; stage: BuildStage; fraction: number }
  | { kind: 'signing' }
  | { kind: 'uploading'; progress: UploadProgress }
  | { kind: 'done'; built: BuiltUpload; expiresAt: number | null }
  | { kind: 'packed'; packed: MetadataOnly; url: string }
  | { kind: 'failed'; message: string; full: boolean }

const STAGE_LABEL: Record<BuildStage, string> = {
  images: 'Reading your images and working out their IPFS addresses…',
  metadata: 'Writing one metadata file per piece…',
  car: 'Laying out the upload…',
}

const GiB = 1024 * 1024 * 1024
const size = (bytes: number) =>
  bytes >= GiB ? `${(bytes / GiB).toFixed(2)} GiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`

function hostName(host: string): string {
  try {
    return new URL(host).host
  } catch {
    return host
  }
}

/** A sign-in kept for this tab, so a reload mid-upload does not ask for a second signature. */
const SESSION_MS = 55 * 60 * 1000
function sessionKey(host: string, address: string) {
  return `art-host-session:${host}:${address.toLowerCase()}`
}
function savedToken(host: string, address: string): string | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(host, address))
    if (raw === null) return null
    const { token, until } = JSON.parse(raw) as { token: string; until: number }
    return Date.now() < until ? token : null
  } catch {
    return null
  }
}
function saveToken(host: string, address: string, token: string) {
  try {
    sessionStorage.setItem(
      sessionKey(host, address),
      JSON.stringify({ token, until: Date.now() + SESSION_MS }),
    )
  } catch {
    // Storage unavailable: the creator signs again after a reload, which is all this saves.
  }
}

const folderProps = { webkitdirectory: '', directory: '' } as Record<string, string>

export function ArtUploadPanel({ host, onUploaded, supply }: ArtUploadPanelProps) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [plan, setPlan] = useState<ArtPlan | null>(null)
  const [dropped, setDropped] = useState<Dropped[] | null>(null)
  const [pattern, setPattern] = useState('')
  const [description, setDescription] = useState('')
  const [dragging, setDragging] = useState(false)
  const [drafts, setDrafts] = useState<HostedDraft[] | null>(null)
  const tokenRef = useRef<string | null>(null)
  const plannedFor = useRef<{ dropped: Dropped[]; supply: number | null } | null>(null)

  const supplyCount = Number.parseInt(supply ?? '', 10)
  const supplyValue = Number.isInteger(supplyCount) && supplyCount > 0 ? supplyCount : null

  const busy =
    phase.kind === 'reading' ||
    phase.kind === 'building' ||
    phase.kind === 'signing' ||
    phase.kind === 'uploading'

  // Re-check the plan when the supply changes, so the count is always against what is typed.
  useEffect(() => {
    if (dropped === null || busy) return
    const last = plannedFor.current
    if (last !== null && last.dropped === dropped && last.supply === supplyValue) return
    plannedFor.current = { dropped, supply: supplyValue }
    let live = true
    void (async () => {
      const [{ collect }, { planArt }] = await Promise.all([
        import('../../lib/art/sources'),
        import('../../lib/art/layout'),
      ])
      const next = await planArt(await collect(dropped), { supply: supplyValue })
      if (live) setPlan(next)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-plan on new files or supply only
  }, [dropped, supplyValue])

  async function choose(files: Dropped[]) {
    if (files.length === 0) return
    setPhase({ kind: 'reading' })
    setDrafts(null)
    try {
      // The reader and packer load on first use, so a creator who pastes a link never downloads them.
      const [{ collect }, { planArt }] = await Promise.all([
        import('../../lib/art/sources'),
        import('../../lib/art/layout'),
      ])
      setPlan(await planArt(await collect(files), { supply: supplyValue }))
      plannedFor.current = { dropped: files, supply: supplyValue }
      setDropped(files)
      setPhase({ kind: 'planned' })
    } catch (error) {
      setPhase({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Those files could not be read.',
        full: false,
      })
    }
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const { fromDataTransfer } = await import('../../lib/art/sources')
    await choose(await fromDataTransfer(event.dataTransfer))
  }

  async function onPick(list: FileList | null) {
    if (list === null) return
    const { fromFileList } = await import('../../lib/art/sources')
    await choose(fromFileList(list))
  }

  async function token(fresh: boolean): Promise<string> {
    if (address === undefined) throw new Error('Connect a wallet first — it is how you sign in.')
    if (!fresh) {
      const kept = tokenRef.current ?? savedToken(host, address)
      if (kept !== null) return kept
    }
    setPhase({ kind: 'signing' })
    const signed = await signIn(host, address, forkChainId, (message) =>
      signMessageAsync({ message }),
    )
    tokenRef.current = signed
    saveToken(host, address, signed)
    return signed
  }

  async function start() {
    if (plan === null) return
    if (address === undefined) {
      setPhase({
        kind: 'failed',
        message: 'Connect a wallet first — it is how you sign in.',
        full: false,
      })
      return
    }
    try {
      const { buildUpload } = await import('../../lib/art/buildUpload')
      setPhase({ kind: 'building', stage: 'images', fraction: 0 })
      const built = await buildUpload(plan, host, { pattern, description }, (stage, fraction) =>
        setPhase({ kind: 'building', stage, fraction }),
      )
      const { draft } = await uploadResumable(host, token, built, (progress) =>
        setPhase({ kind: 'uploading', progress }),
      )
      onUploaded(built.baseUri)
      setPhase({ kind: 'done', built, expiresAt: draft.expiresAt })
    } catch (error) {
      const message =
        error instanceof ArtHostError || error instanceof Error
          ? error.message
          : 'The upload did not complete.'
      const full =
        error instanceof ArtHostError &&
        (error.status === 409 || error.status === 413) &&
        /unlaunched|limit for unlaunched/.test(message)
      setPhase({ kind: 'failed', message, full })
      if (full) {
        try {
          setDrafts(await listDrafts(host, await token(false)))
        } catch {
          // The list is a convenience; the message already says what to do.
        }
      }
    }
  }

  async function packAsIs() {
    if (plan === null) return
    try {
      const { buildMetadataOnly } = await import('../../lib/art/buildUpload')
      const packed = await buildMetadataOnly(plan)
      setPhase({ kind: 'packed', packed, url: URL.createObjectURL(packed.car) })
    } catch (error) {
      setPhase({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'The metadata could not be packed.',
        full: false,
      })
    }
  }

  async function remove(id: string) {
    try {
      const tok = await token(false)
      await deleteDraft(host, tok, id)
      setDrafts(await listDrafts(host, tok))
    } catch (error) {
      setPhase({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'That upload could not be deleted.',
        full: true,
      })
    }
  }

  const packedUrl = phase.kind === 'packed' ? phase.url : null
  useEffect(() => {
    if (packedUrl === null) return
    return () => URL.revokeObjectURL(packedUrl)
  }, [packedUrl])

  const canUpload =
    plan !== null &&
    plan.blockers.length === 0 &&
    plan.pieces.length > 0 &&
    plan.pieces.every((p) => p.image !== null)
  const ipfsOnly = plan !== null && plan.ipfs !== null && plan.pieces.every((p) => p.image === null)

  return (
    <section className={styles.panel} aria-labelledby="art-upload-title">
      <h4 id="art-upload-title" className={styles.title}>
        Or upload your art
      </h4>
      <p className={styles.note}>
        No IPFS setup needed. Drop a zip, a folder or the files themselves: PNG, JPEG, WebP or GIF
        images (up to 10 MiB each, {HOSTING_LIMITS.maxUploadBytes / GiB} GiB in all), with your own
        metadata as one JSON per piece, a <code>_metadata.json</code> list, or a CSV — or images
        alone. Your metadata is kept exactly as you wrote it; only each image link is pointed at the
        hosted copy. <LearnLink slug="preparing-your-files" label="Preparing your files" />
      </p>
      <p className={styles.notice}>
        <strong>Hosting is a convenience, not a promise to keep your art forever.</strong> Your art
        is stored at {hostName(host)} under its IPFS address so you can launch without setting up
        IPFS. Art belongs on IPFS: once your collection graduates, we recommend moving it there —
        your collection page walks you through it, and the links keep working. Uploads that no
        launched collection uses are deleted after {HOSTING_LIMITS.draftTtlDays} days.
      </p>

      <div
        className={dragging ? `${styles.drop} ${styles.dropActive}` : styles.drop}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void onDrop(e)}
        data-testid="art-drop"
      >
        <span className={styles.note}>Drop a zip, a folder or files here, or</span>
        <label className={styles.pick}>
          choose files or a zip
          <input
            className={styles.hiddenInput}
            type="file"
            multiple
            disabled={busy}
            aria-label="Choose files or a zip"
            onChange={(e) => void onPick(e.target.files)}
          />
        </label>
        <label className={styles.pick}>
          choose a folder
          <input
            className={styles.hiddenInput}
            type="file"
            multiple
            disabled={busy}
            aria-label="Choose a folder"
            {...folderProps}
            onChange={(e) => void onPick(e.target.files)}
          />
        </label>
      </div>

      {phase.kind === 'reading' && <p className={styles.status}>Reading your files…</p>}

      {plan !== null && phase.kind !== 'reading' && (
        <>
          <ArtReview plan={plan} showBlockers={!ipfsOnly} />

          {plan.generated > 0 && !ipfsOnly && (
            <div className={styles.naming}>
              <label className={styles.note}>
                Name for pieces without metadata (<code>{'{n}'}</code> is the piece number)
                <input
                  className={styles.input}
                  value={pattern}
                  placeholder="#{n}"
                  onChange={(e) => setPattern(e.target.value)}
                  disabled={busy}
                  aria-label="Name pattern"
                />
              </label>
              <label className={styles.note}>
                Description (optional)
                <input
                  className={styles.input}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={busy}
                  aria-label="Description"
                />
              </label>
            </div>
          )}

          {plan.ipfs !== null && phase.kind !== 'packed' && (
            <div className={styles.summary}>
              <p className={styles.notice}>
                <strong>Already on IPFS.</strong> Every piece&apos;s image links art on IPFS, so you
                can skip hosting and use your metadata as it is: it is packed into one folder named
                by token id, for you to pin.
              </p>
              {plan.ipfs.blockers.length > 0 && ipfsOnly && (
                <ul className={styles.problems} role="alert">
                  {plan.ipfs.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || plan.ipfs.blockers.length > 0}
                onClick={() => void packAsIs()}
              >
                Already on IPFS: use it as-is
              </button>
            </div>
          )}

          {!ipfsOnly && phase.kind !== 'done' && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !canUpload}
              onClick={() => void start()}
            >
              {phase.kind === 'failed' && !phase.full ? 'Resume upload' : 'Sign in and upload'}
            </button>
          )}
        </>
      )}

      {phase.kind === 'building' && (
        <div className={styles.status}>
          <progress className={styles.progress} max={1} value={phase.fraction} />
          <span>{STAGE_LABEL[phase.stage]}</span>
        </div>
      )}
      {phase.kind === 'signing' && (
        <p className={styles.status}>
          Sign the message in your wallet to upload. It costs nothing.
        </p>
      )}
      {phase.kind === 'uploading' && (
        <div className={styles.summary} data-testid="art-progress">
          <div className={styles.status}>
            <progress
              className={styles.progress}
              max={phase.progress.total}
              value={phase.progress.sent}
            />
            <span>
              {phase.progress.stage === 'verifying'
                ? 'Checking every block against its CID…'
                : `Uploading… ${size(phase.progress.sent)} of ${size(phase.progress.total)}`}
            </span>
          </div>
          {phase.progress.resumedFrom > 0 && (
            <p className={styles.note}>
              Resumed: {size(phase.progress.resumedFrom)} was already uploaded.
            </p>
          )}
          {phase.progress.retrying !== null && (
            <p className={styles.note}>{phase.progress.retrying}</p>
          )}
        </div>
      )}
      {phase.kind === 'failed' && (
        <div className={styles.summary}>
          <p className={styles.error} role="alert">
            {phase.message}
          </p>
          {!phase.full && plan !== null && canUpload && (
            <p className={styles.note}>
              What already reached the host is kept: upload again — even after a reload, with the
              same files — and it carries on from there.
            </p>
          )}
        </div>
      )}
      {drafts !== null && drafts.length > 0 && (
        <div className={styles.summary}>
          <p className={styles.note}>Your unlaunched uploads:</p>
          <ul className={styles.problems}>
            {drafts
              .filter((d) => d.state !== 'bound')
              .map((d) => (
                <li key={d.id}>
                  {size(d.bytes)}
                  {d.state === 'reserved' ? ', unfinished' : ''}
                  {d.expiresAt !== null &&
                    `, deleted ${new Date(d.expiresAt).toLocaleDateString()}`}{' '}
                  <button type="button" className="btn btn-sm" onClick={() => void remove(d.id)}>
                    delete
                  </button>
                </li>
              ))}
          </ul>
        </div>
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
            Keep a copy:{' '}
            <a href={`${host}/car/${phase.built.imgCid}`} download>
              download the CAR
            </a>
            . To move the art to IPFS later, use the collection page: it builds the IPFS version of
            the metadata for you.
            {phase.expiresAt !== null &&
              ` Launch by ${new Date(phase.expiresAt).toLocaleDateString()}, or the upload is deleted.`}
          </p>
        </div>
      )}
      {phase.kind === 'packed' && (
        <div className={styles.summary}>
          <p className={styles.note}>
            Metadata <code>{phase.packed.metaCid}</code>.{' '}
            <a href={phase.url} download={`${phase.packed.metaCid}.car`}>
              Download the CAR
            </a>{' '}
            and pin it with a pinning service you use (most import CAR files). Nothing is hosted
            here.
          </p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onUploaded(phase.packed.baseUri)}
          >
            Use {phase.packed.baseUri} as the piece-art link
          </button>
        </div>
      )}
    </section>
  )
}
