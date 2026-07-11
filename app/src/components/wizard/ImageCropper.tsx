import { useRef, useState } from 'react'
import styles from './ImageCropper.module.css'

export interface AspectPreset {
  label: string
  /** Output width/height ratio, or null for free-form. */
  aspect: number | null
}

export interface ImageCropperProps {
  /** Object/data URL of the source image, for display. */
  srcUrl: string
  /** The decoded source, for pixel-accurate cropping. */
  bitmap: ImageBitmap
  /** Aspect presets to offer; the first is the default (matches how the image is displayed). */
  presets: AspectPreset[]
  onApply: (cropped: ImageBitmap) => void
  onCancel: () => void
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type Handle = 'nw' | 'ne' | 'sw' | 'se'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const MIN = 0.05

/**
 * The output aspect A relates the NORMALIZED rect to source pixels: A = (rw·W)/(rh·H), so a locked
 * ratio means rh = rw·W/(H·A). All helpers below carry (W,H) to honor that.
 */
function centeredRect(aspect: number | null, W: number, H: number): Rect {
  if (aspect === null) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  // Largest rect of the target output aspect that fits in the unit square.
  let rw = 1
  let rh = (rw * W) / (H * aspect)
  if (rh > 1) {
    rh = 1
    rw = (rh * H * aspect) / W
  }
  return { x: (1 - rw) / 2, y: (1 - rh) / 2, w: rw, h: rh }
}

export function ImageCropper({ srcUrl, bitmap, presets, onApply, onCancel }: ImageCropperProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const W = bitmap.width
  const H = bitmap.height
  const [aspect, setAspect] = useState<number | null>(presets[0]?.aspect ?? null)
  const [rect, setRect] = useState<Rect>(() => centeredRect(presets[0]?.aspect ?? null, W, H))
  const drag = useRef<{ mode: 'move' | Handle; px: number; py: number; start: Rect } | null>(null)

  function pickAspect(a: number | null) {
    setAspect(a)
    setRect(centeredRect(a, W, H))
  }

  function toNorm(e: React.PointerEvent) {
    const b = boxRef.current!.getBoundingClientRect()
    return { nx: clamp01((e.clientX - b.left) / b.width), ny: clamp01((e.clientY - b.top) / b.height) }
  }

  function onDown(mode: 'move' | Handle) {
    return (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      const { nx, ny } = toNorm(e)
      drag.current = { mode, px: nx, py: ny, start: { ...rect } }
    }
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const { nx, ny } = toNorm(e)
    const dx = nx - d.px
    const dy = ny - d.py
    const s = d.start

    if (d.mode === 'move') {
      setRect({
        x: clamp01(Math.min(Math.max(s.x + dx, 0), 1 - s.w)),
        y: clamp01(Math.min(Math.max(s.y + dy, 0), 1 - s.h)),
        w: s.w,
        h: s.h,
      })
      return
    }

    // Anchor = the corner opposite the grabbed one; it stays pinned.
    const growRight = d.mode === 'ne' || d.mode === 'se'
    const growDown = d.mode === 'sw' || d.mode === 'se'
    const ax = growRight ? s.x : s.x + s.w // anchor x
    const ay = growDown ? s.y : s.y + s.h // anchor y

    if (aspect === null) {
      // Free-form: move the grabbed corner, keep the anchor.
      const cx = clamp01(growRight ? s.x + s.w + dx : s.x + dx)
      const cy = clamp01(growDown ? s.y + s.h + dy : s.y + dy)
      const left = Math.min(ax, cx)
      const right = Math.max(ax, cx)
      const top = Math.min(ay, cy)
      const bottom = Math.max(ay, cy)
      setRect({ x: left, y: top, w: Math.max(MIN, right - left), h: Math.max(MIN, bottom - top) })
      return
    }

    // Locked ratio: width from the horizontal drag, height derived, both scaled to stay in bounds.
    let rw = Math.max(MIN, Math.abs((growRight ? s.w + dx : s.w - dx)))
    let rh = (rw * W) / (H * aspect)
    const maxW = growRight ? 1 - ax : ax
    const maxH = growDown ? 1 - ay : ay
    const scale = Math.min(1, maxW / rw, maxH / rh)
    rw *= scale
    rh *= scale
    const x = growRight ? ax : ax - rw
    const y = growDown ? ay : ay - rh
    setRect({ x, y, w: rw, h: rh })
  }

  function onUp() {
    drag.current = null
  }

  async function apply() {
    const sx = Math.round(rect.x * W)
    const sy = Math.round(rect.y * H)
    const sw = Math.max(1, Math.round(rect.w * W))
    const sh = Math.max(1, Math.round(rect.h * H))
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
    onApply(await createImageBitmap(canvas))
  }

  const pct = (n: number) => `${n * 100}%`

  return (
    <div className={styles.cropper}>
      {presets.length > 1 && (
        <div className={styles.presets}>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`btn btn-sm ${aspect === p.aspect ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => pickAspect(p.aspect)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={boxRef}
        className={styles.stage}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img src={srcUrl} alt="crop source" className={styles.stageImg} draggable={false} />
        <div
          className={styles.selection}
          style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
          onPointerDown={onDown('move')}
        >
          {(['nw', 'ne', 'sw', 'se'] as Handle[]).map((h) => (
            <span key={h} className={`${styles.handle} ${styles[h]}`} onPointerDown={onDown(h)} />
          ))}
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn btn-sm btn-secondary" onClick={apply}>
          Apply crop
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
