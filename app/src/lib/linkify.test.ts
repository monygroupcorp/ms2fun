import { describe, expect, it } from 'vitest'
import { splitLinks } from './linkify'

describe('splitLinks', () => {
  it('plain text → one text segment', () => {
    expect(splitLinks('just words')).toEqual([{ type: 'text', value: 'just words' }])
  })

  it('a bare url → one url segment', () => {
    expect(splitLinks('https://x.com/a')).toEqual([{ type: 'url', value: 'https://x.com/a' }])
  })

  it('linkifies the legacy EXEC chatter shape (urls + || + id)', () => {
    const text =
      'https://www.youtube.com/watch?v=tFMo3UJ4B4g || B000CA8KBE || https://annas-archive.org/md5/fd87'
    expect(splitLinks(text)).toEqual([
      { type: 'url', value: 'https://www.youtube.com/watch?v=tFMo3UJ4B4g' },
      { type: 'text', value: ' || B000CA8KBE || ' },
      { type: 'url', value: 'https://annas-archive.org/md5/fd87' },
    ])
  })

  it('trims trailing sentence punctuation out of the href', () => {
    expect(splitLinks('see (https://x.com).')).toEqual([
      { type: 'text', value: 'see (' },
      { type: 'url', value: 'https://x.com' },
      { type: 'text', value: ').' },
    ])
  })

  it('does not linkify javascript: or bare domains', () => {
    expect(splitLinks('javascript:alert(1) and x.com')).toEqual([
      { type: 'text', value: 'javascript:alert(1) and x.com' },
    ])
  })
})
