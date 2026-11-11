/**
 * The panel's state: the plan (what to keep), the status readout (is it on public IPFS?), and the
 * CAR, built once on the first click that needs it and shared by every option that does.
 */
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { HostingStatus } from '../../../lib/art/hostClient'
import type { KeepCar, KeepProgress } from '../../../lib/art/keep/build'
import { imageRootOf, keepPlan, onChainRoots, type KeepPlan } from '../../../lib/art/keep/plan'
import { checkRoots, independentGateways } from '../../../lib/art/keep/retrievable'
import { normaliseArtServiceBase } from '../../../lib/metadata/artServiceBase'
import { fetchJson } from '../../../lib/metadata/uri'

/** How long a readout stands before it is asked again. Short: a fresh pin propagates in minutes. */
export const STATUS_STALE_MS = 5 * 60_000

/** Our own origins, which the readout never counts and a pinning-service token never reaches. */
export function ourOrigins(host: string | null): (string | null)[] {
  return [host, normaliseArtServiceBase(import.meta.env.VITE_ART_SERVICE)]
}

/**
 * The plan, with the images root filled in for a plain IPFS collection from its first piece's JSON
 * (the read the gallery below has usually already made, so normally a cache hit).
 */
export function usePlan(
  base: string | undefined,
  status: HostingStatus | null | undefined,
  host: string | null,
): { plan: KeepPlan | null; ready: boolean } {
  const plan = keepPlan(base, status, host)
  const lead = useQuery({
    queryKey: ['keep-alive-image-lead', plan?.metaCid, plan?.metaSample],
    enabled: plan !== null && plan.imgCid === null,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await fetchJson<{ image?: unknown }>(
        `ipfs://${plan!.metaCid}/${plan!.metaSample}`,
        signal,
      )
      return result.status === 'found' ? imageRootOf(result.data?.image) : null
    },
  })
  if (plan === null || plan.imgCid !== null) return { plan, ready: true }
  if (lead.isPending) return { plan, ready: false }
  if (!lead.data) return { plan, ready: true }
  return { plan: { ...plan, imgCid: lead.data.cid, imageSample: lead.data.file }, ready: true }
}

/** The status readout: each on-chain root, asked of independent public gateways. */
export function useKeepStatus(plan: KeepPlan | null, host: string | null) {
  const roots = plan === null ? [] : onChainRoots(plan)
  return useQuery({
    queryKey: ['keep-alive-status', ...roots.map((r) => `${r.role}:${r.cid}:${r.sample ?? ''}`)],
    enabled: roots.length > 0,
    staleTime: STATUS_STALE_MS,
    gcTime: STATUS_STALE_MS * 2,
    retry: false,
    queryFn: () => checkRoots(roots, { gateways: independentGateways(ourOrigins(host)) }),
  })
}

export type CarState =
  | { kind: 'idle' }
  | { kind: 'building'; progress: KeepProgress }
  | { kind: 'ready'; keep: KeepCar }
  | { kind: 'failed'; message: string }

/**
 * The CAR for a plan, built on demand. The CAR code (a CAR reader, the UnixFS importer) loads only
 * here, on the first click that needs it.
 */
export function useKeepCar(plan: KeepPlan | null) {
  const [state, setState] = useState<CarState>({ kind: 'idle' })
  const pending = useRef<Promise<KeepCar> | null>(null)
  const planKey = plan === null ? '' : `${plan.kind}:${plan.metaCid}:${plan.imgCid ?? ''}`

  // A new plan (the host's record arrived, the base changed) invalidates any CAR built for the old.
  useEffect(() => {
    pending.current = null
    setState({ kind: 'idle' })
  }, [planKey])

  const build = useCallback(async (): Promise<KeepCar | null> => {
    if (plan === null) return null
    if (pending.current === null) {
      pending.current = (async () => {
        const { buildKeepCar, checkKeepCar } = await import('../../../lib/art/keep/build')
        const keep = await buildKeepCar(plan, {
          onProgress: (progress) => setState({ kind: 'building', progress }),
        })
        await checkKeepCar(keep, plan)
        return keep
      })()
      setState({ kind: 'building', progress: { stage: 'metadata', bytes: 0, source: '' } })
    }
    try {
      const keep = await pending.current
      setState({ kind: 'ready', keep })
      return keep
    } catch (error) {
      pending.current = null
      setState({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'the CAR could not be built',
      })
      return null
    }
  }, [plan])

  return { state, build }
}

/** A file name for the CAR: the collection's name, then the end of its first root. */
export function carFilename(name: string | undefined, keep: KeepCar): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const first = keep.roots[0]?.cid ?? 'collection'
  return `${slug === '' ? 'collection' : slug}-${first.slice(-10)}.car`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
