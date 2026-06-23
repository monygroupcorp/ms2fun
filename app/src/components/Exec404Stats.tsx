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
 * Live EXEC404 state read off the fork via one multicall. Price is the REAL graduated market price
 * from the Uniswap V2 pool (`getAmountsOut` for 1 EXEC → ETH), not the dead bonding curve. User
 * balance is a separate read, enabled only when a wallet is connected.
 */
export function Exec404Stats() {
  const { address, isConnected } = useAccount()

  const { data, isPending, isError } = useReadContracts({
    contracts: [
      { ...exec404Contract, functionName: 'name' },
      { ...exec404Contract, functionName: 'symbol' },
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
    return <p className={styles.unreachable}>EXEC404 unreachable — is the fork up?</p>
  }

  const [name, symbol, totalSupply, pair, amountsOut] = data ?? []
  // getAmountsOut returns [amountIn, amountOut]; amountOut is wei ETH for 1 EXEC.
  const priceWei = amountsOut?.result?.[1]
  const graduated = pair?.result !== undefined && pair.result !== zeroAddress

  const rows: Array<{ label: string; value: string }> = [
    {
      label: 'market price · 1 EXEC',
      value: priceWei !== undefined ? `≈ ${formatGwei(priceWei)} gwei` : '—',
    },
    {
      label: 'total supply',
      value: totalSupply?.result !== undefined ? fmtExec(totalSupply.result) : '—',
    },
    {
      label: 'market',
      value:
        pair?.result !== undefined ? (graduated ? 'Uniswap V2 · graduated' : 'not graduated') : '—',
    },
    {
      label: 'your balance',
      value: !isConnected
        ? 'connect wallet'
        : balance.data !== undefined
          ? `${fmtExec(balance.data)} EXEC`
          : '…',
    },
  ]

  return (
    <section className={styles.panel} data-testid="exec404-stats">
      <header className={styles.head}>
        <h2 className={styles.name}>{isPending ? '…' : (name?.result ?? 'EXEC404')}</h2>
        <span className={styles.symbol}>{symbol?.result ?? 'EXEC'}</span>
      </header>
      <dl className={styles.grid}>
        {rows.map((row) => (
          <div key={row.label} className={styles.cell}>
            <dt className={styles.label}>{row.label}</dt>
            <dd className={styles.value}>{isPending ? '…' : row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
