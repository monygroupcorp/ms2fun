import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TypeLearnLink } from './WizardPage'
import { PROJECT_TYPES } from '../lib/wizard/projectTypes'
import { getConcept } from '../lib/learn/concepts'

describe('type-picker learn links', () => {
  it('every project type carries a learnMore slug that equals its key and resolves', () => {
    expect(PROJECT_TYPES.length).toBeGreaterThan(0)
    for (const pt of PROJECT_TYPES) {
      expect(pt.learnMore, `${pt.key} has no learnMore`).toBe(pt.key)
      expect(getConcept(pt.learnMore!), `no /learn concept for "${pt.key}"`).toBeDefined()
    }
  })

  it('TypeLearnLink renders an anchor to /learn/{key} opening in a new tab', () => {
    for (const pt of PROJECT_TYPES) {
      const { unmount } = render(<TypeLearnLink slug={pt.learnMore!} />)
      const link = screen.getByRole('link')
      expect(link.getAttribute('href')).toBe(`/learn/${pt.key}`)
      expect(link.getAttribute('target')).toBe('_blank')
      unmount()
    }
  })

  it('clicking the learn link does not bubble to the card (type-select stays distinct)', () => {
    const cardClick = vi.fn()
    render(
      <button type="button" onClick={cardClick}>
        <TypeLearnLink slug="erc404" />
      </button>,
    )
    fireEvent.click(screen.getByRole('link'))
    expect(cardClick).not.toHaveBeenCalled()
  })
})
