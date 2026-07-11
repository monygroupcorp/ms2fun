import { useRef, useState } from 'react'
import { resolveUri } from '../../lib/metadata'
import { CollectionHeroPreview } from './CollectionHeroPreview'
import styles from './StylePreviewControl.module.css'

const MAX_CSS = 200_000

function decodeDataCss(uri: string): string {
  const comma = uri.indexOf(',')
  if (comma === -1) return ''
  const header = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  return header.includes(';base64') ? atob(payload) : decodeURIComponent(payload)
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'active'; bytes: number }
  | { kind: 'empty' }
  | { kind: 'error'; msg: string }

export interface StylePreviewControlProps {
  styleUri: string
  name?: string
  description?: string
  image?: string
}

/**
 * Live styleUri preview. Renders the REAL collection hero (same component + CSS the collection page
 * uses) with the creator's own name/cover/description as mock data, portalled into an isolated iframe,
 * and overlays the fetched `styleUri` CSS — so a theme applies pixel-accurately against the actual
 * page markup without leaking into the wizard.
 */
export function StylePreviewControl({ styleUri, name, description, image }: StylePreviewControlProps) {
  const [css, setCss] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const uriRef = useRef(styleUri)
  uriRef.current = styleUri

  async function preview() {
    const uri = uriRef.current.trim()
    if (!uri) {
      setStatus({ kind: 'empty' })
      return
    }
    setStatus({ kind: 'loading' })
    let text = ''
    try {
      if (uri.startsWith('data:text/css')) {
        text = decodeDataCss(uri)
      } else {
        const res = await fetch(resolveUri(uri))
        if (!res.ok) {
          setStatus({ kind: 'error', msg: `fetch failed (${res.status})` })
          return
        }
        text = await res.text()
      }
    } catch {
      setStatus({ kind: 'error', msg: 'could not fetch — check the URL / CORS' })
      return
    }
    if (text === '') {
      setStatus({ kind: 'error', msg: 'stylesheet was empty' })
      return
    }
    const clipped = text.slice(0, MAX_CSS)
    setCss(clipped)
    setStatus({ kind: 'active', bytes: new TextEncoder().encode(clipped).length })
  }

  function clear() {
    setCss('')
    setStatus({ kind: 'idle' })
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <button type="button" className="btn btn-sm btn-secondary" onClick={preview}>
          {status.kind === 'active' ? 'Reload style' : 'Fetch & preview'}
        </button>
        {status.kind === 'active' && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>
            Clear style
          </button>
        )}
        {status.kind === 'loading' && <span className={styles.note}>fetching…</span>}
        {status.kind === 'active' && (
          <span className={styles.note}>applied · {(status.bytes / 1024).toFixed(1)} KB</span>
        )}
        {status.kind === 'empty' && <span className={styles.note}>paste a style URL first</span>}
        {status.kind === 'error' && <span className={styles.error}>{status.msg}</span>}
      </div>

      <CollectionHeroPreview
        name={name}
        description={description}
        image={image}
        creatorCss={css}
        className={styles.frame}
      />

      <p className={styles.hint}>
        Live preview of your collection page (mock data). Theme it by overriding design tokens under{' '}
        <code>body.has-project-style</code> — e.g.{' '}
        <code>body.has-project-style{'{'}--bg-primary:#0a0a12;--text-primary:#c9b3ff{'}'}</code>. A
        generic public stylesheet won&rsquo;t match this design system.
      </p>
    </div>
  )
}
