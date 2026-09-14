/**
 * Review-step gas breakdown. Shows what each piece of the deploy costs — with the on-chain embeddings
 * (cover, banner, text) itemised precisely from the metadataURI byte model, and a best-effort LIVE
 * total from `estimateContractGas`. "Contract & modules" is the remainder (total − embeddings), so the
 * three embedding lines always sum honestly into the whole.
 *
 * The ~ETH column is gas × a price, and the two halves are not equally certain. Gas is measured;
 * the price is read off the chain when the node answers and falls back to a named reference when it
 * does not. The column header carries whichever priced it, so no figure here is a constant wearing
 * the word "live".
 */
import { humanBytes, humanEth, humanGas, humanGwei } from '../../lib/wizard/embedGas'
import type { GasPriceGwei } from './useGasPriceGwei'
import type { EmbedBreakdown } from '../../lib/wizard/deployGasBreakdown'
import styles from './DeployGasBreakdown.module.css'

interface DeployGasBreakdownProps {
  breakdown: EmbedBreakdown
  /** Live total from estimateContractGas; undefined when unavailable (no wallet / would revert). */
  liveGas: bigint | undefined
  liveLoading: boolean
  /** Chain fee behind the ~ETH column, and whether it was actually read. */
  gasPrice: GasPriceGwei
}

export function DeployGasBreakdown({
  breakdown,
  liveGas,
  liveLoading,
  gasPrice,
}: DeployGasBreakdownProps) {
  const embedGas = breakdown.totalGas
  // Remainder = base contract creation + modules. Only meaningful when the live total is in and
  // exceeds the embeddings (it always should — embeddings are a subset of the tx).
  const remainder = liveGas !== undefined ? Math.max(0, Number(liveGas) - embedGas) : undefined
  const eth = (gas: number) => humanEth(gas, gasPrice.gwei)

  // The price label sits on the ~ETH column because it qualifies that column alone — the gas
  // columns beside it are measured either way.
  const priceLabel = gasPrice.isLive
    ? `@ ${humanGwei(gasPrice.gwei)} gwei now`
    : gasPrice.isLoading
      ? '@ reading fee…'
      : `@ ${humanGwei(gasPrice.gwei)} gwei ref.`

  // Two independent unknowns, so four strings: whether the total gas is the user's real deploy, and
  // whether the price came off the chain.
  const gasNote =
    liveGas !== undefined
      ? 'Gas is measured for your exact deploy. Embeddings are permanent on-chain data — you pay for every byte once.'
      : 'Embedding gas is exact; the full deploy total needs a connected wallet on a live fork.'
  const priceNote = gasPrice.isLive
    ? ` ETH is that gas at the network fee right now (${humanGwei(gasPrice.gwei)} gwei), which moves block to block.`
    : gasPrice.isLoading
      ? ' Reading the network fee for the ETH column.'
      : ` No network fee could be read, so ETH is priced at a ${humanGwei(gasPrice.gwei)} gwei reference — not a live quote.`

  return (
    <div className={styles.root} data-testid="deploy-gas-breakdown">
      <p className={styles.head}>Estimated deploy cost</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Item</th>
            <th>On-chain</th>
            <th>Gas</th>
            <th>
              ~ETH <span className={styles.gwei}>{priceLabel}</span>
            </th>
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
              <td>{l.bytes > 0 ? eth(l.gas) : '—'}</td>
            </tr>
          ))}
          <tr className={styles.derived}>
            <td>Contract &amp; modules</td>
            <td>—</td>
            <td>{remainder !== undefined ? humanGas(remainder) : liveLoading ? '…' : '—'}</td>
            <td>{remainder !== undefined ? eth(remainder) : ''}</td>
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
            <td>{liveGas !== undefined ? eth(Number(liveGas)) : ''}</td>
          </tr>
        </tfoot>
      </table>
      <p className={styles.note}>
        {gasNote}
        {priceNote}
      </p>
    </div>
  )
}
