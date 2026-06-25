/**
 * Chain-anchored unix-seconds clock for phase derivation + countdowns (re-exported from the shared
 * hook so the `preopen → bonding` transition and maturity reflect the chain's block.timestamp, not
 * wall clock — see useChainNow for why that matters on a time-advanced dev fork).
 */
export { useChainNow as useNowSec } from '../../../lib/time/useChainNow'
