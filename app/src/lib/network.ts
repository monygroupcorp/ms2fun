import { activeChainId, isChainDeployed } from './addresses'
import { SUPPORTED_CHAINS } from './chains'

/**
 * What the app is allowed to SAY about the chain it talks to.
 *
 * Marketing copy used to hardcode "Ethereum · Live". Neither half was true of any build that
 * exists: `activeChainId` is the local anvil fork by default and Sepolia for the showcase, and
 * both committed deployment artifacts are all-zero placeholders (real addresses are dropped in as
 * config after a deploy, so the repo never carries them). A visitor was told the protocol was live
 * on mainnet by a string that could not know either fact.
 *
 * Both values are derived at module load from the same sources the read path uses — the chain list
 * the app can reach and the deployment artifact this build carries — so the claim moves with the
 * build instead of with an editor's memory.
 */
const activeChain = SUPPORTED_CHAINS.find((chain) => chain.id === activeChainId)

/** Display name of the chain this build talks to: "Ethereum", "Sepolia", "Anvil Fork". */
export const activeNetworkName: string = activeChain?.name ?? `chain ${activeChainId}`

/**
 * The strongest status word the build can honestly print.
 *
 * "Not deployed" whenever the artifact is still a placeholder — that is the state a fresh clone
 * builds in, and it outranks the network's own kind because addresses being unknown makes the
 * question of which network moot. Otherwise a chain viem marks `testnet` is a testnet, and only a
 * populated non-testnet deployment earns "Live".
 */
export const activeNetworkStatus: 'Live' | 'Testnet' | 'Not deployed' = !isChainDeployed(
  activeChainId,
)
  ? 'Not deployed'
  : activeChain?.testnet === true
    ? 'Testnet'
    : 'Live'
