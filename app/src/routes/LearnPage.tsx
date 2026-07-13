/**
 * /learn (index) and /learn/:slug (one concept) — the in-app documentation surface
 * (spec-launchpad-docs-and-explainers §2.2). Content is bundled from lib/learn/concepts and rendered
 * read-only by the first-party Markdown renderer. No external host (ADR-0010): if the app is up, the
 * docs are up. An unknown slug falls back to the index rather than a blank.
 */
import { Link } from 'wouter'
import { CONCEPTS, CONCEPT_GROUPS, getConcept } from '../lib/learn/concepts'
import { renderMarkdown } from '../lib/learn/markdown'
import styles from './LearnPage.module.css'

export function LearnPage({ params }: { params?: { slug?: string } }) {
  const slug = params?.slug
  const concept = slug ? getConcept(slug) : undefined

  // Unknown slug → graceful fall-through to the index (§2.2), not a blank page.
  if (slug && !concept) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/learn" className={styles.back}>
            ← Learn
          </Link>
        </nav>
        <p className={styles.notFound}>No doc for “{slug}”. Here’s everything we’ve written:</p>
        <Index />
      </div>
    )
  }

  if (concept) {
    const related = (concept.related ?? [])
      .map((s) => getConcept(s))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/learn" className={styles.back}>
            ← Learn
          </Link>
        </nav>
        <article className={styles.concept}>
          <h1 className={styles.title}>{concept.title}</h1>
          <p className={styles.lede}>{concept.summary}</p>
          <div className={styles.body}>{renderMarkdown(concept.body)}</div>
          {related.length > 0 && (
            <aside className={styles.related}>
              <p className={styles.relatedHead}>See also</p>
              <ul className={styles.relatedList}>
                {related.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/learn/${c.slug}`}>{c.title}</Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <Link href="/launch" className={styles.backToWizard}>
            ← Back to the launch wizard
          </Link>
        </article>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← noesis
        </Link>
      </nav>
      <h1 className={styles.title}>Learn</h1>
      <p className={styles.lede}>
        How the launchpad works — the concepts behind each step, in plain language.
      </p>
      <Index />
    </div>
  )
}

function Index() {
  return (
    <div className={styles.groups}>
      {CONCEPT_GROUPS.map((g) => (
        <section key={g.title} className={styles.group}>
          <h2 className={styles.groupTitle}>{g.title}</h2>
          <div className={styles.cards}>
            {g.slugs.map((s) => {
              const c = CONCEPTS[s]
              if (!c) return null
              return (
                <Link key={s} href={`/learn/${s}`} className={styles.card}>
                  <span className={styles.cardTitle}>{c.title}</span>
                  <span className={styles.cardSummary}>{c.summary}</span>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
