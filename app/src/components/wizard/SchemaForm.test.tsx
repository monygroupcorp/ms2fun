import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { FieldSchema } from '@/lib/wizard/schema'
import { SchemaForm } from './SchemaForm'

afterEach(cleanup)

const textField: FieldSchema = {
  key: 'name',
  label: 'Name',
  kind: 'text',
  validation: { required: true },
}

const hiddenField: FieldSchema = {
  key: 'secret',
  label: 'Secret',
  kind: 'text',
  visibleWhen: { field: 'name', equals: 'show' },
}

const selectField: FieldSchema = {
  key: 'tier',
  label: 'Tier',
  kind: 'select',
  options: [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
  ],
}

const boolField: FieldSchema = {
  key: 'active',
  label: 'Active',
  kind: 'bool',
}

const numberField: FieldSchema = {
  key: 'count',
  label: 'Count',
  kind: 'number',
  unit: 'tokens',
}

test('renders a text field with label', () => {
  render(<SchemaForm fields={[textField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByLabelText('Name *')).toBeInTheDocument()
})

test('typing in a text input fires onChange with the correct key and value', () => {
  const onChange = vi.fn()
  render(<SchemaForm fields={[textField]} values={{}} onChange={onChange} />)
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Alice' } })
  expect(onChange).toHaveBeenCalledWith('name', 'Alice')
})

test('field hidden by visibleWhen does not appear when condition is not met', () => {
  render(
    <SchemaForm fields={[textField, hiddenField]} values={{ name: 'other' }} onChange={vi.fn()} />,
  )
  expect(screen.queryByLabelText('Secret')).not.toBeInTheDocument()
})

test('field hidden by visibleWhen appears when condition is met', () => {
  render(
    <SchemaForm fields={[textField, hiddenField]} values={{ name: 'show' }} onChange={vi.fn()} />,
  )
  expect(screen.getByLabelText('Secret')).toBeInTheDocument()
})

test('renders error message and aria-invalid when errors map contains field key', () => {
  render(
    <SchemaForm
      fields={[textField]}
      values={{}}
      onChange={vi.fn()}
      errors={{ name: 'Name is required' }}
    />,
  )
  expect(screen.getByText('Name is required')).toBeInTheDocument()
  expect(screen.getByLabelText('Name *')).toHaveAttribute('aria-invalid', 'true')
})

test('renders a select field with placeholder and options', () => {
  render(<SchemaForm fields={[selectField]} values={{}} onChange={vi.fn()} />)
  const select = screen.getByRole('combobox')
  expect(select).toBeInTheDocument()
  expect(screen.getByText('Free')).toBeInTheDocument()
  expect(screen.getByText('Pro')).toBeInTheDocument()
})

test('select onChange fires with new value', () => {
  const onChange = vi.fn()
  render(<SchemaForm fields={[selectField]} values={{ tier: 'free' }} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pro' } })
  expect(onChange).toHaveBeenCalledWith('tier', 'pro')
})

test('bool field checkbox toggles between true and false strings', () => {
  const onChange = vi.fn()
  render(<SchemaForm fields={[boolField]} values={{ active: 'false' }} onChange={onChange} />)
  const checkbox = screen.getByRole('checkbox')
  expect(checkbox).not.toBeChecked()
  fireEvent.click(checkbox)
  expect(onChange).toHaveBeenCalledWith('active', 'true')
})

test('amount-unit number field accepts decimals (inputMode decimal, step any)', () => {
  // `tokens` (like `eth`) is a human amount entered as a decimal and scaled to wei at encode.
  render(<SchemaForm fields={[numberField]} values={{}} onChange={vi.fn()} />)
  const input = screen.getByRole('spinbutton')
  expect(input).toBeInTheDocument()
  expect(input).toHaveAttribute('inputMode', 'decimal')
  expect(input).toHaveAttribute('step', 'any')
})

test('integer-unit number field keeps a numeric keypad', () => {
  const secondsField: FieldSchema = {
    key: 'openTime',
    label: 'Open time',
    kind: 'number',
    unit: 'seconds',
  }
  render(<SchemaForm fields={[secondsField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByRole('spinbutton')).toHaveAttribute('inputMode', 'numeric')
})

test('unit chip is shown in label', () => {
  render(<SchemaForm fields={[numberField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByText('tokens')).toBeInTheDocument()
})

test('eth unit renders as an ETH chip', () => {
  const ethField: FieldSchema = { key: 'price', label: 'Base price', kind: 'number', unit: 'eth' }
  render(<SchemaForm fields={[ethField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByText('ETH')).toBeInTheDocument()
})

test('group field renders as fieldset with children', () => {
  const groupField: FieldSchema = {
    key: 'meta',
    label: 'Metadata',
    kind: 'group',
    fields: [
      { key: 'meta.title', label: 'Title', kind: 'text' },
      { key: 'meta.desc', label: 'Description', kind: 'textarea' },
    ],
  }
  render(<SchemaForm fields={[groupField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByRole('group', { name: 'Metadata' })).toBeInTheDocument()
  expect(screen.getByLabelText('Title')).toBeInTheDocument()
  expect(screen.getByLabelText('Description')).toBeInTheDocument()
})

test('list field add button creates a row and onChange fires for new key', () => {
  const onChange = vi.fn()
  const listField: FieldSchema = {
    key: 'addrs',
    label: 'Addresses',
    kind: 'list',
    item: { key: 'addrs.item', label: 'Address', kind: 'text' },
  }
  render(<SchemaForm fields={[listField]} values={{}} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: /add address/i }))
  expect(onChange).toHaveBeenCalledWith('addrs.0', '')
})

test('uses field.default as initial value when key absent from values', () => {
  const fieldWithDefault: FieldSchema = {
    key: 'qty',
    label: 'Quantity',
    kind: 'number',
    default: 42,
  }
  render(<SchemaForm fields={[fieldWithDefault]} values={{}} onChange={vi.fn()} />)
  const input = screen.getByRole('spinbutton')
  expect(input).toHaveValue(42)
})

const bpsSliderField: FieldSchema = {
  key: 'declaredMaxAllowanceBps',
  label: 'Creator carve — declared max',
  kind: 'number',
  unit: 'bps',
  default: '10000',
  validation: { min: 0, max: 10000 },
}

test('bounded bps field renders a slider paired with an exact-entry input and a percent readout', () => {
  render(<SchemaForm fields={[bpsSliderField]} values={{}} onChange={vi.fn()} />)
  const slider = screen.getByRole('slider')
  const exact = screen.getByRole('spinbutton')
  expect(slider).toHaveAttribute('min', '0')
  expect(slider).toHaveAttribute('max', '10000')
  // Untouched field: the default (10000) is what an untouched submit would carry.
  expect(exact).toHaveValue(10000)
  expect(slider).toHaveValue('10000')
  expect(screen.getByText('100%')).toBeInTheDocument()
})

test('bps exact-entry input lets a creator land on a precise value', () => {
  const onChange = vi.fn()
  render(
    <SchemaForm
      fields={[bpsSliderField]}
      values={{ declaredMaxAllowanceBps: '10000' }}
      onChange={onChange}
    />,
  )
  fireEvent.change(screen.getByRole('spinbutton'), {
    target: { value: '2500' },
  })
  expect(onChange).toHaveBeenCalledWith('declaredMaxAllowanceBps', '2500')
})

test('bps slider percent readout tracks the current value', () => {
  render(
    <SchemaForm
      fields={[bpsSliderField]}
      values={{ declaredMaxAllowanceBps: '2500' }}
      onChange={vi.fn()}
    />,
  )
  expect(screen.getByText('25%')).toBeInTheDocument()
})

test('bps slider clamps at both ends', () => {
  const onChange = vi.fn()
  render(
    <SchemaForm
      fields={[bpsSliderField]}
      values={{ declaredMaxAllowanceBps: '5000' }}
      onChange={onChange}
    />,
  )
  const slider = screen.getByRole('slider')
  fireEvent.change(slider, { target: { value: '-500' } })
  expect(onChange).toHaveBeenCalledWith('declaredMaxAllowanceBps', '0')
  fireEvent.change(slider, { target: { value: '15000' } })
  expect(onChange).toHaveBeenCalledWith('declaredMaxAllowanceBps', '10000')
})

test('help text is rendered and wired via aria-describedby', () => {
  const helpField: FieldSchema = {
    key: 'bio',
    label: 'Bio',
    kind: 'textarea',
    help: 'Tell us about yourself',
  }
  render(<SchemaForm fields={[helpField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByText('Tell us about yourself')).toBeInTheDocument()
  const textarea = screen.getByLabelText('Bio')
  const describedById = textarea.getAttribute('aria-describedby')
  expect(describedById).toBeTruthy()
  const helpEl = document.getElementById(describedById!)
  expect(helpEl?.textContent).toBe('Tell us about yourself')
})

// ── Schedule kinds (noesis/drop-window-in-epoch-seconds) ─────────────────────
//
// `datetime` and `duration` exist so a creator states a moment or a span instead of an epoch
// integer. The VALUES BAG stays in unix seconds throughout — that is what makes the submit-builders
// and `validateField` indifferent to the change — so every case here reads what the control shows
// and asserts what the bag receives.

const datetimeField: FieldSchema = { key: 'closeTime', label: 'Closes', kind: 'datetime' }
const durationField: FieldSchema = { key: 'baseDuration', label: 'Base duration', kind: 'duration' }

/** A local wall-clock moment and its unix seconds, computed the way the browser would. */
const MOMENT = {
  local: '2026-09-22T18:30',
  epoch: Math.floor(new Date(2026, 8, 22, 18, 30).getTime() / 1000),
}

test('datetime field renders a calendar picker, not a number box', () => {
  render(<SchemaForm fields={[datetimeField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByLabelText('Closes')).toHaveAttribute('type', 'datetime-local')
  expect(screen.queryByRole('spinbutton')).toBeNull()
})

test('datetime field shows the stored seconds as a moment', () => {
  render(
    <SchemaForm
      fields={[datetimeField]}
      values={{ closeTime: String(MOMENT.epoch) }}
      onChange={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Closes')).toHaveValue(MOMENT.local)
})

test('datetime field renders 0 as an empty picker — 0 is "no time set", never 1970', () => {
  render(<SchemaForm fields={[datetimeField]} values={{ closeTime: '0' }} onChange={vi.fn()} />)
  expect(screen.getByLabelText('Closes')).toHaveValue('')
})

test('a picked moment reaches the values bag as unix seconds', () => {
  const onChange = vi.fn()
  render(<SchemaForm fields={[datetimeField]} values={{ closeTime: '0' }} onChange={onChange} />)
  fireEvent.change(screen.getByLabelText('Closes'), { target: { value: MOMENT.local } })
  expect(onChange).toHaveBeenCalledWith('closeTime', String(MOMENT.epoch))
})

test('clearing the picker returns the field to 0, which is where it started', () => {
  const onChange = vi.fn()
  render(
    <SchemaForm
      fields={[datetimeField]}
      values={{ closeTime: String(MOMENT.epoch) }}
      onChange={onChange}
    />,
  )
  fireEvent.change(screen.getByLabelText('Closes'), { target: { value: '' } })
  expect(onChange).toHaveBeenCalledWith('closeTime', '0')
})

test('duration field renders an amount and the span it is stated in', () => {
  render(<SchemaForm fields={[durationField]} values={{}} onChange={vi.fn()} />)
  expect(screen.getByLabelText('Base duration')).toHaveAttribute('type', 'number')
  expect(screen.getByLabelText('Base duration unit')).toBeInTheDocument()
})

test('duration field opens on the coarsest span that divides the stored seconds', () => {
  render(
    <SchemaForm fields={[durationField]} values={{ baseDuration: '86400' }} onChange={vi.fn()} />,
  )
  expect(screen.getByLabelText('Base duration')).toHaveValue(1)
  expect(screen.getByLabelText('Base duration unit')).toHaveValue('days')
})

test('an amount is multiplied by its span before it reaches the bag', () => {
  const onChange = vi.fn()
  render(
    <SchemaForm fields={[durationField]} values={{ baseDuration: '3600' }} onChange={onChange} />,
  )
  // The stored 3600 reads as "1 hours", so typing 24 against that span means a day.
  fireEvent.change(screen.getByLabelText('Base duration'), { target: { value: '24' } })
  expect(onChange).toHaveBeenCalledWith('baseDuration', '86400')
})

test('changing the span restates the same amount — 1 hour becomes 1 day', () => {
  const onChange = vi.fn()
  render(
    <SchemaForm fields={[durationField]} values={{ baseDuration: '3600' }} onChange={onChange} />,
  )
  fireEvent.change(screen.getByLabelText('Base duration unit'), { target: { value: 'days' } })
  expect(onChange).toHaveBeenCalledWith('baseDuration', '86400')
})

test('an emptied duration empties the field, so a required rule still bites', () => {
  const onChange = vi.fn()
  render(
    <SchemaForm fields={[durationField]} values={{ baseDuration: '3600' }} onChange={onChange} />,
  )
  fireEvent.change(screen.getByLabelText('Base duration'), { target: { value: '' } })
  expect(onChange).toHaveBeenCalledWith('baseDuration', '')
})
