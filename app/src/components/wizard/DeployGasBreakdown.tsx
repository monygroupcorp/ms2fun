/**
 * Review-step gas breakdown. Shows what each piece of the deploy costs — with the on-chain embeddings
 * (cover, banner, text) itemised precisely from the metadataURI byte model, and a best-effort LIVE
 * total from `estimateContractGas`. "Contract & modules" is the remainder (total − embeddings), so the
 * three embedding lines always sum honestly into the whole.
 */
import { humanBytes, humanEth, humanGas, REF_GWEI } from '../../lib/wizard/embedGas'
import type { EmbedBreakdown } from '../../lib/wizard/deployGasBreakdown'
import styles from './DeployGasBreakdown.module.css'

interface DeployGasBreakdownProps {
  breakdown: EmbedBreakdown
  /** Live total from estimateContractGas; undefined when unavailable (no wallet / would revert). */
  liveGas: bigint | undefined
  liveLoading: boolean
}

export function DeployGasBreakdown({ breakdown, liveGas, liveLoading }: DeployGasBreakdownProps) {
  const embedGas = breakdown.totalGas
  // Remainder = base contract creation + modules. Only meaningful when the live total is in and
  // exceeds the embeddings (it always should — embeddings are a subset of the tx).
  const remainder = liveGas !== undefined ? Math.max(0, Number(liveGas) - embedGas) : undefined

  return (
    <div className={styles.root} data-testid="deploy-gas-breakdown">
      <p className={styles.head}>
        Estimated deploy cost <span className={styles.gwei}>@ {REF_GWEI} gwei</span>
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Item</th>
            <th>On-chain</th>
            <th>Gas</th>
            <th>~ETH</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.lines.map((l) => (
            <tr key={l.key} className={l.bytes === 0 ? styles.zero : undefined}>
              <td>
                {l.label}
                {l.key !== 'text' && l.bytes > 0 && (
                  <span className={styles.tag}>{l.embedded ? 'embedded' : 'link'}</span>
                )}
              </td>
              <td>{l.bytes > 0 ? humanBytes(l.bytes) : '—'}</td>
              <td>{l.bytes > 0 ? humanGas(l.gas) : '—'}</td>
              <td>{l.bytes > 0 ? humanEth(l.gas) : '—'}</td>
            </tr>
          ))}
          <tr className={styles.derived}>
            <td>Contract &amp; modules</td>
            <td>—</td>
            <td>{remainder !== undefined ? humanGas(remainder) : liveLoading ? '…' : '—'}</td>
            <td>{remainder !== undefined ? humanEth(remainder) : ''}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td>{humanBytes(breakdown.totalBytes)}</td>
            <td>
              {liveGas !== undefined
                ? humanGas(Number(liveGas))
                : liveLoading
                  ? 'estimating…'
                  : `${humanGas(embedGas)} + deploy`}
            </td>
            <td>{liveGas !== undefined ? humanEth(Number(liveGas)) : ''}</td>
          </tr>
        </tfoot>
      </table>
      <p className={styles.note}>
        {liveGas !== undefined
          ? 'Live estimate for your exact deploy. Embeddings are permanent on-chain data — you pay for every byte once.'
          : 'Embedding costs are exact; the full deploy total needs a connected wallet on a live fork.'}
      </p>
    </div>
  )
}
