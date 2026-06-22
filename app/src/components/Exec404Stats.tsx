import { formatGwei, formatUnits } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { EXEC404_ADDRESS, EXEC404_CHAIN_ID, ONE_EXEC, exec404Abi } from '../lib/exec404'
import styles from './Exec404Stats.module.css'

const base = { address: EXEC404_ADDRESS, abi: exec404Abi, chainId: EXEC404_CHAIN_ID } as const

/** Compact EXEC token amount: base-units → human, no trailing-zero noise. */
function fmtExec(raw: bigint): string {
  return Number(formatUnits(raw, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Live EXEC404 state read off the fork via one multicall (useReadContracts batches into a single
 * eth_call). User balance is a separate read, enabled only when a wallet is connected.
 */
export function Exec404Stats() {
  const { address, isConnected } = useAccount()

  const { data, isPending, isError } = useReadContracts({
    contracts: [
      { ...base, functionName: 'name' },
      { ...base, functionName: 'symbol' },
      { ...base, functionName: 'totalSupply' },
      { ...base, functionName: 'totalBondingSupply' },
      { ...base, functionName: 'liquidityPair' },
      { ...base, functionName: 'calculateCost', args: [ONE_EXEC] },
    ],
  })

  const balance = useReadContract({
    ...base,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address },
  })

  if (isError) {
    return <p className={styles.unreachable}>EXEC404 unreachable — is the fork up?</p>
  }

  const [name, symbol, totalSupply, bondingSupply, pair, costPerExec] = data ?? []
  const graduated = pair?.result && pair.result !== '0x0000000000000000000000000000000000000000'

  const rows: Array<{ label: string; value: string }> = [
    {
      label: 'price · 1 EXEC',
      value: costPerExec?.result ? `${formatGwei(costPerExec.result)} gwei` : '—',
    },
    { label: 'total supply', value: totalSupply?.result ? fmtExec(totalSupply.result) : '—' },
    { label: 'bonding supply', value: bondingSupply?.result ? fmtExec(bondingSupply.result) : '—' },
    { label: 'graduated', value: pair?.result ? (graduated ? 'yes · has LP' : 'no') : '—' },
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
