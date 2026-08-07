# Requirement — Token Tiers: denomination visibility in a holder-facing UI

**Status:** Display requirement recorded, not implemented. Transfer semantics: DECIDED and enforced on-chain.
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

## What a debit does to a band NFT — the transfer rule

Transfer-time semantics are **decided and enforced on-chain**. The rule:

> **Any coin-path debit burns your tier NFT and credits you its escrow. Only a deliberate ERC721
> transfer moves the NFT itself.**

A sealed tier ladder overrides DN404's `_useDirectTransfersIfPossible` to false, closing the path that
would otherwise move ids straight from a sender to a recipient during an ERC20 transfer. What a UI can
rely on:

- **Every coin-path debit is BURNED-AND-CREDITED.** A plain `transfer`, a `transferFrom` by an approved
  spender, a sell back to the curve, and `stake` all burn a band NFT the debit reaches, and the escrow
  behind it becomes `pendingEscrowRelease(holder)` for the **holder** — never for the spender who moved
  it, never for the recipient.
- **The outcome does not depend on the recipient.** It is a function of the sender's own position alone.
  DN404 keeps `ownedLength == balance / unit` and reconciles on every debit by taking ids off the
  **tail** of `owned`, so any debit dropping `balanceOf(holder) / unit()` below the number of ids held
  takes that many off the tail, and a band id in that range burns. Everything needed to evaluate this
  off-chain is readable: `balanceOf(holder)`, `unit()`, the holder's owned ids (enumerable from the
  mirror), and which of those are band ids by the table above.
- **The ERC721 face is unchanged.** A deliberate `transferFrom` / `safeTransferFrom` of a band id —
  including by an approved operator, and including to a buyer with `skipNFT` on — moves the id and its
  full denomination to the new owner, which is what a secondary market for tier NFTs requires.

Both outcomes are pinned in `contracts/test/factories/erc404/TokenTierOps.t.sol`,
`contracts/test/factories/erc404/TierCrossFeature.t.sol` and
`contracts/test/factories/erc404/TierBurnSafety.t.sol`. In every case the coin is conserved and
reachable — no path leaves escrow stranded.

## Deliberately NOT specified here

**No transfer-time warning, confirmation step, or block is required, and none should be added on the
authority of this file.** An earlier revision of this document reserved that question; the contract now
answers it. A holder cannot lose a denomination to a coin transfer — the escrow returns to them — so
there is nothing to warn about at transfer time.

One display fact does follow from the rule and sits inside the visibility scope this document covers: on
a tiered instance, specific NFT **ids** are not persistent across coin transfers. A sender's tail ids
burn and the recipient receives freshly minted ones, for ordinary ids as well as band ids. The promise
the system makes is that a holder keeps their **tier** and their **coin**, not that they keep id #42.
Untiered instances are unaffected and retain DN404's direct-transfer behaviour.

## How to check this requirement is met

1. A holder with an outstanding band NFT sees their true holdings, not only the transferable remainder.
2. A holder with a non-zero `pendingEscrowRelease` sees that coin, and can pull it.
3. An owned band NFT is presented with its tier and its denomination, not as an ordinary NFT.
