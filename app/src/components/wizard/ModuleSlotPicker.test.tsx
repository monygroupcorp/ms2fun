import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ModuleSlot } from '@/lib/wizard/schema'
import type { ModuleOption } from '@/lib/wizard/useApprovedModules'
import { ModuleSlotPicker } from './ModuleSlotPicker'

// Mock the on-chain module list so the render is deterministic and needs no query client.
const mockUseApprovedModules = vi.hoisted(() =>
  vi.fn<() => { data: ModuleOption[] | undefined; isPending: boolean; isError: boolean }>(),
)
vi.mock('../../lib/wizard/useApprovedModules', () => ({
  useApprovedModules: mockUseApprovedModules,
}))

afterEach(() => {
  cleanup()
  mockUseApprovedModules.mockReset()
})

const slot: ModuleSlot = {
  key: 'gating',
  label: 'Gating',
  tag: 'gating',
  required: false,
}

function meta(configType: string): ModuleOption['meta'] {
  return { name: `mod ${configType}`, subtitle: '', description: '', badge: '', configType }
}

const MAPPED: ModuleOption = {
  address: '0x0000000000000000000000000000000000000001',
  meta: meta('password-tier-gating'),
}
// A configType with no entry in MODULE_CONCEPT_BY_CONFIG_TYPE (synthetic, so it stays unmapped
// even as real modules get wired — e.g. metadata-overlay was wired in noesis-049).
const UNMAPPED: ModuleOption = {
  address: '0x0000000000000000000000000000000000000002',
  meta: meta('no-such-mapped-config-type'),
}

test('a known configType card renders a LearnLink to its /learn concept', () => {
  mockUseApprovedModules.mockReturnValue({ data: [MAPPED], isPending: false, isError: false })
  render(<ModuleSlotPicker slot={slot} value={undefined} onChange={vi.fn()} />)
  const link = screen.getByRole('link', { name: /learn how this works/i })
  expect(link).toHaveAttribute('href', '/learn/password-tier-gating')
  expect(link).toHaveAttribute('target', '_blank')
})

test('an unmapped configType card renders no LearnLink', () => {
  mockUseApprovedModules.mockReturnValue({ data: [UNMAPPED], isPending: false, isError: false })
  render(<ModuleSlotPicker slot={slot} value={undefined} onChange={vi.fn()} />)
  expect(screen.queryByRole('link', { name: /learn how this works/i })).not.toBeInTheDocument()
})

test('clicking the card LearnLink does not select the card', () => {
  const onChange = vi.fn()
  mockUseApprovedModules.mockReturnValue({ data: [MAPPED], isPending: false, isError: false })
  render(<ModuleSlotPicker slot={slot} value={undefined} onChange={onChange} />)
  fireEvent.click(screen.getByRole('link', { name: /learn how this works/i }))
  expect(onChange).not.toHaveBeenCalled()
})

test('clicking the card body still selects the module', () => {
  const onChange = vi.fn()
  mockUseApprovedModules.mockReturnValue({ data: [MAPPED], isPending: false, isError: false })
  render(<ModuleSlotPicker slot={slot} value={undefined} onChange={onChange} />)
  fireEvent.click(screen.getByText('mod password-tier-gating'))
  expect(onChange).toHaveBeenCalledWith({
    address: MAPPED.address,
    configType: 'password-tier-gating',
  })
})
