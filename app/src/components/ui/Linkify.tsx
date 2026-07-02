/**
 * Linkify — render user text with http(s) URLs as safe external anchors (target=_blank +
 * rel=noopener noreferrer). Everything else stays literal. Used for board posts, replies, and the
 * EXEC fossil's legacy on-chain chatter, which often carry links. Splitting is the pure `splitLinks`.
 */
import { splitLinks } from '../../lib/linkify'
import styles from './Linkify.module.css'

export function Linkify({ text }: { text: string }) {
  const segments = splitLinks(text)
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'url' ? (
          <a
            key={i}
            href={seg.value}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            {seg.value}
          </a>
        ) : (
          seg.value
        ),
      )}
    </>
  )
}
