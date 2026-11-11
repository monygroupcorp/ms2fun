/**
 * Working out what a creator dropped: which images are pieces, which metadata belongs to which
 * image, what token id each piece is, and everything that stands in the way of uploading it.
 *
 * LAYOUTS, detected from the files themselves rather than chosen by the creator:
 *
 *   per-piece   images and one JSON per piece — `1.png` beside `1.json`, or `images/` beside a `json/`
 *               or `metadata/` folder — which is what HashLips and most generators write
 *   aggregate   images and one JSON file holding a list of every piece (`_metadata.json`)
 *   csv         images and a spreadsheet: a file column, name, description, a column per trait
 *   images      images alone; the creator types a name pattern and the metadata is written for them
 *
 * PAIRING. Each piece's metadata is matched to an image by the file name its `image` link ends in
 * (placeholder links such as `ipfs://NewUriToReplace/7.png` still name the file), then by its number
 * (the JSON file's own number, `edition`, or the sheet's id column), then by base name
 * (`dragon.json` ↔ `dragon.png`).
 *
 * TOKEN IDS. The collection's first NFT is token #1 (DN404 counts from one, and ids never go past
 * the NFT supply), and `tokenURI(id)` is the base plus the id, so piece N must be token N. Pieces
 * keep the numbers their files carry; a set numbered from 0 is moved up by one, with a notice.
 *
 * Nothing here uploads, signs or builds a CID. It reads the metadata files and the first bytes of
 * each image, and returns a plan the review screen shows in full before anything leaves the browser.
 */
import {
  HOSTING_LIMITS,
  hostedImageExt,
  sniffMatchesExt,
  type HostedImageExt,
} from './hostingLimits'
import { columnOf, parseCsv, type CsvColumn } from './csv'
import {
  decodeUtf8,
  describeProblem,
  minifyJsonObject,
  minifyJsonObjectList,
  type MinifiedObject,
} from './pieceJson'
import { baseName, extensionOf, type Collected, type InputFile, type Skipped } from './sources'

export type Layout = 'per-piece' | 'aggregate' | 'csv' | 'images'

export interface Trait {
  trait_type: string
  value: string
}

export interface PlannedPiece {
  /** The token id this piece is. */
  piece: number
  /** The image to host; null only when the metadata's art is already on IPFS and none was dropped. */
  image: InputFile | null
  ext: HostedImageExt | null
  /** The creator's metadata, minified; null when it is written from the name pattern. */
  meta: MinifiedObject | null
  /** Where the metadata came from, for messages: `json/3.json`, `_metadata.json item 3`, … */
  source: string
  name: string | null
  traits: Trait[]
}

export interface ArtPlan {
  layout: Layout
  pieces: PlannedPiece[]
  /** Problems that stop an upload, each naming the files or pieces involved. */
  blockers: string[]
  /** Worth reading, but not in the way. */
  warnings: string[]
  /** Things this did for the creator, said out loud (renumbering, replaced placeholder links). */
  notices: string[]
  skipped: Skipped[]
  junk: number
  imageBytes: number
  /** Pieces whose metadata will be written from the name pattern. */
  generated: number
  /**
   * Set when every piece's `image` already links real IPFS content: the creator may skip hosting
   * and use their metadata as it is. `blockers` lists only what stops THAT path.
   */
  ipfs: { blockers: string[] } | null
}

export interface PlanOptions {
  /** The collection's NFT supply, when the creator has entered it. */
  supply: number | null
}

const VIDEO = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
  'avi',
  'mkv',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'glb',
  'gltf',
  'obj',
  'fbx',
  'usdz',
  'html',
  'htm',
])

/** A CID-shaped IPFS link: `ipfs://<cid>/…` or a gateway's `/ipfs/<cid>/…`. Placeholders fail it. */
const REAL_IPFS =
  /^(?:ipfs:\/\/|https?:\/\/[^/]+\/ipfs\/)(baf[a-z2-7]{50,}|Qm[1-9A-HJ-NP-Za-km-z]{44})(?:\/|$)/

export function isRealIpfsLink(image: unknown): boolean {
  return typeof image === 'string' && REAL_IPFS.test(image.trim())
}

/** The file name an image link ends in, decoded, or null when it names none. */
export function fileNameOf(image: unknown): string | null {
  if (typeof image !== 'string') return null
  const path = image.trim().split(/[?#]/)[0]!
  const last = path.slice(path.lastIndexOf('/') + 1)
  if (last === '' || !last.includes('.')) return null
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\s*\d{1,12}\s*$/.test(value)) return Number(value)
  return null
}

const stem = (path: string) => baseName(path).replace(/\.[^.]*$/, '')
const numericStem = (path: string) => (/^\d{1,12}$/.test(stem(path)) ? Number(stem(path)) : null)
const naturally = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** `1, 2, 3, 7, 9, 10` → `1–3, 7, 9–10`, cut short past a dozen runs. */
export function describeIds(ids: readonly number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++
    runs.push(j === i ? `#${sorted[i]}` : `#${sorted[i]}–#${sorted[j]}`)
    i = j + 1
  }
  return runs.length > 12 ? `${runs.slice(0, 12).join(', ')} and more` : runs.join(', ')
}

function listOf(names: readonly string[], max = 8): string {
  return names.length > max
    ? `${names.slice(0, max).join(', ')} and ${names.length - max} more`
    : names.join(', ')
}

function traitsOf(meta: MinifiedObject): { name: string | null; traits: Trait[] } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(meta.text) as Record<string, unknown>
  } catch {
    return { name: null, traits: [] }
  }
  const traits: Trait[] = []
  if (Array.isArray(parsed['attributes'])) {
    for (const item of parsed['attributes']) {
      if (item === null || typeof item !== 'object') continue
      const t = item as Record<string, unknown>
      const type = t['trait_type'] ?? t['type']
      const value = t['value']
      if (value === undefined || value === null) continue
      traits.push({
        trait_type: typeof type === 'string' ? type : '(untyped)',
        value: typeof value === 'string' ? value : JSON.stringify(value),
      })
    }
  }
  const name = typeof parsed['name'] === 'string' ? parsed['name'] : null
  return { name, traits }
}

/** One piece's metadata, before it is matched to an image. */
interface Entry {
  source: string
  meta: MinifiedObject
  /** The number the metadata carries: its file's number, its `edition`, or the sheet's id. */
  number: number | null
  /** The metadata file's own base name, for `dragon.json` ↔ `dragon.png`. */
  stem: string | null
  /** The image file the metadata names. */
  imageRef: string | null
  order: number
}

const READ_CONCURRENCY = 16

async function inPool<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await run(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker))
}

/** CSV columns to metadata, in a fixed key order so the same sheet always gives the same JSON. */
function csvEntry(
  header: string[],
  columns: CsvColumn[],
  cells: string[],
): { json: string; number: number | null; file: string | null } {
  const fields: Record<string, unknown> = {}
  let number: number | null = null
  let file: string | null = null
  const attributes: Trait[] = []
  const known = (column: CsvColumn) => cells[columns.indexOf(column)] ?? ''
  if (known('name') !== '') fields['name'] = known('name')
  if (known('description') !== '') fields['description'] = known('description')
  fields['image'] = ''
  for (const column of [
    'external_url',
    'animation_url',
    'background_color',
    'youtube_url',
  ] as const) {
    if (known(column) !== '') fields[column] = known(column)
  }
  columns.forEach((column, i) => {
    const cell = cells[i] ?? ''
    if (column === 'trait' && cell !== '') attributes.push({ trait_type: header[i]!, value: cell })
    if (column === 'number') number = numberOf(cell)
    if (column === 'file' && cell !== '') file = fileNameOf(cell.includes('/') ? cell : `/${cell}`)
  })
  if (attributes.length > 0) fields['attributes'] = attributes
  return { json: JSON.stringify(fields), number, file }
}

/**
 * Plan an upload from what was dropped. Reads every metadata file and the first bytes of every
 * image; never reads an image whole.
 */
export async function planArt(collected: Collected, options: PlanOptions): Promise<ArtPlan> {
  const blockers: string[] = []
  const warnings: string[] = []
  const notices: string[] = []
  const skipped: Skipped[] = [...collected.skipped]

  // ── Sort the files by what they are ───────────────────────────────────────────────────────
  const images: InputFile[] = []
  const jsons: InputFile[] = []
  const csvs: InputFile[] = []
  for (const file of collected.files) {
    const ext = extensionOf(file.path)
    if (hostedImageExt(file.path) !== null) images.push(file)
    else if (ext === 'json' || (ext === '' && numericStem(file.path) !== null)) jsons.push(file)
    else if (ext === 'csv' || ext === 'tsv') csvs.push(file)
    else if (VIDEO.has(ext)) {
      skipped.push({
        path: file.path,
        reason: 'video, audio, 3D and HTML are not hosted; keep animation_url pointing where it is',
      })
    } else if (ext === 'svg') {
      skipped.push({ path: file.path, reason: 'SVG cannot be hosted; use PNG, JPEG, WebP or GIF' })
    } else {
      skipped.push({ path: file.path, reason: 'not an image, JSON or CSV' })
    }
  }
  images.sort((a, b) => naturally(a.path, b.path))

  // ── Images: size and format, from the first bytes only ────────────────────────────────────
  const usable: InputFile[] = []
  let imageBytes = 0
  await inPool(images, async (image) => {
    const ext = hostedImageExt(image.path)!
    if (image.size > HOSTING_LIMITS.maxImageBytes) {
      blockers.push(
        `${image.path} is ${(image.size / 1048576).toFixed(1)} MiB; each image may be at most 10 MiB`,
      )
      return
    }
    if (image.size === 0) {
      blockers.push(`${image.path} is empty`)
      return
    }
    let head: Uint8Array
    try {
      head = await image.head(16)
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : `${image.path} could not be read`)
      return
    }
    if (!sniffMatchesExt(head, ext)) {
      blockers.push(`${image.path} is not really a ${ext.toUpperCase()} image`)
      return
    }
    usable.push(image)
    imageBytes += image.size
  })
  usable.sort((a, b) => naturally(a.path, b.path))

  // ── Metadata files ─────────────────────────────────────────────────────────────────────────
  const perPiece: Entry[] = []
  const aggregates: Array<{ file: InputFile; entries: Entry[] }> = []
  await inPool(jsons, async (file) => {
    if (file.size > HOSTING_LIMITS.maxMetadataBytes) {
      blockers.push(`${file.path} is too large to be metadata`)
      return
    }
    const text = decodeUtf8(await file.bytes())
    if (text === null) {
      blockers.push(`${file.path} is not UTF-8 text`)
      return
    }
    const trimmed = text.replace(/^﻿/, '').trimStart()
    if (trimmed.startsWith('[')) {
      const list = minifyJsonObjectList(text)
      if (!list.ok) {
        blockers.push(describeProblem(file.path, list.problem))
        return
      }
      aggregates.push({
        file,
        entries: list.objects.map((meta, i) => {
          const parsed = JSON.parse(meta.text) as Record<string, unknown>
          return {
            source: `${file.path} item ${i + 1}`,
            meta,
            number: numberOf(
              parsed['edition'] ?? parsed['tokenId'] ?? parsed['token_id'] ?? parsed['id'],
            ),
            stem: null,
            imageRef: fileNameOf(meta.image),
            order: i,
          }
        }),
      })
      return
    }
    if (!trimmed.startsWith('{')) {
      if (extensionOf(file.path) === '') {
        skipped.push({ path: file.path, reason: 'not an image, JSON or CSV' })
      } else {
        blockers.push(`${file.path}, line 1, column 1: expected a JSON object`)
      }
      return
    }
    const meta = minifyJsonObject(text)
    if (!meta.ok) {
      blockers.push(describeProblem(file.path, meta.problem))
      return
    }
    if (meta.text.length > HOSTING_LIMITS.maxPieceJsonBytes) {
      blockers.push(
        `${file.path} is over the ${HOSTING_LIMITS.maxPieceJsonBytes / 1024} KiB limit per piece`,
      )
      return
    }
    perPiece.push({
      source: file.path,
      meta,
      number: numericStem(file.path),
      stem: stem(file.path).toLowerCase(),
      imageRef: fileNameOf(meta.image),
      order: 0,
    })
  })
  perPiece.sort((a, b) => naturally(a.source, b.source))
  perPiece.forEach((e, i) => (e.order = i))

  const sheets: Array<{ file: InputFile; entries: Entry[] }> = []
  for (const file of csvs) {
    const text = decodeUtf8(await file.bytes())
    if (text === null) {
      blockers.push(`${file.path} is not UTF-8 text; export it as "CSV UTF-8"`)
      continue
    }
    const sheet = parseCsv(text)
    if (!sheet.ok) {
      blockers.push(describeProblem(file.path, sheet.problem))
      continue
    }
    const columns = sheet.header.map(columnOf)
    if (!columns.includes('file') && !columns.includes('number')) {
      blockers.push(
        `${file.path}: add a "file" column naming each piece's image (or an "id" column numbering them)`,
      )
      continue
    }
    const entries: Entry[] = []
    for (const [i, row] of sheet.rows.entries()) {
      const { json, number, file: ref } = csvEntry(sheet.header, columns, row.cells)
      const meta = minifyJsonObject(json)
      if (!meta.ok) continue
      entries.push({
        source: `${file.path} line ${row.line}`,
        meta,
        number,
        stem: null,
        imageRef: ref,
        order: i,
      })
    }
    sheets.push({ file, entries })
  }

  // ── Which metadata to use ─────────────────────────────────────────────────────────────────
  let layout: Layout = 'images'
  let entries: Entry[] = []
  const unused = (files: InputFile[], why: string) =>
    files.forEach((f) => skipped.push({ path: f.path, reason: why }))
  if (perPiece.length > 0) {
    layout = 'per-piece'
    entries = perPiece
    unused(
      aggregates.map((a) => a.file),
      'not used: the per-piece JSON files are used instead',
    )
    unused(
      sheets.map((s) => s.file),
      'not used: the per-piece JSON files are used instead',
    )
  } else if (aggregates.length > 0) {
    layout = 'aggregate'
    if (aggregates.length > 1) {
      blockers.push(
        `more than one list of metadata: ${listOf(aggregates.map((a) => a.file.path))}; keep one`,
      )
    }
    entries = aggregates[0]!.entries
    unused(
      sheets.map((s) => s.file),
      'not used: the JSON metadata is used instead',
    )
  } else if (sheets.length > 0) {
    layout = 'csv'
    if (sheets.length > 1) {
      blockers.push(
        `more than one spreadsheet: ${listOf(sheets.map((s) => s.file.path))}; keep one`,
      )
    }
    entries = sheets[0]!.entries
  }

  // ── Already on IPFS? ──────────────────────────────────────────────────────────────────────
  const onIpfs = entries.length > 0 && entries.every((e) => isRealIpfsLink(e.meta.image))

  // ── Pair metadata with images ─────────────────────────────────────────────────────────────
  const byName = new Map<string, InputFile[]>()
  const byNumber = new Map<number, InputFile[]>()
  const byStem = new Map<string, InputFile[]>()
  const add = <K>(map: Map<K, InputFile[]>, key: K, file: InputFile) =>
    map.set(key, [...(map.get(key) ?? []), file])
  for (const image of usable) {
    add(byName, baseName(image.path).toLowerCase(), image)
    add(byStem, stem(image.path).toLowerCase(), image)
    const n = numericStem(image.path)
    if (n !== null) add(byNumber, n, image)
  }
  const only = (found: InputFile[] | undefined) => (found?.length === 1 ? found[0]! : null)

  const used = new Map<InputFile, string>()
  const paired: Array<{ entry: Entry | null; image: InputFile | null }> = []
  const unpaired: Entry[] = []
  const collectionLike: Entry[] = []
  const numberedJson = perPiece.some((e) => e.number !== null)
  for (const entry of entries) {
    const image =
      (entry.imageRef !== null ? only(byName.get(entry.imageRef.toLowerCase())) : null) ??
      (entry.number !== null ? only(byNumber.get(entry.number)) : null) ??
      (entry.stem !== null ? only(byStem.get(entry.stem)) : null)
    if (image === null) {
      // `collection.json` beside `1.json … 100.json` describes the collection, not a piece.
      if (layout === 'per-piece' && entry.number === null && numberedJson)
        collectionLike.push(entry)
      else unpaired.push(entry)
      continue
    }
    const other = used.get(image)
    if (other !== undefined) {
      warnings.push(`${image.path} is the image of both ${other} and ${entry.source}`)
    }
    used.set(image, entry.source)
    paired.push({ entry, image })
  }
  for (const entry of collectionLike) {
    skipped.push({
      path: entry.source,
      reason: 'no image or piece number matches it; it looks like collection metadata',
    })
  }

  const hostBlockers: string[] = []
  if (unpaired.length > 0) {
    hostBlockers.push(
      `${unpaired.length} piece${unpaired.length === 1 ? ' has' : 's have'} metadata but no matching image: ` +
        listOf(
          unpaired.map((e) => (e.imageRef === null ? e.source : `${e.source} (${e.imageRef})`)),
        ),
    )
  }
  const leftover = usable.filter((image) => !used.has(image))
  if (entries.length > 0 && leftover.length > 0 && !(onIpfs && usable.length === leftover.length)) {
    warnings.push(
      `${leftover.length} image${leftover.length === 1 ? ' has' : 's have'} no metadata, so it will be ` +
        `written from the name pattern: ${listOf(leftover.map((f) => f.path))}`,
    )
  }
  for (const image of leftover) paired.push({ entry: null, image })
  if (usable.length === 0 && !onIpfs) {
    if (entries.length > 0) hostBlockers.push('add the image files: only metadata was dropped')
    else if (blockers.length === 0)
      hostBlockers.push('drop at least one PNG, JPEG, WebP or GIF image')
  }

  // ── Token ids ────────────────────────────────────────────────────────────────────────────
  const numberPieces = (
    list: Array<{ entry: Entry | null; image: InputFile | null }>,
    sink: string[],
  ): Array<{ entry: Entry | null; image: InputFile | null; piece: number }> => {
    const tries: Array<[string, (p: (typeof list)[number]) => number | null]> = [
      ['', (p) => p.entry?.number ?? (p.image === null ? null : numericStem(p.image.path))],
      ['', (p) => (p.image === null ? null : numericStem(p.image.path))],
    ]
    let numbers: number[] | null = null
    for (const [, pick] of tries) {
      const got = list.map(pick)
      if (got.every((n) => n !== null) && new Set(got).size === got.length) {
        numbers = got as number[]
        break
      }
    }
    if (numbers === null) {
      const key = (p: (typeof list)[number]) =>
        p.entry !== null && layout !== 'per-piece'
          ? `\u0000${String(p.entry.order).padStart(9, '0')}`
          : (p.image?.path ?? p.entry?.source ?? '')
      const order = [...list.keys()].sort((a, b) => naturally(key(list[a]!), key(list[b]!)))
      numbers = new Array<number>(list.length)
      order.forEach((index, i) => (numbers![index] = i + 1))
      if (list.length > 1) {
        notices.push(
          layout === 'aggregate' || layout === 'csv'
            ? 'Pieces are numbered in the order your metadata lists them.'
            : 'Your files are not numbered, so pieces are numbered in file-name order.',
        )
      }
    }
    if (numbers.length > 0 && Math.min(...numbers) === 0) {
      numbers = numbers.map((n) => n + 1)
      notices.push(
        'Your files are numbered from 0, but the first NFT is token #1, so every piece moves up by ' +
          'one: 0 becomes #1, 1 becomes #2, and so on. Names inside your metadata (such as "#0") ' +
          'are kept as you wrote them.',
      )
    }
    const tooBig = numbers.filter((n) => n > 999_999_999)
    if (tooBig.length > 0)
      sink.push(`piece numbers past 999,999,999 cannot be token ids: ${describeIds(tooBig)}`)
    return list.map((p, i) => ({ ...p, piece: numbers![i]! }))
  }

  const checkIds = (ids: number[], sink: string[]) => {
    if (ids.length === 0) return
    if (ids.length > HOSTING_LIMITS.maxFiles) {
      sink.push(
        `${ids.length} pieces is more than the ${HOSTING_LIMITS.maxFiles.toLocaleString()} one collection may host`,
      )
    }
    const have = new Set(ids)
    const supply = options.supply
    if (supply !== null && supply > 0) {
      const missing: number[] = []
      for (let id = 1; id <= supply && missing.length < 10_000; id++)
        if (!have.has(id)) missing.push(id)
      if (missing.length > 0) {
        sink.push(
          `this collection has ${supply.toLocaleString()} NFT${supply === 1 ? '' : 's'} but ${missing.length.toLocaleString()} ` +
            `of them would have no art: ${describeIds(missing)}`,
        )
      }
      const extra = ids.filter((id) => id > supply)
      if (extra.length > 0) {
        sink.push(
          `${extra.length.toLocaleString()} piece${extra.length === 1 ? ' is' : 's are'} past the NFT supply of ` +
            `${supply.toLocaleString()}, so no token would ever show ${extra.length === 1 ? 'it' : 'them'}: ${describeIds(extra)}`,
        )
      }
    } else if (ids.length > 0) {
      const max = Math.max(...ids)
      const missing: number[] = []
      for (let id = 1; id <= max && missing.length < 10_000; id++)
        if (!have.has(id)) missing.push(id)
      if (missing.length > 0) sink.push(`there is no art for ${describeIds(missing)}`)
      notices.push('Enter the NFT supply above to check the pieces against it.')
    }
  }

  const numbered = numberPieces(paired, hostBlockers)
  checkIds(
    numbered.map((p) => p.piece),
    hostBlockers,
  )

  const pieces: PlannedPiece[] = numbered
    .map(({ entry, image, piece }) => ({
      piece,
      image,
      ext: image === null ? null : hostedImageExt(image.path),
      meta: entry?.meta ?? null,
      source: entry?.source ?? image?.path ?? '',
      ...(entry === null ? { name: null, traits: [] } : traitsOf(entry.meta)),
    }))
    .sort((a, b) => a.piece - b.piece)

  // ── Sizes ────────────────────────────────────────────────────────────────────────────────
  // The CAR adds a little to the images (headers, directory nodes, metadata); leave room for it.
  if (imageBytes > HOSTING_LIMITS.maxUploadBytes * 0.97) {
    hostBlockers.push(
      `${(imageBytes / 1073741824).toFixed(2)} GiB of images is more than one collection may upload ` +
        `(${HOSTING_LIMITS.maxUploadBytes / 1073741824} GiB)`,
    )
  }
  const metaBytes = pieces.reduce((n, p) => n + (p.meta?.text.length ?? 0), 0)
  if (metaBytes > HOSTING_LIMITS.maxMetadataBytes * 0.9) {
    hostBlockers.push('the metadata is too large to host in total; trim long fields')
  }

  // ── Placeholder links, said out loud ──────────────────────────────────────────────────────
  if (!onIpfs) {
    const placeholders = pieces.filter(
      (p) => p.meta !== null && !isRealIpfsLink(p.meta.image),
    ).length
    if (placeholders > 0) {
      notices.push(
        `The image link in ${placeholders === pieces.length ? 'every piece' : `${placeholders} pieces`} ` +
          'is a placeholder or points elsewhere; it will be replaced with the hosted copy. Every ' +
          'other field is kept exactly as you wrote it.',
      )
    }
  }

  // ── The already-on-IPFS path ──────────────────────────────────────────────────────────────
  let ipfs: ArtPlan['ipfs'] = null
  if (onIpfs) {
    const ipfsBlockers: string[] = []
    const asIs = numberPieces(
      entries.map((entry) => ({ entry, image: null })),
      ipfsBlockers,
    )
    checkIds(
      asIs.map((p) => p.piece),
      ipfsBlockers,
    )
    ipfs = { blockers: [...blockers, ...ipfsBlockers] }
    if (usable.length === 0) {
      // Nothing to host: the pieces are the metadata alone.
      pieces.splice(
        0,
        pieces.length,
        ...asIs
          .map(({ entry, piece }) => ({
            piece,
            image: null,
            ext: null,
            meta: entry!.meta,
            source: entry!.source,
            ...traitsOf(entry!.meta),
          }))
          .sort((a, b) => a.piece - b.piece),
      )
    }
  }
  const dedupe = (list: string[]) => [...new Set(list)]
  return {
    layout,
    pieces,
    blockers: dedupe([
      ...blockers,
      ...(onIpfs && usable.length === 0 ? (ipfs?.blockers ?? []) : hostBlockers),
    ]),
    warnings: dedupe(warnings),
    notices: dedupe(notices),
    skipped: skipped.sort((a, b) => naturally(a.path, b.path)),
    junk: collected.junk,
    imageBytes,
    generated: pieces.filter((p) => p.meta === null).length,
    ipfs,
  }
}

/** Every trait type and value with how many pieces carry it, most common first. */
export function traitSummary(
  pieces: readonly PlannedPiece[],
): Array<{ type: string; values: Array<{ value: string; count: number }> }> {
  const types = new Map<string, Map<string, number>>()
  for (const piece of pieces) {
    for (const trait of piece.traits) {
      const values = types.get(trait.trait_type) ?? new Map<string, number>()
      values.set(trait.value, (values.get(trait.value) ?? 0) + 1)
      types.set(trait.trait_type, values)
    }
  }
  return [...types]
    .map(([type, values]) => ({
      type,
      values: [...values]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || naturally(a.value, b.value)),
    }))
    .sort((a, b) => naturally(a.type, b.type))
}

/** The metadata written for a piece that has none: the creator's name pattern and description. */
export function generatedJson(piece: number, pattern: string, description: string): MinifiedObject {
  const name = (pattern.trim() === '' ? '#{n}' : pattern.trim()).replaceAll('{n}', String(piece))
  const fields: Record<string, string> = { name }
  if (description.trim() !== '') fields['description'] = description.trim()
  fields['image'] = ''
  const meta = minifyJsonObject(JSON.stringify(fields))
  if (!meta.ok) throw new Error('generated metadata did not parse')
  return meta
}
