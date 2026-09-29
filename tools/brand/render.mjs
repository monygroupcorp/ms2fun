// Renders the noesis brand assets from cards.html (stills) and scene.html (the motion piece).
//
// The scene is driven by an explicit `window.setT(seconds)` rather than CSS animation, so every
// frame is deterministic: seeking to t always produces the same pixels, and a re-render a month
// from now is byte-comparable. Frames go to out/frames/ for ffmpeg to encode; see README.md.
//
//   node tools/brand/render.mjs
//   ffmpeg -framerate 30 -i out/frames/%04d.png -c:v libx264 -crf 17 -pix_fmt yuv420p out.mp4
//
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, 'out')
const frames = path.join(out, 'frames')
fs.mkdirSync(frames, { recursive: true })

const CARDS = [
  ['c-claim',       'noesis-claim-1600x900'],
  ['c-split',       'noesis-split-1600x900'],
  ['c-live',        'noesis-live-1600x900'],
  ['c-square',      'noesis-claim-1080x1080'],
  ['c-square-live', 'noesis-live-1080x1080'],
  ['c-header',      'noesis-header-1500x500'],
]

const FPS = 30
const DUR = 12.4

// PLAYWRIGHT_CHROMIUM lets a box whose installed browser revision does not match the pinned
// playwright render anyway, instead of downloading a second copy of Chromium to disagree with.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined
const browser = await chromium.launch(executablePath ? { executablePath } : {})

// ── still cards ────────────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 2 })
  await page.goto('file://' + path.join(here, 'cards.html'))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)
  for (const [id, name] of CARDS) {
    await page.locator('#' + id).screenshot({ path: path.join(out, name + '.png') })
    console.log('card  ' + name + '.png')
  }
  await page.close()
}

// ── motion frames ──────────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  await page.goto('file://' + path.join(here, 'scene.html'))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)
  const total = Math.round(DUR * FPS)
  for (let i = 0; i < total; i++) {
    const t = i / FPS
    await page.evaluate((tt) => window.setT(tt), t)
    await page.screenshot({ path: path.join(frames, String(i).padStart(4, '0') + '.png') })
    if (i % 60 === 0) console.log('frame ' + i + '/' + total)
  }
  console.log('frames ' + total)
  await page.close()
}

await browser.close()
