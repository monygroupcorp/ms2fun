import { useState } from 'react'
import type { CollectionMetadata, ProfileLink } from '../../lib/metadata'
import styles from './CollectionMetaForm.module.css'

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
      <div className={styles.field}>
        <label className={styles.label} htmlFor="cmf-name">
          Name
        </label>
        <input
          id="cmf-name"
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => handleName(e.target.value)}
          placeholder="Collection name"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="cmf-description">
          Description
        </label>
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
        <label className={styles.label} htmlFor="cmf-image">
          Image URI
        </label>
        <input
          id="cmf-image"
          className={styles.input}
          type="text"
          value={image}
          onChange={(e) => handleImage(e.target.value)}
          placeholder="ipfs://, ar://, https://, or data:"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="cmf-banner">
          Banner URI
        </label>
        <input
          id="cmf-banner"
          className={styles.input}
          type="text"
          value={banner}
          onChange={(e) => handleBanner(e.target.value)}
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
    </div>
  )
}
