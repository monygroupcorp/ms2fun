import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from './markdown'

afterEach(cleanup)

describe('Markdown injection guard', () => {
  it('renders raw HTML in the body as inert, visible text — never as markup', () => {
    const body = 'Before\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\nAfter'
    const { container } = render(<Markdown source={body} />)

    // No smuggled elements or live handlers. The literal string "onerror" survives only inside the
    // escaped text node (`&lt;img … onerror=…&gt;`), never as a real DOM attribute — assert on the
    // element/attribute, not on the escaped text, which is the whole point of the guard.
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()

    // The dangerous source survives as escaped text the reader can see.
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.textContent).toContain('<img src=x onerror=alert(2)>')
  })

  it('does not use dangerouslySetInnerHTML for a link href either', () => {
    const { container } = render(<Markdown source={'[x](javascript:alert(1))'} />)
    // Unsafe scheme is dropped → rendered as literal text, no anchor.
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('[x](javascript:alert(1))')
  })
})

describe('Markdown rendering', () => {
  it('renders ATX headings h1–h3', () => {
    const { container } = render(<Markdown source={'# One\n\n## Two\n\n### Three'} />)
    expect(container.querySelector('h1')?.textContent).toBe('One')
    expect(container.querySelector('h2')?.textContent).toBe('Two')
    expect(container.querySelector('h3')?.textContent).toBe('Three')
  })

  it('renders paragraphs, inline code, and safe links with rel', () => {
    const { container } = render(
      <Markdown source={'Use `getConcept` and see [docs](https://ms2.fun/learn).'} />,
    )
    expect(container.querySelector('p')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('getConcept')
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://ms2.fun/learn')
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders unordered and ordered lists', () => {
    const { container } = render(<Markdown source={'- a\n- b\n\n1. one\n2. two'} />)
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
  })
})
