# Creator obligation: band metadata must state its denomination

> One-sentence statement: a Token Tier band's art is authored off-chain and unenforced on-chain, so the
> creator is the only party who can make its denomination visible — this is documentation of that
> obligation, not a spec for a validator.

## The mechanism

A tier band is a coin denomination held as a single ERC-721 piece: a tier of weight `w` is worth `w`
units of the same coin the collection already trades. `TokenTierBandResolver.resolve(inst, id, holder)`
returns `band.baseURI + id` for any id in the band — `holder` is accepted but ignored, because a band
id's art is a property of the id, not of who holds it. The JSON at that URI is written by the creator,
off-chain, and the protocol never reads or validates it.

That combination — static per-id art, off-chain JSON, no on-chain read of holder or weight — means
nothing prevents a band piece from *looking* like an ordinary collection piece. An ERC-721 transfer of a
weight-10 band moves ten units of value in a single move; a marketplace or a buyer with no independent
knowledge of the ladder cannot tell that apart from an ordinary piece's transfer.

## What this cannot become

`balanceOf` and `tokenId` are the only NFT vestigials the mirror needs, and the resolver has no way to
validate off-chain JSON — there is no on-chain-derivable denomination to check against. **This is not a
gap a validator closes.** No wizard block, no submit-time check, and no contract change follow from this;
the obligation is disclosure, not enforcement, and the app can only ever tell the creator that, not verify
it.

## The obligation

Every id inside a tier band's metadata must state the band's denomination — what the piece is worth in
coin — so that a marketplace, a buyer, or a script reading the token's metadata can see it without
knowing the ladder out of band. A trait is enough (e.g. a `denomination` or `weight` field naming the
coin multiple), stated consistently across every id in the band.

This applies per band, not per collection: a ladder with several rungs needs the correct weight stated in
each rung's own metadata, not one figure copied across all of them.

## Where creators are told

- The tier ladder form (`TierSupplyHelper`, under the derived rows) states the obligation once a ladder
  is entered, naming each tier and its weight.
- The band base URI field's help text ties the obligation to the field where the art prefix is typed.
- The Token Tiers learn concept explains why the chain cannot enforce it, alongside the rest of the
  mechanism.

None of these are gates — a creator can still ship a ladder with unlabeled bands. This document is the
durable statement of what "correct" looks like, for creators and for anyone auditing a collection's
metadata after the fact.
