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
import { type CurvePoint, curveParamsFromTuple, curvePriceAt, sampleCurve } from './curveSampler'
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

  const curve = useMemo<CurvePoint[] | undefined>(() => {
    if (curveParams === undefined) return undefined
    const params = curveParamsFromTuple(curveParams)
    const maxSupply =
      bondingView && bondingView.maxSupply > 0n
        ? Number(bondingView.maxSupply)
        : Number(params.normalizationFactor) * 10
    return sampleCurve(params, maxSupply, CURVE_SAMPLES)
  }, [curveParams, bondingView])

  const candles = useMemo<Candle[]>(() => aggregateCandles(trades.data), [trades.data])

  // "You are here": live supply + its curve price.
  const here = useMemo<CurvePoint | undefined>(() => {
    if (curveParams === undefined || bondingView === undefined) return undefined
    const params = curveParamsFromTuple(curveParams)
    const supply = Number(bondingView.totalBondingSupply)
    return { supply, price: curvePriceAt(params, supply) }
  }, [curveParams, bondingView])

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
      if (curve) drawCurve(ctx, ink, curve, here)
    } else {
      drawCandles(ctx, ink, candles)
    }
  }, [view, curve, candles, here])

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
  here: CurvePoint | undefined,
): void {
  const prices = points.map((p) => p.price)
  const minP = Math.min(...prices, here?.price ?? Infinity)
  const maxP = Math.max(...prices, here?.price ?? -Infinity)
  const minS = points[0]!.supply
  const maxS = points[points.length - 1]!.supply
  const spanS = maxS - minS || 1

  ctx.strokeStyle = ink.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  points.forEach((p, i) => {
    const x = PAD + ((CANVAS_W - 2 * PAD) * (p.supply - minS)) / spanS
    const y = plotY(p.price, minP, maxP)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  if (here) {
    const clampedS = Math.min(Math.max(here.supply, minS), maxS)
    const x = PAD + ((CANVAS_W - 2 * PAD) * (clampedS - minS)) / spanS
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
