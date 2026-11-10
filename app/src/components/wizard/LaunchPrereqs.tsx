/**
 * What a launcher needs in hand before the wizard is worth starting, and the louder version of the
 * same point at the Deploy button when their wallet can't pay.
 *
 * Both read the faucet from {@link testnetFaucetFor}: a testnet build names the testnet and links
 * its faucet; mainnet (and the local fork) never shows a faucet link. `chainId` defaults to the
 * chain this build talks to and is a prop only so the gate can be exercised in tests.
 */
import { useBalance } from 'wagmi'
import { forkChainId } from '../../lib/addresses'
import { isDeployUnderfunded, testnetFaucetFor } from '../../lib/wizard/testnetFunds'
import styles from './LaunchPrereqs.module.css'

function FaucetLink({ url }: { url: string }) {
  return (
    <a className={styles.link} href={url} target="_blank" rel="noopener noreferrer">
      get some free from a faucet ↗
    </a>
  )
}

/** The short "before you start" list at the top of the first wizard step. */
export function BeforeYouStart({ chainId = forkChainId }: { chainId?: number }) {
  const faucet = testnetFaucetFor(chainId)
  return (
    <section
      className={styles.root}
      aria-label="Before you start"
      data-testid="wizard-before-start"
    >
      <p className={styles.head}>Before you start</p>
      <ul className={styles.list}>
        <li>
          {faucet ? (
            <>
              <b>{faucet.network} ETH</b> in your wallet to pay the deploy gas. It&rsquo;s testnet
              ETH, not real money — <FaucetLink url={faucet.url} />.
            </>
          ) : (
            <>
              <b>ETH</b> in your wallet to pay the deploy gas.
            </>
          )}
        </li>
        <li>
          <b>Your art, already hosted.</b> The wizard takes links (<code>ipfs://</code>,{' '}
          <code>ar://</code>, <code>https://</code>) — it doesn&rsquo;t upload files. For a DNT,
          piece art is a base link with one file per piece (<code>ipfs://CID/1</code>,{' '}
          <code>/2</code>, …). Both the cover and piece art can be added after deploy.
        </li>
      </ul>
    </section>
  )
}

/**
 * Next to Deploy: says plainly that the connected wallet can't cover the deploy on a testnet build,
 * and where to get more. Renders nothing on mainnet, while the balance is loading, or once the
 * wallet holds enough.
 */
export function TestnetFundsNotice({
  wallet,
  costWei,
  chainId = forkChainId,
}: {
  wallet: `0x${string}` | undefined
  /** Best known cost of the deploy in wei, or `undefined` while it isn't known. */
  costWei: bigint | undefined
  chainId?: number
}) {
  const faucet = testnetFaucetFor(chainId)
  const { data } = useBalance({
    address: wallet,
    chainId: chainId as typeof forkChainId,
    query: { enabled: Boolean(faucet && wallet) },
  })
  if (!faucet || !wallet || !isDeployUnderfunded(data?.value, costWei)) return null

  return (
    <div className={styles.alert} role="status" data-testid="wizard-testnet-funds">
      <p className={styles.head}>Not enough {faucet.network} ETH</p>
      <p className={styles.note}>
        {data?.value === 0n
          ? `This wallet has no ${faucet.network} ETH, so it can't pay the deploy gas.`
          : `This wallet's ${faucet.network} ETH won't cover the deploy.`}{' '}
        Testnet ETH is free — <FaucetLink url={faucet.url} />, then come back and deploy.
      </p>
    </div>
  )
}
