import styles from './HomePage.module.css'

export function HomePage() {
  return (
    <section className={styles.home}>
      <h1 className={styles.title}>ms2.fun</h1>
      <p className={styles.tagline}>the opinionated boutique launchpad</p>
    </section>
  )
}
