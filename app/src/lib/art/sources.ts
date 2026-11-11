/**
 * What a creator dropped, as one flat list of files with paths: loose files, a chosen folder, a
 * dragged folder, or a zip, which is opened in place (see `zip.ts`) rather than unpacked.
 *
 * Operating-system clutter (`__MACOSX/`, `.DS_Store`, `Thumbs.db`, dotfiles) is dropped quietly and
 * only counted. Anything else that cannot be used is kept, with the reason, so the review screen can
 * list it: a creator who sees "37 pieces" when they expected 40 needs to know which three were left
 * out and why.
 */
import { readZip, ZipError } from './zip'

/** One dropped file. Bytes are read only when asked for. */
export interface InputFile {
  /** Path within what was dropped, `/`-separated, with a single wrapping folder removed. */
  path: string
  size: number
  bytes(): Promise<Uint8Array>
  head(n: number): Promise<Uint8Array>
}

export interface Skipped {
  path: string
  reason: string
}

export interface Collected {
  files: InputFile[]
  skipped: Skipped[]
  /** System files ignored without comment. */
  junk: number
}

/** A dropped file and where it sat: a `File` and its path relative to what was dropped. */
export interface Dropped {
  path: string
  file: Blob & { name: string }
}

const JUNK_NAMES = new Set(['thumbs.db', 'desktop.ini', 'ehthumbs.db', '.ds_store'])

/** Whether a path is operating-system clutter rather than something the creator meant to drop. */
export function isJunk(path: string): boolean {
  const parts = path.split('/').filter((p) => p !== '')
  if (parts.some((p) => p === '__MACOSX' || p.startsWith('.'))) return true
  const name = parts[parts.length - 1] ?? ''
  return JUNK_NAMES.has(name.toLowerCase())
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function extensionOf(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function fromBlob(path: string, blob: Blob): InputFile {
  return {
    path,
    size: blob.size,
    bytes: async () => new Uint8Array(await blob.arrayBuffer()),
    head: async (n) => new Uint8Array(await blob.slice(0, n).arrayBuffer()),
  }
}

/** Remove one folder that wraps everything (`MyCollection/images/1.png` → `images/1.png`). */
function unwrap(files: InputFile[]): InputFile[] {
  for (;;) {
    const first = files[0]?.path.split('/')
    if (first === undefined || first.length < 2) return files
    const top = `${first[0]}/`
    if (!files.every((f) => f.path.startsWith(top) && f.path.length > top.length)) return files
    files = files.map((f) => ({ ...f, path: f.path.slice(top.length) }))
  }
}

/** Everything dropped, zips opened, clutter removed. */
export async function collect(dropped: readonly Dropped[]): Promise<Collected> {
  const files: InputFile[] = []
  const skipped: Skipped[] = []
  let junk = 0
  for (const { path, file } of dropped) {
    const clean = path.replace(/^\/+/, '')
    if (isJunk(clean)) {
      junk++
      continue
    }
    if (extensionOf(clean) !== 'zip') {
      files.push(fromBlob(clean, file))
      continue
    }
    let entries
    try {
      entries = await readZip(file)
    } catch (error) {
      skipped.push({
        path: clean,
        reason: error instanceof ZipError ? error.message : 'the zip could not be read',
      })
      continue
    }
    // One zip on its own is the collection; a zip among other files is a folder of its own.
    const prefix = dropped.length === 1 ? '' : `${clean.replace(/\.zip$/i, '')}/`
    for (const entry of entries) {
      const inner = prefix + entry.path
      if (isJunk(entry.path)) {
        junk++
      } else if (entry.unreadable !== null) {
        skipped.push({ path: inner, reason: `cannot be read from the zip: ${entry.unreadable}` })
      } else if (extensionOf(entry.path) === 'zip') {
        skipped.push({ path: inner, reason: 'a zip inside a zip; unzip it and drop it on its own' })
      } else {
        files.push({ path: inner, size: entry.size, bytes: entry.bytes, head: entry.head })
      }
    }
  }
  const unwrapped = unwrap(files)
  return { files: unwrapped, skipped, junk }
}

/** Files from an `<input type="file">`, keeping the folder paths a folder picker gives them. */
export function fromFileList(list: ArrayLike<File>): Dropped[] {
  return Array.from(list, (file) => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }))
}

interface FsEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void
  createReader?: () => {
    readEntries: (ok: (entries: FsEntry[]) => void, fail: (error: unknown) => void) => void
  }
}

async function walk(entry: FsEntry, out: Dropped[]): Promise<void> {
  if (entry.isFile && entry.file !== undefined) {
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail))
    out.push({ path: entry.fullPath.replace(/^\/+/, ''), file })
    return
  }
  if (entry.isDirectory && entry.createReader !== undefined) {
    const reader = entry.createReader()
    // `readEntries` answers in batches (100 in Chrome) until it answers with none.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail))
      if (batch.length === 0) return
      for (const child of batch) await walk(child, out)
    }
  }
}

/** Files from a drop, folders walked recursively. */
export async function fromDataTransfer(transfer: DataTransfer): Promise<Dropped[]> {
  const entries: FsEntry[] = []
  for (const item of Array.from(transfer.items ?? [])) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }
    ).webkitGetAsEntry?.()
    if (entry != null) entries.push(entry)
  }
  if (entries.length === 0) return fromFileList(transfer.files)
  const out: Dropped[] = []
  for (const entry of entries) await walk(entry, out)
  return out
}
