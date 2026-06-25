import { useState } from 'react'
import type { ProfileMetadata, ProfileLink } from '../lib/metadata'
import styles from './ProfileEditForm.module.css'

interface SocialRow {
  key: string
  value: string
}

interface ProfileEditFormProps {
  initial?: ProfileMetadata
  onSave: (metadata: ProfileMetadata) => void
  saving?: boolean
}

function initLinks(links?: ProfileLink[]): ProfileLink[] {
  return links && links.length > 0 ? links.map((l) => ({ ...l })) : []
}

function initSocials(socials?: Record<string, string>): SocialRow[] {
  if (!socials) return []
  return Object.entries(socials).map(([key, value]) => ({ key, value }))
}

export function ProfileEditForm({ initial, onSave, saving }: ProfileEditFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [handle, setHandle] = useState(initial?.handle ?? '')
  const [bio, setBio] = useState(initial?.bio ?? '')
  const [avatar, setAvatar] = useState(initial?.avatar ?? '')
  const [banner, setBanner] = useState(initial?.banner ?? '')
  const [links, setLinks] = useState<ProfileLink[]>(() => initLinks(initial?.links))
  const [socials, setSocials] = useState<SocialRow[]>(() => initSocials(initial?.socials))

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const socialsRecord: Record<string, string> = {}
    for (const row of socials) {
      const k = row.key.trim()
      if (k) socialsRecord[k] = row.value.trim()
    }

    const metadata: ProfileMetadata = {
      schemaVersion: initial?.schemaVersion ?? 1,
      name: name.trim(),
      handle: handle.trim(),
      bio: bio.trim(),
      avatar: avatar.trim(),
      banner: banner.trim(),
      links: links
        .filter((l) => l.url.trim() !== '')
        .map((l) => ({
          label: l.label.trim(),
          url: l.url.trim(),
        })),
      socials: socialsRecord,
    }
    onSave(metadata)
  }

  // Link row helpers
  function addLink() {
    setLinks((prev) => [...prev, { label: '', url: '' }])
  }
  function updateLink(idx: number, field: keyof ProfileLink, value: string) {
    setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)))
  }
  function removeLink(idx: number) {
    setLinks((prev) => prev.filter((_, i) => i !== idx))
  }

  // Social row helpers
  function addSocial() {
    setSocials((prev) => [...prev, { key: '', value: '' }])
  }
  function updateSocial(idx: number, field: keyof SocialRow, value: string) {
    setSocials((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
  }
  function removeSocial(idx: number) {
    setSocials((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="pef-name">
          Name
        </label>
        <input
          id="pef-name"
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="pef-handle">
          Handle
        </label>
        <input
          id="pef-handle"
          className={styles.input}
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@handle"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="pef-bio">
          Bio
        </label>
        <textarea
          id="pef-bio"
          className={styles.textarea}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Short bio"
          rows={4}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="pef-avatar">
          Avatar URI
        </label>
        <input
          id="pef-avatar"
          className={styles.input}
          type="text"
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="ipfs://, ar://, https://, or data:"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="pef-banner">
          Banner URI
        </label>
        <input
          id="pef-banner"
          className={styles.input}
          type="text"
          value={banner}
          onChange={(e) => setBanner(e.target.value)}
          placeholder="ipfs://, ar://, https://, or data:"
        />
      </div>

      {/* Links */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Links</span>
          <button
            type="button"
            className={`btn btn-sm btn-secondary ${styles.addBtn}`}
            onClick={addLink}
          >
            + Add link
          </button>
        </div>
        {links.length > 0 && (
          <div className={styles.rowList}>
            {links.map((link, idx) => (
              <div key={idx} className={styles.row}>
                <input
                  className={styles.input}
                  type="text"
                  value={link.label}
                  onChange={(e) => updateLink(idx, 'label', e.target.value)}
                  placeholder="Label"
                  aria-label={`Link ${idx + 1} label`}
                />
                <input
                  className={`${styles.input} ${styles.rowUrl}`}
                  type="text"
                  value={link.url}
                  onChange={(e) => updateLink(idx, 'url', e.target.value)}
                  placeholder="https://"
                  aria-label={`Link ${idx + 1} URL`}
                />
                <button
                  type="button"
                  className={`btn btn-sm btn-ghost ${styles.removeBtn}`}
                  onClick={() => removeLink(idx)}
                  aria-label={`Remove link ${idx + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Socials */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Socials</span>
          <button
            type="button"
            className={`btn btn-sm btn-secondary ${styles.addBtn}`}
            onClick={addSocial}
          >
            + Add social
          </button>
        </div>
        {socials.length > 0 && (
          <div className={styles.rowList}>
            {socials.map((social, idx) => (
              <div key={idx} className={styles.row}>
                <input
                  className={styles.input}
                  type="text"
                  value={social.key}
                  onChange={(e) => updateSocial(idx, 'key', e.target.value)}
                  placeholder="Platform (e.g. x)"
                  aria-label={`Social ${idx + 1} platform`}
                />
                <input
                  className={`${styles.input} ${styles.rowUrl}`}
                  type="text"
                  value={social.value}
                  onChange={(e) => updateSocial(idx, 'value', e.target.value)}
                  placeholder="Handle or URL"
                  aria-label={`Social ${idx + 1} value`}
                />
                <button
                  type="button"
                  className={`btn btn-sm btn-ghost ${styles.removeBtn}`}
                  onClick={() => removeSocial(idx)}
                  aria-label={`Remove social ${idx + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary btn-chromatic" disabled={saving === true}>
          {saving === true ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  )
}
