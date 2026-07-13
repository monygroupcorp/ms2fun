import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface IframeCanvasProps {
  /** Creator CSS injected LAST (after the copied app styles) — the theme under preview. */
  creatorCss: string
  className?: string | undefined
  /**
   * Render the content at this virtual pixel width (so the DESKTOP responsive layout kicks in) and
   * scale it down to fit the frame — a window into the full-width page instead of a mobile column.
   */
  virtualWidth?: number | undefined
  children: ReactNode
}

/**
 * An isolated iframe that hosts `children` via a React PORTAL. Because portals keep the parent React
 * context, the real collection component renders inside with full Router / React-Query / wagmi
 * context — while its DOM lives in a separate document. We clone the app's own stylesheets into that
 * document (so CSS-module + token + noesis classes resolve exactly), add `body.has-project-style`, and
 * append the creator CSS last. Result: a pixel-accurate, themeable preview that can't leak into the
 * wizard. The frame is same-origin (about:blank) so we can reach its document; creator CSS is inert
 * (CSS can't run JS).
 */
export function IframeCanvas({ creatorCss, className, virtualWidth, children }: IframeCanvasProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const creatorStyleRef = useRef<HTMLStyleElement | null>(null)
  const [mount, setMount] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // Desktop-window mode: measure the wrapper so we can scale a virtualWidth-wide frame to fit it.
  useEffect(() => {
    if (!virtualWidth || !wrapRef.current) return
    const el = wrapRef.current
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [virtualWidth])

  useEffect(() => {
    const doc = ref.current?.contentDocument
    if (!doc) return

    // Base URL → relative asset URLs (fonts, images) resolve to the app origin (same-origin, no CORS).
    const base = doc.createElement('base')
    base.href = `${location.origin}/`
    doc.head.appendChild(base)

    // Clone the app's live stylesheets so the frame looks exactly like the app.
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      const clone = node.cloneNode(true) as HTMLElement
      if (clone instanceof HTMLLinkElement) clone.href = (node as HTMLLinkElement).href
      doc.head.appendChild(clone)
    })

    const creator = doc.createElement('style')
    creator.textContent = creatorCss
    doc.head.appendChild(creator)
    creatorStyleRef.current = creator

    doc.body.className = 'has-project-style'
    doc.body.style.margin = '0'
    setMount(doc.body)
    // Mount-once: a snapshot of styles is fine for a preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live-update just the creator layer as the theme changes.
  useEffect(() => {
    if (creatorStyleRef.current) creatorStyleRef.current.textContent = creatorCss
  }, [creatorCss])

  if (virtualWidth) {
    const scale = box.w > 0 ? box.w / virtualWidth : 1
    return (
      <>
        <div
          ref={wrapRef}
          className={className}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          <iframe
            ref={ref}
            title="preview"
            src="about:blank"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              border: 0,
              width: `${virtualWidth}px`,
              // In virtual px: fills the wrapper height once scaled.
              height: scale > 0 ? `${box.h / scale}px` : '100%',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
        {mount && createPortal(children, mount)}
      </>
    )
  }

  return (
    <>
      <iframe ref={ref} title="preview" className={className} src="about:blank" />
      {mount && createPortal(children, mount)}
    </>
  )
}
