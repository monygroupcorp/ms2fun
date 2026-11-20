/**
 * `deployLiquidity` on a tithe-wired collection deploys the alignment hook through
 * `UniTitheHookFactory.deployHook`, which mines a CREATE2 salt over `HookAddressMiner.SCAN_WINDOW`
 * (100,000) candidates starting at an offset derived from `block.prevrandao` and `block.number`. That
 * offset — and so the iteration count the mine actually runs — is only known once the transaction
 * lands, one block after a wallet's `eth_estimateGas` ran. A graduation sized off that single-block
 * estimate can land in a block whose scan runs longer than the one the estimate saw and starve mid-mine
 * (`contracts/deployments/fork-rehearsal-2026-11-13/README.md`, "Seen along the way": the same
 * graduation step measured between 5.02M and 7.64M gas across four fork-rehearsal runs).
 *
 * `GRADUATION_GAS_LIMIT` instead covers the mine's own worst case regardless of which block the
 * transaction lands in: `HookAddressMinerGasTest` measures the constant-memory mine at ~182 gas per
 * iteration, so the full `SCAN_WINDOW` costs ~18.2M gas (`HookAddressMiner.sol`'s own sizing note
 * reaches the same figure and puts a full graduation — the mine plus the CREATE2 deploy and the rest of
 * `deployLiquidity` — at "near 22M against the 30M limit"). This is set above that ceiling with margin,
 * replacing the wallet's per-block estimate rather than scaling it, because a multiplier on a lucky
 * early-iteration estimate would still undershoot an unlucky late-iteration block.
 */
export const GRADUATION_GAS_LIMIT = 25_000_000n
