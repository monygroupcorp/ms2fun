import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProfileMetadata } from '../lib/metadata'
import { ProfileView } from './ProfileView'

afterEach(cleanup)

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const

const FULL_METADATA: ProfileMetadata = {
  schemaVersion: 1,
  name: 'Alice',
  handle: 'alice',
  bio: 'DeFi builder',
  avatar: 'https://example.com/avatar.png',
  banner: 'https://example.com/banner.png',
  links: [{ label: 'Website', url: 'https://alice.dev' }],
  socials: { x: 'https://x.com/alice', farcaster: 'alice' },
}

describe('ProfileView', () => {
  it('renders with full metadata', () => {
    render(<ProfileView address={ADDRESS} metadata={FULL_METADATA} />)

    // Name as hero text
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()

    // Handle
    expect(screen.getByText('@alice')).toBeInTheDocument()

    // Truncated address always present (appears as address line only — name is shown as heading)
    expect(screen.getByText('0x1234…5678')).toBeInTheDocument()

    // Bio
    expect(screen.getByText('DeFi builder')).toBeInTheDocument()

    // Link
    const websiteLink = screen.getByRole('link', { name: 'Website' })
    expect(websiteLink).toHaveAttribute('href', 'https://alice.dev')
    expect(websiteLink).toHaveAttribute('target', '_blank')
    expect(websiteLink).toHaveAttribute('rel', 'noopener noreferrer')

    // Social URL link
    const xLink = screen.getByRole('link', { name: 'https://x.com/alice' })
    expect(xLink).toHaveAttribute('href', 'https://x.com/alice')

    // Social text value (not a URL)
    expect(screen.getByText('alice', { selector: 'span' })).toBeInTheDocument()
  })

  it('renders empty state (undefined metadata)', () => {
    render(<ProfileView address={ADDRESS} metadata={undefined} />)

    // Truncated address appears as both the heading (display name fallback) and the address line
    const truncatedEls = screen.getAllByText('0x1234…5678')
    expect(truncatedEls.length).toBeGreaterThanOrEqual(2)

    // Empty state note
    expect(screen.getByText('No profile set')).toBeInTheDocument()

    // No links rendered when metadata is absent
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
