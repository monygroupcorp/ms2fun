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
// trampoline). Ops reverts with these specific errors; the trampoline discards returndata (a via_ir
// size cliff forbids bubbling), so a caller sees the generic `RerollFailed()`. The specifics remain
// visible in traces.
error InsufficientTokenBalance();
error TokenAmountMustBePositive();
error TokenAmountMustRepresentNFT();
error BalanceMismatchAfterReroll();
error RerollFailed();

// ── Token Tiers errors (shared by the instance seal/trampolines + the delegatecall Ops) ─────────
// Same split as reroll: the tier bodies (`mintUp` / `mintDown`) live in ERC404BondingOps and revert
// with these specific errors; the instance's discard-returndata trampoline surfaces the generic
// `TierOpFailed()` (the specifics stay visible in traces). `InvalidBand` is raised by the
// `initTierBands` seal (reached through the same trampoline), so it surfaces as the generic
// `InitTierBandsFailed()`. `BandIdOverflow` is raised by `ERC404Factory._deriveTierBands` before
// narrowing — the only uint32 rejection in the system — and surfaces verbatim from the factory.
error TiersNotConfigured();
error InvalidBand();
error BandExhausted();
error NotBandId();
error NotTierZeroId();
error TierOpFailed();
error BandIdOverflow();

// ── Escrow release errors — raised by the instance's own `claimReleasedEscrow`, so they surface
// verbatim (no trampoline in that path).
error NothingToClaim();
error EscrowReleaseFailed();

// ── Value-path errors (shared by the instance + the delegatecall Ops) ───────────────────────────
// The value-path bodies (`claimFreeMint`, `claimAllFees`, `withdrawDust`, `stake`, `unstake`,
// `claimStakingRewards`) live in ERC404BondingOps and revert with these specific errors; the
// instance's discard-returndata trampoline surfaces one generic error per entry point (below).
// `BondingEnded` and `GatingNotAllowed` are also raised by `buyBonding` in the instance and surface
// verbatim there. On the graduation path `TooEarly` / `BondingNotConfigured` surface as
// `GraduationFailed`.
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

// ── Generic errors surfaced by the value-path trampolines ───────────────────────────────────────
// One per entry point. Returndata is discarded (bubbling triggers the via_ir size cliff), so an
// Ops-side revert reaches the caller as the generic error for that entry point; the specific error
// stays visible in traces.
error FreeMintFailed();
error ClaimFeesFailed();
error WithdrawDustFailed();
error StakeFailed();
error UnstakeFailed();
error ClaimRewardsFailed();

// ── Config-path errors (shared by the instance + the delegatecall Ops) ──────────────────────────
// The init/admin/setter bodies (`initializeProtocol`, `setMetadataURI`, `setContractURI`,
// `initializeFreeMint`, `initTierBands`, `initializeStaking`, `initModule`, `setAgentDelegation`,
// `setAgentDelegationFromFactory`, `setBondingOpenTime`, `setBondingMaturityTime`, `setBondingActive`,
// `activateStaking`) live in ERC404BondingOps and revert with these specific errors; the instance's
// discard-returndata trampoline surfaces one generic error per entry point (below). Both sides
// compile them. The three raised by bodies in the instance — `AlreadyInitialized` / `InvalidOwner`
// in `initialize`, `OnlyFactory` in `initializeMetadata` — surface verbatim from those paths, and
// `ERC404BondingInstance.sol` re-exports them by name. `initialize` is first-caller-wins: it records
// `factory = msg.sender` rather than checking it, so it cannot raise `OnlyFactory`.
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
error MaturityTooFarAfterOpenTime();
error OpenTimeNotSet();
error CannotActivateAfterLiquidityDeployed();
error StakingAlreadyActive();
error NoFeeClaimingVault();

// ── The "no pull-claim model" signal ────────────────────────────────────────────────────────────
// `AlignmentEndowmentVault.claimFees()` is `revert NotSupported()`: an endowment holds a permanent
// position and never hands ETH back on a pull, so it answers the pull-claim entry point by refusing
// it. `claimAllFees` skips that revert; `activateStaking` reads it, which needs the selector on
// this side of the call. Declared here rather than imported from the vault because core
// contracts in this tree never import a concrete vault (the registry resolves vault families through
// `RevenueSplitLib` for the same reason). What travels on chain is the four-byte selector, and an
// error's selector is fixed by its signature, so this declaration and the vault's are the same value
// by construction — an assertion in `ERC404EndowmentStakingGuard.t.sol` pins them equal.
error NotSupported();

// ── Bonding schedule bound ──────────────────────────────────────────────────────────────────────
// The longest bonding period `setBondingMaturityTime` will accept, measured from `bondingOpenTime`.
// The protocol's outer horizon for a creator bond: the `DeployBondEscrow` defaults `maxBondDuration`
// (180 days) plus `graceDays` (30 days), the two terms its forfeit deadline is built from. Past that
// horizon the anti-spam lever has written the launch off, so a maturity beyond it is a date the
// protocol does not stand behind.
//
// It is a constant, not a live read of the escrow. The instance holds no escrow pointer (the escrow
// is standalone so the factory holds no ETH and nothing lands in this EIP-170-constrained
// contract), and the escrow's terms are owner-tunable: a live read would let a `setMaxBondDuration`
// retroactively invalidate a maturity that was legal when set. The escrow snapshots both terms onto
// each bond at post so no later action moves a deadline already in force.
uint256 constant MAX_BONDING_DURATION = 210 days;

// ── Generic errors surfaced by the config trampolines ───────────────────────────────────────────
// One per entry point, with returndata discarded as for the value paths. The ones the factory calls
// during `createInstance` — `InitProtocolFailed`, `InitFreeMintFailed`, `InitModuleFailed`,
// `InitStakingFailed` — have their own selectors rather than one shared error, so a failed launch
// identifies which init step broke. `InitTierBandsFailed` is the same (the ladder seal is
// factory-driven in the create path).
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
error ActivateStakingFailed();

// ── Graduation errors (raised on the Ops side; surfaced by the instance trampoline) ─────────────
// The `deployLiquidity` body lives in `ERC404BondingOps`, so the errors it raises are declared here
// where both sides compile them. `AlreadyDeployed` and `NoReserve` are importable from
// `ERC404BondingInstance.sol` by name (it re-imports them). `NothingForPool`: the parity clamp
// resolves the pool's coin side from live balances, and a graduation with no placeable coin has no
// pool to open.
error AlreadyDeployed();
error NoReserve();
error NothingForPool();
/// @dev Generic surfaced by the instance's discard-returndata `deployLiquidity` trampoline.
error GraduationFailed();

/// @notice `claimAllFees`'s single settle round-trip to the staking module. Returns the instance's
///         current `totalStaked` — the instance credits its staking-liability reserve only when the
///         module can distribute (`totalStaked > 0`), mirroring `recordFeesReceived`'s own guard — and
///         the un-accruable stream leak released: a stream that outlives its stakers schedules
///         `rewardRate` wei/sec during the zero-stake gap that no staker can accrue; the module hands
///         that un-owed wei back so the instance can debit its `stakingReserve` and let `withdrawDust`
///         recover it. Declared here, separate from the shared `IERC404StakingModule` interface.
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
 * @dev    All instance state is declared here, in this order. A state variable declared in
 *         `ERC404BondingInstance` or `ERC404BondingOps` directly collides across the delegatecall
 *         boundary.
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
    /// @dev Per-token base URI, consumed by `tokenURI(tokenId)`. The collection URI is `contractURI`
    ///      (ERC-7572), declared at the end of this layout; the two are distinct strings.
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
    // `withdrawDust` subtracts this so the owner can never sweep staker-owed ETH.
    uint256 public stakingReserve;

    // Generic keyed module slots (ADR-0006/0007): role => module, 0 = absent. Wired once by the
    // factory at create, then sealed — no owner setter.
    mapping(bytes32 => address) public modules;
    bytes32 internal constant METADATA_RESOLVER = keccak256("metadata.resolver");

    // ── Token Tiers ─────────────────────────────────────────────────────────────────────────────
    // Tiers are coin denominations: a tier-N NFT is exactly one DN404 unit of balance (DN404's
    // `ownedLength == balance / unit` invariant is absolute) plus `(w_N - 1) * unit` of the holder's own
    // coin escrowed in this instance. The escrow is derived from the id's band, never stored per holder.

    /// @dev One reserved band of ids, all carrying denomination `weight` (in units, `w_0 = 1`).
    ///      `idStart`/`idEnd` are inclusive and live above `idLimit = totalSupply / unit`, which makes
    ///      them unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///      `_wrapNFTId(.., idLimit)`). uint32 because DN404's `_restrictNFTId` bounds ids to uint32.
    struct TierBand {
        uint32 idStart;
        uint32 idEnd;
        uint32 weight;
    }

    /// @dev The sealed ladder. `tierBands[i]` describes tier `i + 1`: tier 0 is the implicit ordinary id
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
    ///      `balanceOf(address(this))`, but not part of the curve: the buy cap is counter-based
    ///      (`totalBondingSupply`), so escrow can never inflate the buyable pool.
    uint256 public totalTierEscrow;

    /// @dev Set-once seal flag for `initTierBands`.
    bool internal _tiersSealed;

    // ── Burn-safety escrow release ───────────────────────────────────────────────────────────────
    // DN404 reconciles NFTs to balance on every debit: `numNFTBurns = _zeroFloorSub(ownedLength,
    // balance / unit)` ids are burned LIFO off the tail of `owned[holder]` (in `_transfer` and
    // `_burn`). That loop knows nothing about bands, so a band NFT can be burned out from under its
    // holder, which would strand its `(w_N - 1) * unit` of escrow inside this instance forever.
    // `_afterNFTTransfers` (below) catches that and records a credit;
    // `ERC404BondingInstance.claimReleasedEscrow()` pays it out.

    /// @dev Coin owed to a holder whose band NFT was burned by DN404's reconciliation. Credited by the
    ///      hook (which must never move value), paid by `claimReleasedEscrow`. Part of this instance's
    ///      own `balanceOf(address(this))`; the amount moves out of `totalTierEscrow` into this
    ///      liability, so the two never double-count.
    mapping(address => uint256) public pendingEscrowRelease;

    /// @dev Running sum of `pendingEscrowRelease`. Lets the conservation invariant be checked on-chain
    ///      and keeps `withdrawDust`-style sweeps honest about what this balance already owes.
    uint256 public totalPendingEscrowRelease;

    // ── ERC-7572 collection metadata ─────────────────────────────────────────────────────────────

    /// @notice The collection-level metadata URI (ERC-7572): the project's own image/banner/description
    ///         document, the same string the master registry is handed at create. Marketplaces and
    ///         `QueryAggregator`'s §6 read-through take this as the single source of truth.
    /// @dev    Separate from `metadataURI`, the per-token base URI for `tokenURI(tokenId)`.
    ///         Appended at the end of the layout, never inserted between existing slots:
    ///         `ERC404BondingOps` inherits this same base and executes in the instance's storage under
    ///         delegatecall, so the layouts must stay byte-identical (enforced by
    ///         `test/factories/erc404/eip170-diet-gate.sh`).
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
    event FreeMintClaimed(address indexed user);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount, uint256 rewardPaid);
    event StakingRewardsClaimed(address indexed user, uint256 amount);

    // ── Graduation events (emitted by Ops in the instance's context under delegatecall) ──────────
    event LiquidityDeployed(address indexed deployer, uint256 amountToken, uint256 amountETH);

    /// @notice How graduation sized the pool's coin side and what it did with the rest.
    ///         `availableCoin - tokensToPool == burned`, always: every coin the instance was free to
    ///         place either opened the pool or ceased to exist. `availableCoin` is read from live
    ///         balances net of custodial liabilities (staking, tier escrow, unclaimed escrow release),
    ///         so it covers the LP reserve, unsold bonding supply and unclaimed free-mint allocation
    ///         together, whatever the split between them turned out to be.
    event GraduationSupplyBurned(uint256 availableCoin, uint256 tokensToPool, uint256 burned);

    /// @notice Coin the venue was offered and declined, burned on its way back.
    /// @dev A second, distinct burn with its own topic. `GraduationSupplyBurned` accounts for the coin
    ///      the pool was never offered — its three fields sum, and folding this burn into it would
    ///      break that. This one covers the coin the deployer module handed back because the venue's
    ///      pool was already initialized away from the graduation price and took only one side in
    ///      full. Zero on an ordinary graduation into a fresh pool, so the event is not emitted.
    event GraduationResidueBurned(uint256 burned);

    /// @notice How graduation sized the pool's ETH side. `ethToPool` is exactly the coin side valued at
    ///         the curve's marginal price at the moment of graduation. `excessEth` is LP-share ETH the
    ///         clamp could not place at that price because the instance held no more coin; it rides the
    ///         same 80/19/1 tithe rail as `creatorCarveEth` and is reported separately here so the
    ///         creator's declared carve stays distinguishable from the clamp's residue.
    event GraduationEthDiverted(uint256 ethToPool, uint256 excessEth, uint256 creatorCarveEth);

    // ── Config-path events (emitted by Ops in the instance's context under delegatecall) ─────────
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
    // │       Staking-liability debit (shared)           │
    // └──────────────────────────────────────────────────┘

    /// @dev Debit the staking-liability reserve by ETH actually paid to a staker, clamped so it can
    ///      never underflow (the reserve is a conservative over-estimate; a payout may exceed the
    ///      residual tracked liability by truncation dust). Its callers — `claimAllFees`, `unstake`,
    ///      `claimStakingRewards` — run on the Ops side; the base keeps one compiled clamp.
    function _debitStakingReserve(uint256 amount) internal {
        stakingReserve = amount >= stakingReserve ? 0 : stakingReserve - amount;
    }

    // ┌──────────────────────────────────────────────────┐
    // │       Config auth gate (shared)                  │
    // └──────────────────────────────────────────────────┘

    /// @notice Authorize the caller for a non-custodial config/lifecycle action: the owner always,
    ///         or a platform-vetted agent when this instance has agent delegation enabled. Value-
    ///         extracting fns (withdrawDust/claimAllFees/migrateVault) do not use this — they are
    ///         bare `onlyOwner`. Revocation is live: `isAgent` is re-read at call time, so a revoked
    ///         agent is blocked immediately even with a stale `agentDelegationEnabled == true`.
    /// @dev Declared in the shared base so the Ops-side setters and the instance compile the
    ///      identical gate. `msg.sender` is preserved across `delegatecall`, so `owner()` (Ownable's
    ///      shared fixed slot), `agentDelegationEnabled` and `masterRegistry` resolve against the
    ///      instance's state.
    function _requireOwnerOrAgent() internal view {
        if (msg.sender == owner()) return;
        if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) return;
        revert Unauthorized();
    }

    // ┌──────────────────────────────────────┐
    // │       Band lookup (shared)           │
    // └──────────────────────────────────────┘

    /// @dev The single band-range walk for this instance. Non-reverting so the three callers each
    ///      pick their own failure mode: `ERC404BondingOps.mintDown` reverts `NotBandId`,
    ///      `ERC404BondingInstance.coinBalanceOf` sums, and `_afterNFTTransfers` skips. One walk keeps
    ///      the escrow amount from drifting between call sites. O(bandCount), fixed at seal.
    function _bandOf(uint256 id) internal view returns (bool found, uint256 idx, uint256 weight) {
        uint256 n = tierBands.length;
        for (uint256 i; i < n; ++i) {
            TierBand storage b = tierBands[i];
            if (id >= b.idStart && id <= b.idEnd) return (true, i, b.weight);
        }
    }

    // ┌────────────────────────────────────────────────┐
    // │  Burn-safety hook (shared, hot path)           │
    // └────────────────────────────────────────────────┘
    // Declared in the shared base: `_afterNFTTransfers` is an internal DN404 hook, reached by a plain
    // internal jump from `_mint` / `_mintNext` / `_burn` / `_transfer` / `_transferFromNFT`, never
    // through `msg.data`. So the reroll/mintUp trampoline pattern does not apply: under `delegatecall`
    // the code that runs is Ops's own, and if only the instance carried an override then
    // `ERC404BondingOps.mintUp`'s escrow leg — the most likely place to burn a band NFT — would run
    // with the hook disabled. Both contracts must compile the identical body, which the shared base
    // guarantees.

    /// @dev Turning this on enables DN404's `from`/`to`/`ids` array construction at all five hook
    ///      call sites (an unavoidable floor before any body of ours). `pure` narrows DN404's
    ///      non-view declaration, which is legal and lets the compiler fold the branch.
    function _useAfterNFTTransfers() internal pure override returns (bool) {
        return true;
    }

    /// @notice The transfer rule: any coin-path debit burns your tier NFT and credits you its escrow.
    ///         Only a deliberate ERC721 transfer moves the NFT itself.
    /// @dev    DN404's direct-transfer optimization moves `min(sender burns,
    ///         recipient mints)` ids straight off the sender's `owned` tail to the recipient instead of
    ///         burning and re-minting. On a tiered instance that path can hand a tier NFT — and the
    ///         `(w - 1) * unit` of coin escrowed behind it — to the recipient of an ERC20 transfer. The
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
    ///         The gate is tier-based, not global: an untiered collection cannot have this hazard, and
    ///         making the direct-transfer loop unreachable for everyone would charge it roughly 35k gas
    ///         per 3-NFT transfer to close a hazard it does not have. Untiered instances stay on the
    ///         direct-transfer path; tiered instances pay roughly 12.7k gas per NFT moved on the coin
    ///         path, the price of the rule.
    ///
    ///         Declared in the shared base for the same reason as `_useAfterNFTTransfers`: under
    ///         `delegatecall` `ERC404BondingOps` runs its own compiled bytecode, so an override on the
    ///         instance alone would leave `mintUp`'s escrow leg, reroll's coin round-trip and `stake`
    ///         on the direct-transfer path.
    ///
    ///         `view`, not `pure` — it reads the ladder. The gate is `tierBands.length == 0` rather
    ///         than `!_tiersSealed` because the two are equivalent and this one is free:
    ///         `_afterNFTTransfers` above opens with `tierBands.length` on every transfer, so the gate
    ///         hits an already-warm slot, while the seal flag sits in its own slot that nothing on the
    ///         transfer path touches and would cost a cold read (about 2,000 gas more per transfer).
    ///         Equivalence: `_tiersSealed` is set only by `initTierBands`,
    ///         which reverts `InvalidBand` on an empty array (rolling the flag back) and otherwise
    ///         pushes at least one band, and makes no external call between the two writes — so no
    ///         caller can observe a sealed ladder with zero bands.
    function _useDirectTransfersIfPossible() internal view override returns (bool) {
        return tierBands.length == 0;
    }

    /// @notice Release the escrow behind any band NFT that DN404 just burned.
    /// @dev Pull, never push. This runs in the middle of DN404's own accounting — every call site
    ///      invokes it after the balance/ownership writes but while the caller's frame is still live.
    ///      Moving value here (`_transfer`, mint, burn) would re-enter the bookkeeping that is
    ///      mid-flight, so the hook only records: it credits
    ///      `pendingEscrowRelease`, returns the id to its band's LIFO free list, and moves the amount out
    ///      of `totalTierEscrow` into `totalPendingEscrowRelease`. No external calls, so it cannot
    ///      reenter at all. `claimReleasedEscrow()` on the instance is what actually moves coin.
    /// @dev Burn detection, read off the pinned dn404. The three array shapes DN404 builds are:
    ///      mints → `from[i] == address(0)` (`_mint`, `_mintNext`, and the mint tail of `_transfer`);
    ///      burns → `to[i] == address(0)` (`_burn` and the burn segment of `_transfer`); plain
    ///      transfers → both non-zero (the direct segment of `_transfer`, and `_transferFromNFT`, which
    ///      cannot carry `to == 0` because it reverts `TransferToZeroAddress` first). So
    ///      `to[i] == address(0)` is exactly "this id ceased to exist". A band id merely changing
    ///      hands is not a release — escrow follows the id — which is why the test is on `to`, not
    ///      on `from`.
    /// @dev Hot path. Ordering is by cost: a memory compare (`to[i]`) before a storage compare, and the
    ///      whole body behind a single `tierBands.length` SLOAD that short-circuits every instance that
    ///      never sealed a ladder. `floor_` is the lowest band's `idStart`; `initTierBands` seals
    ///      bands ascending and strictly above `idLimit`, so `id < floor` proves "ordinary id" in one
    ///      comparison and no band walk happens for most transfers.
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
            if (!isBand) continue; // above the ordinary space but between bands: not reachable, cheap
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
            // Checked arithmetic: every outstanding band id contributed exactly `(w - 1) * unit` to
            // `totalTierEscrow` when `mintUp` issued it, and an id can only be burned once (the burn
            // clears its ownership), so this cannot underflow; an underflow would be a broken
            // invariant and reverting the transfer is the correct outcome.
            totalTierEscrow -= released;
            totalPendingEscrowRelease += released;
        }
    }
}
