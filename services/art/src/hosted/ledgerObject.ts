/**
 * The Durable Object that holds the hosting ledger, and the worker's client for it.
 *
 * One instance, addressed by a fixed name, so every cap is counted in one place. It speaks a tiny
 * JSON protocol over `fetch` rather than Durable Object RPC so that the ledger logic stays plain
 * TypeScript the tests can run on any SQLite (see `ledger.ts`).
 *
 * Expiry runs on the object's alarm: every write that can create an expiry re-arms it for the
 * earliest one, and the alarm deletes what has lapsed — the rows here and the objects in the hosted
 * bucket — then re-arms for the next. The same alarm runs the watcher (`lifecycle.ts`), which keeps
 * each launched collection's record current (graduated, migrated) and asks to be woken for its
 * next check. It only informs; nothing it does ends hosting. No
 * cron, and nothing to run by hand.
 */
import { readCollectionFacts, type CollectionFacts } from './chain'
import { checkIntervalMs, hostingConfig, type HostingEnv } from './config'
import {
  Ledger,
  type HostedCollection,
  type LedgerLimits,
  type Part,
  type Removal,
  type Sql,
} from './ledger'
import { watchHosting } from './lifecycle'
import { migrationCidOf } from './migration'
import { carKey, indexKey, metaCarKey } from './store'

/** The name of the one ledger instance. */
const LEDGER_NAME = 'hosting-ledger'

export type LedgerOp =
  | { op: 'nonce'; now: number }
  | { op: 'consume'; nonce: string; now: number }
  | { op: 'reserve'; wallet: string; bytes: number; now: number }
  | {
      op: 'commit'
      id: string
      roots: { imgCid: string; metaCid: string; files: number }
      now: number
    }
  | { op: 'release'; id: string }
  | { op: 'bind'; metaCid: string; instance: string; now: number }
  | { op: 'drafts'; wallet: string }
  | { op: 'remove'; wallet: string; id: string }
  | { op: 'hosting'; instance: string; now: number }
  | {
      op: 'begin'
      wallet: string
      want: { bytes: number; imgCid: string; metaCid: string; partSize: number }
      now: number
    }
  | { op: 'attach'; id: string; uploadId: string }
  | { op: 'upload'; wallet: string; id: string }
  | { op: 'part'; id: string; part: Part }
  | { op: 'parts'; id: string }

/** What anyone may read about a launched collection's hosted art. There is no deadline in it. */
export function publicHosting(record: HostedCollection) {
  return {
    instance: record.instance,
    state:
      record.migratedAt !== null
        ? 'migrated'
        : record.graduatedAt !== null
          ? 'graduated'
          : 'hosted',
    imgCid: record.imgCid,
    metaCid: record.metaCid,
    migrationCid: record.migrationCid,
    pieces: record.pieces ?? [],
    migrated: record.migratedAt !== null,
    boundAt: record.boundAt,
    graduatedAt: record.graduatedAt,
    migratedAt: record.migratedAt,
  }
}

/** What the watcher needs from outside the ledger; the runtime's by default, a test's otherwise. */
export interface WatcherDeps {
  now: () => number
  readFacts: ((rpcUrl: string, instance: `0x${string}`) => Promise<CollectionFacts>) | null
}

export class HostingLedger {
  private readonly ledger: Ledger
  private readonly watcher: WatcherDeps

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: HostingEnv,
    watcher: Partial<WatcherDeps> = {},
  ) {
    this.watcher = { now: () => Date.now(), readFacts: readCollectionFacts, ...watcher }
    const config = hostingConfig(env)
    const limits: LedgerLimits = {
      draftBytesPerWallet: config.draftBytesPerWallet,
      draftsPerWallet: config.draftsPerWallet,
      draftTtlMs: config.draftTtlMs,
      reserveTtlMs: config.reserveTtlMs,
      totalBytes: config.totalBytes,
    }
    this.ledger = new Ledger(state.storage.sql as unknown as Sql, limits)
  }

  async fetch(request: Request): Promise<Response> {
    const call = (await request.json()) as LedgerOp
    const result = this.run(call)
    if (
      call.op === 'nonce' ||
      call.op === 'reserve' ||
      call.op === 'commit' ||
      call.op === 'begin'
    ) {
      await this.arm()
    }
    // A fresh bind wakes the watcher straight away, to read the new collection's pieces. Only while
    // they are unknown: bind is open to anyone, and must not become a way to spin the alarm.
    if (call.op === 'bind' && result !== null) {
      const record = this.ledger.collection((result as { id: string }).id)
      if (record !== null && record.migrationCid === null) await this.arm(call.now)
    }
    // A deployment upgraded from before the watcher existed has bound drafts and no alarm; the first
    // status read starts the watcher for them. Never moves an alarm that is already set.
    if (
      call.op === 'hosting' &&
      result !== null &&
      (await this.state.storage.getAlarm()) === null
    ) {
      await this.state.storage.setAlarm(call.now)
    }
    if (call.op === 'remove' && result !== null) await this.drop([result as Removal])
    return Response.json(result ?? null)
  }

  async alarm(): Promise<void> {
    const now = this.watcher.now()
    await this.drop(this.ledger.sweep(now))
    await this.arm(await this.watch(now))
  }

  /** One run of the watcher. Public so a test can drive it without an alarm. */
  async watch(now: number): Promise<number | null> {
    const rpcUrl = hostingConfig(this.env).rpcUrl
    const read = this.watcher.readFacts
    return watchHosting(this.ledger, {
      now,
      checkMs: checkIntervalMs(this.env),
      readFacts: rpcUrl === null || read === null ? null : (instance) => read(rpcUrl, instance),
      bucket: this.env.ART_HOSTED ?? null,
      migrationCid: migrationCidOf,
    })
  }

  private run(call: LedgerOp): unknown {
    switch (call.op) {
      case 'nonce':
        return this.ledger.issueNonce(call.now)
      case 'consume':
        return this.ledger.consumeNonce(call.nonce, call.now)
      case 'reserve':
        return this.ledger.reserve(call.wallet, call.bytes, call.now)
      case 'commit':
        return this.ledger.commit(call.id, call.roots, call.now)
      case 'release':
        this.ledger.release(call.id)
        return true
      case 'bind':
        return this.ledger.bind(call.metaCid, call.instance, call.now)
      case 'drafts':
        return this.ledger.drafts(call.wallet)
      case 'remove':
        return this.ledger.remove(call.wallet, call.id)
      case 'begin':
        return this.ledger.begin(call.wallet, call.want, call.now)
      case 'attach':
        this.ledger.attach(call.id, call.uploadId)
        return true
      case 'upload':
        return this.ledger.upload(call.wallet, call.id)
      case 'part':
        this.ledger.recordPart(call.id, call.part)
        return true
      case 'parts':
        return this.ledger.parts(call.id)
      case 'hosting': {
        this.ledger.ensureCollections(call.now)
        const record = this.ledger.collectionFor(call.instance)
        return record === null ? null : publicHosting(record)
      }
    }
  }

  private async arm(extra: number | null = null): Promise<void> {
    const expiry = this.ledger.nextExpiry()
    const next = expiry === null ? extra : extra === null ? expiry : Math.min(expiry, extra)
    if (next === null) return
    const current = await this.state.storage.getAlarm()
    if (current === null || next < current) await this.state.storage.setAlarm(next)
  }

  private async drop(removals: readonly Removal[]): Promise<void> {
    const bucket = this.env.ART_HOSTED
    if (bucket === undefined || removals.length === 0) return
    // An upload in parts still arriving is aborted, which drops the parts storage holds for it.
    for (const removal of removals) {
      if (removal.uploadId === null) continue
      try {
        await bucket.resumeMultipartUpload(carKey(removal.draftId), removal.uploadId).abort()
      } catch {
        // Already completed or aborted; nothing is left to drop.
      }
    }
    const keys = removals.flatMap((r) => [
      carKey(r.draftId),
      metaCarKey(r.draftId),
      ...r.cids.map(indexKey),
    ])
    // R2 deletes up to 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000))
  }
}

/** Call the ledger. Throws if the binding is missing — callers check `uploadsConfigured` first. */
export async function callLedger<T>(env: HostingEnv, call: LedgerOp): Promise<T> {
  const namespace = env.HOSTING_LEDGER
  if (namespace === undefined) throw new Error('HOSTING_LEDGER is not bound')
  const stub = namespace.get(namespace.idFromName(LEDGER_NAME))
  const response = await stub.fetch('https://ledger/', {
    method: 'POST',
    body: JSON.stringify(call),
  })
  if (!response.ok) throw new Error(`ledger answered ${response.status}`)
  return (await response.json()) as T
}
