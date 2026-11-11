/**
 * The hosting ledger: sign-in nonces, drafts, and the caps that bound what hosting can cost.
 *
 * ── Why a Durable Object, and not KV or D1 ─────────────────────────────────────────────────────
 * Every rule here is a count that must not be raced: a nonce used once, three open drafts per
 * wallet, 2 GiB per wallet, one global byte ceiling. KV is eventually consistent — two uploads in
 * the same second can each read "two drafts" and both pass — so it cannot hold a cap. D1 is
 * consistent, but binding it puts a database id in `wrangler.toml`, and this service's template
 * carries no account-scoped identifier so a fork can deploy it as it stands. A Durable Object is
 * strongly consistent, runs one request at a time, keeps its rows in its own SQLite, and is bound by
 * class name alone. Its single-instance throughput is far above what uploads will ever ask of it,
 * and the serving path never touches it: hosted reads go to the index in R2.
 *
 * ── What a draft is ────────────────────────────────────────────────────────────────────────────
 *   reserved  space held for an upload in flight. A one-request upload's expires within the hour
 *             if it never completes; an upload in parts, which may be resumed after a dropped
 *             connection or a reload, holds its full size until the draft TTL and is then deleted
 *             with whatever parts arrived.
 *   open      a verified upload no deployed collection uses yet. Deleted after the draft TTL.
 *   bound     an upload a deployed collection's on-chain metadata points at. No TTL: it stays
 *             hosted until the operator acts. Moving the art to IPFS is the creator's choice, which
 *             the collection page encourages once the collection graduates.
 *
 * ── What a collection record is ────────────────────────────────────────────────────────────────
 * One per bound draft: what the watcher (`lifecycle.ts`) has seen on chain since the bind — whether
 * the collection has graduated, and whether its per-token base now points at the regenerated IPFS
 * metadata. It informs the collection page and nothing else: no record ever ends hosting.
 *
 * The ledger is pure logic over a small SQL surface so it can be tested on any SQLite; the Durable
 * Object at the bottom of this file is the thin adapter that gives it storage and an alarm.
 */

/** The SQL surface the ledger needs — a subset of the Durable Object `SqlStorage` API. */
export interface Sql {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] }
}

export interface LedgerLimits {
  draftBytesPerWallet: number
  draftsPerWallet: number
  draftTtlMs: number
  /** How long an upload may take before its reservation lapses. */
  reserveTtlMs: number
  /** Bytes the whole deployment may hold across every draft. The kill switch for the bill. */
  totalBytes: number
}

export type DraftState = 'reserved' | 'open' | 'bound'

export interface Draft {
  id: string
  wallet: string
  state: DraftState
  /** For an upload in parts: the storage's id for it, while it is still arriving. */
  uploadId: string | null
  partSize: number | null
  /** For an upload in parts: the roots it was started for. */
  wantImg: string | null
  wantMeta: string | null
  bytes: number
  files: number
  imgCid: string | null
  metaCid: string | null
  createdAt: number
  /** Epoch ms the draft is deleted at; null once bound. */
  expiresAt: number | null
  instance: string | null
}

/** What deleting a draft leaves to remove from storage. */
export interface Removal {
  draftId: string
  /** Root CIDs whose index should go. */
  cids: string[]
  /** An upload in parts still arriving, to abort in storage. */
  uploadId: string | null
}

/** An upload in parts, as the uploader sees it. */
export interface PartsUpload {
  id: string
  bytes: number
  partSize: number
  parts: number[]
  imgCid: string
  metaCid: string
  expiresAt: number | null
}

export interface Part {
  n: number
  etag: string
  bytes: number
}

export type Refusal = { ok: false; status: number; reason: string }

export type CommitResult =
  | { status: 'open'; draft: Draft }
  | { status: 'duplicate'; draft: Draft }
  | { status: 'missing' }
  | { status: 'conflict' }

const NONCE_TTL_MS = 10 * 60 * 1000

interface DraftRow {
  id: string
  wallet: string
  state: DraftState
  upload_id: string | null
  part_size: number | null
  want_img: string | null
  want_meta: string | null
  bytes: number
  files: number
  img_cid: string | null
  meta_cid: string | null
  created_at: number
  expires_at: number | null
  instance: string | null
}

function draftOf(row: DraftRow): Draft {
  return {
    id: row.id,
    wallet: row.wallet,
    state: row.state,
    uploadId: row.upload_id ?? null,
    partSize: row.part_size ?? null,
    wantImg: row.want_img ?? null,
    wantMeta: row.want_meta ?? null,
    bytes: row.bytes,
    files: row.files,
    imgCid: row.img_cid,
    metaCid: row.meta_cid,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    instance: row.instance,
  }
}

/** What the watcher knows about one bound draft. Dates are epoch ms; null means "not seen yet". */
export interface HostedCollection {
  draftId: string
  instance: string
  imgCid: string
  metaCid: string
  boundAt: number
  /** The image file names under `imgCid`; null until the watcher has read them. */
  pieces: string[] | null
  /** The metadata root a migrated collection points at; null until worked out. */
  migrationCid: string | null
  graduatedAt: number | null
  migratedAt: number | null
  checkedAt: number | null
  lastUri: string | null
}

interface CollectionRow {
  draft_id: string
  instance: string
  img_cid: string
  meta_cid: string
  bound_at: number
  pieces: string | null
  migration_cid: string | null
  graduated_at: number | null
  migrated_at: number | null
  checked_at: number | null
  last_uri: string | null
}

function collectionOf(row: CollectionRow): HostedCollection {
  return {
    draftId: row.draft_id,
    instance: row.instance,
    imgCid: row.img_cid,
    metaCid: row.meta_cid,
    boundAt: row.bound_at,
    pieces: row.pieces === null ? null : (JSON.parse(row.pieces) as string[]),
    migrationCid: row.migration_cid,
    graduatedAt: row.graduated_at,
    migratedAt: row.migrated_at,
    checkedAt: row.checked_at,
    lastUri: row.last_uri,
  }
}

/** A random identifier: lower-case alphanumerics, `length` of them. Also a valid SIWE nonce. */
export function randomId(length = 20): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

export class Ledger {
  constructor(
    private readonly sql: Sql,
    private readonly limits: LedgerLimits,
  ) {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      state TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      files INTEGER NOT NULL DEFAULT 0,
      img_cid TEXT,
      meta_cid TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      instance TEXT,
      bound_at INTEGER
    )`)
    // Columns added for uploads in parts. A ledger created before them gains them here; SQLite
    // cannot add a column "if not exists", so the table's own description is asked first.
    const columns = new Set(
      this.sql
        .exec<{ name: string }>('PRAGMA table_info(drafts)')
        .toArray()
        .map((c) => c.name),
    )
    for (const [name, type] of [
      ['upload_id', 'TEXT'],
      ['part_size', 'INTEGER'],
      ['want_img', 'TEXT'],
      ['want_meta', 'TEXT'],
    ] as const) {
      if (!columns.has(name)) this.sql.exec(`ALTER TABLE drafts ADD COLUMN ${name} ${type}`)
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS parts (
      draft_id TEXT NOT NULL,
      n INTEGER NOT NULL,
      etag TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      PRIMARY KEY (draft_id, n)
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS drafts_wallet ON drafts (wallet, state)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS drafts_meta ON drafts (meta_cid)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS drafts_img ON drafts (img_cid)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS drafts_expiry ON drafts (expires_at)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS collections (
      draft_id TEXT PRIMARY KEY,
      instance TEXT NOT NULL,
      img_cid TEXT NOT NULL,
      meta_cid TEXT NOT NULL,
      bound_at INTEGER NOT NULL,
      pieces TEXT,
      migration_cid TEXT,
      graduated_at INTEGER,
      migrated_at INTEGER,
      checked_at INTEGER,
      last_uri TEXT
    )`)
    this.sql.exec(
      'CREATE INDEX IF NOT EXISTS collections_instance ON collections (instance, bound_at)',
    )
  }

  issueNonce(now: number): { nonce: string; expiresAt: number } {
    const nonce = randomId()
    const expiresAt = now + NONCE_TTL_MS
    this.sql.exec('INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)', nonce, expiresAt)
    return { nonce, expiresAt }
  }

  /** True exactly once per issued, unexpired nonce. */
  consumeNonce(nonce: string, now: number): boolean {
    const rows = this.sql
      .exec<{
        expires_at: number
      }>('DELETE FROM nonces WHERE nonce = ? RETURNING expires_at', nonce)
      .toArray()
    return rows.length === 1 && rows[0]!.expires_at > now
  }

  /** Hold space for an upload, or say which cap refuses it. */
  reserve(
    wallet: string,
    bytes: number,
    now: number,
    ttlMs: number = this.limits.reserveTtlMs,
  ): { ok: true; id: string } | Refusal {
    const who = wallet.toLowerCase()
    const mine = this.sql
      .exec<{ count: number; total: number | null }>(
        `SELECT COUNT(*) AS count, SUM(bytes) AS total FROM drafts
         WHERE wallet = ? AND state IN ('reserved', 'open')`,
        who,
      )
      .toArray()[0]!
    if (mine.count >= this.limits.draftsPerWallet) {
      return {
        ok: false,
        status: 409,
        reason:
          `this wallet already has ${mine.count} unlaunched uploads; launch or delete one, ` +
          'or wait for one to expire',
      }
    }
    if ((mine.total ?? 0) + bytes > this.limits.draftBytesPerWallet) {
      return {
        ok: false,
        status: 413,
        reason: 'this upload would put the wallet over its limit for unlaunched art',
      }
    }
    const all = this.sql
      .exec<{ total: number | null }>('SELECT SUM(bytes) AS total FROM drafts')
      .toArray()[0]!
    if ((all.total ?? 0) + bytes > this.limits.totalBytes) {
      return { ok: false, status: 503, reason: 'hosting is full right now; try again later' }
    }
    const id = randomId()
    this.sql.exec(
      `INSERT INTO drafts (id, wallet, state, bytes, created_at, expires_at)
       VALUES (?, ?, 'reserved', ?, ?, ?)`,
      id,
      who,
      bytes,
      now,
      now + ttlMs,
    )
    return { ok: true, id }
  }

  /**
   * Start an upload in parts, or pick up the one this wallet already started for the same roots and
   * size — after a dropped connection or a page reload, the uploader asks again and carries on.
   *
   * It is held against the wallet's caps for its FULL size from the start, and it expires with the
   * draft clock: an upload abandoned halfway is deleted, parts and all, like an unlaunched draft.
   * Answers with the existing draft instead when these roots are already hosted.
   */
  begin(
    wallet: string,
    want: { bytes: number; imgCid: string; metaCid: string; partSize: number },
    now: number,
  ):
    | { ok: true; upload: PartsUpload; fresh: boolean }
    | { ok: true; duplicate: Draft }
    | Refusal {
    const who = wallet.toLowerCase()
    const hosted = this.sql
      .exec<DraftRow>(
        `SELECT * FROM drafts WHERE meta_cid = ? AND state IN ('open', 'bound') LIMIT 1`,
        want.metaCid,
      )
      .toArray()[0]
    if (hosted !== undefined) return { ok: true, duplicate: draftOf(hosted) }
    const resumable = this.sql
      .exec<DraftRow>(
        `SELECT * FROM drafts WHERE wallet = ? AND state = 'reserved' AND want_meta = ?
           AND want_img = ? AND bytes = ? AND part_size = ? AND upload_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        who,
        want.metaCid,
        want.imgCid,
        want.bytes,
        want.partSize,
      )
      .toArray()[0]
    if (resumable !== undefined) {
      return { ok: true, upload: this.partsUpload(draftOf(resumable)), fresh: false }
    }
    const reserved = this.reserve(who, want.bytes, now, this.limits.draftTtlMs)
    if (!reserved.ok) return reserved
    this.sql.exec(
      'UPDATE drafts SET part_size = ?, want_img = ?, want_meta = ? WHERE id = ?',
      want.partSize,
      want.imgCid,
      want.metaCid,
      reserved.id,
    )
    return { ok: true, upload: this.partsUpload(this.draft(reserved.id)!), fresh: true }
  }

  /** Record the storage's id for a freshly begun upload. */
  attach(id: string, uploadId: string): void {
    this.sql.exec(
      `UPDATE drafts SET upload_id = ? WHERE id = ? AND state = 'reserved'`,
      uploadId,
      id,
    )
  }

  /** One of the wallet's uploads in parts, still arriving; null when there is no such upload. */
  upload(wallet: string, id: string): (PartsUpload & { uploadId: string }) | null {
    const row = this.sql
      .exec<DraftRow>(
        `SELECT * FROM drafts WHERE id = ? AND wallet = ? AND state = 'reserved'
           AND upload_id IS NOT NULL`,
        id,
        wallet.toLowerCase(),
      )
      .toArray()[0]
    if (row === undefined) return null
    return { ...this.partsUpload(draftOf(row)), uploadId: row.upload_id! }
  }

  /** Record a part that storage accepted. Sending a part again replaces it. */
  recordPart(id: string, part: Part): void {
    this.sql.exec(
      `INSERT INTO parts (draft_id, n, etag, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT (draft_id, n) DO UPDATE SET etag = excluded.etag, bytes = excluded.bytes`,
      id,
      part.n,
      part.etag,
      part.bytes,
    )
  }

  parts(id: string): Part[] {
    return this.sql
      .exec<Part>('SELECT n, etag, bytes FROM parts WHERE draft_id = ? ORDER BY n', id)
      .toArray()
  }

  private draft(id: string): Draft | null {
    const row = this.sql.exec<DraftRow>('SELECT * FROM drafts WHERE id = ?', id).toArray()[0]
    return row === undefined ? null : draftOf(row)
  }

  private partsUpload(draft: Draft): PartsUpload {
    return {
      id: draft.id,
      bytes: draft.bytes,
      partSize: draft.partSize!,
      parts: this.parts(draft.id).map((p) => p.n),
      imgCid: draft.wantImg!,
      metaCid: draft.wantMeta!,
      expiresAt: draft.expiresAt,
    }
  }

  /**
   * Turn a reservation into an open draft, once its CAR has verified.
   *
   * If the same metadata root is already hosted the new upload is a duplicate: the reservation is
   * dropped and the EXISTING draft returned, so the caller deletes its copy and the creator gets the
   * same answer they would have got the first time.
   */
  commit(
    id: string,
    roots: { imgCid: string; metaCid: string; files: number },
    now: number,
  ): CommitResult {
    const existing = this.sql
      .exec<DraftRow>(
        `SELECT * FROM drafts WHERE meta_cid = ? AND state IN ('open', 'bound') LIMIT 1`,
        roots.metaCid,
      )
      .toArray()[0]
    if (existing !== undefined) {
      this.sql.exec('DELETE FROM drafts WHERE id = ?', id)
      return { status: 'duplicate', draft: draftOf(existing) }
    }
    // The same images under DIFFERENT metadata. The browser writes metadata deterministically from
    // the images, so this only happens when the two were built for different hosts; refusing it
    // keeps every root owned by exactly one draft, which is what lets deletion drop an index without
    // asking who else is reading it.
    const sharing = this.sql
      .exec<{
        n: number
      }>(`SELECT COUNT(*) AS n FROM drafts WHERE img_cid = ? AND state IN ('open', 'bound')`, roots.imgCid)
      .toArray()[0]!
    if (sharing.n > 0) {
      this.sql.exec('DELETE FROM drafts WHERE id = ?', id)
      return { status: 'conflict' }
    }
    const rows = this.sql
      .exec<DraftRow>(
        `UPDATE drafts SET state = 'open', img_cid = ?, meta_cid = ?, files = ?, expires_at = ?,
           upload_id = NULL
         WHERE id = ? AND state = 'reserved' RETURNING *`,
        roots.imgCid,
        roots.metaCid,
        roots.files,
        now + this.limits.draftTtlMs,
        id,
      )
      .toArray()
    this.sql.exec('DELETE FROM parts WHERE draft_id = ?', id)
    return rows.length === 1 ? { status: 'open', draft: draftOf(rows[0]!) } : { status: 'missing' }
  }

  /** Drop a reservation whose upload failed. */
  release(id: string): void {
    this.sql.exec(`DELETE FROM drafts WHERE id = ? AND state = 'reserved'`, id)
    this.sql.exec('DELETE FROM parts WHERE draft_id = ?', id)
  }

  /**
   * Mark the draft hosting `metaCid` as used by a deployed collection.
   *
   * The caller has already read the instance's on-chain metadata and confirmed the registry knows
   * it; this only records the fact. Idempotent: binding a bound draft returns it unchanged.
   */
  bind(metaCid: string, instance: string, now: number): Draft | null {
    const rows = this.sql
      .exec<DraftRow>(
        `UPDATE drafts SET state = 'bound', expires_at = NULL, instance = ?, bound_at = ?
         WHERE meta_cid = ? AND state = 'open' RETURNING *`,
        instance.toLowerCase(),
        now,
        metaCid,
      )
      .toArray()
    if (rows.length === 1) {
      this.ensureCollections(now)
      return draftOf(rows[0]!)
    }
    const bound = this.sql
      .exec<DraftRow>(
        `SELECT * FROM drafts WHERE meta_cid = ? AND state = 'bound' LIMIT 1`,
        metaCid,
      )
      .toArray()[0]
    return bound === undefined ? null : draftOf(bound)
  }

  drafts(wallet: string): Draft[] {
    return this.sql
      .exec<DraftRow>(
        'SELECT * FROM drafts WHERE wallet = ? ORDER BY created_at',
        wallet.toLowerCase(),
      )
      .toArray()
      .map(draftOf)
  }

  /** Delete one of a wallet's own unbound drafts. A bound draft is not the uploader's to delete. */
  remove(wallet: string, id: string): Removal | null {
    const rows = this.sql
      .exec<DraftRow>(
        `DELETE FROM drafts WHERE id = ? AND wallet = ? AND state IN ('reserved', 'open')
         RETURNING *`,
        id,
        wallet.toLowerCase(),
      )
      .toArray()
    return rows.length === 1 ? this.removalOf(rows[0]!) : null
  }

  /** Delete every draft and nonce past its expiry; return what storage should drop. */
  sweep(now: number): Removal[] {
    this.sql.exec('DELETE FROM nonces WHERE expires_at <= ?', now)
    const rows = this.sql
      .exec<DraftRow>(
        'DELETE FROM drafts WHERE expires_at IS NOT NULL AND expires_at <= ? RETURNING *',
        now,
      )
      .toArray()
    return rows.map((row) => this.removalOf(row))
  }

  /** The next moment something expires, for the alarm. Null when nothing will. */
  nextExpiry(): number | null {
    const row = this.sql
      .exec<{ next: number | null }>(
        `SELECT MIN(e) AS next FROM (
           SELECT MIN(expires_at) AS e FROM drafts WHERE expires_at IS NOT NULL
           UNION ALL SELECT MIN(expires_at) AS e FROM nonces
         )`,
      )
      .toArray()[0]
    return row?.next ?? null
  }

  /** Bytes held across the whole deployment, every state. */
  totalBytes(): number {
    return (
      this.sql.exec<{ total: number | null }>('SELECT SUM(bytes) AS total FROM drafts').toArray()[0]
        ?.total ?? 0
    )
  }

  // ── Collection records ─────────────────────────────────────────────────────────────────────

  /** Give every bound draft a record, dated from when it was bound. Idempotent. */
  ensureCollections(now: number): void {
    this.sql.exec(
      `INSERT INTO collections (draft_id, instance, img_cid, meta_cid, bound_at)
       SELECT id, instance, img_cid, meta_cid, COALESCE(bound_at, ?) FROM drafts
       WHERE state = 'bound' AND img_cid IS NOT NULL AND meta_cid IS NOT NULL
         AND instance IS NOT NULL AND id NOT IN (SELECT draft_id FROM collections)`,
      now,
    )
  }

  /** Every bound draft's record, oldest first. */
  collections(): HostedCollection[] {
    return this.sql
      .exec<CollectionRow>('SELECT * FROM collections ORDER BY bound_at')
      .toArray()
      .map(collectionOf)
  }

  collection(draftId: string): HostedCollection | null {
    const row = this.sql
      .exec<CollectionRow>('SELECT * FROM collections WHERE draft_id = ?', draftId)
      .toArray()[0]
    return row === undefined ? null : collectionOf(row)
  }

  /** The record of the upload a collection most recently bound, or null when it bound none. */
  collectionFor(instance: string): HostedCollection | null {
    const row = this.sql
      .exec<CollectionRow>(
        'SELECT * FROM collections WHERE instance = ? ORDER BY bound_at DESC LIMIT 1',
        instance.toLowerCase(),
      )
      .toArray()[0]
    return row === undefined ? null : collectionOf(row)
  }

  /** Record the image names and the migrated metadata root they make. Set once. */
  setMigrationTarget(draftId: string, pieces: readonly string[], migrationCid: string): void {
    this.sql.exec(
      `UPDATE collections SET pieces = ?, migration_cid = ?
       WHERE draft_id = ? AND migration_cid IS NULL`,
      JSON.stringify(pieces),
      migrationCid,
      draftId,
    )
  }

  /** Record one look at the chain. Graduation is recorded the first time it is seen, never undone. */
  recordCheck(draftId: string, now: number, facts: { graduated: boolean; uri: string }): void {
    this.sql.exec(
      `UPDATE collections SET checked_at = ?, last_uri = ?,
         graduated_at = COALESCE(graduated_at, CASE WHEN ? = 1 THEN ? END)
       WHERE draft_id = ?`,
      now,
      facts.uri,
      facts.graduated ? 1 : 0,
      now,
      draftId,
    )
  }

  /** The collection points at the migrated metadata. Recorded once. */
  markMigrated(draftId: string, now: number): void {
    this.sql.exec(
      'UPDATE collections SET migrated_at = COALESCE(migrated_at, ?) WHERE draft_id = ?',
      now,
      draftId,
    )
  }

  private removalOf(row: DraftRow): Removal {
    this.sql.exec('DELETE FROM parts WHERE draft_id = ?', row.id)
    // No other live draft shares these roots — `commit` guarantees it — so both indexes go.
    const cids = [row.img_cid, row.meta_cid].filter((cid): cid is string => cid !== null)
    return { draftId: row.id, cids, uploadId: row.upload_id ?? null }
  }
}
