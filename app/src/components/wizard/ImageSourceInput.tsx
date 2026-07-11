import { useEffect, useRef, useState } from 'react'
import styles from './ImageSourceInput.module.css'
import { ImageCropper, type AspectPreset } from './ImageCropper'
import {
  byteLen,
  estimateEmbedGas,
  humanBytes,
  humanEth,
  humanGas,
  REF_GWEI,
} from '../../lib/wizard/embedGas'

// Crop presets that MATCH how the image is displayed, so what a creator crops is what ships. Cover art
// renders 16:9 on the collection page (and cover-crops on front-page cards); a banner is wide (3:1,
// the profile-banner precedent). First entry is the default.
const COVER_PRESETS: AspectPreset[] = [
  { label: 'Cover 16:9', aspect: 16 / 9 },
  { label: 'Square 1:1', aspect: 1 },
  { label: 'Free', aspect: null },
]
const BANNER_PRESETS: AspectPreset[] = [
  { label: 'Banner 3:1', aspect: 3 },
  { label: 'Wide 16:9', aspect: 16 / 9 },
  { label: 'Free', aspect: null },
]

export interface ImageSourceInputProps {
  id: string
  label: string
  value: string
  onChange: (uri: string) => void
  /** Preview box shape. */
  aspect?: 'square' | 'wide'
  /** Default longest edge (px) for the on-chain embed. The slider can go far below this. */
  maxEdge?: number
  /**
   * Marginal on-chain size of embedding `uri`, in bytes. The raw data URI is NOT what lands on
   * chain — it's nested inside the metadata JSON and URL-encoded, which inflates it (`"`→`%22`, and
   * base64's `+ / =` each triple). Supply the real delta so the gas readout doesn't under-report.
   * Defaults to the data URI's own length.
   */
  marginalBytes?: (uri: string) => number
  help?: string
}

// Public gateway used ONLY to render a preview of an `ipfs://` link in this form. Not a runtime
// dependency — the on-chain value stays `ipfs://…`. Kept generic + key-less on purpose.
const IPFS_PREVIEW_GATEWAY = 'https://ipfs.io/ipfs/'

// The embed gas model (SSTORE + calldata) lives in ../../lib/wizard/embedGas — shared with the
// Review-step breakdown so the numbers can't drift.
const OK_BYTES = 10 * 1024
const WARN_BYTES = 24 * 1024
const FIT_TARGETS = [8, 16, 24] as const
const MIN_EDGE = 4

function toPreviewSrc(uri: string): string | null {
  const v = uri.trim()
  if (!v) return null
  if (v.startsWith('ipfs://')) return IPFS_PREVIEW_GATEWAY + v.slice('ipfs://'.length)
  if (v.startsWith('ar://')) return `https://arweave.net/${v.slice('ar://'.length)}`
  if (v.startsWith('https://') || v.startsWith('http://') || v.startsWith('data:')) return v
  return null
}

function fitDims(w: number, h: number, edge: number): { w: number; h: number } {
  const scale = Math.min(1, edge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/** Draw the source bitmap at `edge`/`quality` and return a compact `data:` URI. Sync. */
function encodeFromBitmap(bmp: ImageBitmap, edge: number, quality: number): string {
  const { w, h } = fitDims(bmp.width, bmp.height, edge)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(bmp, 0, 0, w, h)
  const webp = canvas.toDataURL('image/webp', quality)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality)
}

/** A downscaled data URL of a bitmap, just for on-screen display (cropper + thumbnail). */
function bitmapToDisplayUrl(bmp: ImageBitmap, cap = 640): string {
  const { w, h } = fitDims(bmp.width, bmp.height, cap)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h)
  return canvas.toDataURL('image/webp', 0.9)
}

export function ImageSourceInput({
  id,
  label,
  value,
  onChange,
  aspect = 'square',
  maxEdge = 512,
  marginalBytes,
  help,
}: ImageSourceInputProps) {
  // What this image actually costs once serialized into the on-chain metadataURI.
  const onChainBytes = (uri: string) => (marginalBytes ? marginalBytes(uri) : byteLen(uri))
  const fileRef = useRef<HTMLInputElement>(null)
  // Current working source image (post-crop), kept so the crush slider re-encodes without re-picking.
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const [hasSource, setHasSource] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)
  const [quality, setQuality] = useState(0.82)
  const [edge, setEdge] = useState(maxEdge)
  const [cropping, setCropping] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Re-encode when the crush controls move (once a source exists).
  useEffect(() => {
    if (bitmapRef.current) onChange(encodeFromBitmap(bitmapRef.current, edge, quality))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, edge])

  useEffect(() => () => bitmapRef.current?.close?.(), [])

  /** Adopt a new working bitmap (from a file pick or a crop) and re-encode. */
  function setWorking(bmp: ImageBitmap) {
    bitmapRef.current?.close?.()
    bitmapRef.current = bmp
    setHasSource(true)
    setDims({ w: bmp.width, h: bmp.height })
    setDisplayUrl(bitmapToDisplayUrl(bmp))
    const startEdge = Math.min(maxEdge, Math.max(bmp.width, bmp.height))
    setEdge(startEdge)
    onChange(encodeFromBitmap(bmp, startEdge, quality))
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setErr(null)
    try {
      setWorking(await createImageBitmap(file))
    } catch {
      setErr('Could not read that image. Try a PNG, JPEG, or WebP file.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** Bitcrush to fit a byte budget: drop quality, then resolution, until it fits. */
  function fitTo(targetKb: number) {
    const bmp = bitmapRef.current
    if (!bmp) return
    const target = targetKb * 1024
    let q = 0.9
    let e = Math.min(maxEdge, Math.max(bmp.width, bmp.height))
    let uri = encodeFromBitmap(bmp, e, q)
    while (onChainBytes(uri) > target && q > 0.2) {
      q = Math.round((q - 0.1) * 100) / 100
      uri = encodeFromBitmap(bmp, e, q)
    }
    while (onChainBytes(uri) > target && e > MIN_EDGE) {
      e = Math.max(MIN_EDGE, Math.round(e * 0.85))
      uri = encodeFromBitmap(bmp, e, q)
    }
    setQuality(q)
    setEdge(e)
    onChange(uri)
  }

  function clear() {
    bitmapRef.current?.close?.()
    bitmapRef.current = null
    setHasSource(false)
    setDims(null)
    setDisplayUrl(null)
    setCropping(false)
    onChange('')
  }

  const previewSrc = toPreviewSrc(value)
  const isEmbed = value.trim().startsWith('data:')
  const embedBytes = isEmbed ? onChainBytes(value) : 0
  const gas = estimateEmbedGas(embedBytes)
  const tone = embedBytes > WARN_BYTES ? styles.warn : embedBytes > OK_BYTES ? styles.caution : styles.ok
  const out = dims ? fitDims(dims.w, dims.h, edge) : null

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
          value={isEmbed ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste a link — ipfs://, ar://, or https://"
          disabled={isEmbed}
          aria-label={`${label} link`}
        />
        <span className={styles.or}>or</span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => fileRef.current?.click()}>
          Embed a file on-chain
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className={styles.hiddenFile}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {err && <p className={styles.error}>{err}</p>}

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
            {isEmbed ? (
              <>
                <span className={tone}>
                  On-chain · adds {humanBytes(embedBytes)} to your deploy · {humanGas(gas)} (
                  {humanEth(gas)} @ {REF_GWEI}gwei)
                </span>
                <span className={styles.scale}>
                  {embedBytes > WARN_BYTES
                    ? 'Very expensive — a large fraction of a block. Host it and paste a link instead.'
                    : embedBytes > OK_BYTES
                      ? 'Costly but doable. Crush it smaller or host it for a fraction of the gas.'
                      : 'Small enough to embed cheaply.'}
                </span>
                {hasSource && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCropping((c) => !c)}>
                    {cropping ? 'Close crop' : 'Crop'}
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>
                  Remove
                </button>
              </>
            ) : (
              <span className={styles.ok}>Link preview</span>
            )}
          </div>
        </div>
      )}

      {isEmbed && hasSource && cropping && displayUrl && bitmapRef.current && (
        <ImageCropper
          srcUrl={displayUrl}
          bitmap={bitmapRef.current}
          presets={aspect === 'wide' ? BANNER_PRESETS : COVER_PRESETS}
          onApply={(cropped) => {
            setWorking(cropped)
            setCropping(false)
          }}
          onCancel={() => setCropping(false)}
        />
      )}

      {/* Bitcrush controls — quality + resolution, live re-encode. */}
      {isEmbed && hasSource && !cropping && (
        <div className={styles.crush}>
          <div className={styles.crushRow}>
            <label className={styles.crushLabel} htmlFor={`${id}-q`}>
              Quality {Math.round(quality * 100)}%
            </label>
            <input
              id={`${id}-q`}
              className={styles.slider}
              type="range"
              min={20}
              max={95}
              step={5}
              value={Math.round(quality * 100)}
              onChange={(e) => setQuality(Number(e.target.value) / 100)}
            />
          </div>
          <div className={styles.crushRow}>
            <label className={styles.crushLabel} htmlFor={`${id}-e`}>
              Resolution {out ? `${out.w}×${out.h}px` : ''}
            </label>
            <input
              id={`${id}-e`}
              className={styles.slider}
              type="range"
              min={MIN_EDGE}
              max={maxEdge}
              step={1}
              value={edge}
              onChange={(e) => setEdge(Number(e.target.value))}
            />
          </div>
          <div className={styles.crushRow}>
            <span className={styles.crushLabel}>Fit to</span>
            <div className={styles.fitBtns}>
              {FIT_TARGETS.map((kb) => (
                <button key={kb} type="button" className="btn btn-sm btn-ghost" onClick={() => fitTo(kb)}>
                  {kb} KB
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
