/**
 * The watcher: runs on the ledger's alarm and keeps each launched collection's record current, so the
 * collection page can say where its art stands.
 *
 * On each run, for every bound upload:
 *   1. learn its image names from the images index, read its hosted metadata, and work out the
 *      migrated metadata root from them, once;
 *   2. when a check is due, read the chain — `graduated()` and `metadataURI()` — and record what it
 *      says; a base of exactly `ipfs://<migrated root>/` marks the collection migrated.
 *
 * IT ONLY INFORMS. Nothing here stops serving, deletes, or redirects anything: hosted art stays
 * hosted until the operator acts by hand. Moving to IPFS is the creator's choice, which the app
 * recommends once the collection graduates. A chain read that fails changes nothing and is retried
 * on the next run.
 */
import { PIECE_IMAGE_NAME } from '../../../../app/src/lib/art/hostingLimits'
import { isMigratedBase, type HostedPiece } from '../../../../app/src/lib/art/ipfsMigration'
import type { CollectionFacts } from './chain'
import type { HostedCollection, Ledger } from './ledger'
import { readHostedPieces } from './metadata'
import { loadIndex } from './store'

export interface WatchDeps {
  now: number
  /** Minutes between chain reads for one collection, in ms. */
  checkMs: number
  /** Reads a collection's facts; null when this deployment has no RPC, so nothing is read. */
  readFacts: ((instance: `0x${string}`) => Promise<CollectionFacts>) | null
  /** The hosted bucket, read for piece names and metadata; null when none is bound. */
  bucket: R2Bucket | null
  migrationCid: (imgCid: string, pieces: readonly HostedPiece[]) => Promise<string>
}

/** When the watcher should run next, or null when there is nothing left to watch. */
export async function watchHosting(ledger: Ledger, deps: WatchDeps): Promise<number | null> {
  const { now, checkMs } = deps
  let next: number | null = null
  const wake = (at: number) => {
    const when = Math.max(at, now + 1000)
    next = next === null ? when : Math.min(next, when)
  }
  ledger.ensureCollections(now)

  for (let record of ledger.collections()) {
    try {
      if (record.migrationCid === null) record = (await learnPieces(ledger, record, deps)) ?? record
      if (record.migrationCid === null) wake(now + checkMs)
      // A migrated collection has nothing left to learn from the chain.
      if (record.migratedAt !== null || deps.readFacts === null) continue
      if (record.checkedAt === null || now - record.checkedAt >= checkMs) {
        // A read that fails is no news: the record stays as it was, and the next try waits a full
        // interval rather than hammering an RPC that is down.
        record = await check(ledger, record, deps).catch(() => ({ ...record, checkedAt: now }))
      }
      if (record.migratedAt === null) wake((record.checkedAt ?? now) + checkMs)
    } catch {
      // One collection's bad read must not hold up the rest. Try again next run.
      wake(now + checkMs)
    }
  }
  return next
}

/** Read the image names and hosted metadata, and record the migrated root they make. */
async function learnPieces(
  ledger: Ledger,
  record: HostedCollection,
  deps: WatchDeps,
): Promise<HostedCollection | null> {
  if (deps.bucket === null) return null
  const index = await loadIndex(deps.bucket, record.imgCid)
  if (index === null) return null
  const names = Object.keys(index.files).filter((name) => PIECE_IMAGE_NAME.test(name))
  if (names.length === 0) return null
  const meta = await loadIndex(deps.bucket, record.metaCid)
  if (meta === null) return null
  const migrationCid = await deps.migrationCid(
    record.imgCid,
    await readHostedPieces(deps.bucket, meta),
  )
  ledger.setMigrationTarget(record.draftId, names, migrationCid)
  return ledger.collection(record.draftId)
}

async function check(
  ledger: Ledger,
  record: HostedCollection,
  deps: WatchDeps,
): Promise<HostedCollection> {
  const facts = await deps.readFacts!(record.instance as `0x${string}`)
  ledger.recordCheck(record.draftId, deps.now, {
    graduated: facts.graduated,
    uri: facts.metadataURI,
  })
  if (record.migrationCid !== null && isMigratedBase(facts.metadataURI, record.migrationCid)) {
    ledger.markMigrated(record.draftId, deps.now)
  }
  return ledger.collection(record.draftId) ?? record
}
