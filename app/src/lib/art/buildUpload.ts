/**
 * Turn a creator's image files into what hosting stores: two IPFS directories and one CAR.
 *
 *   images     `<piece>.<ext>` — the files, renamed to their piece number
 *   metadata   `<piece>`       — one JSON per piece: `{ "name": "#<piece>", "image": <link> }`
 *
 * `tokenURI(id)` on the collection is `base + id`, and what it returns must be JSON with an `image`
 * field, which is why the metadata files are named by bare id with no extension and why the base
 * written on-chain is the METADATA directory: `https://<host>/ipfs/<metaCid>/`.
 *
 * Each `image` link is gateway-shaped (`https://<host>/ipfs/<imgCid>/<piece>.<ext>`). While hosted,
 * the host serves it; once the art has moved to IPFS, the same link is still a CID and a path, which
 * the app resolves through any gateway — so neither the JSON nor the on-chain base ever has to
 * change.
 *
 * Built entirely in the browser with the shared UnixFS core, so the CIDs shown to the creator are
 * the CIDs the art will have on any IPFS node that imports the CAR.
 */
import {
  HOSTING_LIMITS,
  hostedImageExt,
  hostedImageName,
  sniffMatchesExt,
  type HostedImageExt,
} from './hostingLimits'
import { importFiles, writeCarChunks, type ImportFile } from './unixfs'

/** The parts of a `File` this needs. A plain object in tests, a real `File` in the browser. */
export interface PieceSource {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface PlannedPiece<T extends PieceSource = PieceSource> {
  piece: number
  source: T
  ext: HostedImageExt
  /** The name it is stored under in the images directory. */
  name: string
}

/** Why a set of files cannot be uploaded, one line per problem. Empty means it can. */
export interface UploadPlan<T extends PieceSource = PieceSource> {
  pieces: PlannedPiece<T>[]
  problems: string[]
  bytes: number
}

const sizeMiB = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`

/**
 * Order the files and check them against the limits, without reading them.
 *
 * Pieces are numbered in FILE NAME order, compared the way a person reads numbers (`2.png` before
 * `10.png`), so a folder exported as `art-1.png … art-100.png` keeps its order.
 */
export function planUpload<T extends PieceSource>(files: readonly T[]): UploadPlan<T> {
  const problems: string[] = []
  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
  if (sorted.length === 0) problems.push('choose at least one image')
  if (sorted.length > HOSTING_LIMITS.maxFiles) {
    problems.push(`at most ${HOSTING_LIMITS.maxFiles} images per collection`)
  }
  const pieces: PlannedPiece<T>[] = []
  let bytes = 0
  sorted.forEach((source, i) => {
    const ext = hostedImageExt(source.name)
    if (ext === null) {
      problems.push(`${source.name}: only PNG, JPEG, WebP and GIF images can be hosted`)
      return
    }
    if (source.size > HOSTING_LIMITS.maxImageBytes) {
      problems.push(`${source.name}: ${sizeMiB(source.size)} is over the 10 MiB limit per image`)
      return
    }
    bytes += source.size
    pieces.push({ piece: i + 1, source, ext, name: hostedImageName(i + 1, ext) })
  })
  // The CAR adds a little to the images (headers, directory nodes, metadata); leave room for it.
  if (bytes > HOSTING_LIMITS.maxUploadBytes * 0.97) {
    problems.push(
      `${sizeMiB(bytes)} of images is more than one upload can carry (${sizeMiB(HOSTING_LIMITS.maxUploadBytes)})`,
    )
  }
  return { pieces, problems, bytes }
}

/** The JSON for one piece. Stable key order and no whitespace, so the CID is reproducible. */
export function pieceJson(piece: number, imageUrl: string): string {
  return JSON.stringify({ name: `#${piece}`, image: imageUrl })
}

export interface BuiltUpload {
  imgCid: string
  metaCid: string
  /** The value to write as the collection's per-token base. */
  baseUri: string
  car: Blob
  pieces: number
}

export type BuildStage = 'reading' | 'images' | 'metadata' | 'car'

/**
 * Read, verify and pack the planned pieces.
 *
 * Each file's first bytes are checked against its extension here, before anything is signed or
 * sent: the service refuses a mismatch anyway, but finding out after a 90 MB upload is a poor way
 * to learn a file was misnamed.
 */
export async function buildUpload(
  plan: UploadPlan,
  host: string,
  onStage?: (stage: BuildStage) => void,
): Promise<BuiltUpload> {
  if (plan.problems.length > 0) throw new Error(plan.problems[0])
  onStage?.('reading')
  const images: ImportFile[] = []
  for (const piece of plan.pieces) {
    const content = new Uint8Array(await piece.source.arrayBuffer())
    if (!sniffMatchesExt(content.subarray(0, 16), piece.ext)) {
      throw new Error(`${piece.source.name} is not really a ${piece.ext.toUpperCase()} image`)
    }
    images.push({ path: piece.name, content })
  }

  onStage?.('images')
  const imageDag = await importFiles(images)
  const imgCid = imageDag.root.toString()

  onStage?.('metadata')
  const encoder = new TextEncoder()
  const metadata: ImportFile[] = plan.pieces.map((piece) => ({
    path: String(piece.piece),
    content: encoder.encode(pieceJson(piece.piece, `${host}/ipfs/${imgCid}/${piece.name}`)),
  }))
  const metaDag = await importFiles(metadata)
  const metaCid = metaDag.root.toString()

  onStage?.('car')
  const parts: Uint8Array[] = []
  const blocks = new Map([...imageDag.blocks, ...metaDag.blocks])
  // DAG order, so each file's chunks sit together and the service reads a file in one go.
  await writeCarChunks(
    [imageDag.root, metaDag.root],
    blocks,
    (chunk) => void parts.push(chunk),
    'dag',
  )

  return {
    imgCid,
    metaCid,
    baseUri: `${host}/ipfs/${metaCid}/`,
    car: new Blob(parts as BlobPart[], { type: 'application/vnd.ipld.car' }),
    pieces: plan.pieces.length,
  }
}
