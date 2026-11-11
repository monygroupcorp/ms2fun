/**
 * The on-chain reads hosting makes: the two the bind step needs, and the two the watcher repeats
 * for every launched collection (has it graduated, where does its per-token base point now).
 *
 * Binding turns an expiring draft into hosting for a launched collection, so it has to be earned by
 * a fact anyone can check: the instance is one the protocol's registry knows, and its on-chain
 * per-token base (`metadataURI()`, which `tokenURI` composes as `base + id`) points at the draft's
 * metadata CID. Both are read here; the caller never takes a client's word for either.
 */
import { createPublicClient, http, parseAbi } from 'viem'

import { parseGatewayShapedUri } from '../../../../app/src/lib/art/hostingLimits'

const REGISTRY_ABI = parseAbi(['function isRegisteredInstance(address) view returns (bool)'])
const INSTANCE_ABI = parseAbi([
  'function metadataURI() view returns (string)',
  'function graduated() view returns (bool)',
])

export interface InstanceFacts {
  registered: boolean
  metadataURI: string
}

export type ReadInstance = (
  rpcUrl: string,
  registry: `0x${string}`,
  instance: `0x${string}`,
) => Promise<InstanceFacts>

export const readInstance: ReadInstance = async (rpcUrl, registry, instance) => {
  const client = createPublicClient({ transport: http(rpcUrl) })
  const [registered, metadataURI] = await Promise.all([
    client.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: 'isRegisteredInstance',
      args: [instance],
    }),
    client.readContract({ address: instance, abi: INSTANCE_ABI, functionName: 'metadataURI' }),
  ])
  return { registered, metadataURI }
}

/** What the watcher reads about a launched collection on each check. */
export interface CollectionFacts {
  /** False for a collection type without a bonding curve, which never graduates. */
  graduated: boolean
  metadataURI: string
}

export type ReadCollectionFacts = (
  rpcUrl: string,
  instance: `0x${string}`,
) => Promise<CollectionFacts>

export const readCollectionFacts: ReadCollectionFacts = async (rpcUrl, instance) => {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000 }) })
  const [graduated, metadataURI] = await Promise.allSettled([
    client.readContract({ address: instance, abi: INSTANCE_ABI, functionName: 'graduated' }),
    client.readContract({ address: instance, abi: INSTANCE_ABI, functionName: 'metadataURI' }),
  ])
  // The base is the one read that must succeed: without it nothing is known. A `graduated()` that
  // fails is a contract without one, and counts as not graduated, so only the backstop applies.
  if (metadataURI.status === 'rejected') throw metadataURI.reason
  return {
    graduated: graduated.status === 'fulfilled' && graduated.value,
    metadataURI: metadataURI.value,
  }
}

/**
 * The root CID a per-token base points into: `ipfs://<cid>/` or the gateway shape
 * `https://<host>/ipfs/<cid>/`. Null for anything else — a base on some other host is not ours.
 */
export function baseCid(uri: string): string | null {
  const trimmed = uri.trim()
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]{46,})(?:\/|$)/.exec(trimmed)
  if (ipfs !== null) return ipfs[1]!
  return parseGatewayShapedUri(trimmed)?.cid ?? null
}
