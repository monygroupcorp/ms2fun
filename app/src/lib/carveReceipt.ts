/**
 * Graduation carve settlement — the log-reading half of the creator-carve disclosure.
 *
 * `lib/` may not import from `components/`, so the `MoneyReceipt` adapter for the creator's
 * in-session confirmation stays at its call site (`Erc404AdminPanel.tsx`); the union arithmetic it
 * formats is `carveSettlementFromLogs` below, which is also what the public collection page renders.
 *
 * `lib/carve.ts` stays a dependency-free pure-math mirror of the on-chain split. This module is the
 * other half: it decodes what the chain ACTUALLY settled, from the two graduation events, and is the
 * single home of that union arithmetic. Two call sites read it:
 *   - the creator admin panel, off the confirmed `deployLiquidity` receipt (in-session), and
 *   - the public collection page's graduated surface, off a backward log scan (survives a reload).
 *
 * Reads `CreatorCarvePaid(instance, creator, requested, paid)` AND `GraduationExcessTithed(instance,
 * amount)` and sums them — the two authoritative figures the chain settled on, never a re-quote of
 * the pre-tx preview (a preview can drift from what `deployLiquidity` resolves to).
 *
 * `CreatorCarvePaid.paid` is capped to the requested leg alone (`min(r.carvePaid, p.carveEth)` at
 * emit time); any LP-share ETH the parity clamp could not place at pool price (`excessEth`) is tithed
 * on the same rail but reported separately as `GraduationExcessTithed`. The two always sum to the
 * module's actual gross carve, and — critically — the carve request defaults to 0, so the common case
 * is `carveEth == 0`: no `CreatorCarvePaid` at all, even though `excessEth` can still be nonzero and
 * ETH still lands in the creator's wallet. Summing both events (treating an absent event as 0) is
 * what makes the excess-only case produce a figure instead of reading as "no carve".
 *
 * The summed gross is split 1% protocol / 19% vault / 80% creator, mirroring `RevenueSplitLib.split`
 * exactly (via `carveCreatorNet`). Every LiquidityDeployerModule variant (default/zamm/cypher)
 * declares both events with an identical signature, so decoding against the default ABI resolves
 * regardless of which module this instance's factory wired.
 */
import { useQuery } from '@tanstack/react-query'
import { decodeEventLog, type Log } from 'viem'
import { usePublicClient } from 'wagmi'
import {
  liquidityDeployerModuleAbi,
  useReadErc404BondingInstanceLiquidityDeployer,
} from '../generated/contracts'
import { deployBlock, type SupportedChainId } from './addresses'
import { carveCreatorNet } from './carve'
import { scanBackward } from './logScan'

/** What the chain settled at graduation: the gross carve and its 1/19/80 split. */
export interface CarveSettlement {
  /** `CreatorCarvePaid.paid + GraduationExcessTithed.amount` — the module's actual gross carve. */
  gross: bigint
  /** 1% of gross. */
  protocol: bigint
  /** 19% of gross. */
  vault: bigint
  /** 80% of gross — what the creator's wallet received. */
  creatorNet: bigint
}

/**
 * The union arithmetic, in one place. Logs that this ABI cannot decode are skipped, so a full tx
 * receipt or a mixed log window can be passed straight in. A `gross` of 0 is a real answer — the
 * collection graduated with no creator carve — not a failure.
 */
export function carveSettlementFromLogs(logs: readonly Log[]): CarveSettlement {
  let carvePaid = 0n
  let excessTithed = 0n
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: liquidityDeployerModuleAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'CreatorCarvePaid') {
        carvePaid = decoded.args.paid
      } else if (decoded.eventName === 'GraduationExcessTithed') {
        excessTithed = decoded.args.amount
      }
    } catch {
      // Not a log this ABI can decode (a different event, or a log from another contract in the
      // same window) — decodeEventLog throws on a topic0 mismatch; skip it and keep scanning.
    }
  }
  const gross = carvePaid + excessTithed
  return {
    gross,
    protocol: gross / 100n,
    vault: (gross * 19n) / 100n,
    creatorNet: carveCreatorNet(gross),
  }
}

export interface UseCarveSettlementResult {
  /** The settled figures once the scan resolves; `gross === 0n` means "graduated with no carve". */
  data: CarveSettlement | undefined
  isPending: boolean
  isError: boolean
}

/**
 * Read a graduated instance's carve settlement straight from chain history, so the disclosure
 * survives a page reload and is visible to every visitor — not only the wallet that clicked
 * graduate. Scans BACKWARD from `latest` in windows, floored at the deploy block per the rule in
 * `lib/addresses.ts` (never `fromBlock: 0n`), matching the two events on the instance's own
 * `liquidityDeployer` module and filtering by the indexed `instance` topic.
 *
 * Pass `enabled: false` for a non-graduated instance — there is nothing to find before graduation.
 */
export function useCarveSettlement(
  instance: `0x${string}`,
  chainId: SupportedChainId,
  options?: { enabled?: boolean },
): UseCarveSettlementResult {
  const enabled = options?.enabled ?? true
  const client = usePublicClient({ chainId })
  const { data: deployer } = useReadErc404BondingInstanceLiquidityDeployer({
    address: instance,
    chainId,
    query: { enabled },
  })

  const query = useQuery({
    queryKey: ['carve-settlement', chainId, instance, deployer],
    enabled: enabled && Boolean(client) && Boolean(deployer),
    staleTime: 60_000,
    queryFn: async (): Promise<CarveSettlement> => {
      if (!client || !deployer) throw new Error('carve settlement: no client or deployer module')
      const latest = await client.getBlockNumber()
      const logs = await scanBackward<Log>(
        async (fromBlock, toBlock) => {
          const [paid, excess] = await Promise.all([
            client.getContractEvents({
              address: deployer,
              abi: liquidityDeployerModuleAbi,
              eventName: 'CreatorCarvePaid',
              args: { instance },
              fromBlock,
              toBlock,
            }),
            client.getContractEvents({
              address: deployer,
              abi: liquidityDeployerModuleAbi,
              eventName: 'GraduationExcessTithed',
              args: { instance },
              fromBlock,
              toBlock,
            }),
          ])
          return [...paid, ...excess] as Log[]
        },
        { latest, floor: deployBlock },
      )
      return carveSettlementFromLogs(logs)
    },
  })

  return {
    data: query.data,
    isPending: enabled && query.isPending,
    isError: query.isError,
  }
}
