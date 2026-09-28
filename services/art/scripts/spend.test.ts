/**
 * The spend command's arithmetic and its reading of Cloudflare's answer.
 *
 * WHAT THESE DO NOT PROVE, stated because it matters: no assertion here has ever seen the live
 * Cloudflare analytics API. The GraphQL query's field names come from documentation, not from a
 * response this repository has captured, so the first real run is also the first proof that the
 * query is right. That is exactly why `parseUsage` throws on anything it does not recognise instead
 * of defaulting to zero — the failure mode of a wrong query is then a loud error and not a bill that
 * reads as $0.
 */
import { describe, expect, it } from 'vitest'

import {
  costOf,
  isOverBudget,
  monthStart,
  parseUsage,
  PRICES,
  priceAgeDays,
  report,
  STALE_AFTER_DAYS,
  type Usage,
} from './spend.ts'

const GB = 1024 ** 3
const NOTHING: Usage = { storedBytes: 0, classAOps: 0, classBOps: 0, workerRequests: 0 }

describe('the cost of a month', () => {
  it('is only the Workers minimum when nothing has been used', () => {
    const cost = costOf(NOTHING)
    expect(cost.serviceUsd).toBe(0)
    expect(cost.totalUsd).toBe(PRICES.workersPaidBaseUsd)
  })

  it('charges nothing inside the free tier', () => {
    const cost = costOf({
      storedBytes: PRICES.free.storageGbMonth * GB,
      classAOps: PRICES.free.classAMillion * 1_000_000,
      classBOps: PRICES.free.classBMillion * 1_000_000,
      workerRequests: PRICES.free.workerRequestsMillion * 1_000_000,
    })
    expect(cost.serviceUsd).toBe(0)
  })

  it('charges only the excess over the free tier, not the whole usage', () => {
    // 10 GB free + 10 billable; 1M class A free + 1M billable.
    const cost = costOf({
      storedBytes: 20 * GB,
      classAOps: 2_000_000,
      classBOps: 0,
      workerRequests: 0,
    })
    expect(cost.serviceUsd).toBeCloseTo(10 * PRICES.storagePerGbMonth + PRICES.classAPerMillion, 6)
  })

  it('never charges for egress — the reason this is a cache and not a proxy', () => {
    const egress = costOf({ ...NOTHING, classBOps: 50_000_000 }).lines.find(
      (l) => l.what === 'Egress',
    )
    expect(egress?.usd).toBe(0)
  })

  it('keeps the account-wide Workers minimum out of what this service caused', () => {
    const cost = costOf({ ...NOTHING, storedBytes: 110 * GB })
    expect(cost.serviceUsd).toBeCloseTo(100 * PRICES.storagePerGbMonth, 6)
    expect(cost.totalUsd).toBeCloseTo(cost.serviceUsd + PRICES.workersPaidBaseUsd, 6)
  })

  it('a heavy month is over a small budget and says so', () => {
    const heavy: Usage = {
      storedBytes: 500 * GB,
      classAOps: 20_000_000,
      classBOps: 200_000_000,
      workerRequests: 200_000_000,
    }
    expect(isOverBudget(heavy, 25)).toBe(true)
    expect(report(heavy, 25, new Date('2026-09-27T00:00:00Z')).join('\n')).toContain('OVER by')
  })

  it('a quiet month is under budget and says what is left', () => {
    expect(isOverBudget(NOTHING, 25)).toBe(false)
    expect(report(NOTHING, 25, new Date('2026-09-27T00:00:00Z')).join('\n')).toContain('left')
  })
})

describe('the price table', () => {
  it('is printed with the number, so no figure is quoted without its provenance', () => {
    const out = report(NOTHING, 25, new Date('2026-09-27T00:00:00Z')).join('\n')
    expect(out).toContain(PRICES.readOn)
    for (const source of PRICES.sources) expect(out).toContain(source)
  })

  it('is not stale today — if this fails, re-read those pages and move the date', () => {
    expect(priceAgeDays(PRICES.readOn, new Date())).toBeLessThanOrEqual(STALE_AFTER_DAYS)
  })

  it('warns once it is older than the window rather than quietly staying wrong', () => {
    const later = new Date(Date.parse(`${PRICES.readOn}T00:00:00Z`) + 400 * 86_400_000)
    expect(report(NOTHING, 25, later).join('\n')).toContain('WARNING')
  })

  it('refuses a date it cannot read', () => {
    expect(() => priceAgeDays('not-a-date', new Date())).toThrow()
  })
})

describe('the month it measures', () => {
  it('starts at the first instant of the current UTC month', () => {
    expect(monthStart(new Date('2026-09-27T18:30:00Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
  })
})

describe("reading Cloudflare's answer", () => {
  const ANSWER = {
    r2StorageAdaptiveGroups: [{ max: { payloadSize: 3 * GB } }],
    r2OperationsAdaptiveGroups: [
      { dimensions: { actionType: 'GetObject' }, sum: { requests: 900 } },
      { dimensions: { actionType: 'PutObject' }, sum: { requests: 40 } },
      { dimensions: { actionType: 'DeleteObject' }, sum: { requests: 2 } },
    ],
    workersInvocationsAdaptive: [{ sum: { requests: 1200 } }],
  }

  it('splits operations into the two classes Cloudflare bills by', () => {
    expect(parseUsage(ANSWER)).toEqual({
      storedBytes: 3 * GB,
      classAOps: 42,
      classBOps: 900,
      workerRequests: 1200,
    })
  })

  it('sums every Worker group rather than reading only the first', () => {
    const usage = parseUsage({
      ...ANSWER,
      workersInvocationsAdaptive: [{ sum: { requests: 10 } }, { sum: { requests: 5 } }],
    })
    expect(usage.workerRequests).toBe(15)
  })

  it('THROWS on an operation it cannot classify — an unknown op is a missing cost', () => {
    expect(() =>
      parseUsage({
        ...ANSWER,
        r2OperationsAdaptiveGroups: [
          { dimensions: { actionType: 'SomeNewOperation' }, sum: { requests: 1 } },
        ],
      }),
    ).toThrow(/unclassified/)
  })

  it('throws rather than reporting zero when a figure is absent', () => {
    expect(() => parseUsage({ ...ANSWER, r2StorageAdaptiveGroups: [] })).toThrow(/storage/)
    expect(() => parseUsage({ ...ANSWER, r2OperationsAdaptiveGroups: undefined })).toThrow(
      /operations/,
    )
    expect(() => parseUsage({ ...ANSWER, workersInvocationsAdaptive: undefined })).toThrow(
      /Worker request/,
    )
    expect(() => parseUsage({})).toThrow()
  })

  it('throws on a group with no actionType at all', () => {
    expect(() =>
      parseUsage({ ...ANSWER, r2OperationsAdaptiveGroups: [{ sum: { requests: 1 } }] }),
    ).toThrow(/actionType/)
  })
})
