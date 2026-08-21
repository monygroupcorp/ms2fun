import { describe, expect, it } from 'vitest'
import {
  ALLOW_REMOTE_HTTP_URIS,
  isDocumentResponse,
  isImageResponse,
  MAX_RESPONSE_BYTES,
  readCappedText,
  sanitizeImageUri,
  sanitizeStyleUri,
  stripCssImports,
} from './untrusted'

/** Minimal stand-in for the only part of a Response these guards read. */
function headers(contentType: string | null, contentLength?: number): Response {
  return {
    headers: {
      get: (name: string) => {
        const n = name.toLowerCase()
        if (n === 'content-type') return contentType
        if (n === 'content-length')
          return contentLength === undefined ? null : String(contentLength)
        return null
      },
    },
    text: () => Promise.resolve('x'.repeat(contentLength ?? 1)),
  } as unknown as Response
}

describe('sanitizeImageUri', () => {
  it('keeps content-addressed pointers', () => {
    expect(sanitizeImageUri('ipfs://QmFoo/a.png')).toBe('ipfs://QmFoo/a.png')
    expect(sanitizeImageUri('ar://tx1')).toBe('ar://tx1')
    expect(sanitizeImageUri('  ipfs://QmFoo  ')).toBe('ipfs://QmFoo')
  })

  it('keeps an inline image data: URI', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(sanitizeImageUri(png)).toBe(png)
    expect(sanitizeImageUri('data:image/svg+xml,<svg/>')).toBe('data:image/svg+xml,<svg/>')
  })

  it('rejects a data: URI that is not an image', () => {
    expect(sanitizeImageUri('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(sanitizeImageUri('data:text/css,body{}')).toBe('')
    expect(sanitizeImageUri('data:,plain')).toBe('')
    expect(sanitizeImageUri('data:image/png;base64')).toBe('') // no comma → malformed
  })

  it('rejects executable and unknown schemes', () => {
    expect(sanitizeImageUri('javascript:alert(1)')).toBe('')
    expect(sanitizeImageUri('JaVaScRiPt:alert(1)')).toBe('')
    expect(sanitizeImageUri('vbscript:msgbox')).toBe('')
    expect(sanitizeImageUri('blob:https://example.com/abc')).toBe('')
    expect(sanitizeImageUri('file:///etc/passwd')).toBe('')
    expect(sanitizeImageUri('not a uri at all')).toBe('')
  })

  it('rejects same-origin and protocol-relative paths (an image pointer is never a path)', () => {
    expect(sanitizeImageUri('/art/1.png')).toBe('')
    expect(sanitizeImageUri('//evil.example/1.png')).toBe('')
  })

  it('handles empty and non-string-ish input', () => {
    expect(sanitizeImageUri('')).toBe('')
    expect(sanitizeImageUri('   ')).toBe('')
    expect(sanitizeImageUri(undefined)).toBe('')
    expect(sanitizeImageUri(null)).toBe('')
  })

  it('treats a remote http(s) pointer per the ALLOW_REMOTE_HTTP_URIS ruling', () => {
    const remote = 'https://tracker.example/pixel.png'
    expect(sanitizeImageUri(remote)).toBe(ALLOW_REMOTE_HTTP_URIS ? remote : '')
    expect(sanitizeImageUri('http://tracker.example/p.png')).toBe(
      ALLOW_REMOTE_HTTP_URIS ? 'http://tracker.example/p.png' : '',
    )
  })
})

describe('sanitizeStyleUri', () => {
  it('applies the same scheme allowlist as an image pointer', () => {
    expect(sanitizeStyleUri('ipfs://QmStyle')).toBe('ipfs://QmStyle')
    expect(sanitizeStyleUri('ar://tx1')).toBe('ar://tx1')
    expect(sanitizeStyleUri('javascript:alert(1)')).toBe('')
    expect(sanitizeStyleUri('data:text/html,<b>')).toBe('')
    expect(sanitizeStyleUri(undefined)).toBe('')
    expect(sanitizeStyleUri('https://themes.example/x.css')).toBe(
      ALLOW_REMOTE_HTTP_URIS ? 'https://themes.example/x.css' : '',
    )
  })

  it('accepts inline CSS and same-origin paths, but not a protocol-relative host', () => {
    expect(sanitizeStyleUri('data:text/css,body{color:red}')).toBe('data:text/css,body{color:red}')
    expect(sanitizeStyleUri('data:image/png;base64,AA')).toBe('')
    expect(sanitizeStyleUri('/styles/theme.css')).toBe('/styles/theme.css')
    expect(sanitizeStyleUri('//evil.example/theme.css')).toBe('')
  })
})

describe('isDocumentResponse', () => {
  it('flags a gateway answering with an HTML/XML document', () => {
    expect(isDocumentResponse(headers('text/html; charset=utf-8'))).toBe(true)
    expect(isDocumentResponse(headers('TEXT/HTML'))).toBe(true)
    expect(isDocumentResponse(headers('application/xhtml+xml'))).toBe(true)
  })

  it('passes the content types a gateway legitimately serves for a CID', () => {
    expect(isDocumentResponse(headers('application/json'))).toBe(false)
    expect(isDocumentResponse(headers('text/plain'))).toBe(false)
    expect(isDocumentResponse(headers('application/octet-stream'))).toBe(false)
    expect(isDocumentResponse(headers('text/css'))).toBe(false)
    expect(isDocumentResponse(headers(null))).toBe(false)
  })
})

describe('isImageResponse', () => {
  it('requires a positive image content type', () => {
    expect(isImageResponse(headers('image/png'))).toBe(true)
    expect(isImageResponse(headers('image/svg+xml; charset=utf-8'))).toBe(true)
  })

  it('treats a non-image answer as a gateway failure, not a missing CID', () => {
    expect(isImageResponse(headers('text/html'))).toBe(false)
    expect(isImageResponse(headers('application/json'))).toBe(false)
    expect(isImageResponse(headers(null))).toBe(false)
  })
})

describe('readCappedText', () => {
  it('reads a body inside the cap', async () => {
    await expect(readCappedText(headers('application/json', 10))).resolves.toHaveLength(10)
  })

  it('refuses a declared length over the cap without reading the body', async () => {
    const res = {
      headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? '999999999' : null) },
      text: () => Promise.reject(new Error('body must not be read')),
    } as unknown as Response
    await expect(readCappedText(res)).rejects.toThrow(/size cap/)
  })

  it('refuses an undeclared body that turns out to be over the cap', async () => {
    const res = {
      headers: { get: () => null },
      text: () => Promise.resolve('x'.repeat(MAX_RESPONSE_BYTES + 1)),
    } as unknown as Response
    await expect(readCappedText(res)).rejects.toThrow(/size cap/)
  })
})

describe('stripCssImports', () => {
  it('removes @import rules that would fetch from an author-named host', () => {
    expect(stripCssImports("@import url('https://tracker.example/t.css');body{color:red}")).toBe(
      'body{color:red}',
    )
    expect(stripCssImports('@IMPORT "x.css" screen;\n.a{}')).toBe('\n.a{}')
    expect(stripCssImports('@import url(x.css) layer(a);.c{}')).toBe('.c{}')
    expect(stripCssImports('.a{}\n@import "unterminated.css"')).toBe('.a{}\n')
  })

  it('leaves ordinary CSS alone', () => {
    const css = 'body.has-project-style .hero { color: #fff; background: url(ipfs://QmA); }'
    expect(stripCssImports(css)).toBe(css)
  })
})
