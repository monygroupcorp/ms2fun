/**
 * The Durable Object that holds the hosting ledger, and the worker's client for it.
 *
 * One instance, addressed by a fixed name, so every cap is counted in one place. It speaks a tiny
 * JSON protocol over `fetch` rather than Durable Object RPC so that the ledger logic stays plain
 * TypeScript the tests can run on any SQLite (see `ledger.ts`).
 *
 * Expiry runs on the object's alarm: every write that can create an expiry re-arms it for the
 * earliest one, and the alarm deletes what has lapsed — the rows here and the objects in the hosted
 * bucket — then re-arms for the next. No cron, and nothing to run by hand.
 */
import { Ledger, type LedgerLimits, type Removal, type Sql } from './ledger'
import { hostingConfig, type HostingEnv } from './config'
import { carKey, indexKey } from './store'

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

export class HostingLedger {
  private readonly ledger: Ledger

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: HostingEnv,
  ) {
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
    if (call.op === 'nonce' || call.op === 'reserve' || call.op === 'commit') await this.arm()
    if (call.op === 'remove' && result !== null) await this.drop([result as Removal])
    return Response.json(result ?? null)
  }

  async alarm(): Promise<void> {
    await this.drop(this.ledger.sweep(Date.now()))
    await this.arm()
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
    }
  }

  private async arm(): Promise<void> {
    const next = this.ledger.nextExpiry()
    if (next === null) return
    const current = await this.state.storage.getAlarm()
    if (current === null || next < current) await this.state.storage.setAlarm(next)
  }

  private async drop(removals: readonly Removal[]): Promise<void> {
    const bucket = this.env.ART_HOSTED
    if (bucket === undefined || removals.length === 0) return
    const keys = removals.flatMap((r) => [carKey(r.draftId), ...r.cids.map(indexKey)])
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
