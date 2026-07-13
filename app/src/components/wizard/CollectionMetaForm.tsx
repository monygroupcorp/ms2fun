import { useState } from 'react'
import { collectionToDataUri, type CollectionMetadata, type ProfileLink } from '../../lib/metadata'
import { NAME_MAX, toSlug } from '../../lib/wizard/collectionName'
import styles from './CollectionMetaForm.module.css'
import { ImageSourceInput } from './ImageSourceInput'
import { LearnLink } from './LearnLink'
import { useNameAvailability } from './useNameAvailability'

export interface CollectionMetaFormProps {
  initial?: CollectionMetadata
  onChange: (metadata: CollectionMetadata) => void
}

function initLinks(links?: ProfileLink[]): ProfileLink[] {
  return links && links.length > 0 ? links.map((l) => ({ ...l })) : []
}

function assemble(
  schemaVersion: number,
  name: string,
  description: string,
  image: string,
  banner: string,
  category: string,
  links: ProfileLink[],
): CollectionMetadata {
  return {
    schemaVersion,
    name: name.trim(),
    description: description.trim(),
    image: image.trim(),
    banner: banner.trim(),
    category: category.trim(),
    links: links
      .filter((l) => l.url.trim() !== '')
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
  }
}

export function CollectionMetaForm({ initial, onChange }: CollectionMetaFormProps) {
  const schemaVersion = initial?.schemaVersion ?? 1

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [image, setImage] = useState(initial?.image ?? '')
  const [banner, setBanner] = useState(initial?.banner ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [links, setLinks] = useState<ProfileLink[]>(() => initLinks(initial?.links))

  const nameStatus = useNameAvailability(name)

  function emit(patch: {
    name?: string
    description?: string
    image?: string
    banner?: string
    category?: string
    links?: ProfileLink[]
  }) {
    onChange(
      assemble(
        schemaVersion,
        patch.name ?? name,
        patch.description ?? description,
        patch.image ?? image,
        patch.banner ?? banner,
        patch.category ?? category,
        patch.links ?? links,
      ),
    )
  }

  function handleName(v: string) {
    setName(v)
    emit({ name: v })
  }
  function handleDescription(v: string) {
    setDescription(v)
    emit({ description: v })
  }
  function handleImage(v: string) {
    setImage(v)
    emit({ image: v })
  }
  function handleBanner(v: string) {
    setBanner(v)
    emit({ banner: v })
  }
  function handleCategory(v: string) {
    setCategory(v)
    emit({ category: v })
  }

  const utf8Len = (s: string) => new TextEncoder().encode(s).length

  /**
   * The bytes an image *adds* to the on-chain `metadataURI` — the serialized-with minus the
   * serialized-without. Charging the bare data URI under-counts: `toJsonDataUri` URL-encodes the
   * whole JSON, tripling every `"`, `+`, `/`, and `=`. Measured on a real deploy: ~1.14x.
   */
  function marginalBytes(field: 'image' | 'banner', uri: string): number {
    const base = assemble(schemaVersion, name, description, image, banner, category, links)
    const withUri = collectionToDataUri({ ...base, [field]: uri.trim() })
    const without = collectionToDataUri({ ...base, [field]: '' })
    return Math.max(0, utf8Len(withUri) - utf8Len(without))
  }

  function addLink() {
    const next: ProfileLink[] = [...links, { label: '', url: '' }]
    setLinks(next)
    emit({ links: next })
  }
  function updateLink(idx: number, field: keyof ProfileLink, value: string) {
    const next = links.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    setLinks(next)
    emit({ links: next })
  }
  function removeLink(idx: number) {
    const next = links.filter((_, i) => i !== idx)
    setLinks(next)
    emit({ links: next })
  }

  return (
    <div className={styles.form}>
      <div className={styles.explainer}>
        <strong className={styles.explainerTitle}>This describes the collection itself</strong>
        <p className={styles.explainerBody}>
          Its title, story, and cover art — the page visitors land on. This is <em>not</em> the
          individual artworks or editions. You add those afterward from the collection dashboard.
          Everything here is written on-chain, so keep text tight and host images externally where
          you can.
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="cmf-name">
          Name
        </label>
        <p className={styles.help}>
          Letters, numbers, hyphens, and underscores &mdash; no spaces. Claimed once, globally and
          case-insensitively, and you can&rsquo;t rename it later. This becomes your
          collection&rsquo;s address on the site.
        </p>
        <input
          id="cmf-name"
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => handleName(e.target.value)}
          placeholder="my-collection"
          maxLength={NAME_MAX}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={nameStatus.state === 'invalid' || nameStatus.state === 'taken'}
          aria-describedby="cmf-name-status"
        />
        <p id="cmf-name-status" className={styles.nameStatus} aria-live="polite">
          {nameStatus.state === 'invalid' && (
            <span className={styles.nameBad}>{nameStatus.reason}</span>
          )}
          {nameStatus.state === 'taken' && (
            <span className={styles.nameBad}>&ldquo;{name.trim()}&rdquo; is already taken.</span>
          )}
          {nameStatus.state === 'checking' && (
            <span className={styles.nameMuted}>Checking&hellip;</span>
          )}
          {nameStatus.state === 'available' && (
            <span className={styles.nameOk}>Available &middot; /{toSlug(name)}</span>
          )}
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="cmf-description">
          Description
        </label>
        <p className={styles.help}>
          A sentence or two on what this collection is and the community it aligns to.
        </p>
        <textarea
          id="cmf-description"
          className={styles.textarea}
          value={description}
          onChange={(e) => handleDescription(e.target.value)}
          placeholder="Short description"
          rows={4}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="cmf-category">
          Category
        </label>
        <p className={styles.help}>One word to file it under — helps discovery.</p>
        <input
          id="cmf-category"
          className={styles.input}
          type="text"
          value={category}
          onChange={(e) => handleCategory(e.target.value)}
          placeholder="e.g. art, edition, pfp"
        />
      </div>

      <div className={styles.field}>
        <ImageSourceInput
          id="cmf-image"
          label="Cover image"
          value={image}
          onChange={handleImage}
          aspect="square"
          maxEdge={512}
          marginalBytes={(uri) => marginalBytes('image', uri)}
          help="You can launch without a cover and add or reveal art anytime after. A ready collection tends to do better — but that's your call. Host it anywhere permanent (IPFS, Arweave, or any HTTPS link you control) and paste the URL, or embed a small copy on-chain."
        />
        <p className={styles.help}>
          <LearnLink slug="withholding-art" /> · <LearnLink slug="onchain-image-cost" />
        </p>
      </div>

      <div className={styles.field}>
        <ImageSourceInput
          id="cmf-banner"
          label="Banner image"
          value={banner}
          onChange={handleBanner}
          aspect="wide"
          maxEdge={1200}
          marginalBytes={(uri) => marginalBytes('banner', uri)}
          help="Optional wide banner. Its main job is to populate the on-chain metadata that DEX charts (DEXScreener / DEXtools) read — so your chart shows a banner without paying for a listing upgrade. Paste a hosted link, or embed a small copy on-chain."
        />
        <p className={styles.help}>
          <LearnLink slug="cover-vs-banner" />
        </p>
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
                  className={`${styles.input} ${styles.rowLabel}`}
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
    </div>
  )
}
