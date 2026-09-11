/**
 * Vector pin for `splitAmount` against `RevenueSplitLib.split` (contracts/src/shared/libraries/
 * RevenueSplitLib.sol). The `expected` column below is NOT hand-derived — it is the console.log
 * output of a throwaway `forge test -vv` run against the actual library, over exactly these ten
 * amounts:
 *
 *   forge test --match-contract RevenueSplitVectorsTest -vv
 *
 * (a one-off test file, not committed, that called `RevenueSplitLib.split(amounts[i])` in a loop
 * and logged `protocolCut`/`vaultCut`/`remainder` for each). The Solidity twin of this exact table
 * — same ten amounts, same expected legs — lives in
 * contracts/test/shared/libraries/RevenueSplitLib.t.sol as `test_vectors_matchesAppMirror`; if one
 * side ever needs to change, change the other file's table to match and say why in both commits.
 *
 * Vectors cover: zero, the two smallest amounts too small for either leg to round up (1, 2), the
 * three amounts where a leg's floor division is on/around a rounding boundary (99 loses the vault
 * leg a wei short of 19, 100 is the first amount where protocol rounds up to 1, 101 is one wei
 * past that), a mid-size amount (10001) exercising all three legs at once, a realistic on-chain
 * amount (1 ETH), a large amount (1e24, ~1M ETH), and a value near the top of what `vaultCut`'s
 * `amount * 19` can multiply without approaching uint256 overflow (2^128).
 */
import { describe, expect, test } from 'vitest'
import { splitAmount } from './revenueSplit'

const VECTORS: { amount: bigint; protocol: bigint; vault: bigint; remainder: bigint }[] = [
  { amount: 0n, protocol: 0n, vault: 0n, remainder: 0n },
  { amount: 1n, protocol: 0n, vault: 0n, remainder: 1n },
  { amount: 2n, protocol: 0n, vault: 0n, remainder: 2n },
  { amount: 99n, protocol: 0n, vault: 18n, remainder: 81n },
  { amount: 100n, protocol: 1n, vault: 19n, remainder: 80n },
  { amount: 101n, protocol: 1n, vault: 19n, remainder: 81n },
  { amount: 10_001n, protocol: 100n, vault: 1_900n, remainder: 8_001n },
  {
    amount: 1_000_000_000_000_000_000n, // 1 ETH
    protocol: 10_000_000_000_000_000n,
    vault: 190_000_000_000_000_000n,
    remainder: 800_000_000_000_000_000n,
  },
  {
    amount: 1_000_000_000_000_000_000_000_000n, // 1e24
    protocol: 10_000_000_000_000_000_000_000n,
    vault: 190_000_000_000_000_000_000_000n,
    remainder: 800_000_000_000_000_000_000_000n,
  },
  {
    amount: 340_282_366_920_938_463_463_374_607_431_768_211_456n, // 2^128
    protocol: 3_402_823_669_209_384_634_633_746_074_317_682_114n,
    vault: 64_653_649_714_978_308_058_041_175_412_035_960_176n,
    remainder: 272_225_893_536_750_770_770_699_685_945_414_569_166n,
  },
]

describe('splitAmount — pinned against RevenueSplitLib.split', () => {
  test.each(VECTORS)('amount=$amount', ({ amount, protocol, vault, remainder }) => {
    expect(splitAmount(amount)).toEqual({ protocol, vault, remainder })
  })

  test('every vector sums back to the amount (no wei created or lost)', () => {
    for (const v of VECTORS) {
      const s = splitAmount(v.amount)
      expect(s.protocol + s.vault + s.remainder).toBe(v.amount)
    }
  })
})
