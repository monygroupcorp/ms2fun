import type { ProfileMetadata } from '../lib/metadata'
import { isResolvableUri } from '../lib/metadata'
import { IpfsImage } from './ui/IpfsImage'
import { truncateAddress } from '../lib/format'
import styles from './ProfileView.module.css'

interface ProfileViewProps {
  address: `0x${string}`
  metadata: ProfileMetadata | undefined
  /** When provided (own profile), an Edit affordance is shown on the framed avatar. */
  onEdit?: (() => void) | undefined
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value)
}

function GlyphAvatar({ char }: { char: string }) {
  return <div className={styles.avatarGlyph}>{char.toUpperCase()}</div>
}

export function ProfileView({ address, metadata, onEdit }: ProfileViewProps) {
  const displayName = metadata?.name || truncateAddress(address)
  const glyphChar = metadata?.name?.slice(0, 1) || address.charAt(2) // first hex char after '0x'

  // IpfsImage rotates gateways and falls back internally, so gate only on a resolvable pointer.
  const hasBanner = isResolvableUri(metadata?.banner)
  const hasAvatar = isResolvableUri(metadata?.avatar)

  const hasLinks = (metadata?.links?.length ?? 0) > 0
  const socialEntries = metadata?.socials ? Object.entries(metadata.socials) : []

  return (
    <article className={styles.profile}>
      {/* Banner */}
      <div className={`${styles.banner} ${hasBanner ? styles.bannerImg : styles.bannerBlank}`}>
        {hasBanner && metadata != null && metadata.banner !== '' && (
          <IpfsImage uri={metadata.banner} alt="" className={styles.bannerImage} loading="eager" />
        )}
      </div>

      {/* Avatar — the user-set image, hung in the mono .noesis-frame (the brand container). An
          Edit affordance shows on one's own profile (rule 1: avatar is set/updated, not derived). */}
      <div className={`noesis-frame ${styles.avatarFrame}`}>
        <div className={styles.avatarInner}>
          {hasAvatar && metadata != null && metadata.avatar !== '' ? (
            <IpfsImage
              uri={metadata.avatar}
              alt={displayName}
              className={styles.avatarImage}
              loading="eager"
              fallback={<GlyphAvatar char={glyphChar} />}
            />
          ) : (
            <GlyphAvatar char={glyphChar} />
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            className={styles.avatarEdit}
            onClick={onEdit}
            data-testid="profile-avatar-edit"
          >
            Edit
          </button>
        )}
      </div>

      {/* Identity */}
      <div className={styles.identity}>
        <h1 className={styles.name}>{displayName}</h1>
        {metadata?.handle && <p className={styles.handle}>@{metadata.handle}</p>}
        <p className={styles.addressLine}>{truncateAddress(address)}</p>
      </div>

      {/* Empty state note */}
      {metadata === undefined && <p className={styles.emptyNote}>No profile set</p>}

      {/* Bio */}
      {metadata?.bio && <p className={styles.bio}>{metadata.bio}</p>}

      {/* Links */}
      {hasLinks && (
        <ul className={styles.links}>
          {metadata?.links.map((link, i) => (
            <li key={i}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* Socials */}
      {socialEntries.length > 0 && (
        <ul className={styles.socials}>
          {socialEntries.map(([key, value]) => (
            <li key={key} className={styles.socialItem}>
              <span className={styles.socialKey}>{key}</span>
              {isUrl(value) ? (
                <a href={value} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {value}
                </a>
              ) : (
                <span className={styles.socialValue}>{value}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
