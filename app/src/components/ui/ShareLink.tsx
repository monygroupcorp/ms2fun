import { useEffect, useRef, useState } from 'react'
import styles from './ShareLink.module.css'

const CONFIRM_MS = 2000

export interface ShareLinkProps {
  /** URL to copy. Defaults to the current page's URL. */
  url?: string
  /** Resting-state label. Defaults to "copy link". */
  label?: string
}

function hasClipboardWrite(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
}

/**
 * Copy-link affordance — the site's only share mechanic (copy-link only; social-intent buttons are
 * a separate, unruled decision — see DISTRIBUTION.md D3).
 *
 * `navigator.clipboard` is undefined on insecure origins and in some in-app browsers.
 * `navigator.clipboard?.writeText(...)` short-circuits on that without throwing, so a click can look
 * like it did nothing. This component checks availability up front and, when the API is missing (or
 * a write is rejected), falls back to a selectable, read-only input carrying the URL — never a click
 * that silently no-ops.
 */
export function ShareLink({ url, label = 'copy link' }: ShareLinkProps) {
  const [copied, setCopied] = useState(false)
  const [fallback, setFallback] = useState(() => !hasClipboardWrite())
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [])

  function resolveUrl(): string {
    return url ?? (typeof window !== 'undefined' ? window.location.href : '')
  }

  function handleClick(): void {
    if (!hasClipboardWrite()) {
      setFallback(true)
      return
    }
    void navigator.clipboard.writeText(resolveUrl()).then(
      () => {
        setCopied(true)
        timerRef.current = window.setTimeout(() => setCopied(false), CONFIRM_MS)
      },
      () => setFallback(true),
    )
  }

  if (fallback) {
    return (
      <div className={styles.fallback}>
        <input
          className={styles.fallbackInput}
          type="text"
          readOnly
          value={resolveUrl()}
          aria-label="page link — copy by hand"
          onFocus={(e) => e.currentTarget.select()}
          data-testid="share-link-fallback"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      className={styles.share}
      onClick={handleClick}
      aria-label={copied ? 'link copied' : 'copy link to clipboard'}
      aria-live="polite"
      data-testid="share-link"
    >
      {copied ? 'link copied' : label}
    </button>
  )
}
