import { sepoliaChainId } from '../addresses'

/**
 * Where a launcher gets free gas money on a testnet build. Deploying a collection is a transaction
 * from the launcher's own wallet, so on Sepolia they need Sepolia ETH before the Deploy button can do
 * anything — and nothing in the flow said so until the wallet refused at the very end.
 *
 * Keyed by chain id, and only chains with real public faucets are listed: mainnet has none (its ETH
 * is real money), and the local anvil fork funds its dev accounts itself. A build pointed at either
 * gets `undefined` from {@link testnetFaucetFor}, which is the whole gate for every faucet mention.
 */
export interface TestnetFaucet {
  /** Display name of the chain the ETH is for, as the launcher will see it in their wallet. */
  network: string
  /** Faucet page. External; open in a new tab. */
  url: string
}

/** Google Cloud's Web3 faucet: free Sepolia ETH daily with a Google sign-in, no mainnet balance asked. */
export const SEPOLIA_FAUCET_URL =
  'https://cloud.google.com/application/web3/faucet/ethereum/sepolia'

const FAUCETS: Readonly<Record<number, TestnetFaucet>> = {
  [sepoliaChainId]: { network: 'Sepolia', url: SEPOLIA_FAUCET_URL },
}

/** The faucet for `chainId`, or `undefined` when the chain is not a public testnet we can point at. */
export function testnetFaucetFor(chainId: number): TestnetFaucet | undefined {
  return FAUCETS[chainId]
}

/**
 * Whether a wallet holding `balance` wei looks unable to pay for the deploy.
 *
 * `costWei` is the best known cost (ETH sent with the call plus live gas × price) or `undefined`
 * when it isn't known yet. An unknown balance is never "short" — the notice must not flash while the
 * read is in flight. An empty wallet is always short, whether or not the cost is known.
 */
export function isDeployUnderfunded(
  balance: bigint | undefined,
  costWei: bigint | undefined,
): boolean {
  if (balance === undefined) return false
  if (balance === 0n) return true
  return costWei !== undefined && balance < costWei
}
