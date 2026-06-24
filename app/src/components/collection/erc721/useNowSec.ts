/**
 * Chain-anchored unix-seconds clock for auction countdowns + state derivation (re-exported from the
 * shared hook so an on-chain-ended auction reads as ended in the UI — see useChainNow for why this
 * matters on a time-advanced dev fork).
 */
export { useChainNow as useNowSec } from '../../../lib/time/useChainNow'
