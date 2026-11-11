/**
 * The rules for art uploaded through the site for hosting, in one dependency-free file.
 *
 * Two very different callers need the SAME answers: the browser, which refuses a file before it
 * spends a signature or a byte of upload on it, and the art service (`services/art/`), which refuses
 * it again because a browser is not a trust boundary. The service cannot import the app, so this
 * file imports nothing — the same arrangement `metadata/gateways.ts` has — and both sides read it.
 * A second copy of these numbers is how the form and the service come to disagree.
 *
 * WHAT HOSTING IS. Uploaded art is held, addressed by its IPFS CID, so a creator can launch without
 * setting up IPFS first. It is a convenience and not a permanence promise: the policy is that art
 * belongs on IPFS, and creators are encouraged to move it there once the collection graduates. The
 * CID it was built under is what keeps every pointer valid when it does.
 *
 * These are working defaults, chosen to be easy to change: every one of them is a plain constant
 * here, and the service lets a deployment override the money-shaped ones through its own vars.
 */

const KiB = 1024
const MiB = 1024 * KiB
const GiB = 1024 * MiB

/**
 * The image formats hosting accepts, by file extension, with the content type each is served as.
 *
 * DELIBERATELY NARROW. SVG and HTML are documents a browser will execute when served from our
 * origin; video is a bandwidth bill of a different order. A format earns a place here only when it
 * is a static raster a browser renders and nothing more.
 */
export const HOSTED_IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as const

/** An extension in {@link HOSTED_IMAGE_TYPES}. */
export type HostedImageExt = keyof typeof HOSTED_IMAGE_TYPES

/** The content type hosted per-piece metadata is served as. */
export const HOSTED_JSON_TYPE = 'application/json; charset=utf-8'

export const HOSTING_LIMITS = {
  /** Largest single image. */
  maxImageBytes: 10 * MiB,
  /**
   * Largest per-piece metadata document. The creator's own JSON is hosted as written, so this is
   * the art service's read cap for any piece's metadata rather than a size for a name and a link.
   */
  maxPieceJsonBytes: 512 * KiB,
  /** All of one upload's metadata together. HashLips-style JSON is around a kilobyte a piece. */
  maxMetadataBytes: 32 * MiB,
  /** Most pieces one upload may carry. Also the file ceiling of a bound collection. */
  maxFiles: 10_000,
  /** Largest upload, in bytes of CAR: a full-size collection. Sent in parts (see `partBytes`). */
  maxUploadBytes: 2 * GiB,
  /**
   * Largest single request body, in bytes. Below 100 MB because that is the request-body ceiling
   * Cloudflare applies on its Free and Pro plans: a larger body never reaches the worker at all. A
   * one-request upload is capped here; a larger one goes up in parts. A deployment on a plan with a
   * higher ceiling raises it with the service's `UPLOAD_MAX_CAR_BYTES` var.
   */
  maxRequestBytes: 95 * MiB,
  /**
   * The size of each part of a resumable upload (the last may be smaller). Storage requires every
   * part but the last to be the same size and at least 5 MiB; this size keeps a 2 GiB upload to 128
   * parts and loses at most 16 MiB to a dropped connection.
   */
  partBytes: 16 * MiB,
  /** Bytes one wallet may hold across its unbound drafts, unfinished uploads included. */
  draftBytesPerWallet: 2 * GiB,
  /** Unbound drafts one wallet may hold at once, unfinished uploads included. */
  draftsPerWallet: 3,
  /** Days an unbound draft is kept before it is deleted. A deploy that binds it ends the clock. */
  draftTtlDays: 7,
  /** Bytes a collection bound to a deployed instance may hold. */
  boundBytes: 2 * GiB,
  /** Files a collection bound to a deployed instance may hold. */
  boundFiles: 10_000,
} as const

/**
 * Where a launched collection's hosted art stands, as the art service reports it. Informational:
 * none of these ends hosting.
 *
 *   hosted     launched with hosted art, not graduated yet
 *   graduated  the collection has graduated; moving the art to IPFS is recommended
 *   migrated   the collection points at the regenerated IPFS metadata
 */
export type HostingState = 'hosted' | 'graduated' | 'migrated'

/** The extension of a hosted image name, lower-cased, or null when hosting does not accept it. */
export function hostedImageExt(name: string): HostedImageExt | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name)
  if (match === null) return null
  const ext = match[1]!.toLowerCase()
  return Object.prototype.hasOwnProperty.call(HOSTED_IMAGE_TYPES, ext)
    ? (ext as HostedImageExt)
    : null
}

/**
 * Which accepted format the first bytes of a file actually are, or null for none of them.
 *
 * An extension is a claim and the bytes are the fact. Both sides check that the two agree, so a
 * file named `.png` that is really an HTML page is refused rather than stored and served under a
 * content type that does not describe it. Twelve bytes is enough for every format here.
 */
export function sniffImage(head: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | null {
  const at = (i: number) => head[i] ?? -1
  const ascii = (from: number, text: string) =>
    [...text].every((ch, i) => at(from + i) === ch.charCodeAt(0))
  if (at(0) === 0x89 && ascii(1, 'PNG') && at(4) === 0x0d && at(5) === 0x0a) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp'
  return null
}

/** Whether sniffed bytes are the format an extension claims (`jpg` and `jpeg` are one format). */
export function sniffMatchesExt(head: Uint8Array, ext: HostedImageExt): boolean {
  const sniffed = sniffImage(head)
  if (sniffed === null) return false
  return sniffed === (ext === 'jpg' ? 'jpeg' : ext)
}

/**
 * A hosted image's file name inside the images directory: the piece number and its extension.
 * `jpeg` is written as `jpg` so one format has one spelling in every URL.
 */
export function hostedImageName(piece: number, ext: HostedImageExt): string {
  return `${piece}.${ext === 'jpeg' ? 'jpg' : ext}`
}

/** A per-piece metadata file name: the token id and nothing else, because `tokenURI = base + id`. */
export const PIECE_JSON_NAME = /^[1-9][0-9]{0,8}$/

/** An image file name hosting will index. Kept to the shape {@link hostedImageName} writes. */
export const PIECE_IMAGE_NAME = /^[1-9][0-9]{0,8}\.(png|jpg|webp|gif)$/

/**
 * `https://<host>/ipfs/<cid>/...` (or `http://`) → the CID and the path after it, or null otherwise.
 *
 * This is the gateway shape hosted art is published under. Recognising it is what lets the app and
 * the service treat such a link as the content address it is, rather than as an opaque URL tied to
 * one host forever.
 */
export function parseGatewayShapedUri(uri: string): { cid: string; path: string } | null {
  const match = /^https?:\/\/[^/?#\s]+\/ipfs\/([A-Za-z0-9]{46,})(\/[^?#\s]*)?$/.exec(uri.trim())
  if (match === null) return null
  return { cid: match[1]!, path: match[2] ?? '' }
}
