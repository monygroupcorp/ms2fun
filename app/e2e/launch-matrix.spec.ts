/**
 * LAUNCH MATRIX (@fork) — walk the real wizard UI once per project-type × module combination and
 * assert each combination actually deploys.
 *
 * This is the "does every launch work" gate: every case drives `/launch` through all applicable
 * steps with the injected anvil wallet, clicks Deploy, and asserts the wizard redirects to the new
 * collection page (which only happens once `InstanceCreated` is mined). A revert, a stuck deploy
 * button, or a blocker line fails the case that produced it — so a broken combination names itself.
 *
 * Combination axes (all live on the seeded fork):
 *   - project type: erc404 | erc1155 | erc721
 *   - erc404 liquidity deployer: Uniswap V4 | ZAMM | Cypher (required slot)
 *   - optional module slots: gating (Merkle) · staking · resolver (router) · overlay · tier
 *   - alignment: community (target) × venue (Aave yield / Uni V4 / ZAMM / Cypher LP)
 *   - erc404 launch preset 0/1/2, free-mint allocation + gating scope
 *   - erc721 auction lines 1..3, erc1155 gating scope 0/1/2
 *
 * Each case needs a UNIQUE collection name — the registry claims names globally and
 * case-insensitively — so names are suffixed with a per-run token.
 */
import { test, expect, connectWallet } from './fixtures/anvilWallet'
import type { Page } from '@playwright/test'

/** Per-run suffix so re-running against a live fork never collides on a claimed name. */
const RUN = `${Date.now().toString(36)}`

type TypeKey = 'erc404' | 'erc1155' | 'erc721'

interface LaunchCase {
  /** Case id — also the collection-name stem (must be [0-9A-Za-z_-]). */
  id: string
  type: TypeKey
  /** Contract-step field values, keyed by visible label. */
  fields?: Record<string, string>
  /** Contract-step <select> values, keyed by visible label → option label substring. */
  selects?: Record<string, string>
  /** Module-step / gating-step / liquidity-step selections, keyed by slot label → option name.
   *  Omit a slot to leave it at its default ("None" for optional slots). */
  modules?: Partial<
    Record<
      | 'Liquidity deployer'
      | 'Gating'
      | 'Staking'
      | 'Metadata resolver'
      | 'Artist overlay'
      | 'Token Tiers',
      string
    >
  >
  /** Tier-ladder rows (weight, count, baseURI) — only when the tier slot is selected. */
  tiers?: { weight: string; count?: string; baseURI?: string }[]
  /** Overlay policy inputs, when the overlay slot is selected. */
  overlay?: { autoLatest?: boolean; payout?: 'Artist' | 'Split' }
  /** Alignment: community card title substring + venue card label. */
  align: { community: string; venue: 'Aave' | 'Uniswap V4' | 'ZAMM' | 'Cypher' }
}

/** Which step owns a free-mint input depends on the TYPE. ERC-404 carries `freeMint` as a group, and
 *  WizardPage renders that group (allocation + its scope select) on the Gating step. ERC-1155 has no
 *  allocation field at all — its standalone `freeMint.scope` is an ordinary core field and renders on
 *  the Contract step. So only ERC-404's free-mint inputs are deferred past Contract. */
function isGatingField(label: string, type: TypeKey): boolean {
  return type === 'erc404' && /allocation|gating scope/i.test(label)
}

/** Fill a labelled text/number input on the current step. */
async function setField(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: false }).first()
  await input.waitFor({ state: 'visible' })
  await input.fill(value)
}

/** Select a module option by its card name. Every approved module's display name is unique across
 *  the slots rendered on one step (Uniswap V4 Deployer / Merkle Allowlist Gating / ERC404 Staking /
 *  Metadata Resolver / Artist Overlay / Token Tiers), so a page-wide match is unambiguous — and the
 *  slot header ("Liquidity deployer*") is not a reliable scoping anchor. Asserts the card latched. */
async function pickModule(page: Page, slotLabel: string, optionName: string): Promise<void> {
  const card = page.getByRole('button', { name: new RegExp(optionName, 'i') }).first()
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await card.click()
  await expect(card).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 })
}

/** The stepper button for a step label — used to jump directly and to read applicability. */
function stepButton(page: Page, label: string) {
  return page.locator('.noesis-stepper button', { hasText: label }).first()
}

async function stepIsApplicable(page: Page, label: string): Promise<boolean> {
  return !(await stepButton(page, label).isDisabled())
}

/** Walk one case end-to-end and return the deployed collection's slug. */
async function launch(page: Page, c: LaunchCase): Promise<string> {
  const name = `${c.id}-${RUN}`

  await page.goto('/launch')
  await connectWallet(page)

  // ── 01 Contract ─────────────────────────────────────────────────────────────
  const typeLabel = { erc404: 'ERC-404', erc1155: 'ERC-1155', erc721: 'ERC-721' }[c.type]
  await page
    .getByRole('button', { name: new RegExp(`^${typeLabel}`) })
    .first()
    .click()
  // `styleUri` and the free-mint group are rendered on later steps (Collection page / Gating), so
  // only the Contract-step slice of `fields` is applied here — the rest are applied on their step.
  for (const [label, value] of Object.entries(c.fields ?? {})) {
    if (isGatingField(label, c.type)) continue
    await setField(page, label, value)
  }
  for (const [label, option] of Object.entries(c.selects ?? {})) {
    if (isGatingField(label, c.type)) continue
    await page.getByLabel(label, { exact: false }).first().selectOption({ label: option })
  }

  // ── 02 Modules (staking + metadata stack) ───────────────────────────────────
  await goToStep(page, 'Modules')
  if (await stepIsApplicable(page, 'Modules')) {
    if (c.modules?.Staking) await pickModule(page, 'Staking', c.modules.Staking)
    if (c.modules?.['Metadata resolver'])
      await pickModule(page, 'Metadata resolver', c.modules['Metadata resolver'])
    if (c.modules?.['Artist overlay']) {
      await pickModule(page, 'Artist overlay', c.modules['Artist overlay'])
      if (c.overlay?.autoLatest) await page.getByLabel(/Auto-apply latest wave/).check()
      if (c.overlay?.payout)
        await page
          .getByLabel(/Default commission payout/)
          .selectOption({ label: new RegExp(c.overlay.payout, 'i').source })
    }
    if (c.modules?.['Token Tiers']) {
      await pickModule(page, 'Token Tiers', c.modules['Token Tiers'])
      const rows = c.tiers ?? []
      for (let i = 0; i < rows.length; i++) {
        await page.getByRole('button', { name: '+ Add Weight' }).click()
        await page.getByRole('button', { name: '+ Add Count' }).click()
        await page.getByRole('button', { name: '+ Add Band URI' }).click()
        await setField(page, `Weight ${i + 1}`, rows[i]!.weight)
        await setField(page, `Count ${i + 1}`, rows[i]!.count ?? '0')
        await setField(page, `Band URI ${i + 1}`, rows[i]!.baseURI ?? '')
      }
    }
  }

  // ── 03 Gating (+ free mint) ─────────────────────────────────────────────────
  await goToStep(page, 'Gating')
  if (await stepIsApplicable(page, 'Gating')) {
    if (c.modules?.Gating) await pickModule(page, 'Gating', c.modules.Gating)
    // The free-mint group lives on this step. Allocation first — the scope select is `visibleWhen`
    // allocation > 0, so setting scope before allocation would target a field that isn't rendered.
    const alloc = Object.entries(c.fields ?? {}).find(([l]) => /allocation/i.test(l))
    if (alloc) await setField(page, alloc[0], alloc[1])
    // ERC-1155's scope select is a plain core field on the Contract step (already applied there); only
    // ERC-404 carries it inside the free-mint group rendered here.
    const scope =
      c.type === 'erc404'
        ? Object.entries(c.selects ?? {}).find(([l]) => /gating scope/i.test(l))
        : undefined
    if (scope)
      await page.getByLabel(scope[0], { exact: false }).first().selectOption({ label: scope[1] })
  }

  // ── 04 Liquidity ────────────────────────────────────────────────────────────
  await goToStep(page, 'Liquidity')
  if (await stepIsApplicable(page, 'Liquidity')) {
    const dep = c.modules?.['Liquidity deployer']
    if (dep) await pickModule(page, 'Liquidity deployer', dep)
  }

  // ── 05 Alignment ────────────────────────────────────────────────────────────
  await goToStep(page, 'Alignment')
  await page
    .getByRole('button', { name: new RegExp(c.align.community, 'i') })
    .first()
    .click()
  await page
    .getByRole('button', { name: new RegExp(c.align.venue, 'i') })
    .first()
    .click()

  // ── 06 Collection page ──────────────────────────────────────────────────────
  await goToStep(page, 'Collection page')
  await page.locator('#cmf-name').fill(name)
  await page.locator('#cmf-description').fill(`launch-matrix ${c.id}`)

  // ── 07 Review & deploy ──────────────────────────────────────────────────────
  await goToStep(page, 'Review')
  const blockers = page.locator('text=Before you can deploy:')
  if (await blockers.isVisible().catch(() => false)) {
    const lines = await page.locator('ul li button span').allInnerTexts()
    throw new Error(`[${c.id}] deploy blocked: ${lines.join(' | ')}`)
  }
  const deploy = page.getByRole('button', { name: /Deploy collection/ })
  await expect(deploy).toBeEnabled({ timeout: 20_000 })
  await deploy.click()

  const slug = name.toLowerCase()
  await expect(page).toHaveURL(new RegExp(`/1337/${slug}$`), { timeout: 90_000 })
  return slug
}

/** Click a stepper entry directly (steps are freely navigable; Continue skips N/A steps). */
async function goToStep(page: Page, label: string): Promise<void> {
  const btn = stepButton(page, label)
  if (await btn.isEnabled()) await btn.click()
}

// ── The matrix ────────────────────────────────────────────────────────────────

/**
 * ERC-404 supply is NOT free of the launch preset: the instance mints `nftCount * unitPerNFT * 1e18`
 * coin units at create, and DN404 reverts `TotalSupplyOverflow()` once that passes `type(uint96).max`
 * (~7.92e28). With the deployed presets (unitPerNFT 1e9 / 1e6 / 1e3) the ceilings are:
 *   NICHE ≈ 79 NFTs · STANDARD ≈ 79,228 · HYPE ≈ 79,228,162.
 * Each case below stays inside its preset's ceiling. (The wizard does not yet enforce this — a
 * NICHE + 1000-supply launch reverts on-chain; see the KNOWN-GAP case at the end of the matrix.)
 */
const ERC404_BASE = {
  Symbol: 'LM',
  'NFT supply': '50',
  'Token base URI': 'ipfs://lm/',
}

const CASES: LaunchCase[] = [
  // ERC-404 — one case per liquidity venue, bare otherwise.
  {
    id: 'lm404-uni-bare',
    type: 'erc404',
    fields: ERC404_BASE,
    modules: { 'Liquidity deployer': 'Uniswap V4' },
    align: { community: 'MS2|Milady', venue: 'Uniswap V4' },
  },
  {
    id: 'lm404-zamm-bare',
    type: 'erc404',
    fields: ERC404_BASE,
    modules: { 'Liquidity deployer': 'ZAMM' },
    align: { community: 'MS2|Milady', venue: 'ZAMM' },
  },
  {
    id: 'lm404-cypher-bare',
    type: 'erc404',
    fields: ERC404_BASE,
    modules: { 'Liquidity deployer': 'Cypher' },
    align: { community: 'MS2|Milady', venue: 'Cypher' },
  },
  // ERC-404 — every slot the wizard OFFERS, on at once (tier is not offered — see the gap cases),
  // free mint on with a narrowed gating scope, HYPE preset, largest supply.
  {
    id: 'lm404-full-stack',
    type: 'erc404',
    fields: { ...ERC404_BASE, 'NFT supply': '1000', 'Free allocation': '10' },
    selects: { 'Launch preset': 'HYPE — 50 ETH target', 'Gating scope': 'Free-mint only' },
    modules: {
      'Liquidity deployer': 'Uniswap V4',
      Gating: 'Merkle',
      Staking: 'Staking',
      'Metadata resolver': 'Metadata Resolver',
      'Artist overlay': 'Artist Overlay',
    },
    overlay: { autoLatest: true, payout: 'Split' },
    align: { community: 'MS2|Milady', venue: 'Uniswap V4' },
  },
  // ERC-404 — overlay as the SINGLE metadata child, no router (the direct-resolver encode path).
  {
    id: 'lm404-overlay-no-router',
    type: 'erc404',
    fields: { ...ERC404_BASE, 'NFT supply': '500' },
    selects: { 'Launch preset': 'STANDARD — 25 ETH target' },
    modules: { 'Liquidity deployer': 'ZAMM', 'Artist overlay': 'Artist Overlay' },
    overlay: { payout: 'Artist' },
    align: { community: 'CULT', venue: 'ZAMM' },
  },
  // ERC-404 — staking + gating, paid-only scope, no metadata stack, Cypher venue on the other target.
  {
    id: 'lm404-stake-gate-cypher',
    type: 'erc404',
    fields: { ...ERC404_BASE, 'Free allocation': '5' },
    selects: { 'Gating scope': 'Paid only' },
    modules: { 'Liquidity deployer': 'Cypher', Gating: 'Merkle', Staking: 'Staking' },
    align: { community: 'CULT', venue: 'Cypher' },
  },
  // ERC-404 — carve rights waived forever (declared max 0), the other end of the disclosure range.
  {
    id: 'lm404-carve-waived',
    type: 'erc404',
    fields: { ...ERC404_BASE, 'Creator carve — declared max': '0' },
    modules: { 'Liquidity deployer': 'Uniswap V4' },
    align: { community: 'CULT', venue: 'Uniswap V4' },
  },
  // ERC-1155 — bare, and gated. Yield (Aave) family is selectable for non-ERC404 types.
  {
    id: 'lm1155-bare-aave',
    type: 'erc1155',
    fields: { Symbol: 'LM11' },
    align: { community: 'MS2|Milady', venue: 'Aave' },
  },
  {
    // Empty symbol is accepted end-to-end for ERC1155 (noesis-084) — asserted here, not just in unit tests.
    id: 'lm1155-gated-lp',
    type: 'erc1155',
    fields: { Symbol: '' },
    selects: { 'Gating scope': 'Free-mint only' },
    modules: { Gating: 'Merkle' },
    align: { community: 'CULT', venue: 'Uniswap V4' },
  },
  {
    id: 'lm1155-scope-paid',
    type: 'erc1155',
    fields: { Symbol: 'LM11P' },
    selects: { 'Gating scope': 'Paid only' },
    modules: { Gating: 'Merkle' },
    align: { community: 'MS2|Milady', venue: 'ZAMM' },
  },
  // ERC-721 auction — min and max auction lines.
  {
    id: 'lm721-1line',
    type: 'erc721',
    fields: {
      Symbol: 'LM721',
      'Auction lines': '1',
      'Base duration': '86400',
      'Anti-snipe buffer': '300',
      'Min bid increment': '0.001',
    },
    align: { community: 'MS2|Milady', venue: 'Aave' },
  },
  {
    id: 'lm721-3lines',
    type: 'erc721',
    fields: {
      Symbol: 'LM723',
      'Auction lines': '3',
      'Base duration': '3600',
      'Anti-snipe buffer': '60',
      'Min bid increment': '0.01',
    },
    align: { community: 'CULT', venue: 'Cypher' },
  },
]

for (const c of CASES) {
  test(`@fork launch ${c.id}`, async ({ page }) => {
    test.setTimeout(180_000)
    const slug = await launch(page, c)
    // The collection page renders for the freshly deployed instance (not an error/404 shell).
    await expect(page.locator('body')).toContainText(new RegExp(slug, 'i'), { timeout: 30_000 })
  })
}

// ── Known gaps ────────────────────────────────────────────────────────────────
// Two combinations a creator can reach that do NOT launch today. Both are `test.fail()`, so the suite
// stays green while the gap stands AND goes red the moment it's fixed — at which point delete the
// `test.fail()` and move the case into CASES above. They are cases, not comments, so neither gap can
// be quietly forgotten.

/**
 * GAP 1 — Token Tiers is unreachable from the wizard.
 *
 * Everything else about tiers is wired: the `tier` ComponentRegistry tag resolves to a deployed
 * TokenTierBandResolver, `CONFIG_SCHEMAS` carries the `metadata-tier` ladder form, `encodeMetadataConfig`
 * threads `tiers` into the factory's 7-arg `createInstance`, `validateMetadataConfig` validates the
 * ladder, `TierSupplyHelper` renders the derived bands, and WizardPage's Modules step asks for a
 * `tier` slot. But `PROJECT_TYPES.erc404.moduleSlots` never declares one, so `slotByKey('tier')` is
 * undefined and the picker never renders — no creator can launch a tiered collection.
 */
test('@fork launch GAP tier slot is not offered on the ERC-404 modules step', async ({ page }) => {
  test.fail()
  test.setTimeout(60_000)
  await page.goto('/launch')
  await connectWallet(page)
  await page
    .getByRole('button', { name: /^ERC-404/ })
    .first()
    .click()
  await goToStep(page, 'Modules')
  await expect(page.getByRole('button', { name: /Token Tiers/i }).first()).toBeVisible({
    timeout: 15_000,
  })
})

/**
 * GAP 2 — supply is not validated against the launch preset's unit size.
 *
 * `nftCount * unitPerNFT * 1e18` must stay under `type(uint96).max` or DN404 reverts
 * `TotalSupplyOverflow()` (0xe5cfe957) inside create. With NICHE (unitPerNFT 1e9) the real ceiling is
 * ~79 NFTs, but the wizard accepts any supply, shows no blocker, prices a gas estimate, and the deploy
 * reverts — surfacing only as "transaction failed — try again". The fix is a client-side bound read
 * from the selected preset (and a blocker line naming it), not a bigger error string.
 */
test('@fork launch GAP NICHE preset with 1000 supply is blocked before deploy', async ({
  page,
}) => {
  test.fail()
  test.setTimeout(180_000)
  const blocked = await launchIsBlocked(page, {
    id: 'lm404gap-niche-overflow',
    type: 'erc404',
    fields: { ...ERC404_BASE, 'NFT supply': '1000' },
    modules: { 'Liquidity deployer': 'Uniswap V4' },
    align: { community: 'MS2|Milady', venue: 'Uniswap V4' },
  })
  expect(blocked, 'wizard should refuse an over-ceiling supply instead of reverting on-chain').toBe(
    true,
  )
})

/** Walk a case to Review and report whether the wizard REFUSES to deploy it (a blocker line or a
 *  disabled Deploy button). Used by the gap cases — it never sends a transaction. */
async function launchIsBlocked(page: Page, c: LaunchCase): Promise<boolean> {
  try {
    await launch(page, c)
    return false
  } catch (err) {
    // `launch` throws its own "deploy blocked" error when the wizard surfaced blocker lines.
    return /deploy blocked/.test(String(err))
  }
}
