/**
 * Moving hosted art to IPFS: the metadata a migrated collection points at, worked out from facts
 * anyone can check.
 *
 * Hosted per-piece JSON names its image by the art host's gateway-shaped link
 * (`https://<host>/ipfs/<imgCid>/<n>.<ext>`). That link stays a valid content address after the
 * art moves, but it still names our host. So moving the art properly means writing the metadata
 * again with a plain IPFS link —
 *
 *   `{"name":"#<n>","image":"ipfs://<imgCid>/<n>.<ext>"}`
 *
 * — one file per piece, named by bare piece number exactly as before, imported with the same
 * UnixFS parameters. The result is a new metadata root, and the collection's per-token base becomes
 * `ipfs://<that root>/`.
 *
 * DETERMINISTIC ON PURPOSE. The inputs are the images root and the image file names; nothing else.
 * The creator's browser builds it to pin, the art service builds it to recognise a finished move on
 * chain, and any visitor's browser builds it to check the collection's on-chain base really is that
 * move. All three must get the same CID, so the JSON is written by one function here, with fixed key
 * order and no whitespace.
 *
 * DEPENDENCY-FREE, like `hostingLimits.ts`: the art service imports this file and cannot resolve
 * the app's packages. The one step that needs a UnixFS importer is passed one by the caller.
 */
import { PIECE_IMAGE_NAME } from './hostingLimits'

/** The piece number an image file name carries (`12.png` → 12), or null for any other name. */
export function pieceOfImageName(name: string): number | null {
  if (!PIECE_IMAGE_NAME.test(name)) return null
  return Number.parseInt(name, 10)
}

/** One piece's migrated JSON. Same shape as the hosted JSON, with an `ipfs://` image. */
export function migratedPieceJson(piece: number, imgCid: string, imageName: string): string {
  return JSON.stringify({ name: `#${piece}`, image: `ipfs://${imgCid}/${imageName}` })
}

/** A file to import: a directory-relative path and its bytes. */
export interface MigrationFile {
  path: string
  content: Uint8Array
}

/**
 * The migrated metadata directory, one file per image, ordered by piece.
 *
 * Throws on a name that is not `<piece>.<ext>` or on two images for one piece: either means the list
 * did not come from a hosted upload, and a CID built from it would match nothing on chain.
 */
export function migrationFiles(imgCid: string, imageNames: readonly string[]): MigrationFile[] {
  if (imageNames.length === 0) throw new Error('no images to migrate')
  const encoder = new TextEncoder()
  const seen = new Set<number>()
  const pieces = imageNames.map((name) => {
    const piece = pieceOfImageName(name)
    if (piece === null) throw new Error(`${name} is not a hosted piece image`)
    if (seen.has(piece)) throw new Error(`piece ${piece} has more than one image`)
    seen.add(piece)
    return { piece, name }
  })
  pieces.sort((a, b) => a.piece - b.piece)
  return pieces.map(({ piece, name }) => ({
    path: String(piece),
    content: encoder.encode(migratedPieceJson(piece, imgCid, name)),
  }))
}

/** Imports files into one wrapped directory and returns its root CID as a string. */
export type ImportDirectory = (files: readonly MigrationFile[]) => Promise<string>

/** The migrated metadata root for a hosted upload: `metaCID2`. */
export async function migratedMetaCid(
  imgCid: string,
  imageNames: readonly string[],
  importDirectory: ImportDirectory,
): Promise<string> {
  return importDirectory(migrationFiles(imgCid, imageNames))
}

/** The per-token base a migrated collection writes on chain. */
export function migratedBaseUri(metaCid: string): string {
  return `ipfs://${metaCid}/`
}

/**
 * Whether an on-chain per-token base is the migrated one. Exact, trailing slash included:
 * `tokenURI` is `base + id`, so a base without the slash is a different, broken pointer.
 */
export function isMigratedBase(uri: string, metaCid: string): boolean {
  return uri.trim() === migratedBaseUri(metaCid)
}

/**
 * The pieces worth checking on a gateway: the first, the last, and one from the middle. Enough to
 * catch a pin that never finished or a CAR that held only part of the directory, without asking a
 * metered public gateway for every file.
 */
export function samplePieces<T>(items: readonly T[], count = 3): T[] {
  if (items.length <= count) return [...items]
  const picks = new Set<number>([0, items.length - 1])
  for (let i = 1; picks.size < count; i++) {
    picks.add(Math.floor((items.length * i) / count))
  }
  return [...picks].sort((a, b) => a - b).map((i) => items[i]!)
}
