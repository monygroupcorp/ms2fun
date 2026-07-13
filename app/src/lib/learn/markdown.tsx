/**
 * Deliberately minimal, injection-proof Markdown renderer for `/learn` concept bodies
 * (spec-launchpad-docs-and-explainers §2.1).
 *
 * SECURITY CONTRACT: this renderer is *structurally* incapable of emitting raw HTML. It never builds an
 * HTML string and never uses `dangerouslySetInnerHTML` (its presence here is a review-fail). Source text
 * is parsed into a typed node tree and mapped to React elements; every text value reaches the DOM as a
 * React child, which React escapes. So a `body` containing `<script>…</script>` or `<img onerror=…>`
 * renders as inert, visible text — never as markup.
 *
 * Grammar (intentionally tiny — NOT a general Markdown engine): ATX headings `#`–`###`, paragraphs,
 * unordered (`-`/`*`) and ordered (`1.`) lists, links `[text](href)`, and inline `` `code` ``.
 * Unsupported syntax degrades to plain text.
 */
import type { ReactNode } from 'react'

type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; text: string; href: string }

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'paragraph'; inline: Inline[] }

const INLINE_RE = /(`[^`]*`)|(\[[^\]]*\]\([^)\s]+\))/g
const LINK_RE = /^\[([^\]]*)\]\(([^)\s]+)\)$/

/** Allow only http(s), mailto, and same-origin relative/anchor hrefs; everything else is dropped. */
function safeHref(href: string): string | null {
  if (href.startsWith('/') || href.startsWith('#')) return href
  try {
    const { protocol } = new URL(href)
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return href
  } catch {
    // not a parseable absolute URL → drop
  }
  return null
}

function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0
    const token = m[0]
    if (token === undefined) continue
    if (idx > last) out.push({ type: 'text', value: text.slice(last, idx) })
    if (token.startsWith('`')) {
      out.push({ type: 'code', value: token.slice(1, -1) })
    } else {
      const link = LINK_RE.exec(token)
      const href = link ? safeHref(link[2] ?? '') : null
      if (link && href) out.push({ type: 'link', text: link[1] ?? '', href })
      else out.push({ type: 'text', value: token }) // unsafe/unparseable → literal text
    }
    last = idx + token.length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i++
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: (heading[1] ?? '').length as 1 | 2 | 3,
        inline: parseInline((heading[2] ?? '').trim()),
      })
      i++
      continue
    }
    const isUl = (s: string) => /^[-*]\s+/.test(s)
    const isOl = (s: string) => /^\d+\.\s+/.test(s)
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line)
      const items: Inline[][] = []
      for (
        let cur = lines[i];
        cur !== undefined && (ordered ? isOl(cur) : isUl(cur));
        cur = lines[i]
      ) {
        items.push(parseInline(cur.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, '')))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    for (
      let cur = lines[i];
      cur !== undefined && cur.trim() !== '' && !/^#{1,3}\s+/.test(cur) && !isUl(cur) && !isOl(cur);
      cur = lines[i]
    ) {
      para.push(cur)
      i++
    }
    blocks.push({ type: 'paragraph', inline: parseInline(para.join(' ')) })
  }
  return blocks
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, k) => {
    if (n.type === 'code') return <code key={k}>{n.value}</code>
    if (n.type === 'link')
      return (
        <a key={k} href={n.href} rel="noopener noreferrer">
          {n.text}
        </a>
      )
    return <span key={k}>{n.value}</span>
  })
}

/** Read-only Markdown view. See the security contract above. */
export function Markdown({ source }: { source: string }): ReactNode {
  const blocks = parseBlocks(source)
  return (
    <>
      {blocks.map((b, k) => {
        if (b.type === 'heading') {
          const Tag = `h${b.level}` as 'h1' | 'h2' | 'h3'
          return <Tag key={k}>{renderInline(b.inline)}</Tag>
        }
        if (b.type === 'list') {
          const items = b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)
          return b.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>
        }
        return <p key={k}>{renderInline(b.inline)}</p>
      })}
    </>
  )
}
