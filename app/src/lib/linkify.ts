/** Pure text→segments splitter for linkifying user content. No React — unit-testable. */

export type LinkSegment = { type: 'text'; value: string } | { type: 'url'; value: string }

// http(s) URLs only (never javascript:/data: — those must not become anchors). Stops at whitespace;
// trailing sentence punctuation is trimmed back into the following text segment so "(see https://x)."
// doesn't swallow the ")." into the href.
const URL_RE = /(https?:\/\/[^\s<>]+)/gi
const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/

/**
 * Split `text` into ordered text/url segments. URLs render as anchors; everything else stays literal
 * (so `||`-style separators and bare ids in legacy EXEC chatter pass through untouched).
 */
export function splitLinks(text: string): LinkSegment[] {
  const out: LinkSegment[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    let url = m[0]
    let trailing = ''
    const trail = TRAILING_PUNCT.exec(url)
    if (trail) {
      trailing = trail[0]
      url = url.slice(0, url.length - trailing.length)
    }
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) })
    out.push({ type: 'url', value: url })
    if (trailing) out.push({ type: 'text', value: trailing })
    last = start + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}
