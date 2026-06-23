import { formatGwei, formatUnits, zeroAddress } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import {
  EXEC_TO_ETH_PATH,
  ONE_EXEC,
  exec404Contract,
  uniswapV2RouterContract,
} from '../lib/exec404'
import styles from './Exec404Stats.module.css'

/** Compact EXEC token amount: base-units → human, no trailing-zero noise. */
function fmtExec(raw: bigint): string {
  return Number(formatUnits(raw, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Live EXEC404 market read off the fork via one multicall, rendered as a brutalist stat-box card
 * (docs/examples `.bonding-section` + `.bonding-stats`). Price is the REAL graduated market price
 * from the Uniswap V2 pool (`getAmountsOut` for 1 EXEC → ETH), not the dead bonding curve.
 */
export function Exec404Stats() {
  const { address, isConnected } = useAccount()

  const { data, isPending, isError } = useReadContracts({
    contracts: [
      { ...exec404Contract, functionName: 'totalSupply' },
      { ...exec404Contract, functionName: 'liquidityPair' },
      {
        ...uniswapV2RouterContract,
        functionName: 'getAmountsOut',
        args: [ONE_EXEC, EXEC_TO_ETH_PATH],
      },
    ],
  })

  const balance = useReadContract({
    ...exec404Contract,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address },
  })

  if (isError) {
    return (
      <section className={styles.card} data-testid="exec404-stats">
        <p className={styles.unreachable}>EXEC404 unreachable — is the fork up?</p>
      </section>
    )
  }

  const [totalSupply, pair, amountsOut] = data ?? []
  // getAmountsOut returns [amountIn, amountOut]; amountOut is wei ETH for 1 EXEC.
  const priceWei = amountsOut?.result?.[1]
  const graduated = pair?.result !== undefined && pair.result !== zeroAddress

  const stats: Array<{ label: string; value: string }> = [
    {
      label: 'market price · 1 EXEC',
      value: priceWei !== undefined ? `≈${formatGwei(priceWei)} gwei` : '—',
    },
    {
      label: 'total supply',
      value: totalSupply?.result !== undefined ? fmtExec(totalSupply.result) : '—',
    },
    {
      label: 'your balance',
      value: !isConnected
        ? '— connect'
        : balance.data !== undefined
          ? `${fmtExec(balance.data)}`
          : '…',
    },
  ]

  return (
    <section className={styles.card} data-testid="exec404-stats">
      <header className={styles.head}>
        <h2 className={styles.title}>Market</h2>
        <span className={`badge ${graduated ? 'badge-solid' : ''}`}>
          {pair?.result === undefined ? '…' : graduated ? 'Uniswap V2' : 'not graduated'}
        </span>
      </header>
      <dl className={styles.statsGrid}>
        {stats.map((s) => (
          <div key={s.label} className={styles.stat}>
            <dd className={styles.statValue}>{isPending ? '…' : s.value}</dd>
            <dt className={styles.statLabel}>{s.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}
