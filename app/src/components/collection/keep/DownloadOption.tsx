/**
 * Option 3: take a copy away. The CIDs, to copy into any tool; and the CAR, checked here like the
 * one sent to a node, to keep on a disk or import anywhere.
 */
import { useEffect, useState } from 'react'

import type { KeepCar } from '../../../lib/art/keep/build'
import { ROLE_LABEL, type KeepRoot } from '../../../lib/art/keep/plan'
import { ShareLink } from '../../ui/ShareLink'
import styles from './KeepAlive.module.css'

export function DownloadOption({
  enabled,
  disabledReason,
  roots,
  build,
  building,
  filename,
}: {
  enabled: boolean
  disabledReason: string
  /** The roots to show before any CAR is built. */
  roots: KeepRoot[]
  build: () => Promise<KeepCar | null>
  building: string | null
  filename: (keep: KeepCar) => string
}) {
  const [file, setFile] = useState<{ url: string; name: string; keep: KeepCar } | null>(null)
  const [waiting, setWaiting] = useState(false)

  const url = file?.url ?? null
  useEffect(() => {
    if (url === null) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  async function download() {
    setWaiting(true)
    const keep = await build()
    setWaiting(false)
    if (keep === null) return
    const next = { url: URL.createObjectURL(keep.car), name: filename(keep), keep }
    setFile(next)
    const link = document.createElement('a')
    link.href = next.url
    link.download = next.name
    link.rel = 'noopener'
    link.click()
  }

  const shown = file?.keep.roots ?? roots
  const name = file?.name ?? 'collection.car'

  return (
    <li data-testid="keep-download">
      <strong>Download the CAR, or copy the CIDs.</strong> A CAR file is the collection in one file:
      every image and piece of metadata, under the same CIDs.
      <ul className={styles.roots}>
        {shown.map((root) => (
          <li key={root.cid}>
            {ROLE_LABEL[root.role]} <code data-testid="keep-cid">{root.cid}</code>
            <ShareLink url={root.cid} label="copy" />
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!enabled || waiting}
          onClick={() => void download()}
          data-testid="keep-download-car"
        >
          Download the CAR
        </button>
        {waiting && building !== null && (
          <span className={styles.note} role="status">
            {building}
          </span>
        )}
        {file !== null && (
          <a href={file.url} download={file.name} className={styles.note}>
            {file.name}
          </a>
        )}
      </div>
      {!enabled && <p className={styles.note}>{disabledReason}</p>}
      <ul className={styles.note}>
        <li>
          IPFS Desktop or kubo: <code>ipfs dag import {name}</code> — imports it and pins every
          root.
        </li>
        <li>
          A pinning service that imports CAR files: upload it there, and check the root CIDs it
          shows match the ones above.
        </li>
        <li>
          Any other pinning service: give it the CIDs above, once the status above shows them on
          public IPFS.
        </li>
      </ul>
    </li>
  )
}
