/**
 * Moving hosted art to IPFS: the metadata a migrated collection points at, worked out from facts
 * anyone can check.
 *
 * Hosted per-piece JSON is the creator's own, as they wrote it, with one change: its `image` names
 * the art host's gateway-shaped link (`https://<host>/ipfs/<imgCid>/<n>.<ext>`). That link stays a
 * valid content address after the art moves, but it still names our host. So moving the art
 * properly means writing each piece's JSON again with ONLY that link switched to a plain IPFS one —
 *
 *   hosted    `{"name":"Sprite #1","attributes":[...],"image":"https://<host>/ipfs/<imgCid>/1.png"}`
 *   migrated  `{"name":"Sprite #1","attributes":[...],"image":"ipfs://<imgCid>/1.png"}`
 *
 * — one file per piece, named by bare piece number exactly as before, imported with the same
 * UnixFS parameters. The result is a new metadata root, and the collection's per-token base becomes
 * `ipfs://<that root>/`.
 *
 * DETERMINISTIC ON PURPOSE. The inputs are the images root and the hosted JSON, both public and both
 * content-addressed. The creator's browser builds the result to pin, the art service builds it to
 * recognise a finished move on chain, and any visitor's browser builds it to check the collection's
 * on-chain base really is that move. All three must get the same CID, so the rewrite is one function
 * here, over the minifier in `pieceJson.ts`, which changes nothing but the `image` value.
 *
 * DEPENDENCY-FREE, like `hostingLimits.ts`: the art service imports this file and cannot resolve
 * the app's packages. The one step that needs a UnixFS importer is passed one by the caller.
 */
import { PIECE_IMAGE_NAME, PIECE_JSON_NAME, parseGatewayShapedUri } from './hostingLimits'
import { minifyJsonObject, withImage } from './pieceJson'

/** The piece number an image file name carries (`12.png` → 12), or null for any other name. */
export function pieceOfImageName(name: string): number | null {
  if (!PIECE_IMAGE_NAME.test(name)) return null
  return Number.parseInt(name, 10)
}

/**
 * The image file a hosted piece's `image` names under `imgCid`, or null when it names anything
 * else: `https://<any host>/ipfs/<imgCid>/<file>`, a single file directly under the images root.
 */
export function hostedImageFile(image: unknown, imgCid: string): string | null {
  if (typeof image !== 'string') return null
  const shaped = parseGatewayShapedUri(image)
  if (shaped === null || shaped.cid !== imgCid) return null
  const match = /^\/([^/]+)$/.exec(shaped.path)
  return match === null ? null : match[1]!
}

/**
 * One piece's migrated JSON: the hosted JSON with its `image` switched to `ipfs://<imgCid>/<file>`.
 * Throws when the hosted JSON is not an object whose `image` is a link into `imgCid` — such a piece
 * did not come from a hosted upload, and a CID built from it would match nothing on chain.
 */
export function migratedPieceJson(hostedJson: string, imgCid: string): string {
  const parsed = minifyJsonObject(hostedJson)
  if (!parsed.ok) throw new Error(`hosted metadata is not valid JSON: ${parsed.problem.message}`)
  const file = hostedImageFile(parsed.image, imgCid)
  if (file === null) throw new Error('hosted metadata does not link an image under its images root')
  return withImage(parsed, `ipfs://${imgCid}/${file}`)
}

/** One hosted metadata file: its name in the metadata directory (the piece number) and its text. */
export interface HostedPiece {
  name: string
  json: string
}

/** A file to import: a directory-relative path and its bytes. */
export interface MigrationFile {
  path: string
  content: Uint8Array
}

/**
 * The migrated metadata directory, one file per hosted piece, under the same names.
 *
 * Throws on a name that is not a piece number, on a name that repeats, or on JSON that is not a
 * hosted piece's: any of those means the list did not come from a hosted upload.
 */
export function migrationFiles(imgCid: string, pieces: readonly HostedPiece[]): MigrationFile[] {
  if (pieces.length === 0) throw new Error('no pieces to migrate')
  const encoder = new TextEncoder()
  const seen = new Set<string>()
  for (const { name } of pieces) {
    if (!PIECE_JSON_NAME.test(name)) throw new Error(`${name} is not a piece number`)
    if (seen.has(name)) throw new Error(`piece ${name} appears more than once`)
    seen.add(name)
  }
  return [...pieces]
    .sort((a, b) => Number(a.name) - Number(b.name))
    .map(({ name, json }) => ({
      path: name,
      content: encoder.encode(migratedPieceJson(json, imgCid)),
    }))
}

/** Imports files into one wrapped directory and returns its root CID as a string. */
export type ImportDirectory = (files: readonly MigrationFile[]) => Promise<string>

/** The migrated metadata root for a hosted upload: `metaCID2`. */
export async function migratedMetaCid(
  imgCid: string,
  pieces: readonly HostedPiece[],
  importDirectory: ImportDirectory,
): Promise<string> {
  return importDirectory(migrationFiles(imgCid, pieces))
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
