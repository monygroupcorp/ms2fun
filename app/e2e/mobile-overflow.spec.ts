/**
 * @fork — mobile layout guard. At a 375px viewport, NO element may extend past the viewport's right
 * edge. We scan every element's rect rather than the document scrollWidth, because `.app` has
 * `overflow-x: clip` (which hides page-level overflow but the offending element still overflows its
 * track — the real symptom). Guards the flex/grid "min-width:auto won't shrink" bug class across all
 * public surfaces. See docs/DESIGN_SYSTEM_V2.md.
 */
import { test, expect } from '@playwright/test'

const MOBILE = { width: 375, height: 812 }

/** Return distinct selectors for elements whose right edge exceeds the viewport (1px tolerance). */
async function overflowingElements(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const bad = new Set<string>()
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 && r.width > 1) {
        bad.add(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)}`)
      }
    }
    return [...bad].slice(0, 10)
  })
}

async function expectNoOverflow(page: import('@playwright/test').Page, where: string) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  expect(await overflowingElements(page), `elements overflowing 375px on ${where}`).toEqual([])
}

// Surfaces reachable without a wallet (connect-gated pages still render an empty/prompt state).
const ROUTES = ['/', '/collections', '/board', '/launch', '/portfolio', '/admin', '/exec404']

for (const route of ROUTES) {
  test(`no horizontal overflow at 375px: ${route} @fork`, async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto(route)
    await expectNoOverflow(page, route)
  })
}

test('no horizontal overflow at 375px: collection detail @fork', async ({ page }) => {
  await page.setViewportSize(MOBILE)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const card = page.locator('a[href^="/collection/"]').first()
  test.skip((await card.count()) === 0, 'no seeded collections to open')
  await card.click()
  await page.waitForURL(/\/collection\/0x[0-9a-fA-F]{40}/)
  await expectNoOverflow(page, 'collection detail')
})
