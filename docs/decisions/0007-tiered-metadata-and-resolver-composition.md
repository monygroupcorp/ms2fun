# ADR-0007 — Tiered (rarity-by-ownership) metadata + the resolver-composition model

**Status:** Exploratory 2026-06-25 (Mony). Captures a design exploration; not yet committed to build.
**Related:** [ADR-0006](0006-metadata-overlay-module.md) (overlay module — generalized here),
[ADR-0004](0004-metadata-model.md), `ERC404BondingInstance.sol` (the `_tokenURI` seam, `stake`),
`ERC404StakingModule.sol` (`stakedBalance`), DN404.sol (id assignment + NFT-burn-on-transfer).

## Context
A second ERC404 metadata idea: **tiers of rarity activated and gated by NFT ownership.** A holder with
enough balance to back 10 NFTs can see/access a rarer subset (a distinct URI, e.g. an id-range); 100
unlocks a rarer one still — "work your way to an ultra rare." Pairing it with ADR-0006's overlay module
is a deliberate thought experiment: does the single immutable `_tokenURI` seam survive a *second*
metadata module wanting the same hole?

Two readings of "tier" were considered:
- **A — gated allocation:** the holder claims an actual reserved-range id. DN404 doesn't let a minter
  *choose* an id (assignment pulls burned-pool then sequential, DN404.sol:529–553), so this needs a
  directed-swap function in the **immutable** instance implementation + pre-minted reserved ranges. Heavy.
- **B — conditional reveal (CHOSEN):** rare ids already exist in supply; a rare id renders rare **only
  while its holder's effective balance clears the tier threshold**, else it shows base/locked. Pure
  metadata resolution — zero allocation, zero custody, zero new instance write. DN404-native.

## Decision 1 — generalize the ADR-0006 seam (the architectural payoff)
Two metadata modules wanting one `_tokenURI` hole does **not** widen the immutable seam. ADR-0006's seam
was already the right shape; we only generalize its **role/name**:

- `IMetadataOverlayModule` → **`IMetadataResolver`**: `resolve(address instance, uint256 id, address holder)
  → string`. Unchanged signature. Overlay and tier both implement it.
- Instance holds the resolver in a **generic `mapping(bytes32 => address) modules`** at role
  `METADATA_RESOLVER` — one keyed slot for all known + future module pointers, NOT a dedicated var per
  category (lean storage; decided 2026-06-26). The contract it points at MAY be a
  **`MetadataResolverRouter`** that composes an ordered list of child resolvers (first non-empty wins).

The immutable implementation is **unchanged** from ADR-0006 — one pointer, one defensive `try/catch`,
`_ownerAt(id)`. Stacking N metadata modules is entirely a swappable-layer concern; the frozen hole never
changes again to admit a third or fourth. A collection that wants only one module sets
`modules[METADATA_RESOLVER]` straight at it and skips the router entirely.

```solidity
interface IMetadataResolver is IComponentModule {
    function resolve(address instance, uint256 id, address holder) external view returns (string memory);
}

contract MetadataResolverRouter is IMetadataResolver {
    mapping(address => address[]) public resolvers;                 // per instance, ordered by precedence
    mapping(address => bool)      public sealed_;                   // per instance, set-once
    // SEALED AT CONSTRUCTION — a REGISTERED FACTORY wires the stack once, then frozen (no owner mutation of
    // the mechanism; ADR-0006 mutability principle). The artist evolves CONTENT inside each module, not the
    // stack. Auth is masterRegistry.isFactoryRegistered (NOT a hardcoded `factory`): this is a shared
    // singleton serving many instances across factory types/versions, AND it blocks the seal-front-run —
    // CREATE3 instance addresses are deterministic, so only a registered factory may seal a (future) instance.
    function initResolvers(address inst, address[] calldata rs) external {
        require(masterRegistry.isFactoryRegistered(msg.sender) && !sealed_[inst]);  // registered-factory, once
        resolvers[inst] = rs; sealed_[inst] = true;
    }
    function resolve(address inst, uint256 id, address holder) external view returns (string memory) {
        address[] storage rs = resolvers[inst];
        for (uint256 i; i < rs.length; ++i) {
            try IMetadataResolver(rs[i]).resolve(inst, id, holder) returns (string memory u) {
                if (bytes(u).length != 0) return u;                 // first non-empty wins
            } catch {}                                               // defensive at the router too
        }
        return "";                                                  // → instance falls back to base
    }
}
```

Natural precedence `[overlay, tier]`: a holder's explicit pin/event (overlay) is the most specific intent;
tier rarity is the ambient layer beneath it; collection base is last.

## Decision 2 — tier as a conditional-reveal resolver
Singleton keyed by instance (same pattern as staking/overlay), holds no custody:

```solidity
struct Tier {
    uint256 idStart;     // inclusive — the rare id range (the "subset within the collection")
    uint256 idEnd;       // inclusive
    uint256 minBalance;  // effective-holdings threshold, in token units (e.g. 10 * unit)
    string  baseURI;     // revealed art base; resolves baseURI + id
    string  lockedURI;   // shown when held but under threshold ("" => fall through to collection base)
}
mapping(address => Tier[]) public tiers;   // non-overlapping ranges; order = precedence on overlap
mapping(address => bool)   public sealed_; // per instance, set-once

// CONFIG SEALED AT CONSTRUCTION — a REGISTERED FACTORY wires tiers ONCE at create, then frozen. NO owner
// add/edit. Mutable rarity = rug: moving ranges/thresholds after people bought or earned toward a tier
// would change what's rare retroactively. The REVEAL stays dynamic (tracks live balances) — frozen rules,
// moving outcomes — but the rules themselves are immutable. (Opposite of overlay, ADR-0006, whose
// content is mutable-forever because it only serves OVER a holder-selectable, indestructible base.)
// Auth: masterRegistry.isFactoryRegistered (same rationale as the router — shared singleton, upgrade-safe,
// blocks seal-front-run on deterministic CREATE3 addresses). NOT a hardcoded `factory`.
function initTiers(address inst, Tier[] calldata ts) external {
    require(masterRegistry.isFactoryRegistered(msg.sender) && !sealed_[inst]);  // registered-factory, once
    // validate non-overlapping, ascending ranges here
    tiers[inst] = ts; sealed_[inst] = true;
}

function resolve(address inst, uint256 id, address holder) external view returns (string memory) {
    (bool found, Tier memory t) = _tierForId(inst, id);            // explicit found-flag (not idEnd==0 sentinel)
    if (!found) return "";                                          // common id → collection base
    uint256 eff = IERC20(inst).balanceOf(holder) + _stakedOf(inst, holder);
    if (eff >= t.minBalance) return string.concat(t.baseURI, _toStr(id));   // revealed
    return t.lockedURI;                                             // "" => base/common look
}
```

"Enough balance to support 10 NFTs" = `minBalance = 10 * unit`. Reveal is for ids the holder **holds**
(by construction they hold ≥1 unit backing it); the threshold gates whether it lights up. Dump balance →
the rare ids you hold go dark. **Tier config is set at construction and frozen** — frozen rules, dynamic
reveal; no post-create authoring.

## Decision 3 — effective holdings count staked balance
`_stakedOf(inst, holder) = inst.stakingModule() == address(0) ? 0 : stakingModule.stakedBalance(inst, holder)`.

This exists because of a sharp DN404 interaction surfaced by pairing the modules:

**Staking and NFT-rarity-holding fight over the same ERC20 units.** Staking moves the holder's balance
into the instance (ERC404BondingInstance.sol:363), and moving backing ERC20 out **burns the holder's
NFTs** (`numNFTBurns = _zeroFloorSub(fromOwnedLength, fromBalance / unit)`, DN404.sol:771). So staking the
units behind a legendary **burns the legendary** and drops `balanceOf`. Naively, staking would doubly
disable tier reveal, and overlay's STAKE-gated events (which *require* staking) would be mutually
exclusive with tier reveal on the same tokens.

Counting staked balance toward `eff` resolves the *threshold* half cleanly, with one caveat it cannot fix:
- **Restored:** a holder keeps the specific rare NFTs **unstaked** (≈1 unit each, so the ids survive) and
  stakes everything else; staked units still count toward `minBalance`. Rarity stays lit while earning
  staking yield. Minimal opportunity cost — you only keep the rare ids themselves in-wallet.
- **Not restored (by design — can't be):** if you stake the unit *behind a rare id itself*, that id burns
  and returns to the pool. Reveal is keyed on holding the id; no balance arithmetic brings a burned NFT
  back. This is inherent to DN404's balance↔NFT binding, not a module bug.

This is also why Reading B composes and Reading A would not: threshold-reveal survives partial staking;
hold-the-exact-id allocation does not.

## Composition summary (overlay × tier) — they STACK and AGREE
The two modules compose by design; they are NOT exclusive (except one structural DN404 case below).
- Both implement `IMetadataResolver`; the router orders them — precedence chosen at construction and
  **frozen** (sealed router, ADR-0006). `[overlay, tier]` default; tier-over-overlay is a valid launch
  choice (rarity as sacred identity).
- **Precedence composition, not blending** — per render one layer wins (you can't blend two URIs on-chain).
- **The id is the shared key, so agreement is an authoring property:** overlay event art is `eventBaseURI
  + id`, tier is id-range keyed. Because tier ranges are FROZEN at construction, the artist knows which ids
  are rare when authoring overlays, and authors the rare ids' event/commission art as rarity-aware
  variants. The contract picks overlay-over-tier; the overlay already reflects the tier. True visual
  "stacking" happens in authoring, enabled by the frozen tier config.
- **Opposite mutability is the point** (per ADR-0006's three-tier model): overlay content is
  mutable-forever (safe — serves over an indestructible, holder-selectable base); tier config is frozen
  (mutable rarity would rug). They agree precisely *because* tier is frozen — it gives the mutable overlay
  a stable rarity map to author against.
- **The only genuine exclusivity is structural, not design:** overlay's *STAKE-gated* events vs tier's
  *hold-to-reveal* fight over the same ERC20 units (staking burns the NFT). Overlay's PAY / commission /
  free-event paths stack with tier cleanly; staked balance counts toward tier thresholds, but the rare ids
  themselves must stay unstaked to exist. No metadata design can paper over DN404's balance↔NFT binding.
- Overlay's id-recycle edge (ADR-0006) is now reachable *through staking* too: staking burns ids, a freed
  id can be reminted to another wallet inheriting any id-keyed PAY commission. Same per-id version-nonce
  mitigation applies if it ever bites.

## Configurations this covers
| | Mechanic | Gate | Stacks with overlay |
|---|---|---|---|
| Earned rarity | id-range reveal | effective holdings ≥ threshold | yes — tier beneath overlay |
| Tiered ladder | several ranges, ascending thresholds | hold more → reveal rarer | yes |
| Rarity + augment | tier base + holder-pinned event | threshold + selection | overlay wins on pin |

## Spec hardening from the 2026-06-26 hole-review
- **H1 (HIGH) — module-init auth fixed:** router/tier seal via `masterRegistry.isFactoryRegistered`
  (verified MasterRegistryV1.sol:285), NOT a hardcoded `factory`. Survives factory upgrades + multiple
  factory types, and blocks the **seal-front-run** (deterministic CREATE3 addresses → only a registered
  factory may seal a future instance).
- **H6 — `_tierForId` returns an explicit `(found, Tier)`**, not an `idEnd==0` sentinel.
- **Verified non-issue:** `_ownerAt(id)` is revert-free (`_restrictNFTId` masks id≥2³² to 0,
  DN404.sol), so feeding it into `_tokenURI` adds no new reverts for weird/unminted ids.

## Caveats / open questions
- **Router precedence is a per-collection launch choice, then frozen** — `[overlay, tier]` default; a
  collection may invert to tier-over-overlay (ultra-rares as sacred identity). Chosen at construction via
  the sealed router; not mutable afterward.
- **Tier ranges must be non-overlapping + ascending**; validate in `initTiers` at construction (reverts seal).
- **`_tierForId` is O(tiers)** — fine for a handful of tiers; not a per-id mapping. Cap tier count.
- **Holder `address(0)` / unminted id (decided): no special-casing.** Effective holdings = 0 < threshold →
  the normal `lockedURI` path applies. So `lockedURI == ""` → falls to collection base (clean default);
  `lockedURI` set → the locked art shows for in-range unminted ids too, i.e. a **teaser** for unsold rares.
  The artist chooses which simply by whether they set `lockedURI` — no branch needed.
- **Reading A (allocation) deferred** — if reserved-range claiming is ever wanted, it's a separate
  instance-level directed-swap primitive layered on top, not part of this resolver.
- DN404 facts verified 2026-06-25/26: NFT-burn-on-balance-decrease (DN404.sol:771), id assignment
  (529–553), `_ownerAt`/`_ownerOf` (1124/1133), `_restrictNFTId` revert-free.

## Build notes (tier + router)
- **Tier read-interface:** `IERC20(inst).balanceOf`, `inst.stakingModule()`, and the staking singleton's
  `stakedBalance(inst, holder)` — all verified to exist; tier holds no custody and has no holder/artist
  write path (only the factory's one-time `initTiers`).
- **Tier wizard `configType: "metadata-tier"`** — the **entire** tier table (ranges/thresholds/URIs/
  precedence) is create-time and sealed; there are **no post-create ops** (unlike overlay). The wizard
  collects it all upfront and the factory seals it in the create tx.
- **Events:** `TiersSealed(inst, count)`, `ResolversSealed(inst, resolvers[])` — emitted once at seal, for
  the indexer to record the frozen graph. No mutation events (there are no mutations).
- **Router order is the precedence** and is itself sealed; `[overlay, tier]` default, `[tier, overlay]` for
  rarity-supreme collections — chosen in the wizard, frozen by `initResolvers`.

## Out of scope (for now)
- Build. Exploratory — captures the model + the composition findings so they don't drift.
- ERC1155 / ERC721-auction parity.
