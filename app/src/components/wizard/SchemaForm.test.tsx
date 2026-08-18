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
