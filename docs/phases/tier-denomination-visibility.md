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

### The one exception: reroll never dissolves a tier NFT

`rerollSelectedNFTs` is the single debit a holder does not aim at. Every other debit is a deliberate move
of coin — spend it, sell it, stake it — while a reroll is a request to change *art*, and its coin
round-trip through the instance is a debit only as an implementation mechanism. So reroll is carved out
of the rule above:

> **A reroll never dissolves a tier NFT.** Every band id the caller owns is exempted by the contract,
> whether or not the caller named it in `exemptedNFTIds`.

This is enforced **on-chain, and is not a UI responsibility**. No caller can dissolve a band through
reroll: not this project's app, not a third-party integrator, not a direct contract call. A UI must not
be built on the assumption that it is the thing keeping a holder's denomination safe here, and it does
not need to warn about reroll. Two consequences a UI *does* need to render:

- **A protected band consumes one unit of the reroll budget**, exactly as an explicitly exempted id
  always has — a band NFT *is* one unit of the position. A holder with one band and three ordinary ids
  who submits `3 * unit()` rerolls **two** ordinary ids. Show the effective count before submit;
  it is `tokenAmount / unit()` minus the number of band ids the holder owns.
- **A holder whose entire position is band NFTs cannot reroll**, and the call reverts rather than
  succeeding. There is nothing left to shuffle once the bands are protected. The revert surfaces as the
  generic `RerollFailed()`.

Deliberate dissolution remains available and is the intended path: `mintDown` returns the escrow as
spendable coin first, and the freed coin rerolls normally afterwards.

Pinned in `contracts/test/factories/erc404/TierCrossFeature.t.sol` — survival without a caller-supplied
exemption, an unchanged result when the caller does supply it, the budget count, and the all-band
holder's revert.

## A self-transfer is not carved out

`transfer(self, amount)` — a holder sending coin to their own address — is a coin-path debit like any
other, and the rule above applies to it unchanged: a band NFT the debit reaches is **burned**, and
`(weight - 1) * unit()` becomes `pendingEscrowRelease(holder)`. The ERC20 ledger is unmoved, because the
coin returns to the address it left, so the whole visible outcome of a self-send is a dissolved tier NFT
and a claim.

This is the accepted outcome and a recorded decision, not an oversight, and it is the deliberate
counterpart to the reroll carve-out above: reroll is exempted because changing art is something holders
do on purpose, and a self-directed transfer is not exempted. Mechanically it follows from the seal — with
`_useDirectTransfersIfPossible` false, DN404's `from == to` shortcut is not reachable and the ordinary
tail reconciliation runs. The coin is preserved and claimable in full, and the tier is re-attainable with
a `claimReleasedEscrow()` plus a fresh `mintUp`.

What a UI does with that: a send flow has no reason to offer the holder's own address as a destination,
and a holder who sends to themselves anyway loses no coin — they hold a claim instead of a band NFT, and
the surface should render it as such (see the display requirement above).

Pinned in `contracts/test/factories/erc404/TokenTierOps.t.sol` —
`test_selfTransferDissolvesABandNftAndCreditsTheEscrowBack`, which asserts the dissolved id, the exact
credit, the untouched ERC20 balance, a successful claim, and coin conservation.

## Deliberately NOT specified here

**No transfer-time warning, confirmation step, or block is required, and none should be added on the
authority of this file.** An earlier revision of this document reserved that question; the contract now
answers it. A coin transfer cannot destroy a holder's coin — the escrow behind a burned band NFT returns
to them as `pendingEscrowRelease` — so there is nothing to warn about at transfer time. What a transfer
can and does end is the band NFT itself; that is the rule, not an edge case, and it belongs in the
display surface rather than in a warning dialog.

One display fact does follow from the rule and sits inside the visibility scope this document covers: on
a tiered instance, specific NFT **ids** are not persistent across coin transfers. A sender's tail ids
burn and the recipient receives freshly minted ones, for ordinary ids as well as band ids. The promise
the system makes is **coin conservation, not tier persistence**: what a holder keeps through a coin-path
debit is their **coin**, as escrow credited back to them — not id #42, and not the tier. A tier is
re-attainable rather than permanent, and regaining one costs a `claimReleasedEscrow()` plus a fresh
`mintUp`. A UI must not tell a holder their tier survives a transfer; it must show the claim the transfer
produced and what re-attaining the tier takes. Untiered instances are unaffected and retain DN404's
direct-transfer behaviour.

## How to check this requirement is met

1. A holder with an outstanding band NFT sees their true holdings, not only the transferable remainder.
2. A holder with a non-zero `pendingEscrowRelease` sees that coin, and can pull it.
3. An owned band NFT is presented with its tier and its denomination, not as an ordinary NFT.
