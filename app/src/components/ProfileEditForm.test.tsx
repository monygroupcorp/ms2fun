import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ProfileEditForm } from './ProfileEditForm'

afterEach(cleanup)

test('renders without initial values', () => {
  const onSave = vi.fn()
  render(<ProfileEditForm onSave={onSave} />)
  expect(screen.getByLabelText('Name')).toBeInTheDocument()
  expect(screen.getByLabelText('Handle')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /save profile/i })).toBeInTheDocument()
})

test('typing a name and submitting calls onSave with that name', () => {
  const onSave = vi.fn()
  render(<ProfileEditForm onSave={onSave} />)

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } })
  fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

  expect(onSave).toHaveBeenCalledOnce()
  expect(onSave.mock.calls[0]![0]).toMatchObject({ name: 'Alice', schemaVersion: 1 })
})

test('adding a link row and filling it is included in onSave result', () => {
  const onSave = vi.fn()
  render(<ProfileEditForm onSave={onSave} />)

  fireEvent.click(screen.getByRole('button', { name: /add link/i }))

  fireEvent.change(screen.getByLabelText('Link 1 label'), { target: { value: 'My Site' } })
  fireEvent.change(screen.getByLabelText('Link 1 URL'), {
    target: { value: 'https://example.com' },
  })

  fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

  expect(onSave).toHaveBeenCalledOnce()
  const meta = onSave.mock.calls[0]![0]
  expect(meta.links).toHaveLength(1)
  expect(meta.links[0]).toEqual({ label: 'My Site', url: 'https://example.com' })
})

test('save button is disabled when saving=true', () => {
  render(<ProfileEditForm onSave={vi.fn()} saving={true} />)
  expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
})
