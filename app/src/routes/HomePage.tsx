import { Link } from 'wouter'
import { HelloChain } from '../components/HelloChain'
import styles from './HomePage.module.css'

const cards = [
  {
    href: '/collections',
    glyph: '✦',
    title: 'FEATURED',
    meta: 'discovery',
    body: 'Featured collections on the platform — live state read straight off chain.',
    testid: 'collections-link',
  },
  {
    href: '/exec404',
    glyph: '✕',
    title: 'CULT EXECUTIVES',
    meta: 'EXEC · fossil',
    body: 'The one live deployment, grandfathered forever. Real market price from its V2 pool.',
    testid: 'exec404-link',
  },
]

export function HomePage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={`${styles.title} text-chromatic-strong`}>ms2.fun</h1>
        <p className={styles.tagline}>the opinionated boutique launchpad</p>
      </section>

      <HelloChain />

      <section className={styles.projects}>
        <h2 className={styles.sectionTitle}>Surfaces</h2>
        <div className={styles.grid}>
          {cards.map((c) => (
            <Link key={c.href} href={c.href} className={styles.card} data-testid={c.testid}>
              <div className={styles.cardImage}>{c.glyph}</div>
              <div className={styles.cardContent}>
                <div className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>{c.title}</h3>
                  <span className="badge">{c.meta}</span>
                </div>
                <p className={styles.cardBody}>{c.body}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
