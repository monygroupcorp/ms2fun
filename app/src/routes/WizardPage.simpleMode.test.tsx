/**
 * The wizard's simple mode, as a first-time ERC-404 creator meets it.
 *
 * Every chain read the wizard makes is answered here with a fixed value, so what is under test is
 * the page's own behaviour: which inputs it shows with Advanced settings off and on, that the
 * Uniswap V4 liquidity deployer arrives pre-selected, and that a creator who never opens Advanced
 * settings reaches Deploy and sends a create call built from the defaults.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CreateCall } from '../lib/wizard/submit'
import type { ModuleOption } from '../lib/wizard/useApprovedModules'
import { WizardPage } from './WizardPage'

// Hoisted: the module mocks below are lifted above every import and read these.
const { WALLET, VAULT, V4, ZERO, submitted, MODULES } = vi.hoisted(() => {
  const meta = (name: string, configType: string) => ({
    name,
    subtitle: '',
    description: '',
    badge: '',
    configType,
  })
  const V4 = '0x367039E2E64c9405213Ab077C130a5Df9e78466C' as const
  const ZAMM = '0x4B7a7485D974013e9553f2dcFd2F544822B9DC46' as const
  const TIER = '0x00000000000000000000000000000000000000a1' as const
  return {
    WALLET: '0x2222222222222222222222222222222222222222' as const,
    VAULT: '0x3333333333333333333333333333333333333333' as const,
    V4,
    ZAMM,
    TIER,
    ZERO: '0x0000000000000000000000000000000000000000' as const,
    submitted: { calls: [] as CreateCall[] },
    MODULES: {
      liquidity: [
        { address: ZAMM, meta: meta('ZAMM deployer', 'launch-profile') },
        { address: V4, meta: meta('Uniswap V4 deployer', 'launch-profile') },
      ],
      tier: [{ address: TIER, meta: meta('Token Tier resolver', 'metadata-tier') }],
    } as Record<string, ModuleOption[]>,
  }
})

vi.mock('../lib/addresses', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../lib/addresses')>()
  return {
    ...orig,
    // The committed local deployment is a zero placeholder; give this chain a V4 deployer.
    forkAddresses: { ...orig.forkAddresses, ModuleUniV4Deployer: V4 },
  }
})

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({ address: WALLET, isConnected: true }),
}))

vi.mock('../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generated/contracts')>()),
  useReadMasterRegistryV1IsAgent: () => ({ data: false }),
  useReadDeployBondEscrowBondAmount: () => ({ data: 0n }),
}))

vi.mock('../lib/wizard/useApprovedModules', () => ({
  useApprovedModules: (tag: string) => ({
    data: MODULES[tag] ?? [],
    isPending: false,
    isError: false,
  }),
}))

vi.mock('../components/wizard/useCreateSubmit', () => ({
  useCreateSubmit: () => ({
    submit: (call: CreateCall) => submitted.calls.push(call),
    instance: undefined,
    isPending: false,
    isConfirming: false,
    isSuccess: false,
    isError: false,
    reset: () => {},
  }),
}))
vi.mock('../components/wizard/useRegisteredVaults', () => ({
  useRegisteredVaults: () => ({
    data: [{ address: VAULT, name: 'Test' }],
    isPending: false,
    isError: false,
  }),
}))
vi.mock('../components/wizard/AlignmentTargetPicker', () => ({
  AlignmentTargetPicker: ({ onSelectVault }: { onSelectVault: (v: `0x${string}`) => void }) => (
    <button type="button" onClick={() => onSelectVault(VAULT)}>
      pick test vault
    </button>
  ),
}))
vi.mock('../components/wizard/useNameAvailability', () => ({
  useNameAvailability: () => ({ state: 'available' }),
}))
vi.mock('../components/wizard/usePresetSupplyCeiling', () => ({
  usePresetSupplyCeiling: () => ({
    ceiling: undefined,
    unitPerNFT: undefined,
    isPending: false,
    isError: false,
  }),
}))
vi.mock('../components/wizard/useDeployGasEstimate', () => ({
  useDeployGasEstimate: () => ({ gas: undefined, isLoading: false }),
}))
vi.mock('../components/wizard/useGasPriceGwei', () => ({
  useGasPriceGwei: () => ({ gwei: 1, isLive: false, isLoading: false }),
}))
vi.mock('../components/wizard/useSwapTithe', () => ({
  useSwapTithe: () => ({ kind: 'unknown' }),
}))
vi.mock('../components/wizard/CarveDisclosure', () => ({
  CarveDisclosure: () => <div data-testid="carve-disclosure" />,
}))
vi.mock('../components/wizard/BondNotice', () => ({ BondNotice: () => null }))
vi.mock('../components/wizard/CollectionHeroPreview', () => ({
  CollectionHeroPreview: () => null,
}))

beforeEach(() => {
  submitted.calls = []
})
afterEach(cleanup)

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WizardPage />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /ERC-404/ }))
}

/** The carve disclosure's number box (the field also renders a range slider). */
const carveInput = () => screen.queryByRole('spinbutton', { name: /creator carve/i })

const advancedSwitch = () => screen.getByRole('switch', { name: /advanced settings/i })

/** Jump straight to a step through the stepper rail. */
function goTo(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^\\d\\d\\s*${label}`, 'i') }))
}

test('Advanced settings are off by default and the advanced inputs are hidden', () => {
  mount()
  expect(advancedSwitch()).not.toBeChecked()

  // Contract step: no carve disclosure field, no carve preview.
  expect(carveInput()).toBeNull()
  expect(screen.queryByTestId('carve-disclosure')).toBeNull()
  expect(screen.getByLabelText(/^symbol/i)).toBeInTheDocument()

  // Modules step: staking only — no tiers, no overlay (and so no commission payout), no resolver.
  goTo('modules')
  expect(screen.getByText('Staking')).toBeInTheDocument()
  expect(screen.queryByText('Token Tiers')).toBeNull()
  expect(screen.queryByText('Artist overlay')).toBeNull()
  expect(screen.queryByText('Metadata resolver')).toBeNull()
  expect(screen.queryByText(/default commission payout/i)).toBeNull()
  expect(screen.queryByText(/weight/i)).toBeNull()
})

test('the Uniswap V4 liquidity deployer is pre-selected', () => {
  mount()
  goTo('liquidity')
  expect(screen.getByRole('button', { name: /uniswap v4 deployer/i })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: /zamm deployer/i })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('turning Advanced settings on reveals the carve, tier and overlay inputs', () => {
  mount()
  fireEvent.click(advancedSwitch())
  expect(advancedSwitch()).toBeChecked()

  expect(carveInput()).toBeInTheDocument()
  expect(screen.getByTestId('carve-disclosure')).toBeInTheDocument()

  goTo('modules')
  expect(screen.getByText('Token Tiers')).toBeInTheDocument()
  expect(screen.getByText('Artist overlay')).toBeInTheDocument()
  expect(screen.getByText('Metadata resolver')).toBeInTheDocument()
  // The tier copy says plainly that tiers are bundles, not price levels.
  expect(screen.getByText(/not a price level/i)).toBeInTheDocument()

  // Picking the tier module shows the weight ladder.
  fireEvent.click(screen.getByRole('button', { name: /token tier resolver/i }))
  expect(screen.getByText(/denomination \(coin units per nft\)/i)).toBeInTheDocument()
})

test('turning Advanced settings off keeps what was set and says so', () => {
  mount()
  fireEvent.click(advancedSwitch())
  fireEvent.change(carveInput()!, { target: { value: '2500' } })
  fireEvent.click(advancedSwitch())

  expect(carveInput()).toBeNull()
  expect(screen.getByTestId('advanced-in-effect')).toHaveTextContent(
    /still in effect: creator carve — declared max/i,
  )

  // Back on: the value is still there, not reset.
  fireEvent.click(advancedSwitch())
  expect(carveInput()).toHaveValue(2500)
  expect(screen.queryByTestId('advanced-in-effect')).toBeNull()
})

test('a first-time creator deploys without ever seeing tier, weight or commission fields', () => {
  mount()
  fireEvent.change(screen.getByLabelText(/^symbol/i), { target: { value: 'FIRST' } })
  fireEvent.change(screen.getByLabelText(/^nft supply/i), { target: { value: '1000' } })

  goTo('alignment')
  fireEvent.click(screen.getByRole('button', { name: /pick test vault/i }))

  goTo('collection page')
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'first-launch' } })

  goTo('review')
  expect(within(screen.getByTestId('review-advanced')).getByText('defaults')).toBeInTheDocument()
  expect(screen.queryByText(/before you can deploy/i)).toBeNull()
  expect(screen.queryByText(/weight|commission|token tiers/i)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /deploy collection/i }))

  expect(submitted.calls).toHaveLength(1)
  const call = submitted.calls[0]!
  if (call.type !== 'erc404') throw new Error(`expected an erc404 create, got ${call.type}`)
  expect(call.args).toHaveLength(5) // no metadata stack: no tiers, overlay or resolver
  const [params, , liquidity, gating, freeMint] = call.args
  expect(params.symbol).toBe('FIRST')
  expect(params.name).toBe('first-launch')
  expect(params.nftCount).toBe(1000n)
  expect(params.declaredMaxAllowanceBps).toBe(10_000)
  expect(params.vault).toBe(VAULT)
  expect(params.owner).toBe(WALLET)
  expect(liquidity).toBe(V4)
  expect(gating).toBe(ZERO)
  expect(freeMint).toEqual({ allocation: 0n, scope: 0 })
})

test('with no approved V4 deployer the slot is left empty and deploy says why', () => {
  const saved = MODULES.liquidity!
  MODULES.liquidity = [saved[0]!] // ZAMM only
  try {
    mount()
    goTo('liquidity')
    expect(screen.getByRole('button', { name: /zamm deployer/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    goTo('review')
    expect(screen.getByText(/choose a liquidity deployer/i)).toBeInTheDocument()
  } finally {
    MODULES.liquidity = saved
  }
})
