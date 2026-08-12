// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DN404 } from "dn404/src/DN404.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { BondingCurveMath } from "./libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IGlobalMessageRegistry } from "../../registry/interfaces/IGlobalMessageRegistry.sol";
import { IGatingModule, GatingScope } from "../../gating/IGatingModule.sol";
import { IERC404StakingModule } from "../../interfaces/IERC404StakingModule.sol";

// ── Reroll errors (shared by the instance trampoline + the delegatecall Ops) ────────────────────
// The instance's reroll body lives in ERC404BondingOps (reached by a discard-returndata delegatecall
// trampoline, EIP-170 diet — noesis-091). Ops reverts with these specific errors INTERNALLY; the
// trampoline discards returndata (a via_ir size cliff forbids bubbling), so a caller sees the generic
// `RerollFailed()`. The specifics remain visible in traces.
error InsufficientTokenBalance();
error TokenAmountMustBePositive();
error TokenAmountMustRepresentNFT();
error BalanceMismatchAfterReroll();
error RerollFailed();

// ── Token Tiers errors (shared by the instance seal/trampolines + the delegatecall Ops) ─────────
// Same split as reroll: the tier bodies (`mintUp` / `mintDown`) live in ERC404BondingOps and revert
// with these specific errors INTERNALLY; the instance's discard-returndata trampoline surfaces the
// generic `TierOpFailed()` to the caller (the specifics stay visible in traces). `InvalidBand` is
// raised by the instance's OWN `initTierBands` seal (reached through the same discard-returndata
// trampoline), so it surfaces as the generic `InitTierBandsFailed()`, not verbatim. `BandIdOverflow`
// is raised by `ERC404Factory._deriveTierBands` before narrowing — the only live uint32 rejection in
// the system — and therefore surfaces verbatim from the factory.
error TiersNotConfigured();
error InvalidBand();
error BandExhausted();
error NotBandId();
error NotTierZeroId();
error TierOpFailed();
error BandIdOverflow();

// ── Escrow release errors (noesis-143) — raised by the instance's OWN `claimReleasedEscrow`, so
// they surface verbatim (no trampoline in that path).
error NothingToClaim();
error EscrowReleaseFailed();

// ── Value-path errors (shared by the instance + the delegatecall Ops — noesis-148 D3 diet) ──────
// The six value-path bodies (`claimFreeMint`, `claimAllFees`, `withdrawDust`, `stake`, `unstake`,
// `claimStakingRewards`) live in ERC404BondingOps and revert with these specific errors INTERNALLY;
// the instance's discard-returndata trampoline surfaces one generic error per entry point (below).
// Several of these are ALSO raised by bodies that STAYED in the instance — `BondingEnded` and
// `GatingNotAllowed` in buyBonding — and there they still surface verbatim.
// (`TooEarly` / `BondingNotConfigured` were in that list until noesis-188 moved the `deployLiquidity`
// body to Ops as well; on the graduation path they now surface as `GraduationFailed`.)
error BondingEnded();
error BondingNotConfigured();
error TooEarly();
error GatingNotAllowed();
error FreeMintDisabled();
error FreeMintAlreadyClaimed();
error FreeMintExhausted();
error StakingModuleNotSet();
error NothingToWithdraw();
error WithdrawFailed();

// ── Generic errors surfaced by the six value-path trampolines (noesis-148) ──────────────────────
// One per entry point. Returndata is discarded deliberately (bubbling re-triggers the via_ir size
// cliff the whole diet exists to buy back — re-measured on this tree, see the PR body), so an
// Ops-side revert reaches the caller as the generic error for that entry point. Every revert still
// HAPPENS and the specific error stays visible in traces; only message legibility degrades.
error FreeMintFailed();
error ClaimFeesFailed();
error WithdrawDustFailed();
error StakeFailed();
error UnstakeFailed();
error ClaimRewardsFailed();

// ── Config-path errors (shared by the instance + the delegatecall Ops — noesis-149 D2 diet) ─────
// The fourteen init/admin/setter bodies (`initializeProtocol`, `setMetadataURI`, `setContractURI`,
// `initializeFreeMint`,
// `initTierBands`, `initializeStaking`, `initModule`, `setAgentDelegation`,
// `setAgentDelegationFromFactory`, `setBondingOpenTime`, `setBondingMaturityTime`, `setBondingActive`,
// `setStyle`, `activateStaking`) live in ERC404BondingOps and revert with these specific errors
// INTERNALLY; the instance's discard-returndata trampoline surfaces one generic error per entry point
// (below). Moved VERBATIM out of `ERC404BondingInstance.sol` so BOTH sides compile them. The three that
// bodies STILL in the instance raise — `AlreadyInitialized` / `InvalidOwner` in `initialize`,
// `OnlyFactory` in `initializeMetadata` — surface verbatim from those paths, exactly as before, and
// stay importable from `ERC404BondingInstance.sol` (it re-exports them by name). `initialize` itself
// is deliberately first-caller-wins: it RECORDS `factory = msg.sender` rather than checking it, so it
// cannot raise `OnlyFactory`.
// `StakingModuleNotSet` is declared above with the value-path errors: `activateStaking` shares it with
// the staking trampolines.
error OnlyFactory();
error NotInitialized();
error AlreadyInitialized();
error InvalidOwner();
error InvalidGlobalMessageRegistry();
error ModuleAlreadySet();
error TimeMustBeInFuture();
error OpenTimeMustBeSetFirst();
error MaturityMustBeAfterOpenTime();
error OpenTimeNotSet();
error CannotActivateAfterLiquidityDeployed();
error StakingAlreadyActive();

// ── Generic errors surfaced by the fourteen config trampolines (noesis-149) ─────────────────────
// One per entry point, on the same discard-returndata contract noesis-148 established for the value
// paths. The four the FACTORY calls during `createInstance` — `InitProtocolFailed`,
// `InitFreeMintFailed`, `InitModuleFailed`, `InitStakingFailed` — deliberately get their OWN selector
// rather than one shared `ConfigFailed()`, so a failed launch still identifies WHICH init step broke,
// for the creator and for us. `InitTierBandsFailed` is on the same footing (the ladder seal is
// factory-driven in the create path noesis-141 wires).
error InitProtocolFailed();
error SetMetadataURIFailed();
error SetContractURIFailed();
error InitFreeMintFailed();
error InitTierBandsFailed();
error InitStakingFailed();
error InitModuleFailed();
error SetAgentDelegationFailed();
error SetAgentDelegationFromFactoryFailed();
error SetBondingOpenTimeFailed();
error SetBondingMaturityTimeFailed();
error SetBondingActiveFailed();
error SetStyleFailed();
error ActivateStakingFailed();

// ── Graduation errors (raised on the Ops side; surfaced by the instance trampoline) ─────────────
// The `deployLiquidity` body moved to `ERC404BondingOps` (noesis-188 D3 continuation), so the errors
// it raises are declared here where BOTH sides compile them. `AlreadyDeployed` and `NoReserve` are
// still importable FROM `ERC404BondingInstance.sol` by name (it re-imports them), so existing test
// imports resolve unchanged. `NothingForPool` is new: the parity clamp resolves the pool's coin side
// from live balances, and a graduation with no placeable coin has no pool to open.
error AlreadyDeployed();
error NoReserve();
error NothingForPool();
/// @dev Generic surfaced by the instance's discard-returndata `deployLiquidity` trampoline.
error GraduationFailed();

/// @notice `claimAllFees`'s single settle round-trip to the staking module. Returns the instance's
///         current `totalStaked` — the instance credits its staking-liability reserve only when the
///         module can distribute (`totalStaked > 0`), mirroring `recordFeesReceived`'s own guard — AND
///         the un-accruable stream leak now released (noesis-127): a stream that outlives its stakers
///         schedules `rewardRate` wei/sec during the zero-stake gap that no staker can ever accrue; the
///         module hands that un-owed wei back so the instance can debit its `stakingReserve` and let
///         `withdrawDust` recover it. Declared HERE (moved verbatim out of the instance by noesis-148,
///         which moved the `claimAllFees` body into Ops) — the shared `IERC404StakingModule` interface
///         is unchanged.
interface IStakingTotals {
    function settleAndReleaseLeak() external returns (uint256 totalStaked, uint256 leaked);
    /// @notice Coin this instance currently custodies on behalf of stakers. Read at graduation to take
    ///         staked coin out of the instance's placeable balance — it is a liability, not free supply.
    function totalStaked(address instance) external view returns (uint256);
}

/**
 * @title ERC404BondingStorage
 * @notice Single source of truth for the ERC404 bonding instance's storage layout. Both the deployable
 *         `ERC404BondingInstance` and the delegatecall `ERC404BondingOps` inherit this identical base,
 *         so Ops executes in the instance's storage context with a byte-identical layout (proven by the
 *         CI storageLayout-equality gate). DN404 / Ownable / ReentrancyGuard keep their state at fixed
 *         hashed slots (not sequential), so they never collide with the sequential slots below.
 * @dev    HARD CONSTRAINT (noesis-091): all instance state MUST be declared HERE, in this exact order.
 *         Never add a state variable to `ERC404BondingInstance` or `ERC404BondingOps` directly — a var
 *         outside this shared base is a storage-collision bug across the delegatecall boundary.
 */
abstract contract ERC404BondingStorage is DN404, Ownable, ReentrancyGuard {
    // ┌─────────────────────────┐
    // │      State Variables    │
    // └─────────────────────────┘

    bool internal _initialized;

    string internal _name;
    string internal _symbol;

    uint256 public maxSupply;
    uint256 public liquidityReserve;
    BondingCurveMath.Params public curveParams;
    uint256 public unit;

    address public factory;
    IAlignmentVault public vault;
    IMasterRegistry public masterRegistry;
    IGlobalMessageRegistry public globalMessageRegistry;

    address public protocolTreasury;
    address public weth;
    uint256 public bondingFeeBps;

    string public styleUri;
    /// @dev PER-TOKEN base URI, consumed by `tokenURI(tokenId)`. NOT the collection URI — that is
    ///      `contractURI` (ERC-7572), declared at the END of this layout (noesis-085). The two are
    ///      distinct strings with distinct meanings; never overload one for the other.
    string public metadataURI;

    uint256 public bondingOpenTime;
    uint256 public bondingMaturityTime;
    bool public bondingActive;
    uint256 public totalBondingSupply;
    uint256 public reserve;

    // Gating module (address(0) = open gating)
    IGatingModule public gatingModule;
    bool public agentDelegationEnabled;
    bool public gatingActive;

    // Liquidity deployer — set once in initialize(), AMM-agnostic
    ILiquidityDeployerModule public liquidityDeployer;

    // Graduation flag
    bool public graduated;

    // Creator carve disclosure — set once at initialize, immutable thereafter (public getter).
    uint16 public declaredMaxAllowanceBps;

    // Free mint tranche
    uint256 public freeMintAllocation; // NFT count reserved (0 = disabled)
    uint256 public freeMintsClaimed; // running counter (in NFTs, not tokens)
    mapping(address => bool) public freeMintClaimed;
    GatingScope public gatingScope;
    bool internal _freeMintInitialized;

    // Staking module (address(0) = staking not available for this instance)
    IERC404StakingModule public stakingModule;
    bool public stakingActive;

    // ETH currently owed to stakers (a liability held in this instance's balance, NOT part of the
    // bonding `reserve`). Credited when distributable fees arrive (`claimAllFees`, only while
    // `totalStaked > 0`), debited as stakers are actually paid (`unstake`, `claimStakingRewards`).
    // `withdrawDust` subtracts this so the owner can never sweep staker-owed ETH (noesis-061 F1).
    uint256 public stakingReserve;

    // Generic keyed module slots (ADR-0006/0007). One slot for all known + future module pointers
    // (role => module; 0 = absent). Wired ONCE by the factory at create, then sealed — no owner setter.
    mapping(bytes32 => address) public modules;
    bytes32 internal constant METADATA_RESOLVER = keccak256("metadata.resolver");

    // ── Token Tiers (noesis-142) ────────────────────────────────────────────────────────────────
    // Tiers are coin DENOMINATIONS: a tier-N NFT is still exactly ONE DN404 unit of balance (DN404's
    // `ownedLength == balance / unit` invariant is absolute) PLUS `(w_N - 1) * unit` of the holder's own
    // coin escrowed in this instance. The escrow is DERIVED from the id's band — never stored per holder.

    /// @dev One reserved band of ids, all carrying denomination `weight` (in units, `w_0 = 1`).
    ///      `idStart`/`idEnd` are inclusive and live ABOVE `idLimit = totalSupply / unit`, which is what
    ///      makes them unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///      `_wrapNFTId(.., idLimit)`). uint32 because DN404's `_restrictNFTId` bounds ids to uint32.
    struct TierBand {
        uint32 idStart;
        uint32 idEnd;
        uint32 weight;
    }

    /// @dev The sealed ladder. `tierBands[i]` describes tier `i + 1`: tier 0 is the IMPLICIT ordinary id
    ///      space `[1..idLimit]` with `w_0 = 1` and is never stored (it needs no band and no escrow).
    ///      Sealed once by the factory at create — mutable weights would retroactively reprice every
    ///      outstanding band NFT.
    TierBand[] public tierBands;

    /// @dev Per-band high-water cursor: the next never-issued id in `tierBands[i]`. Initialized to
    ///      `idStart` at seal time.
    mapping(uint256 => uint256) public bandNextFree;

    /// @dev Per-band LIFO stack of ids returned by `mintDown`. Popped before the high-water cursor, so
    ///      id reuse is deterministic and O(1) — no scanning.
    mapping(uint256 => uint32[]) internal bandFreed;

    /// @dev Running sum of coin escrowed behind outstanding band NFTs. Part of this instance's own
    ///      `balanceOf(address(this))`, but NOT part of the curve: the buy cap is counter-based
    ///      (`totalBondingSupply`), so escrow can never inflate the buyable pool.
    uint256 public totalTierEscrow;

    /// @dev Set-once seal flag for `initTierBands`.
    bool internal _tiersSealed;

    // ── Burn-safety escrow release (noesis-143) ──────────────────────────────────────────────────
    // DN404 reconciles NFTs to balance on EVERY debit: `numNFTBurns = _zeroFloorSub(ownedLength,
    // balance / unit)` ids are burned LIFO off the tail of `owned[holder]` (DN404.sol:825-838 in
    // `_transfer`, :690-712 in `_burn`). That loop knows nothing about bands, so a band NFT can be
    // burned out from under its holder — which would strand its `(w_N - 1) * unit` of escrow inside
    // this instance forever. `_afterNFTTransfers` (below) catches exactly that and RECORDS a credit;
    // `ERC404BondingInstance.claimReleasedEscrow()` pays it out.

    /// @dev Coin owed to a holder whose band NFT was burned by DN404's reconciliation. Credited by the
    ///      hook (which must never move value), paid by `claimReleasedEscrow`. Part of this instance's
    ///      own `balanceOf(address(this))` — it moved out of `totalTierEscrow` into this liability, so
    ///      the two never double-count.
    mapping(address => uint256) public pendingEscrowRelease;

    /// @dev Running sum of `pendingEscrowRelease`. Lets the conservation invariant be checked on-chain
    ///      and keeps `withdrawDust`-style sweeps honest about what this balance already owes.
    uint256 public totalPendingEscrowRelease;

    // ── ERC-7572 collection metadata (noesis-085) ────────────────────────────────────────────────

    /// @notice The COLLECTION-level metadata URI (ERC-7572): the project's own image/banner/description
    ///         document, the same string the master registry is handed at create. Marketplaces and
    ///         `QueryAggregator`'s §6 read-through take this as the single source of truth, so a drifted
    ///         registry copy can no longer win.
    /// @dev    Deliberately SEPARATE from `metadataURI`, which is the PER-TOKEN base URI for
    ///         `tokenURI(tokenId)` — the two are different documents and must never be conflated.
    ///         Declared HERE (the shared base) and APPENDED at the end of the layout, never inserted
    ///         between existing slots: `ERC404BondingOps` inherits this same base and executes in the
    ///         instance's storage under delegatecall, so the layouts must stay byte-identical
    ///         (noesis-091, enforced by `test/factories/erc404/eip170-diet-gate.sh`).
    string public contractURI;

    // ── Reroll events (emitted by Ops in the instance's context under delegatecall) ─────────────
    event RerollInitiated(address indexed user, uint256 tokenAmount, uint256[] exemptedNFTIds);
    event RerollCompleted(address indexed user, uint256 tokensReturned);

    // ── Token Tiers events (emitted by Ops in the instance's context under delegatecall) ─────────
    event MintedUp(address indexed holder, uint8 indexed tierN, uint256 tierZeroId, uint256 bandId);
    event MintedDown(address indexed holder, uint8 indexed tierN, uint256 bandId, uint256 tierZeroId);
    event TierBandsSealed(uint256 bandCount);

    /// @notice A band NFT was destroyed by DN404's own NFT/balance reconciliation; `amount` of escrow is
    ///         now claimable by `holder` and the id is back on its band's free list.
    event EscrowReleased(address indexed holder, uint256 indexed bandId, uint256 amount);

    // ── Value-path events (emitted by Ops in the instance's context under delegatecall) ──────────
    // Moved here from `ERC404BondingInstance` by noesis-148 (D3 diet) so the emitting bodies compile
    // on the Ops side. Moving an event declaration does NOT change its topic0 — the signature is
    // byte-identical, so every existing indexer/test filter keeps matching.
    event FreeMintClaimed(address indexed user);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount, uint256 rewardPaid);
    event StakingRewardsClaimed(address indexed user, uint256 amount);

    // ── Graduation events (emitted by Ops in the instance's context under delegatecall) ──────────
    // `LiquidityDeployed` moved here from `ERC404BondingInstance` when the `deployLiquidity` body moved
    // to Ops (noesis-188). Moving an event declaration does NOT change its topic0 — the signature is
    // byte-identical, so every existing indexer/test filter keeps matching.
    event LiquidityDeployed(address indexed deployer, uint256 amountToken, uint256 amountETH);

    /// @notice How graduation sized the pool's coin side and what it did with the rest.
    ///         `availableCoin - tokensToPool == burned`, always: every coin the instance was free to
    ///         place either opened the pool or ceased to exist. `availableCoin` is read from live
    ///         balances net of custodial liabilities (staking, tier escrow, unclaimed escrow release),
    ///         so it covers the LP reserve, unsold bonding supply and unclaimed free-mint allocation
    ///         together, whatever the split between them turned out to be.
    event GraduationSupplyBurned(uint256 availableCoin, uint256 tokensToPool, uint256 burned);

    /// @notice How graduation sized the pool's ETH side. `ethToPool` is exactly the coin side valued at
    ///         the curve's marginal price at the moment of graduation. `excessEth` is LP-share ETH the
    ///         clamp could not place at that price because the instance held no more coin; it rides the
    ///         same 80/19/1 tithe rail as `creatorCarveEth` and is reported separately here so the
    ///         creator's declared carve stays distinguishable from the clamp's residue.
    event GraduationEthDiverted(uint256 ethToPool, uint256 excessEth, uint256 creatorCarveEth);

    // ── Config-path events (emitted by Ops in the instance's context under delegatecall) ─────────
    // Moved here from `ERC404BondingInstance` by noesis-149 (D2 diet) so the emitting bodies compile on
    // the Ops side. Moving an event declaration does NOT change its topic0 — the signature is
    // byte-identical, so every existing indexer/test filter keeps matching, and the events are still
    // emitted from THIS instance's address under delegatecall.
    event BondingOpenTimeSet(uint256 openTime);
    event BondingMaturityTimeSet(uint256 maturityTime);
    event BondingActiveChanged(bool active);
    event AgentDelegationChanged(bool enabled);
    event StakingActivated(address indexed stakingModule);
    event ModuleSet(bytes32 indexed role, address module);

    // ── DN404 unit override (shared: DN404 internals in both the instance and Ops read this) ────
    function _unit() internal view override returns (uint256) {
        return unit;
    }

    // ┌──────────────────────────────────────────────────┐
    // │  Staking-liability debit (shared, noesis-148)    │
    // └──────────────────────────────────────────────────┘

    /// @dev Debit the staking-liability reserve by ETH actually paid to a staker, clamped so it can
    ///      never underflow (the reserve is a conservative over-estimate; a payout may exceed the
    ///      residual tracked liability by truncation dust).
    /// @dev Was `private` in `ERC404BondingInstance`; moved to the shared base (unchanged) by
    ///      noesis-148 because all three of its callers — `claimAllFees`, `unstake`,
    ///      `claimStakingRewards` — now execute on the Ops side. Declaring it in the base is what
    ///      guarantees both contracts compile the IDENTICAL clamp (the `_bandOf` precedent from
    ///      noesis-143 / the `_skipNFTDefault` lesson from noesis-142).
    function _debitStakingReserve(uint256 amount) internal {
        stakingReserve = amount >= stakingReserve ? 0 : stakingReserve - amount;
    }

    // ┌──────────────────────────────────────────────────┐
    // │  Config auth gate (shared, noesis-149)           │
    // └──────────────────────────────────────────────────┘

    /// @notice Authorize the caller for a non-custodial config/lifecycle action: the owner always,
    ///         or a platform-vetted agent when this instance has agent delegation enabled. Value-
    ///         extracting fns (withdrawDust/claimAllFees/migrateVault) do NOT use this — they stay
    ///         bare `onlyOwner`. Revocation is live: `isAgent` is re-read at call time, so a revoked
    ///         agent is blocked immediately even with a stale `agentDelegationEnabled == true`.
    /// @dev Was `internal view` on `ERC404BondingInstance`; moved to the shared base (logic UNCHANGED)
    ///      by noesis-149 because most of its callers — the ten owner/agent config setters — now execute
    ///      on the Ops side, while `deployLiquidity` still calls it from the instance. Declaring it in
    ///      the base is what guarantees both contracts compile the IDENTICAL gate (the `_skipNFTDefault`
    ///      lesson from noesis-142, the `_debitStakingReserve` precedent from noesis-148). `msg.sender`
    ///      is preserved across `delegatecall`, so `owner()` (Ownable's shared fixed slot),
    ///      `agentDelegationEnabled` and `masterRegistry` all resolve exactly as they did in-instance.
    function _requireOwnerOrAgent() internal view {
        if (msg.sender == owner()) return;
        if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) return;
        revert Unauthorized();
    }

    // ┌──────────────────────────────────────┐
    // │  Band lookup (shared, noesis-143)    │
    // └──────────────────────────────────────┘

    /// @dev THE single band-range walk for this instance. Deliberately non-reverting so the three
    ///      callers can each pick their own failure mode: `ERC404BondingOps.mintDown` reverts
    ///      `NotBandId`, `ERC404BondingInstance.coinBalanceOf` sums, and `_afterNFTTransfers` skips.
    ///      Duplicating the walk per call site is how the escrow amount drifts, so there is exactly one.
    ///      O(bandCount) with bandCount fixed at seal (a 2-3 rung ladder in practice).
    function _bandOf(uint256 id) internal view returns (bool found, uint256 idx, uint256 weight) {
        uint256 n = tierBands.length;
        for (uint256 i; i < n; ++i) {
            TierBand storage b = tierBands[i];
            if (id >= b.idStart && id <= b.idEnd) return (true, i, b.weight);
        }
    }

    // ┌────────────────────────────────────────────────┐
    // │  Burn-safety hook (shared, HOT PATH)           │
    // └────────────────────────────────────────────────┘
    // Declared HERE, in the shared base, deliberately: `_afterNFTTransfers` is an INTERNAL DN404 hook,
    // reached by a plain internal jump from `_mint` / `_mintNext` / `_burn` / `_transfer` /
    // `_transferFromNFT` — never through `msg.data`. So the reroll/mintUp trampoline pattern does NOT
    // apply: under `delegatecall` the code that runs is Ops's own, and if only the instance carried an
    // override then `ERC404BondingOps.mintUp`'s escrow leg — the single most likely place to burn a band
    // NFT — would run with the hook DISABLED. Both contracts must compile the identical body, and the
    // shared base is the only way to guarantee that. Measured cost: see the PR body.

    /// @dev Turning this on un-dead-codes DN404's `from`/`to`/`ids` array construction at all five hook
    ///      call sites (a measured, unavoidable floor before any body of ours). `pure` narrows DN404's
    ///      non-view declaration, which is legal and lets the compiler fold the branch.
    function _useAfterNFTTransfers() internal pure override returns (bool) {
        return true;
    }

    /// @notice THE TRANSFER RULE: any coin-path debit burns your tier NFT and credits you its escrow.
    ///         Only a deliberate ERC721 transfer moves the NFT itself.
    /// @dev    DN404's direct-transfer optimization (`DN404.sol:779`) moves `min(sender burns,
    ///         recipient mints)` ids straight off the sender's `owned` tail to the recipient instead of
    ///         burning and re-minting. On a tiered instance that path can hand a tier NFT — and the
    ///         `(w - 1) * unit` of coin escrowed behind it — to the RECIPIENT of an ERC20 transfer. The
    ///         trigger is not the amount sent: the carry needs `min(burns, mints) > 0`, so it fires only
    ///         when the recipient crosses a whole-unit boundary. That is a condition the sender cannot
    ///         see, control, or be warned about, which makes a 1-wei send able to move a whole
    ///         denomination. The same path lets any ERC20 spender the holder has approved (a router, an
    ///         aggregator, a bridge) take the denomination through `transferFrom`.
    ///
    ///         DN404's carry loop has no per-id hook, so there is no surgical "exclude tier ids" option;
    ///         the policy gate is the whole mechanism. Turning it off routes every coin-path debit into
    ///         burn-and-re-mint, where `_afterNFTTransfers` above credits the escrow back to the holder.
    ///         The ERC721 face is a different function (`_transferFromNFT`) and is untouched — a
    ///         deliberate sale still carries the id and its full denomination to the buyer.
    ///
    ///         TIER-GATED, not global, and that is a decision rather than a nicety: an untiered
    ///         collection structurally cannot have this hazard, and making the direct-transfer loop
    ///         unreachable for everyone charges it ~35k gas per 3-NFT transfer to close a hazard it does
    ///         not have. Gating on the ladder leaves untiered instances on the direct-transfer path for
    ///         +77 gas. Tiered instances pay ~12.7k per NFT moved on the coin path — the price of the rule.
    ///
    ///         Declared HERE, in the shared base, for the same reason `_useAfterNFTTransfers` is: under
    ///         `delegatecall` `ERC404BondingOps` runs its OWN compiled bytecode, so an override on the
    ///         instance alone would leave `mintUp`'s escrow leg, reroll's coin round-trip and `stake`
    ///         still taking the direct-transfer path. Both contracts must compile the identical body.
    ///
    ///         `view`, not `pure` — it reads the ladder. The gate is written as `tierBands.length == 0`
    ///         rather than `!_tiersSealed` because the two are equivalent and this one is FREE:
    ///         `_afterNFTTransfers` above opens with `tierBands.length` on every transfer, so the gate
    ///         hits an already-paid slot and adds a comparison rather than a cold SLOAD. The seal flag
    ///         sits in its own slot that nothing on the transfer path touches, so gating on it costs a
    ///         genuinely new cold read. Measured on an ordinary 3-NFT transfer: this form 107,108
    ///         untiered / 146,443 tiered, the seal-flag form 109,114 / 148,449 — 2,006 gas dearer on
    ///         BOTH, and 3 bytes larger. Equivalence: `_tiersSealed` is set only by `initTierBands`,
    ///         which reverts `InvalidBand` on an empty array (rolling the flag back) and otherwise
    ///         pushes at least one band, and makes no external call between the two writes — so no
    ///         caller can observe a sealed ladder with zero bands.
    function _useDirectTransfersIfPossible() internal view override returns (bool) {
        return tierBands.length == 0;
    }

    /// @notice Release the escrow behind any band NFT that DN404 just burned.
    /// @dev PULL, never push (noesis-143 decision 1). This runs in the middle of DN404's own
    ///      accounting — every call site invokes it after the balance/ownership writes but while the
    ///      caller's frame is still live. Moving value here (`_transfer`, mint, burn) would re-enter the
    ///      very bookkeeping that is mid-flight, so the hook only RECORDS: it credits
    ///      `pendingEscrowRelease`, returns the id to its band's LIFO free list, and moves the amount out
    ///      of `totalTierEscrow` into `totalPendingEscrowRelease`. No external calls, so it cannot
    ///      reenter at all. `claimReleasedEscrow()` on the instance is what actually moves coin.
    /// @dev BURN DETECTION (decision 3), read off the pinned dn404 rather than assumed. The three array
    ///      shapes DN404 builds are: mints → `from[i] == address(0)` (`_mint` :564-569, `_mintNext`
    ///      :653-658, and the mint tail of `_transfer` :884-897); burns → `to[i] == address(0)` (`_burn`
    ///      :728-733 and the burn segment of `_transfer`); plain transfers → BOTH non-zero (the direct
    ///      segment of `_transfer`, and `_transferFromNFT` :998, which cannot carry `to == 0` because it
    ///      reverts `TransferToZeroAddress` first). So `to[i] == address(0)` is exactly "this id ceased
    ///      to exist", and nothing else is. A band id merely CHANGING HANDS is not a release — escrow
    ///      follows the id (decision 4) — which is why the test is on `to`, not on `from`.
    /// @dev HOT PATH. Ordering is by cost: a memory compare (`to[i]`) before a storage compare, and the
    ///      whole body behind a single `tierBands.length` SLOAD that short-circuits every instance that
    ///      never sealed a ladder. `floor_` is the lowest band's `idStart`; `initTierBands` seals
    ///      bands ASCENDING and strictly above `idLimit`, so `id < floor` proves "ordinary id" in one
    ///      comparison and no band walk happens for the overwhelming majority of transfers.
    function _afterNFTTransfers(address[] memory from, address[] memory to, uint256[] memory ids)
        internal
        virtual
        override
    {
        uint256 bandCount = tierBands.length;
        if (bandCount == 0) return;

        uint256 floor_ = tierBands[0].idStart;
        uint256 unitSize = _unit();
        uint256 released;

        uint256 n = ids.length;
        for (uint256 i; i < n; ++i) {
            if (to[i] != address(0)) continue; // not a burn: mint or ordinary transfer
            uint256 id = ids[i];
            if (id < floor_) continue; // ordinary id space — the O(1) early-out
            (bool isBand, uint256 idx, uint256 weight) = _bandOf(id);
            if (!isBand) continue; // above the ordinary space but between bands: impossible today, cheap
            unchecked {
                uint256 amount = (weight - 1) * unitSize; // weight >= 2 is a seal invariant
                address holder = from[i];
                pendingEscrowRelease[holder] += amount;
                released += amount;
                bandFreed[idx].push(uint32(id)); // back on the free list; outstanding count falls with it
                emit EscrowReleased(holder, id, amount);
            }
        }

        if (released != 0) {
            // Checked on purpose: every outstanding band id contributed exactly `(w - 1) * unit` to
            // `totalTierEscrow` when `mintUp` issued it, and an id can only be burned once (the burn
            // clears its ownership), so this can never underflow. If it ever did, that is a broken
            // invariant and reverting the transfer is the correct outcome.
            totalTierEscrow -= released;
            totalPendingEscrowRelease += released;
        }
    }
}
