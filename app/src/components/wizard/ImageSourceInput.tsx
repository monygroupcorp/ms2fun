import { useEffect, useMemo, useState } from 'react'
import { isResolvableUri, resolveCandidates } from '../../lib/metadata'
import styles from './ImageSourceInput.module.css'

export interface ImageSourceInputProps {
  id: string
  label: string
  value: string
  onChange: (uri: string) => void
  /** Preview box shape. */
  aspect?: 'square' | 'wide'
  help?: string
  /**
   * Preview a DERIVED string instead of `value` (e.g. a composed base+id URI) while the input still
   * edits and displays the raw `value`. The input's `Remove` button still clears `value` — unset
   * (the default) previews `value` itself, which is what a direct image-link field wants.
   */
  previewValue?: string
}

/**
 * Every URL worth spending a request on to preview a stored URI (`ipfs://`, `ar://`, `https://`,
 * `data:`), best-first, or `[]` for a scheme this form can't preview.
 *
 * The list comes from the shared metadata resolver (`resolveCandidates`) — the same seam the app's
 * art renderer uses: one gateway roster, health-ordered, with cooling gateways dropped. The form
 * holds no gateway host of its own. A preview resolved through a different list than the renderer
 * can report a working pointer as broken (or the reverse), and that preview is exactly the signal a
 * creator reads when deciding whether their art link is good.
 *
 * `ipfs://` yields one URL per usable gateway so the caller can rotate on error instead of being
 * pinned to whichever is listed first; `ar://`, `http(s)://` and `data:` resolve to a single URL.
 * Exported so a caller previewing a DERIVED string (see `previewValue`) resolves under the same rules.
 */
export function toPreviewCandidates(uri: string): string[] {
  const v = uri.trim()
  if (!isResolvableUri(v)) return []
  return resolveCandidates(v).map((candidate) => candidate.url)
}

export function ImageSourceInput({
  id,
  label,
  value,
  onChange,
  aspect = 'square',
  help,
  previewValue,
}: ImageSourceInputProps) {
  const previewUri = (previewValue ?? value).trim()
  const candidates = useMemo(() => toPreviewCandidates(previewUri), [previewUri])
  // Which candidate is being shown. Rotation happens on `onError`: one refusing or hung gateway must
  // not read as "your link is broken" when the next in the roster serves the same bytes.
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    setIdx(0)
  }, [previewUri])

  // The preview box is shown for any pointer this form can address, so the Remove control stays
  // reachable while the image is still resolving or has exhausted its candidates.
  const addressable = isResolvableUri(previewUri)
  const previewSrc = candidates[idx]

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {help && <p className={styles.help}>{help}</p>}

      <div className={styles.controls}>
        <input
          id={id}
          className={styles.input}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste a link — ipfs://, ar://, or https://"
          aria-label={`${label} link`}
        />
      </div>

      {addressable && (
        <div className={styles.previewWrap}>
          <div className={`${styles.preview} ${aspect === 'wide' ? styles.wide : styles.square}`}>
            {previewSrc !== undefined && (
              <img
                src={previewSrc}
                alt={`${label} preview`}
                className={styles.previewImg}
                referrerPolicy="no-referrer"
                // Advance to the next candidate; past the end there is nothing left to try.
                onError={() => setIdx((i) => i + 1)}
              />
            )}
          </div>
          <div className={styles.meta}>
            <span className={styles.ok}>Link preview</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('')}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
