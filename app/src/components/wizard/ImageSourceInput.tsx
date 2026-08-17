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

// Public gateway used ONLY to render a preview of an `ipfs://` link in this form. Not a runtime
// dependency — the stored value stays `ipfs://…`. Kept generic + key-less on purpose.
const IPFS_PREVIEW_GATEWAY = 'https://ipfs.io/ipfs/'

/** Resolve a stored URI (`ipfs://`, `ar://`, `https://`, `data:`) to a fetchable preview `src`, or
 * `null` for a scheme this form can't preview. Exported so a caller previewing a DERIVED string (see
 * `previewValue`) can resolve it under the same rules. */
export function toPreviewSrc(uri: string): string | null {
  const v = uri.trim()
  if (!v) return null
  if (v.startsWith('ipfs://')) return IPFS_PREVIEW_GATEWAY + v.slice('ipfs://'.length)
  if (v.startsWith('ar://')) return `https://arweave.net/${v.slice('ar://'.length)}`
  if (v.startsWith('https://') || v.startsWith('http://') || v.startsWith('data:')) return v
  return null
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
  const previewSrc = toPreviewSrc(previewValue ?? value)

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

      {previewSrc && (
        <div className={styles.previewWrap}>
          <div className={`${styles.preview} ${aspect === 'wide' ? styles.wide : styles.square}`}>
            <img
              src={previewSrc}
              alt={`${label} preview`}
              className={styles.previewImg}
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
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
