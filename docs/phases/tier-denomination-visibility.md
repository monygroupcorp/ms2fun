# Requirement — Token Tiers: denomination visibility in a holder-facing UI

**Status:** Requirement recorded, not implemented
**Applies to:** any holder-facing surface for a factory-launched ERC404 instance with a sealed tier ladder
**Source:** noesis-153 (tier cross-feature test expansion), measured against `contracts/src/factories/erc404/**`

> A tier NFT is a coin DENOMINATION. A holder-facing UI must make that denomination visible, because
> the ERC20 balance alone does not describe what a holder owns.

---

## Why this is written down before there is a UI

The tier feature is complete on-chain (`mintUp` / `mintDown`, the escrow accounting, and the
`_afterNFTTransfers` burn-safety hook) and has no front-end surface yet: `mintUp`, `coinBalanceOf` and
`tierBands` appear nowhere under `app/src/**` outside the generated ABI bindings. So there is nothing to
add this to today. Recording the requirement here keeps it from being re-derived from the contracts by
whoever builds that surface.

## The requirement

A holder-facing tier UI **MUST** show a holder's true holdings — `coinBalanceOf(holder)` — alongside the
transferable amount — `balanceOf(holder)` — and must not present `balanceOf` alone as "your balance".

The two differ by design. `balanceOf` is DN404's transferable ERC20 balance and is deliberately left
unchanged by the tier feature: coin escrowed behind a band NFT is not transferable, so it is not in
`balanceOf`. `coinBalanceOf` is the aggregate view that adds it back. A holder who converts ten units'
worth of holdings into one tier-1 band NFT reads as **one** unit under `balanceOf` and **ten** under
`coinBalanceOf`, having lost nothing. A UI that shows only the former reports a 90% loss that did not
happen.

The same applies to coin already released back to a holder but not yet pulled:
`pendingEscrowRelease(holder)` is claimable via `claimReleasedEscrow()` and is likewise absent from
`balanceOf` until claimed.

## On-chain facts a UI can read

All of these are public reads on the instance.

| Fact | How to read it |
| --- | --- |
| True holdings (liquid + escrowed) | `coinBalanceOf(holder)` |
| Transferable amount | `balanceOf(holder)` |
| Coin released and awaiting a pull | `pendingEscrowRelease(holder)`, paid by `claimReleasedEscrow()` |
| The ordinary id ceiling | `idLimit = totalSupply() / unit()` — fixed for the instance's life |
| Is an owned id a band id? | `id > idLimit`. Which band and what weight: walk `tierBands(i)` → `(idStart, idEnd, weight)` and match `idStart <= id <= idEnd` |
| What one band id is worth | `(weight - 1) * unit()` of escrow, plus the one unit of balance the NFT itself is |
| Collection-level totals | `bandOutstanding(tierN)`, `totalTierEscrow()`, `totalPendingEscrowRelease()` |

## The condition that decides a band NFT's fate on a debit

Stated here as a readable fact, because a UI cannot describe a holder's position without it — **not** as
a prescription for what to do about it (see the next section).

DN404 keeps `ownedLength == balance / unit` for every holder, and reconciles it on every debit by taking
ids off the **tail** of that holder's `owned` array. So any debit that would drop
`balanceOf(holder) / unit()` below the number of ids the holder owns will take that many ids off the
tail, and a band id inside that range is one of them. Everything needed to evaluate this off-chain is
readable: `balanceOf(holder)`, `unit()`, the holder's owned ids (enumerable from the mirror), and which
of those ids are band ids by the table above.

The two outcomes are measured and pinned in
`contracts/test/factories/erc404/TierCrossFeature.t.sol` and
`contracts/test/factories/erc404/TierBurnSafety.t.sol`: the band id either moves to the recipient with
its escrow claim intact, or it is burned and its escrow becomes `pendingEscrowRelease` for the holder.
Which of the two happens depends on whether the recipient takes NFTs. In both cases the coin is
conserved and reachable — no path leaves escrow stranded.

## Deliberately NOT specified here

**Transfer-time semantics are an open design decision and this document takes no position on them.** Do
not implement a warning, a confirmation step, a block, or any other transfer-time behaviour on the
authority of this file. What a transfer of a tier NFT should mean — including whether a transferred tier
NFT keeps its id and carries its full denomination, which is what a secondary market for tier NFTs would
require — is being decided separately. This requirement is scoped to **display**: make the denomination
visible. Anything beyond that waits for that decision.

## How to check this requirement is met

1. A holder with an outstanding band NFT sees their true holdings, not only the transferable remainder.
2. A holder with a non-zero `pendingEscrowRelease` sees that coin, and can pull it.
3. An owned band NFT is presented with its tier and its denomination, not as an ordinary NFT.
