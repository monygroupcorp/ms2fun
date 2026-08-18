/**
 * BondingChart (W-B5) — a self-contained, dependency-free bonding chart for an ERC404 instance.
 * Two views, both rendered on a single <canvas> (no chart library):
 *
 *  - "curve":   the bonding PRICE curve derived from `curveParams` coefficients (see curveSampler),
 *               with a "you are here" dot plotted at the live `totalBondingSupply`.
 *  - "candles": OHLC candles aggregated (see candleAggregator) from indexed `BondingSale` events,
 *               price = cost / amount per trade, bucketed by block ranges with carry-forward gaps.
 *
 * Monochrome Gallery Brutalism: the canvas reads its ink/paper/grid colors from the resolved theme
 * CSS vars (so it follows light/dark), no gradients, no shadows, no radius.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { BondingView } from './bondingPhase'
import { type Candle, aggregateCandles } from './candleAggregator'
import {
  type CurveParams,
  type CurvePoint,
  type Viewport,
  computeViewport,
  curveParamsFromTuple,
  curvePriceAt,
  sampleCurve,
  sampleViewport,
} from './curveSampler'
import type { CurveParamsTuple } from './useBondingData'
import { useBondingTrades } from './useBondingTrades'
import styles from './BondingChart.module.css'

/** Mirrors the curve view shown by the surface; `pool` reuses the candle view post-graduation. */
export type BondingChartView = 'curve' | 'candles'

export interface BondingChartProps {
  instance: `0x${string}`
  curveParams: CurveParamsTuple | undefined
  view: BondingChartView
  decimals: number
  /** Live bonding view (for `totalBondingSupply` / `maxSupply`); optional for the candle-only path. */
  bondingView?: BondingView
}

const CANVAS_W = 600
const CANVAS_H = 260
const PAD = 28
const CURVE_SAMPLES = 80

// Full-curve minimap inset, top-left of the plot — the "where am I" signal. A hyperbola zoomed at a
// constant price ratio is self-similar, so the main plot's shape alone looks much the same at 5% and
// at 90% sold; the minimap is what actually distinguishes them, so it is sized as a first-class
// element rather than decoration. Every curve here rises monotonically toward the top-right, so the
// inset sits top-left, the one quadrant guaranteed empty across the whole bonding domain.
const MINI_W = 150
const MINI_H = 66
const MINI_PAD = 6
const MINI_X = PAD
const MINI_Y = PAD + 4

interface Ink {
  paper: string
  ink: string
  grid: string
  muted: string
}

function readInk(el: HTMLElement): Ink {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback
  return {
    paper: v('--bg-secondary', '#ffffff'),
    ink: v('--text-primary', '#000000'),
    grid: v('--border-tertiary', '#f0f0f0'),
    muted: v('--text-tertiary', '#999999'),
  }
}

export function BondingChart({
  instance,
  curveParams,
  view,
  decimals,
  bondingView,
}: BondingChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trades = useBondingTrades(instance, decimals)

  const params = useMemo<CurveParams | undefined>(
    () => (curveParams === undefined ? undefined : curveParamsFromTuple(curveParams)),
    [curveParams],
  )

  // Full curve over the whole bonding range [0, cap] — feeds the minimap, never the pole-adjacent
  // `maxSupply` domain (see curveSampler.bondingCap).
  const fullCurve = useMemo<CurvePoint[] | undefined>(() => {
    if (params === undefined) return undefined
    return sampleCurve(params, CURVE_SAMPLES)
  }, [params])

  const candles = useMemo<Candle[]>(() => aggregateCandles(trades.data), [trades.data])

  // "You are here": live supply + its curve price.
  const here = useMemo<CurvePoint | undefined>(() => {
    if (params === undefined || bondingView === undefined) return undefined
    const supply = Number(bondingView.totalBondingSupply)
    return { supply, price: curvePriceAt(params, supply) }
  }, [params, bondingView])

  // Adaptive viewport: holds the visible price span constant and slides/pins with position.
  const viewport = useMemo<Viewport | undefined>(() => {
    if (params === undefined || here === undefined) return undefined
    return computeViewport(params, here.supply)
  }, [params, here])

  // The windowed samples the main plot draws — the viewport's clamped supply domain, not the whole
  // curve. Falls back to the full curve when there is no live position to window around.
  const windowed = useMemo<CurvePoint[] | undefined>(() => {
    if (params === undefined) return undefined
    if (viewport === undefined) return fullCurve
    return sampleViewport(params, viewport, CURVE_SAMPLES)
  }, [params, viewport, fullCurve])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ink = readInk(canvas)

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.fillStyle = ink.paper
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    drawAxes(ctx, ink)

    if (view === 'curve') {
      if (windowed && viewport) {
        drawCurve(ctx, ink, windowed, viewport, here)
        if (fullCurve) drawMinimap(ctx, ink, fullCurve, viewport, here)
      } else if (windowed) {
        // No live position (candle-only path never reaches here in practice, but bondingView is
        // an optional prop) — draw the raw curve with no window/minimap.
        drawCurve(
          ctx,
          ink,
          windowed,
          {
            loSupply: windowed[0]?.supply ?? 0,
            hiSupply: windowed[windowed.length - 1]?.supply ?? 0,
            loPrice: windowed[0]?.price ?? 0,
            hiPrice: windowed[windowed.length - 1]?.price ?? 0,
            graduationPrice: windowed[windowed.length - 1]?.price ?? 0,
            graduationInView: true,
          },
          here,
        )
      }
    } else {
      drawCandles(ctx, ink, candles)
    }
  }, [view, windowed, viewport, fullCurve, candles, here])

  const isCurve = view === 'curve'

  return (
    <div className={styles.chart} data-testid="erc404-chart">
      <div className={styles.header}>
        <p className={styles.title}>{isCurve ? 'bonding curve' : 'price candles'}</p>
        <span className={styles.meta}>
          {isCurve
            ? here
              ? `price ${formatPrice(here.price)} ETH`
              : 'price model'
            : `${trades.data.length} trades`}
        </span>
      </div>

      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={CANVAS_W}
          height={CANVAS_H}
          data-testid={isCurve ? 'erc404-curve' : 'erc404-candles'}
        />
      </div>

      {isCurve ? (
        curveParams === undefined ? (
          <p className={styles.note}>curve params unavailable.</p>
        ) : (
          <div className={styles.legend}>
            <span>x: supply</span>
            <span>y: price (ETH)</span>
            {here && <span>● you are here</span>}
          </div>
        )
      ) : trades.isPending ? (
        <p className={styles.note}>indexing trades…</p>
      ) : candles.length === 0 ? (
        <p className={styles.note}>no trades yet — candles appear after the first buy.</p>
      ) : (
        <div className={styles.legend}>
          <span>x: blocks</span>
          <span>y: price (cost / amount)</span>
        </div>
      )}
    </div>
  )
}

// ---- Canvas drawing (pure functions of ctx + data) -----------------------------------------------

function drawAxes(ctx: CanvasRenderingContext2D, ink: Ink): void {
  ctx.strokeStyle = ink.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, PAD)
  ctx.lineTo(PAD, CANVAS_H - PAD)
  ctx.lineTo(CANVAS_W - PAD, CANVAS_H - PAD)
  ctx.stroke()
}

function plotY(value: number, min: number, max: number): number {
  const span = max - min || 1
  const t = (value - min) / span
  return CANVAS_H - PAD - (CANVAS_H - 2 * PAD) * t
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  points: CurvePoint[],
  viewport: Viewport,
  here: CurvePoint | undefined,
): void {
  const minS = viewport.loSupply
  const maxS = viewport.hiSupply
  const minP = viewport.loPrice
  const maxP = viewport.hiPrice
  const spanS = maxS - minS || 1

  const plotX = (supply: number): number => PAD + ((CANVAS_W - 2 * PAD) * (supply - minS)) / spanS

  ctx.strokeStyle = ink.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  points.forEach((p, i) => {
    const x = plotX(p.supply)
    const y = plotY(p.price, minP, maxP)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  if (here) {
    const clampedS = Math.min(Math.max(here.supply, minS), maxS)
    const x = plotX(clampedS)
    const y = plotY(here.price, minP, maxP)
    ctx.fillStyle = ink.ink
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
    // Outline ring in paper color for contrast on either theme.
    ctx.strokeStyle = ink.paper
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Graduation must never be hidden: mark it in-window when visible, otherwise pin a labelled arrow
  // to the right edge so the price traders most want is never off-canvas.
  ctx.font = '10px monospace'
  ctx.fillStyle = ink.muted
  if (viewport.graduationInView) {
    const x = plotX(maxS)
    const y = plotY(viewport.graduationPrice, minP, maxP)
    ctx.beginPath()
    ctx.moveTo(x - 5, y - 5)
    ctx.lineTo(x, y)
    ctx.lineTo(x - 5, y + 5)
    ctx.strokeStyle = ink.muted
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillText(`grad @ ${formatPrice(viewport.graduationPrice)}`, PAD + 4, PAD + 10)
  } else {
    ctx.textAlign = 'right'
    ctx.fillText(`grad @ ${formatPrice(viewport.graduationPrice)} →`, CANVAS_W - PAD - 2, PAD + 10)
    ctx.textAlign = 'left'
  }
}

/**
 * Full-curve inset: the whole `[0, cap]` curve with the visible window shaded and the live position
 * dotted. Load-bearing (not decoration) — a hyperbola at constant-ratio zoom is self-similar, so the
 * main plot's shape alone cannot tell 5% sold from 90% sold; this is what does.
 */
function drawMinimap(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  fullCurve: CurvePoint[],
  viewport: Viewport,
  here: CurvePoint | undefined,
): void {
  const minS = fullCurve[0]!.supply
  const maxS = fullCurve[fullCurve.length - 1]!.supply
  const spanS = maxS - minS || 1
  const prices = fullCurve.map((p) => p.price)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)

  const x0 = MINI_X
  const y0 = MINI_Y
  const innerX = (supply: number): number =>
    x0 + MINI_PAD + ((MINI_W - 2 * MINI_PAD) * (supply - minS)) / spanS
  const innerY = (price: number): number => {
    const span = maxP - minP || 1
    const t = (price - minP) / span
    return y0 + MINI_H - MINI_PAD - (MINI_H - 2 * MINI_PAD) * t
  }

  ctx.fillStyle = ink.paper
  ctx.fillRect(x0, y0, MINI_W, MINI_H)
  ctx.strokeStyle = ink.grid
  ctx.lineWidth = 1
  ctx.strokeRect(x0, y0, MINI_W, MINI_H)

  // Shade the visible window.
  const wx0 = innerX(viewport.loSupply)
  const wx1 = innerX(viewport.hiSupply)
  ctx.fillStyle = ink.grid
  ctx.fillRect(wx0, y0 + MINI_PAD, Math.max(1, wx1 - wx0), MINI_H - 2 * MINI_PAD)

  // The full curve.
  ctx.strokeStyle = ink.muted
  ctx.lineWidth = 1.5
  ctx.beginPath()
  fullCurve.forEach((p, i) => {
    const x = innerX(p.supply)
    const y = innerY(p.price)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  if (here) {
    const x = innerX(Math.min(Math.max(here.supply, minS), maxS))
    const y = innerY(here.price)
    ctx.fillStyle = ink.ink
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawCandles(ctx: CanvasRenderingContext2D, ink: Ink, candles: Candle[]): void {
  if (candles.length === 0) return
  let minP = Infinity
  let maxP = -Infinity
  for (const c of candles) {
    if (c.low < minP) minP = c.low
    if (c.high > maxP) maxP = c.high
  }
  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) return

  const n = candles.length
  const slot = (CANVAS_W - 2 * PAD) / n
  const bodyW = Math.max(2, slot * 0.6)

  candles.forEach((c, i) => {
    const center = PAD + slot * (i + 0.5)
    const yHigh = plotY(c.high, minP, maxP)
    const yLow = plotY(c.low, minP, maxP)
    const yOpen = plotY(c.open, minP, maxP)
    const yClose = plotY(c.close, minP, maxP)

    const up = c.close >= c.open
    ctx.strokeStyle = ink.ink
    ctx.fillStyle = up ? ink.paper : ink.ink

    // Wick.
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(center, yHigh)
    ctx.lineTo(center, yLow)
    ctx.stroke()

    // Body — filled (down) or hollow (up); flat dojis (gaps) render as a 1px bar.
    const top = Math.min(yOpen, yClose)
    const h = Math.max(1, Math.abs(yClose - yOpen))
    const x = center - bodyW / 2
    if (c.trades === 0) {
      // Carried-forward gap: a faint flat line at the carried price.
      ctx.strokeStyle = ink.muted
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x + bodyW, top)
      ctx.stroke()
    } else {
      ctx.fillRect(x, top, bodyW, h)
      ctx.strokeRect(x, top, bodyW, h)
    }
  })
}

function formatPrice(p: number): string {
  if (p === 0) return '0'
  if (p < 1e-6) return p.toExponential(2)
  return p.toPrecision(4)
}
