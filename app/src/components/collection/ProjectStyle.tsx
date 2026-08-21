/**
 * ProjectStyle — applies a collection's creator-supplied `styleUri` to its page.
 *
 * The contracts store `styleUri` (ERC1155 + ERC404) and the wizard/admin set it, but until now
 * nothing rendered it. This reads `styleUri()` off the instance, fetches the CSS, and injects it as a
 * scoped `<style>` while adding `has-project-style` to <body> — the convention the design system's
 * `public/styles/test-project-style.css` was written against (creator CSS scopes its rules under
 * `body.has-project-style …`). Renders nothing; cleans up on unmount / route change.
 *
 * Trust + safety: `styleUri` is an author-chosen string on a path that is not an `<img>`, so it
 * carries the same hostile-input treatment as an image pointer: (a) the pointer goes through the
 * URI scheme allowlist (`untrusted.ts`), so it can only be content-addressed, inline `text/css`, or
 * same-origin; (b) a gateway that answers with an HTML document is treated as a gateway failure and
 * nothing is injected; (c) the body is read through the shared size cap and then bounded again at
 * MAX_CSS; (d) `@import` rules are stripped, since they would re-open the automatic-request channel
 * the allowlist closes; (e) the CSS is assigned as `textContent` on a <style> element — never a
 * <link>, never innerHTML — so it cannot introduce markup; and (f) authors scope their rules under
 * `body.has-project-style`.
 */
import { useEffect } from 'react'
import { useReadContract } from 'wagmi'
import { useCollectionChainId } from './useCollectionChain'
import {
  isDocumentResponse,
  readCappedText,
  resolveUri,
  sanitizeStyleUri,
  stripCssImports,
} from '../../lib/metadata'

const STYLE_ABI = [
  {
    type: 'function',
    name: 'styleUri',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

/** Max injected CSS (bytes). Generous for real themes; bounds a pathological/huge styleUri. */
const MAX_CSS = 200_000

/** Decode a `data:text/css[;base64],…` URI to its CSS text. */
function decodeDataCss(uri: string): string {
  const comma = uri.indexOf(',')
  if (comma === -1) return ''
  const header = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  return header.includes(';base64') ? atob(payload) : decodeURIComponent(payload)
}

export function ProjectStyle({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data: styleUri } = useReadContract({
    address: instance,
    abi: STYLE_ABI,
    functionName: 'styleUri',
    chainId,
  })

  useEffect(() => {
    const uri = sanitizeStyleUri(styleUri)
    if (!uri) return

    let cancelled = false
    const styleEl = document.createElement('style')
    styleEl.setAttribute('data-project-style', instance)

    async function load(): Promise<void> {
      let css = ''
      try {
        if (uri.startsWith('data:text/css')) {
          css = decodeDataCss(uri)
        } else {
          // The pointer is already allowlisted above; resolveUri maps ipfs://ar:// onto a gateway
          // URL and passes same-origin paths through, which fetch resolves against the page origin.
          const res = await fetch(resolveUri(uri))
          if (!res.ok) return
          // An HTML challenge/error page is a gateway failure, not a stylesheet.
          if (isDocumentResponse(res)) return
          css = await readCappedText(res)
        }
      } catch {
        return // unreachable / blocked — fall back to the default monochrome look
      }
      css = stripCssImports(css)
      if (cancelled || css.trim() === '') return
      styleEl.textContent = css.slice(0, MAX_CSS)
      document.head.appendChild(styleEl)
      document.body.classList.add('has-project-style')
    }
    void load()

    return () => {
      cancelled = true
      styleEl.remove()
      // Drop the body flag only when no other styled collection page is mounted.
      if (document.querySelector('style[data-project-style]') === null) {
        document.body.classList.remove('has-project-style')
      }
    }
  }, [styleUri, instance])

  return null
}
