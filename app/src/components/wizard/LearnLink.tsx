/**
 * LearnLink (spec §2.3) — the hook from a wizard field/slot to its /learn concept. Renders a small
 * anchor that opens the concept in a NEW TAB so a creator never loses wizard state to read a doc.
 * Dev-only guard: an unknown slug `console.warn`s so a typo is caught in review, not shipped as a
 * dead link (the concepts unit test is the CI-level guard).
 */
import { getConcept } from '../../lib/learn/concepts'
import styles from './LearnLink.module.css'

export function LearnLink({
  slug,
  label = 'Learn how this works',
}: {
  slug: string
  label?: string
}) {
  if (import.meta.env.DEV && !getConcept(slug)) {
    // eslint-disable-next-line no-console
    console.warn(`[LearnLink] no /learn concept for slug "${slug}"`)
  }
  return (
    <a className={styles.link} href={`/learn/${slug}`} target="_blank" rel="noopener noreferrer">
      {label} ↗
    </a>
  )
}
