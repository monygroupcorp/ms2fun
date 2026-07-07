/**
 * ProjectStyle — applies a collection's creator-supplied `styleUri` to its page.
 *
 * The contracts store `styleUri` (ERC1155 + ERC404) and the wizard/admin set it, but until now
 * nothing rendered it. This reads `styleUri()` off the instance, fetches the CSS, and injects it as a
 * scoped `<style>` while adding `has-project-style` to <body> — the convention the design system's
 * `public/styles/test-project-style.css` was written against (creator CSS scopes its rules under
 * `body.has-project-style …`). Renders nothing; cleans up on unmount / route change.
 *
 * Trust + safety: CSS cannot execute JS, but it can fetch external resources (privacy) and override
 * layout, so we (a) bound the injected size, (b) only ever inject as a <style> element (never a
 * <link> or innerHTML on app DOM), and (c) scope authors to `body.has-project-style`. This is the
 * creator-supplied-style trade-off we accept for the boutique launchpad; revisit hardening for
 * untrusted creators before a permissionless testnet phase.
 */
import { useEffect } from 'react'
import { useReadContract } from 'wagmi'
import { forkChainId } from '../../lib/addresses'
import { resolveUri } from '../../lib/metadata'

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
  const { data: styleUri } = useReadContract({
    address: instance,
    abi: STYLE_ABI,
    functionName: 'styleUri',
    chainId: forkChainId,
  })

  useEffect(() => {
    const uri = (styleUri ?? '').trim()
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
          // resolveUri passes http(s)/ar/ipfs through (root-relative /seed-art paths too); fetch
          // resolves relative URLs against the page origin.
          const res = await fetch(resolveUri(uri))
          if (!res.ok) return
          css = await res.text()
        }
      } catch {
        return // unreachable / blocked — fall back to the default monochrome look
      }
      if (cancelled || css === '') return
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
