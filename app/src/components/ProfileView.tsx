import { useState } from 'react'
import type { ProfileMetadata } from '../lib/metadata'
import { isResolvableUri, resolveUri } from '../lib/metadata'
import { truncateAddress } from '../lib/format'
import styles from './ProfileView.module.css'

interface ProfileViewProps {
  address: `0x${string}`
  metadata: ProfileMetadata | undefined
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value)
}

function GlyphAvatar({ char }: { char: string }) {
  return <div className={styles.avatarGlyph}>{char.toUpperCase()}</div>
}

export function ProfileView({ address, metadata }: ProfileViewProps) {
  const [bannerError, setBannerError] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  const displayName = metadata?.name || truncateAddress(address)
  const glyphChar = metadata?.name?.slice(0, 1) || address.charAt(2) // first hex char after '0x'

  const hasBanner = !bannerError && isResolvableUri(metadata?.banner)
  const hasAvatar = !avatarError && isResolvableUri(metadata?.avatar)

  const hasLinks = (metadata?.links?.length ?? 0) > 0
  const socialEntries = metadata?.socials ? Object.entries(metadata.socials) : []

  return (
    <article className={styles.profile}>
      {/* Banner */}
      <div className={`${styles.banner} ${hasBanner ? styles.bannerImg : styles.bannerBlank}`}>
        {hasBanner && metadata != null && metadata.banner !== '' && (
          <img
            src={resolveUri(metadata.banner)}
            alt=""
            className={styles.bannerImage}
            onError={() => setBannerError(true)}
          />
        )}
      </div>

      {/* Avatar */}
      <div className={styles.avatarWrap}>
        {hasAvatar && metadata != null && metadata.avatar !== '' ? (
          <img
            src={resolveUri(metadata.avatar)}
            alt={displayName}
            className={styles.avatarImage}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <GlyphAvatar char={glyphChar} />
        )}
      </div>

      {/* Identity */}
      <div className={styles.identity}>
        <h1 className={`${styles.name} text-chromatic-strong`}>{displayName}</h1>
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
