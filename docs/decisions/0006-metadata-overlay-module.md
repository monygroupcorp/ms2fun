# ADR-0006 — Metadata-overlay module (artist-driven augmentation as an ERC404 availability)

**Status:** Exploratory 2026-06-25 (Mony). Captures a fully-fleshed design exploration; not yet committed to build.
**Amended 2026-06-25** ([ADR-0007](0007-tiered-metadata-and-resolver-composition.md)): the seam is
generalized from overlay-specific to a generic **`IMetadataResolver`** (`resolve(instance, id, holder)`),
and the instance holds a generic `modules[METADATA_RESOLVER]` pointer (one keyed slot, not a dedicated
var — see seam), which may point at a
`MetadataResolverRouter` that stacks multiple metadata modules (overlay, tier, …). The overlay module
below is one such resolver; its interface/seam are unchanged in shape — only the name generalizes.
**Related:** [ADR-0004](0004-metadata-model.md) (metadata model), [ADR-0005](0005-module-option-schema.md)
(module-option schema), `ERC404BondingInstance.sol` (tokenURI + styleUri + staking seams),
`ERC404StakingModule.sol` (the singleton this reads/writes through), `ComponentRegistry.sol` (curation).

## Context
Artists want **continuing revenue and engagement** after launch. The mechanism: a secondary metadata
layer served *over* the original without replacing it. Base `metadataURI` resolves exactly as today
(`ERC404BondingInstance._tokenURI`, line 585); a token can additionally resolve to an artist-authored
**augmented** URI — AI-augmented, canon, custom — when published and unlocked. Two motivating flows:

1. **Commission.** A holder requests a bespoke augmentation of their specific id, pays the artist
   directly (or it's free, by request); the artist publishes it for that id; the holder toggles between
   original and augmented.
2. **Event wave.** The artist releases a swathe of augmentations to a cohort (e.g. everyone staked).
   Holders opt in, *or* — under auto policy — staked holders' tokens automatically show the latest
   event with no transaction.

The flexibility to mix these is the whole point: some collections want events without forcing staking;
some want commission customization without payment. So nothing may be hard-coded to one flow.

## The decision that drives everything: what is immutable vs swappable

Instances are **EIP-1167 minimal-proxy clones of a fixed `implementation`** deployed via CREATE3
(`ERC404Factory._deployAndInitialize`, lines 261–267). Consequence: the implementation's code is frozen
the moment the factory ships, and **`_tokenURI` is a DN404 override — it can only live in the
implementation.** Changing it means a new implementation + new factory version, and even then only
*new* clones get the change.

Therefore:
- The **only** thing added to the immutable implementation is a tiny, generic, *defensive* seam — a
  module pointer + a guarded branch in `_tokenURI` — designed once to never need changing.
- **All overlay logic** (publishing, selection, pricing, eligibility, payment) lives in a
  **`MetadataOverlayModule`** singleton, curated in `ComponentRegistry` under tag `keccak256("overlay")`
  — exactly like gating / staking / liquidity. The DAO can approve, iterate, or swap overlay modules
  with **zero** change to instances or the factory. An instance adopts one by address.

This is the elegant hookup: the immutable layer carries a stable hole; the mutable layer fills it.

## The minimal instance seam (added once to the implementation)

Storage principle (decided 2026-06-26): **one generic keyed module slot, not a dedicated slot per
category.** Avoids the multi-slot overfit; absorbs every metadata-category pointer (and any future
category) in a single mapping. We deliberately add **only the one call-site we need** (`_tokenURI`) — no
speculative hooks to pre-anticipate future modules (that's attack surface we can't yet review). New
call-sites later = an accepted implementation/factory upgrade, which the upgradeable factory absorbs.
Existing `gatingModule`/`stakingModule`/`liquidityDeployer` slots stay as-is (built + bespoke call-sites);
the map is the pattern for new categories going forward, not a retrofit.

Mutability principle (decided 2026-06-26): **the resolution mechanism is sealed at construction — no owner
setter.** The instance pointer (and the router's per-instance resolver list, ADR-0007) are wired ONCE by
the factory at create, registry-validated, then frozen. This separates two owner powers the conflated
setter mixed: changing the *mechanism* (which contracts resolve — pure rug surface → frozen) vs changing
the *content* (publish waves/commissions/tiers — the actual feature → stays mutable, but lives in the
modules, governed by each module's own rules). Sealing the pointer costs the feature nothing because the
artist's whole post-launch loop runs through the modules, not the pointer. Trade-off accepted: a
collection declares its module stack at launch and can't bolt on a *new module category* later (it keeps
every feature of the modules it launched with); the defensive `try/catch` means a revoked/buggy module
degrades to base metadata rather than bricking, so no owner setter is needed for recovery either.

**Overlay content mutability is *additive*, not free-rewrite** — the integrity guardrail that makes
"editable forever" safe beyond the protected base: the artist can always *add* (new waves, new
commissions), but **published content is immutable once live** — a published wave's `baseURI` is frozen,
and a commission's URI is frozen once it's been *paid for*. Otherwise "mutable" would let an artist take
payment then swap the art — a rug inside the mutable layer. So: base is indestructible (holder-selectable
fallback), published/paid overlay content is immutable (buyer protection), and only *adding new* content
stays open. Tier (ADR-0007) goes further — its whole config is frozen at construction.

```solidity
// 1. ONE generic slot for all known + future module pointers (role => module; 0 = absent)
mapping(bytes32 => address) public modules;
bytes32 constant METADATA_RESOLVER = keccak256("metadata.resolver");

// 2. SET ONCE, BY FACTORY, AT CONSTRUCTION — no owner setter (sealed mechanism). Registry-validated by
//    the factory (isApprovedComponent), like gating/staking wiring today; reverts if already set.
function initModule(bytes32 role, address m) external {
    if (msg.sender != factory) revert OnlyFactory();
    if (modules[role] != address(0)) revert ModuleAlreadySet();
    modules[role] = m;
    emit ModuleSet(role, m);
}

// 3. expose the NFT owner so the module can authorize holder writes (DN404 tracks it internally)
function ownerOf(uint256 id) public view returns (address) { return _ownerOf(id); }

// 4. the resolution hook — the ONLY new call-site; defensive: a misbehaving module can NEVER brick tokenURI.
//    NB: uses _ownerAt (no existence check), NOT _ownerOf — _ownerOf reverts TokenDoesNotExist (DN404.sol:1133)
//    and the current _tokenURI never reverts on unminted ids; _ownerAt returns address(0) there → resolves to base.
function _tokenURI(uint256 id) internal view override returns (string memory) {
    string memory base = string.concat(metadataURI, LibString.toString(id));
    address m = modules[METADATA_RESOLVER];
    if (m != address(0)) {
        try IMetadataResolver(m).resolve(address(this), id, _ownerAt(id)) returns (string memory aug) {
            if (bytes(aug).length != 0) return aug;        // augmented wins
        } catch {}                                          // any revert/gas issue → base, marketplaces safe
    }
    return base;
}

// (DROPPED 2026-06-26) fundStakers / the STAKERS payout rail is deferred to keep the immutable seam
// strictly generic — the 4 hooks above know nothing about overlay/tier. Overlay ships with ARTIST + SPLIT
// payout only (both 100% module-side). If pay-to-augment→stakers is ever wanted, re-add this as a general
// "external revenue → stakers" primitive (recordFeesReceived is onlyRegisteredInstance, so it MUST
// originate from the instance — it cannot be offloaded to a module):
//   function fundStakers() external payable { if (!stakingActive) revert; stakingModule.recordFeesReceived(msg.value); }
```

The entry is **registry-validated at construction** (the factory's existing `isApprovedComponent` check,
mirroring `params.stakingModule` at ERC404Factory.sol:179–181) AND the `try/catch` makes the read
defensive: even if a module is later revoked or misbehaves, `tokenURI` degrades to base — never reverts.
Belt and suspenders, with no owner mutation path on the mechanism. Consistent with the registry's stance
that "revocation blocks new creation only; existing instances are unaffected."

## The module (everything else lives here, swappable)

The overlay module **implements the generic `IMetadataResolver`** (defined in ADR-0007 — `resolve(instance,
id, holder) → string`); there is no overlay-specific resolver interface. It self-describes via
`IComponentModule.metadataURI` for the wizard.

```solidity
enum WaveCond  { NONE, STAKE, PAY }     // event-wave gate, chosen per wave
enum CommCond  { NONE, PAY }            // commission gate — STAKE makes no sense for a bespoke per-id piece
enum Payout    { ARTIST, SPLIT }        // where PAY money goes (STAKERS deferred — see seam note)
```

**Read-interfaces the module needs** (all getters verified to exist on `ERC404BondingInstance`): `owner()`
(Ownable), `ownerOf(uint256)` (the new seam getter), `balanceOf(address)` (ERC20), `stakingModule()`,
`vault()`, `protocolTreasury()`; plus the staking singleton's public `stakedBalance(address,address)`. The
module declares these as two small read interfaces — no instance-side changes beyond the seam's `ownerOf`.

**Eligibility predicates** (exact):
- `commissionVisible(inst,id)` = `bytes(commissionURI[inst][id]).length>0 && (cond==NONE || (cond==PAY && paid[inst][id]))`.
- `waveEligible(inst,id,wIdx,holder)` = `NONE → true`, `STAKE → stakedBalance(inst,holder) ≥ wave.threshold`,
  `PAY → wavePaid[inst][id][wIdx]`.
- **Note the deliberate metric split:** overlay STAKE waves gate on **staked amount** (`stakedBalance`) —
  these are staker-reward events; tier (ADR-0007) gates on **effective holdings** (`balanceOf + stakedBalance`).
  Don't conflate them in the build — different numbers, different intent.

**Events** (for the indexer / UI, no backend): `WavePublished(inst, wIdx)`, `CommissionSet(inst, id)`,
`Unlocked(inst, id, who, kind)`, `SelectionChanged(inst, id, ptr)`, `AutoLatestSet(inst, bool)`.

State, keyed by instance address (same singleton pattern as `ERC404StakingModule`, holds no custody):

```solidity
// kind A — commission: bespoke per-id string
mapping(address => mapping(uint256 => string))   commissionURI;
mapping(address => mapping(uint256 => Terms))     commissionTerms;   // {CommCond, price, Payout}
mapping(address => mapping(uint256 => bool))      paid;              // PAY commission settled

// kind B — event wave: ONE entry; a token's event art is baseURI + tokenId (mirrors the main concat)
struct Wave { string baseURI; WaveCond cond; uint256 threshold; uint256 price; Payout payout; }
mapping(address => Wave[])                         waves;

// holder selection — a version pointer (see encoding), default 0 = AUTO
mapping(address => mapping(uint256 => uint256))    selection;
mapping(address => mapping(uint256 => mapping(uint256 => bool))) wavePaid; // PAY-wave unlock, per id per wave
mapping(address => bool)                           autoLatest;       // collection policy
```

**Authorization** (no new trust — the instance already fully owns its metadata):
- Artist writes (publish commission / wave, set policy): `Ownable(instance).owner() == msg.sender`.
- Holder writes (select / unlock): `IInstance(instance).ownerOf(id) == msg.sender` (reverts on unminted —
  correct: can't select a token that doesn't exist).
- STAKE reads: `instance.stakingModule().stakedBalance(instance, holder)` — a public mapping (NOT on the
  minimal `IERC404StakingModule` interface, so the module declares its own one-line read interface), no
  auth, returns 0 when staking inactive, so STAKE waves are simply never eligible until staking is on.

**Content-integrity enforcement (H4) — the guardrail needs teeth, not just intent:**
- **Waves are append-only:** there is no `editWave`; `publishWave` only appends. A published wave's
  `baseURI`/terms are immutable by construction. ✔
- **Commissions lock on payment (decided):** `setCommission(id, …)` MUST revert once `paid[inst][id]` is
  true — you can't rug what someone paid for. **Free (`NONE`) commissions stay mutable**; the holder's
  recourse is to re-pin (`BASE`/`AUTO`) since they're out nothing — so we DON'T track "pinned" state just
  to lock free gifts (one trigger, `paid`, not two). Before payment the artist may freely set/clear. One
  commission slot per id (matches the single `COMMISSION` pointer).
- **`autoLatest`** is mutable policy (`setAutoLatest`, owner) — safe because holders always retain pin
  control; it is NOT a sealed mechanism. (H8: it's a post-create op, with its initial value optionally
  seeded at create — not two separate sources of truth.)

**Reentrancy (H5):** `unlock` / `unlockWave` are `payable` and send ETH to `owner()` (ARTIST) or
vault+treasury+owner (SPLIT) — any of which may be a contract. They MUST be `nonReentrant` with strict
CEI: set `paid`/`wavePaid`/`selection` before any external value transfer. The module holds no custody;
ETH only flows through.

## Selection as a version pointer (not a toggle)

`selection[inst][id]` encodes: `0 = AUTO`, `1 = BASE`, `2 = COMMISSION`, `≥3 = wave index (n-3)`.

- `AUTO` (default) — follow collection policy: newest *eligible* wave if `autoLatest` and staked, else base.
- `BASE` — pin to original; survives every future wave. The "override back to base."
- `COMMISSION` / `wave#` — **pinned versioning**: stay on that exact version when newer waves drop,
  until the holder re-points. Pins are sticky; only re-pointing or returning to `AUTO` moves them.

Resolution precedence (pin wins; auto is the fallback; eligibility always re-checked live):

```
sel = selection[inst][id]
sel == BASE        -> ""                                           (DECLINE overlay → falls to lower stack)
sel == COMMISSION  -> commissionVisible ? commissionURI : ""       (NONE, or PAY && paid)
sel is wave w      -> waveEligible(w, holder) ? baseURI+id : ""     (NONE | STAKE≥thr | PAY && wavePaid)
sel == AUTO        -> autoLatest ? newestEligibleWave(holder)+id : ""   (eligibility is PER-WAVE, below)
default            -> ""                                           (resolver returns "" → next in stack / base)
```

`waveEligible(w, holder)` / `newestEligibleWave` evaluate eligibility **per wave by its Condition** —
`NONE` → always, `STAKE` → effective stake ≥ threshold, `PAY` → `wavePaid`. (H2 fix: AUTO is NOT gated on
a blanket `staked` — an open/`NONE` "automatic event" must auto-show to *all* holders, not only stakers;
the per-wave Condition is the only gate.) `newestEligibleWave` scans `waves` from the end and returns the
first the holder qualifies for — O(1) in the common case; pinned lookups are O(1) by index. The auto path
costs the holder **zero transactions** — `tokenURI` computes the latest eligible event live.

**`BASE` in the stack (H3):** overlay's `BASE` returns `""`, which means *decline overlay augmentation* —
the router then falls through to the **next resolver** (e.g. tier), NOT necessarily to collection-base.
So a holder pinning `BASE` on a tier id still sees its rarity reveal (rarity is intrinsic, not opt-out);
`BASE` escapes the *overlay layer*, not the whole stack. UX copy should say "show original / no
augmentation," not "show plain base." Collection-base shows only when every resolver in the stack returns
`""`.

**Paying shows it immediately.** `unlock(id)` (commission) / `unlockWave(id, w)` sets `paid`/`wavePaid`
*and* sets `selection` to that version in the same tx — no second toggle. The holder can later re-point
to `BASE` or `AUTO`. (`AUTO` deliberately tracks *events only*; commissions are opt-in pins, so an
event wave never silently overwrites a holder's bespoke commission.)

## Payment routing (the `Payout` per publish)

Two rails (STAKERS deferred — see seam note above), each reusing existing machinery; the artist picks
per commission / per wave:

- **ARTIST** (commission default) — `SafeTransferLib.safeTransferETH(Ownable(instance).owner(), price)`.
  A bespoke service rendered by the artist; paid directly.
- **SPLIT** — `RevenueSplitLib.split` (the canonical 1% protocol / 19% vault / 80% artist), reading
  `instance.protocolTreasury()` and `instance.vault()`. The vault leg is **not** a plain transfer: it
  reuses the graduation path `IAlignmentVault.receiveContribution{value: vaultCut}(Currency.wrap(address(0)),
  vaultCut, instance)` (cf. LiquidityDeployerModule.sol:173) so the contribution is credited to the
  instance as benefactor; protocol and artist legs are plain `safeTransferETH`. For collections that want
  overlay revenue to feed the alignment vault like every other settlement.

Both shipped rails (ARTIST, SPLIT) are entirely module-side — no instance hook. This is exactly why
STAKERS was dropped: it was the *only* rail needing instance code (`recordFeesReceived` is
instance-only), so deferring it keeps the immutable seam free of any overlay-specific function.

## Transfer behavior (falls out of the id-keying for free — no transfer hook)

State is keyed by `tokenId`, so a transfer needs **no** DN404 hook (which we couldn't cheaply add anyway):
- **PAY unlocks travel with the id** → a paid/augmented piece is a **sellable upgrade**; the buyer
  inherits `paid`/`wavePaid` and the pinned `selection`. Emergent, and desirable.
- **Selection is sticky** → a buyer who wants a different view re-points in one tx (it's now *their*
  preference). No reset-on-transfer machinery.
- **STAKE eligibility re-evaluates for the new holder** → a staking-gated wave the previous owner saw
  shows for the buyer only if *they* stake. The pin is a preference; the stake is the gate; they compose.

(Accepted id-recycle consequence from the prior exploration is unchanged: PAY state lives on the id; a
future remint of a freed id could inherit a paid unlock. A per-id version nonce clears it later if it
ever bites. STAKE waves are immune — tied to the live holder's stake.)

## Wizard / ADR-0005 integration

The module self-describes (`IComponentModule.metadataURI`) with `configType: "metadata-overlay"`.
Split along ADR-0005's create-time-config vs post-create-ops seam:
- **Create-time `ConfigSchema`** (small, rendered in the wizard): *initial* `autoLatest` (mutable later,
  H8), default `Payout`, enable-commissions / enable-events flags. This is all the overlay needs at creation — the
  module pointer is factory-wired at construction via `initModule(METADATA_RESOLVER, …)` (sealed, no owner
  setter), like a `ModuleSlot` with tag `overlay`.
- **Post-create operations** (like ERC1155 editions): `publishWave`, `setCommission`, `setAutoLatest` —
  artist actions over the collection's life, surfaced in a management UI, not the creation wizard.

Frontend resolution needs **nothing special**: `tokenURI` already returns the right value on-chain
(cf. `ProjectStyle.tsx` / styleUri precedent). The UI only adds: an artist "publish augmentation /
release event" panel and a holder "pin version / unlock" control.

## Configurations this covers
| | Scope | Condition | Selection | Payout |
|---|---|---|---|---|
| Bespoke, pay-artist, toggle | one id | PAY | COMMISSION pin | ARTIST |
| Bespoke, by-request, free | one id | NONE | COMMISSION pin | — |
| Event, staking, opt-in | cohort | STAKE | holder selects wave | SPLIT (or free) |
| Event, staking, automatic | cohort | STAKE | AUTO + autoLatest | SPLIT (or free) |
| Event, open, automatic | cohort | NONE | AUTO + autoLatest | — |

## Caveats / open questions
- **Requires a new implementation + factory version** to introduce the seam; already-live clones
  (EXEC404, grandfathered) won't have it. Acceptable — EXEC404 is a fossil slice.
- **Canon authority** = the artist is the sole writer; off-chain like all metadata, not on-chain-verified.
- **`SPLIT` 80%-leg destination** confirmed as artist (owner) for overlay payments — settle before build.
- **DN404 owner lookup — VERIFIED (2026-06-25):** `_ownerOf(id)` (DN404.sol:1133, reverts on unminted) and
  `_ownerAt(id)` (line 1124, no check) both exist. Hook uses `_ownerAt`; instance's public `ownerOf` uses
  `_ownerOf`. `RevenueSplitLib.split` shape and `IAlignmentVault.receiveContribution` signature also verified.

## Out of scope (for now)
- Build. This ADR is exploratory — it captures the model and the hookup so they don't drift.
- ERC1155 / ERC721-auction parity — designed against ERC404 first.
