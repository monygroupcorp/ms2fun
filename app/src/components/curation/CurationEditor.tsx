import { useMemo, useState } from 'react'
import { useAllCollections, type ProjectCard } from '../../lib/discovery'
import { curationItemKey, type CurationItem, type CurationMetadata } from '../../lib/metadata'
import { CURATION_MAX_ITEMS } from '../../lib/metadata'
import { truncateAddress } from '../../lib/format'
import styles from './CurationEditor.module.css'

/** `0x` + 40 hex — the only thing that can be a pick without first being a known collection. */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TOKEN_ID_RE = /^[0-9]{1,78}$/

interface CurationEditorProps {
  initial?: CurationMetadata | undefined
  onSave: (metadata: CurationMetadata) => void
  onCancel?: (() => void) | undefined
  saving?: boolean | undefined
  saveLabel?: string
}

/**
 * The form behind "Create a curation" — and the whole of what assembling one takes.
 *
 * A pick is named the way the curator already thinks of it: by typing the collection's name, with
 * every registered collection offered as a suggestion. A raw address is also accepted, because a
 * collection this build's registry scan has not reached yet is still a real collection and refusing
 * it would make the surface depend on a scan finishing.
 *
 * The form holds no wallet and signs nothing: it hands a `CurationMetadata` to `onSave`, which is
 * the one transaction — a create or a repoint. That keeps the entire authoring cost at one
 * signature no matter how many picks are in the set.
 */
export function CurationEditor({
  initial,
  onSave,
  onCancel,
  saving,
  saveLabel = 'Publish curation',
}: CurationEditorProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [image, setImage] = useState(initial?.image ?? '')
  const [items, setItems] = useState<CurationItem[]>(() =>
    (initial?.items ?? []).map((i) => ({ ...i })),
  )

  const [pickInput, setPickInput] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [pickError, setPickError] = useState('')

  // The suggestion list. A scan still in flight just means fewer suggestions — never a blocked add,
  // since a pasted address bypasses the list entirely.
  const { data: collections } = useAllCollections({ sort: 'name' })
  const byName = useMemo(() => {
    const map = new Map<string, ProjectCard>()
    for (const c of collections ?? []) map.set(c.name.toLowerCase(), c)
    return map
  }, [collections])
  const byInstance = useMemo(() => {
    const map = new Map<string, ProjectCard>()
    for (const c of collections ?? []) map.set(c.instance.toLowerCase(), c)
    return map
  }, [collections])

  const full = items.length >= CURATION_MAX_ITEMS

  function addPick() {
    const typed = pickInput.trim()
    if (typed === '') return

    const instance = (
      ADDRESS_RE.test(typed)
        ? typed.toLowerCase()
        : byName.get(typed.toLowerCase())?.instance.toLowerCase()
    ) as `0x${string}` | undefined
    if (instance === undefined) {
      setPickError(`no collection called “${typed}” — pick one from the list, or paste its address`)
      return
    }

    const tokenId = tokenInput.trim()
    if (tokenId !== '' && !TOKEN_ID_RE.test(tokenId)) {
      setPickError('a piece is numbered — leave it blank to pick the whole collection')
      return
    }

    const pick: CurationItem = { instance, tokenId, note: '' }
    const key = curationItemKey(pick)
    if (items.some((i) => curationItemKey(i) === key)) {
      setPickError('that pick is already in this curation')
      return
    }

    setItems((prev) => [...prev, pick])
    setPickInput('')
    setTokenInput('')
    setPickError('')
  }

  function updateNote(idx: number, note: string) {
    setItems((prev) => prev.map((i, n) => (n === idx ? { ...i, note } : i)))
  }
  function removePick(idx: number) {
    setItems((prev) => prev.filter((_, n) => n !== idx))
  }
  function movePick(idx: number, by: -1 | 1) {
    setItems((prev) => {
      const to = idx + by
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(idx, 1)
      next.splice(to, 0, moved as CurationItem)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSave({
      schemaVersion: initial?.schemaVersion ?? 1,
      name: name.trim(),
      description: description.trim(),
      image: image.trim(),
      items: items.map((i) => ({ ...i, note: i.note.trim() })),
    })
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="cur-name">
          Title
        </label>
        <input
          id="cur-name"
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is this set?"
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="cur-description">
          Note
        </label>
        <textarea
          id="cur-description"
          className={styles.textarea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Why these, together."
          rows={3}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="cur-image">
          Cover URI
        </label>
        <input
          id="cur-image"
          className={styles.input}
          type="text"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="ipfs://, ar://, https://, or data:image/"
        />
      </div>

      <fieldset className={styles.picks}>
        <legend className={styles.label}>
          Picks{' '}
          <span className={styles.count}>
            {items.length} / {CURATION_MAX_ITEMS}
          </span>
        </legend>

        <div className={styles.adder}>
          <input
            className={styles.input}
            type="text"
            list="cur-collection-options"
            value={pickInput}
            onChange={(e) => {
              setPickInput(e.target.value)
              setPickError('')
            }}
            onKeyDown={(e) => {
              // Enter inside the adder adds a pick; it must not submit the whole form.
              if (e.key === 'Enter') {
                e.preventDefault()
                addPick()
              }
            }}
            placeholder="Collection name or address"
            aria-label="Collection name or address"
            disabled={full}
          />
          <datalist id="cur-collection-options">
            {(collections ?? []).map((c) => (
              <option key={c.instance} value={c.name}>
                {truncateAddress(c.instance)}
              </option>
            ))}
          </datalist>
          <input
            className={`${styles.input} ${styles.tokenInput}`}
            type="text"
            inputMode="numeric"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value)
              setPickError('')
            }}
            placeholder="#"
            aria-label="Piece number (optional)"
            disabled={full}
          />
          <button type="button" className="btn" onClick={addPick} disabled={full}>
            Add
          </button>
        </div>
        <p className={styles.hint}>
          Leave the number blank to pick the whole collection, or give an edition / token number to
          pick one piece.
        </p>
        {pickError !== '' && (
          <p className={styles.pickError} role="alert">
            {pickError}
          </p>
        )}
        {full && (
          <p className={styles.hint}>
            This curation is at its {CURATION_MAX_ITEMS}-pick ceiling. Remove one to add another.
          </p>
        )}

        {items.length === 0 ? (
          <p className={styles.hint}>
            Nothing picked yet. A curation can be published empty and filled later.
          </p>
        ) : (
          <ol className={styles.pickList}>
            {items.map((item, idx) => {
              const known = byInstance.get(item.instance)
              return (
                <li key={curationItemKey(item)} className={styles.pick}>
                  <div className={styles.pickHead}>
                    <span className={styles.pickName}>
                      {known?.name ?? truncateAddress(item.instance)}
                      {item.tokenId !== '' && (
                        <span className={styles.pickPiece}> #{item.tokenId}</span>
                      )}
                    </span>
                    <span className={styles.pickActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => movePick(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${known?.name ?? item.instance} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => movePick(idx, 1)}
                        disabled={idx === items.length - 1}
                        aria-label={`Move ${known?.name ?? item.instance} down`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => removePick(idx)}
                        aria-label={`Remove ${known?.name ?? item.instance}`}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  <input
                    className={styles.input}
                    type="text"
                    value={item.note}
                    onChange={(e) => updateNote(idx, e.target.value)}
                    placeholder="Why this one (optional)"
                    aria-label={`Note on ${known?.name ?? item.instance}`}
                  />
                </li>
              )
            })}
          </ol>
        )}
      </fieldset>

      <div className={styles.actions}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving === true || name.trim() === ''}
        >
          {saving === true ? 'confirm in wallet…' : saveLabel}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
