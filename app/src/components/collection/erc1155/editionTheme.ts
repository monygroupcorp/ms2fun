/**
 * editionTheme — metadata-driven theming for the standalone edition detail page.
 *
 * Convention: an edition's metadata MAY carry an optional `theme` object:
 *   { "theme": { "accent": "#rrggbb", "background": "#rrggbb" } }
 *
 * When present and valid, `accent` recolors a single seam (title underline + CTA border)
 * and `background` tints the stats panel — so each "drop" can look distinct while staying
 * inside Gallery Brutalism (one accent color, no gradients/shadows). Absent or malformed
 * values fall through to the default monochrome look (no custom properties emitted).
 *
 * We only accept strict 3- or 6-digit hex (`#abc` / `#aabbcc`) to keep arbitrary CSS out of
 * the style attribute; anything else is ignored.
 */
import type { CSSProperties } from 'react'

export interface EditionTheme {
  accent?: string
  background?: string
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function sanitizeHex(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return HEX_RE.test(trimmed) ? trimmed : undefined
}

/**
 * Build the inline custom-property style for the page container. Returns an object with
 * `--edition-accent` / `--edition-bg` set only for the valid colors provided; the CSS module
 * supplies monochrome fallbacks via `var(--edition-accent, …)`.
 */
export function editionThemeStyle(theme: EditionTheme | undefined): CSSProperties {
  const style: Record<string, string> = {}
  const accent = sanitizeHex(theme?.accent)
  const background = sanitizeHex(theme?.background)
  if (accent) style['--edition-accent'] = accent
  if (background) style['--edition-bg'] = background
  return style as CSSProperties
}
