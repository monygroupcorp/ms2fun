import { describe, expect, it } from 'vitest'
import { editionThemeStyle, type EditionTheme } from './editionTheme'

describe('editionThemeStyle', () => {
  describe('valid hex colors', () => {
    it('accepts 3-digit hex (#abc) and produces both custom properties', () => {
      const result = editionThemeStyle({ accent: '#abc', background: '#def' })
      expect(result).toEqual({
        '--edition-accent': '#abc',
        '--edition-bg': '#def',
      })
    })

    it('accepts 6-digit hex (#aabbcc) and produces both custom properties', () => {
      const result = editionThemeStyle({ accent: '#aabbcc', background: '#ddeeff' })
      expect(result).toEqual({
        '--edition-accent': '#aabbcc',
        '--edition-bg': '#ddeeff',
      })
    })

    it('accepts mixed 3-digit and 6-digit hex', () => {
      const result = editionThemeStyle({ accent: '#abc', background: '#ddeeff' })
      expect(result).toEqual({
        '--edition-accent': '#abc',
        '--edition-bg': '#ddeeff',
      })
    })

    it('accepts uppercase hex digits', () => {
      const result = editionThemeStyle({ accent: '#ABC', background: '#DDEEFF' })
      expect(result).toEqual({
        '--edition-accent': '#ABC',
        '--edition-bg': '#DDEEFF',
      })
    })

    it('accepts mixed case hex digits', () => {
      const result = editionThemeStyle({ accent: '#AbC', background: '#DdEeFf' })
      expect(result).toEqual({
        '--edition-accent': '#AbC',
        '--edition-bg': '#DdEeFf',
      })
    })

    it('trims whitespace before validating hex', () => {
      const result = editionThemeStyle({ accent: '  #abc  ', background: '\t#def\n' })
      expect(result).toEqual({
        '--edition-accent': '#abc',
        '--edition-bg': '#def',
      })
    })
  })

  describe('invalid colors', () => {
    it('rejects malformed hex (missing #)', () => {
      const result = editionThemeStyle({ accent: 'abc', background: 'def' })
      expect(result).toEqual({})
    })

    it('rejects 2-digit hex', () => {
      const result = editionThemeStyle({ accent: '#ab', background: '#de' })
      expect(result).toEqual({})
    })

    it('rejects 4-digit hex', () => {
      const result = editionThemeStyle({ accent: '#abcd', background: '#deff' })
      expect(result).toEqual({})
    })

    it('rejects 5-digit hex', () => {
      const result = editionThemeStyle({ accent: '#abcde', background: '#deeee' })
      expect(result).toEqual({})
    })

    it('rejects 7-digit hex', () => {
      const result = editionThemeStyle({ accent: '#abcdeff', background: '#defffff' })
      expect(result).toEqual({})
    })

    it('rejects hex with non-hex digits', () => {
      const result = editionThemeStyle({ accent: '#gggggg', background: '#zzzzzz' })
      expect(result).toEqual({})
    })

    it('rejects arbitrary CSS (e.g., color name)', () => {
      const result = editionThemeStyle({ accent: 'red', background: 'blue' })
      expect(result).toEqual({})
    })

    it('rejects CSS functions (rgb, etc.)', () => {
      const result = editionThemeStyle({
        accent: 'rgb(255, 0, 0)',
        background: 'hsl(0, 100%, 50%)',
      })
      expect(result).toEqual({})
    })

    it('rejects non-string values (null, number, object)', () => {
      const result = editionThemeStyle({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        accent: null as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        background: 42 as any,
      })
      expect(result).toEqual({})
    })

    it('rejects empty string', () => {
      const result = editionThemeStyle({ accent: '', background: '' })
      expect(result).toEqual({})
    })

    it('rejects whitespace-only string', () => {
      const result = editionThemeStyle({ accent: '   ', background: '\t\n' })
      expect(result).toEqual({})
    })
  })

  describe('partial/missing values', () => {
    it('returns empty object when theme is undefined', () => {
      const result = editionThemeStyle(undefined)
      expect(result).toEqual({})
    })

    it('returns empty object for empty theme object', () => {
      const result = editionThemeStyle({})
      expect(result).toEqual({})
    })

    it('omits custom property for undefined accent', () => {
      const result = editionThemeStyle({ background: '#abc' })
      expect(result).toEqual({
        '--edition-bg': '#abc',
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any)['--edition-accent']).toBeUndefined()
    })

    it('omits custom property for undefined background', () => {
      const result = editionThemeStyle({ accent: '#abc' })
      expect(result).toEqual({
        '--edition-accent': '#abc',
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any)['--edition-bg']).toBeUndefined()
    })

    it('omits custom property for invalid accent, includes valid background', () => {
      const result = editionThemeStyle({ accent: 'invalid', background: '#abc' })
      expect(result).toEqual({
        '--edition-bg': '#abc',
      })
    })

    it('includes valid accent, omits invalid background', () => {
      const result = editionThemeStyle({ accent: '#abc', background: 'invalid' })
      expect(result).toEqual({
        '--edition-accent': '#abc',
      })
    })
  })

  describe('injection prevention', () => {
    it('does not emit custom properties for CSS injection attempts', () => {
      const maliciousInputs: EditionTheme[] = [
        { accent: '#abc; font-size: 999px', background: '#def' },
        { accent: '#abc` }, body { background: red', background: '#def' },
        { accent: "'; DROP TABLE users; --", background: '#def' },
        { accent: '#abc\n--edition-accent: url(attack)', background: '#def' },
      ]
      maliciousInputs.forEach((theme) => {
        const result = editionThemeStyle(theme)
        // Malicious inputs should be rejected, resulting in only valid values (if any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any)['--edition-accent']).toBeUndefined()
      })
    })
  })
})
