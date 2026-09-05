// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IAlignmentRegistry } from "../../master/interfaces/IAlignmentRegistry.sol";

/// @dev Minimal WETH surface used by the vault.
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
}

/// @dev Minimal ERC-4626 surface of the Aave `StaticATokenV2` (waEthWETH) — the non-rebasing yield engine.
interface IStataToken {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function maxWithdraw(address owner) external view returns (uint256 assets);
    function balanceOf(address) external view returns (uint256);
    function asset() external view returns (address);
}

/// @dev Read the current owner of a benefactor (collection instance) — follows ownership transfers.
interface IOwnable {
    function owner() external view returns (address);
}

/**
 * @title AlignmentEndowmentVault
 * @notice The Aave endowment vault (rework, specs 2a + 2b). One impl, clone-deployed PER alignment
 *         target by `AlignmentEndowmentVaultFactory`. N benefactors (aligned collections) pool their
 *         pledged principal into ONE Aave `StaticATokenV2` position per target.
 *
 * @dev Money model (locked design session 2026-07-21). The rules below are the law:
 *
 *      - **Principal is a PERMANENT donation.** There is NO refund path — a benefactor's pledged
 *        principal never returns to them. It is committed to the alignment target forever.
 *      - **Principal vests over 6 months per benefactor** (`VEST_DURATION`, measured from the
 *        benefactor's first deposit). Before vest the principal is *escrowed*; at vest it becomes the
 *        target's *deployable* corpus. Vest mechanic (b): vested principal STAYS in the Aave position
 *        earning until the target deploys it (deployment = spec 2c / a separate item) — it is never
 *        idle. The position therefore holds two principal classes at once: `escrowedPrincipal` and
 *        `vestedDeployable`.
 *      - **Yield split (Part 0), applied per class on each `harvest()`:**
 *          escrowed class → 80 creator / 19 target / 1 protocol
 *          vested   class →  0 creator / 99 target / 1 protocol   (creator exited; protocol keeps 1%)
 *        Hard bps constants, no setter (the ratio is sacred). The creator leg flows through a
 *        per-benefactor MasterChef accumulator (`accCreatorYieldPerPrincipal` + `rewardDebt`, weighted
 *        by escrowed principal) and is pulled via `claimYieldPurse()`. Target leg → the registry's
 *        community payout for `targetId`, resolved at send time (native ETH). Protocol leg →
 *        `protocolTreasury`.
 *      - **Impairment socialization** (pro-rata-on-shortfall) is preserved for escrowed principal in the
 *        redeeming emergency path (`migratePosition`). Once vested, the corpus is the target's; its risk
 *        is the venue the target deploys into, so escrow impairment no longer applies to it.
 *      - **migratePosition** is an escrow-only Aave-reserve-deprecation emergency that preserves
 *        per-benefactor accounting ON-CHAIN (no off-chain reconcile).
 *
 *      Clone-compatible (EIP-1167): initialized via `initialize()`, owned by the factory. The legacy
 *      tradable-share / delegation methods of `IAlignmentVault` revert `NotSupported` (an endowment has
 *      no tradable shares); the endowment claim path is `claimYieldPurse()`.
 *
 *      NOTE (audit): this is a fund-holding money-core rework. Deployment of vested capital (the
 *      target-sovereign `execute`) is intentionally NOT in this contract — it is a separately-audited
 *      follow-on. Re-audit required before any deploy.
 */
contract AlignmentEndowmentVault is ReentrancyGuard, Ownable, IAlignmentVault {
    // ┌─────────────────────────┐
    // │      Custom Errors      │
    // └─────────────────────────┘
    // `AlreadyInitialized()` is inherited from solady Ownable.
    error InvalidAddress();
    error AmountMustBePositive();
    error AmountMismatch();
    error NativeOnly();
    error NoPrincipal();
    error NotAuthorized();
    error CommunityPayoutNotSet();
    error NotSupported();
    error BenefactorNotContract();
    error RedeemShortfall();
    error NotVested();
    error ExceedsDeployableCorpus();
    /// @dev `execute` may not target the vault's own principal-bearing assets (the stataToken position or
    ///      its WETH) nor itself — that would let an ambassador route past the `deployableCorpus` bound and
    ///      reach ESCROWED principal via calldata (RE-B1). The value-bound alone does not bind the corpus.
    error ForbiddenExecuteTarget();
    /// @dev The vault has been escrow-migrated (decommissioned): intake and vesting are permanently closed.
    error VaultMigrated();

    // ┌─────────────────────────┐
    // │       Constants         │
    // └─────────────────────────┘
    /// @notice Per-benefactor vesting duration — a platform constant (6 months), measured from the
    ///         benefactor's first deposit. NOT a refund trigger: at vest, principal becomes the
    ///         target's deployable corpus, it does not return to the benefactor.
    uint256 public constant VEST_DURATION = 26 weeks;

    uint256 internal constant BPS = 10_000;
    /// @dev Sacred protocol cut — exactly 1% of ALL yield (both principal classes). Hard, no setter.
    uint256 internal constant PROTOCOL_BPS = 100; // 1%
    /// @dev Target cut on the ESCROWED class — 19%. Creator = remainder of the escrowed class (80%).
    ///      On the VESTED class the creator leg is zero and the target takes the whole non-protocol
    ///      remainder (99%), so no separate vested-target constant is needed.
    uint256 internal constant TARGET_BPS_ESCROW = 1_900; // 19%

    /// @dev Fixed-point precision for the per-benefactor yield accumulator (MasterChef-style).
    uint256 internal constant ACC_PRECISION = 1e18;

    /// @dev A redemption short of the request by ≤ REDEEM_DUST is absorbed as ERC-4626 floor-rounding;
    ///      a larger shortfall is treated as an Aave liquidity event and reverts so the caller can retry
    ///      once liquidity returns (rather than clearing accounting for funds we could not recover).
    uint256 internal constant REDEEM_DUST = 1e6; // wei

    // ┌─────────────────────────┐
    // │         Storage         │
    // └─────────────────────────┘
    bool private _initialized;
    IStataToken public stataToken; // this clone's Aave position (waEthWETH)
    IWETH public weth;
    address public protocolTreasury; // 1% protocol cut sink
    IMasterRegistry public masterRegistry; // agent authorization
    address public alignmentToken; // satisfies registerVault's alignmentToken() check
    address public communityPayout; // target sink FALLBACK (seeded at deploy, owner-updatable) — see `_targetSink`
    uint256 public targetId; // the alignment target this clone serves (for the stat surface / events)

    // ── Per-benefactor accounting ─────────────────────────────────────────────
    /// @notice One escrowed deposit and the timestamp it was made (its own vesting clock). A benefactor's
    ///         escrow is a LIST of these — each deposit vests independently at `depositTs + VEST_DURATION`
    ///         (RE-B3). `escrowedPrincipal[b]` stays the sum of a benefactor's live (unvested) tranches.
    struct DepositTranche {
        uint256 amount;
        uint256 depositTs;
    }

    /// @notice A benefactor's live escrow tranches (per-deposit vesting clocks). Vested tranches are removed.
    mapping(address => DepositTranche[]) internal _escrowTranches;

    /// @notice Where the next BOUNDED vest walk resumes in `_escrowTranches[benefactor]`. Persisted so a
    ///         paged caller advances through the array across calls instead of re-examining the same prefix
    ///         forever: the walk removes matured tranches by swap-and-pop, which leaves unmatured entries in
    ///         place, so a cursor-less bounded walk starting at index 0 could never reach a matured tranche
    ///         sitting behind `maxTranches` unmatured ones. Normalized to 0 whenever it is out of range (the
    ///         array shrank, or the walk wrapped). A full sweep (`maxTranches >= tranches.length`) ignores
    ///         and resets it — it examines every tranche anyway.
    mapping(address => uint256) internal _vestCursor;

    /// @notice Set once by `migratePosition`: the vault is escrow-decommissioned. Intake and vesting close
    ///         permanently so a post-migrate deposit cannot re-open a dead position and a stale-basis vest
    ///         cannot desync harvest/execute into RedeemShortfall (RE-B2).
    bool public migrated;

    /// @notice A benefactor's live ESCROWED (pre-vest) principal — the accumulator weight.
    mapping(address => uint256) public escrowedPrincipal;
    /// @notice A benefactor's principal that has VESTED (now the target's deployable corpus).
    mapping(address => uint256) public vestedPrincipal;
    /// @notice First-deposit timestamp; the benefactor's principal vests at `depositTime + VEST_DURATION`.
    mapping(address => uint256) public depositTime;
    /// @notice MasterChef reward debt (settled snapshot of `escrowedPrincipal * acc / 1e18`).
    mapping(address => uint256) public rewardDebt;
    /// @notice Accrued, still-unclaimed creator yield (native ETH wei) held by the vault for the benefactor.
    mapping(address => uint256) public yieldPurse;

    // ── Aggregates / accumulator ──────────────────────────────────────────────
    uint256 public totalEscrowedPrincipal; // Σ escrowed principal (live) — accumulator weight
    uint256 public totalVestedDeployable; // Σ vested principal still in the position, awaiting deploy
    /// @notice Creator-yield-per-escrowed-principal accumulator, scaled by 1e18 (MasterChef).
    uint256 public accCreatorYieldPerPrincipal;
    /// @notice Target-leg yield (native ETH wei) held by the vault because `_targetSink()` was unset at
    ///         crystallize time. Delivered by the permissionless `flushTargetFees()` once a sink exists.
    uint256 public accumulatedTargetFees;

    // ── Cumulative stat counters (spec 2a §5) ─────────────────────────────────
    uint256 internal _totalPrincipalCommittedAllTime; // monotonic Σ of all principal ever deposited
    uint256 internal _totalVested; // monotonic Σ of all principal ever vested
    uint256 internal _totalDeployedByTarget; // Σ deployed by the target (deployment is a separate item; 0 here)
    uint256 internal _totalYieldToCreators; // Σ creator leg routed to the accumulator
    uint256 internal _totalYieldToTarget; // Σ target leg routed to the target sink
    uint256 internal _totalProtocolFees; // Σ protocol leg routed to protocolTreasury

    // ┌─────────────────────────┐
    // │         Events          │
    // └─────────────────────────┘
    event PrincipalDeposited(address indexed benefactor, uint256 amount, uint256 indexed targetId, uint256 timestamp);
    event PrincipalVested(address indexed benefactor, uint256 amount, uint256 timestamp);
    event YieldDistributed(uint256 creatorLeg, uint256 targetLeg, uint256 protocolLeg, uint256 timestamp);
    event YieldClaimed(address indexed benefactor, address indexed recipient, uint256 amount);
    event ImpairmentRealized(uint256 shortfallBps, uint256 timestamp);
    event CommunityPayoutUpdated(address indexed payout);
    event Migrated(address indexed to, uint256 amount);
    /// @notice Emitted when a crystallized target leg is held in the vault because the target sink is unset.
    event TargetFeesAccrued(uint256 amount, uint256 totalAccrued);
    /// @notice Emitted when the accrued target leg is delivered to the community sink.
    event TargetFeesFlushed(address indexed payout, uint256 amount);
    /// @notice Emitted when the alignment target (via an ambassador) deploys vested corpus capital.
    ///         `selector` = the first 4 bytes of `data` (0x00000000 for a plain value transfer).
    event CapitalDeployed(
        address indexed ambassador, address indexed to, uint256 value, bytes4 selector, uint256 timestamp
    );

    constructor() {
        // Lock the implementation; clones initialize via initialize().
        _initialized = true;
    }

    /// @notice Initialize a freshly-deployed clone. Callable once, by the factory (becomes owner).
    function initialize(
        address _owner,
        address _weth,
        address _stataToken,
        address _protocolTreasury,
        address _masterRegistry,
        address _alignmentToken,
        uint256 _targetId,
        address _communityPayout
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (
            _owner == address(0) || _weth == address(0) || _stataToken == address(0) || _protocolTreasury == address(0)
                || _masterRegistry == address(0) || _alignmentToken == address(0)
        ) revert InvalidAddress();
        _initialized = true;
        _initializeOwner(_owner);

        weth = IWETH(_weth);
        stataToken = IStataToken(_stataToken);
        protocolTreasury = _protocolTreasury;
        masterRegistry = IMasterRegistry(_masterRegistry);
        alignmentToken = _alignmentToken;
        targetId = _targetId;
        // The FALLBACK sink only: `_targetSink()` prefers the registry's live answer. May be zero here and
        // set later on either side; until some sink exists the target leg accrues into
        // `accumulatedTargetFees` and is delivered by `flushTargetFees()`.
        communityPayout = _communityPayout;

        // One-time max approval: the vault is the sole holder of its WETH, deposited each intake into
        // the stataToken. Cheaper + cleaner than re-approving per deposit.
        IWETH(_weth).approve(_stataToken, type(uint256).max);
    }

    // ┌─────────────────────────┐
    // │   Intake (deposit)      │
    // └─────────────────────────┘

    /// @inheritdoc IAlignmentVault
    /// @dev Native ETH only (`currency` must be the zero Currency); `msg.value == amount`. Wraps to
    ///      WETH and supplies the stataToken, crediting `benefactor`'s ESCROWED (permanent, vesting)
    ///      principal. Open + guarded (matches the reference vault): there is no tradable-share surface
    ///      to inflate, so no caller gate is required. `benefactor` MUST be a contract — the yield-claim
    ///      path reads `IOwnable(benefactor).owner()`, so crediting a codeless address would strand it.
    function receiveContribution(Currency currency, uint256 amount, address benefactor)
        external
        payable
        override
        nonReentrant
    {
        if (migrated) revert VaultMigrated(); // no intake into a decommissioned vault (RE-B2)
        if (Currency.unwrap(currency) != address(0)) revert NativeOnly();
        if (amount == 0) revert AmountMustBePositive();
        if (msg.value != amount) revert AmountMismatch();
        if (benefactor == address(0)) revert InvalidAddress();
        if (benefactor.code.length == 0) revert BenefactorNotContract();
        _deposit(benefactor, amount);
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Direct ETH (e.g. from `weth.withdraw`) is accepted but NOT auto-credited — endowment
    ///      principal is only created through `receiveContribution` with an explicit benefactor.
    receive() external payable override { }

    function _deposit(address benefactor, uint256 amount) internal {
        // Harvest-first: crystallize any not-yet-harvested Aave yield BEFORE this deposit grows the escrow
        // weight / inflates the position. Otherwise the next harvest apportions yield the existing
        // benefactors earned during their exclusive window at the POST-join weight, letting the new
        // depositor capture a share of pre-join yield (dilution). Must run before `weth.deposit`/
        // `stataToken.deposit` so `_pendingYield` reads the pre-deposit position value against the
        // pre-deposit basis. `receiveContribution` (the only caller) is `nonReentrant`, so the external
        // `_redeem` + force-sends here cannot be re-entered.
        _crystallizeYield();

        weth.deposit{ value: amount }(); // approval is set once in initialize
        stataToken.deposit(amount, address(this));

        if (depositTime[benefactor] == 0) depositTime[benefactor] = block.timestamp;

        // RE-B3: each deposit gets its OWN vesting clock. A later top-up starts a fresh 26-week window and
        // does NOT ride the first deposit's clock (which would let a month-5 top-up vest in ~1 month, or a
        // post-vest top-up vest instantly, skipping the creator-earning window). Recording the tranche does
        // not regress any existing tranche's clock: earlier tranches keep their original `depositTs`.
        _escrowTranches[benefactor].push(DepositTranche({ amount: amount, depositTs: block.timestamp }));

        // Settle the benefactor's accrued creator yield at their OLD escrow weight, then grow the
        // weight and re-baseline `rewardDebt` so the new principal earns only future yield.
        _settle(benefactor);
        escrowedPrincipal[benefactor] += amount;
        totalEscrowedPrincipal += amount;
        rewardDebt[benefactor] = (escrowedPrincipal[benefactor] * accCreatorYieldPerPrincipal) / ACC_PRECISION;

        _totalPrincipalCommittedAllTime += amount;

        emit ContributionReceived(benefactor, amount);
        emit PrincipalDeposited(benefactor, amount, targetId, block.timestamp);
    }

    // ┌─────────────────────────┐
    // │   Vesting               │
    // └─────────────────────────┘

    /// @notice Realize a benefactor's vest once `depositTime + VEST_DURATION` has elapsed. Permissionless
    ///         (anyone may poke it — it moves no value to the caller). Settles and STOPS the benefactor's
    ///         creator-yield accrual, then moves their principal from the escrowed class to the target's
    ///         deployable class. Mechanic (b): the principal STAYS in the Aave position (no redeem) and
    ///         from here earns 0 creator / 99 target / 1 protocol until the target deploys it.
    ///         Walks the benefactor's whole tranche array in one call. A benefactor whose array has grown
    ///         large enough that a full walk no longer fits in a block uses `vest(address,uint256)` instead.
    function vest(address benefactor) external nonReentrant {
        _vest(benefactor, type(uint256).max);
    }

    /// @notice Paginated `vest`: same accounting, but examines at most `maxTranches` of the benefactor's
    ///         escrow tranches per call. `_escrowTranches[benefactor]` is appended to by every deposit and
    ///         `receiveContribution` is permissionless, so any address can lengthen any benefactor's array;
    ///         a bound that the caller chooses keeps the vest reachable at any array length, and repeated
    ///         calls vest exactly the total that one unbounded call would have.
    /// @param maxTranches Number of tranches to examine in this call. Must be non-zero. A value at or above
    ///        the benefactor's live tranche count performs a full sweep, identical to `vest(address)`.
    /// @dev `NotVested` semantics: a FULL sweep that finds nothing matured reverts `NotVested`, as before —
    ///      it has seen every tranche, so "nothing matured" is a statement about the benefactor. A BOUNDED
    ///      page that finds nothing matured SUCCEEDS and moves the resume cursor: the page has only seen a
    ///      window, and reverting would roll the cursor back and leave a caller unable to page forward past
    ///      unmatured entries. Such a call moves no principal and emits no `PrincipalVested`.
    function vest(address benefactor, uint256 maxTranches) external nonReentrant {
        if (maxTranches == 0) revert AmountMustBePositive(); // a walk of zero tranches cannot make progress
        _vest(benefactor, maxTranches);
    }

    function _vest(address benefactor, uint256 maxTranches) internal {
        if (migrated) revert VaultMigrated(); // escrow is decommissioned post-migrate (RE-B2)
        if (escrowedPrincipal[benefactor] == 0) revert NoPrincipal();

        // Harvest-first: crystallize any not-yet-harvested Aave yield BEFORE this benefactor's principal is
        // reclassified escrowed→vested. Otherwise the yield that accrued while the principal was escrowed —
        // which the split law routes 80 creator / 19 target / 1 protocol — would be apportioned by the NEXT
        // harvest at the post-vest weight (0 creator / 99 target / 1 protocol), stripping the creator leg to
        // the target sink and diluting every still-escrowed benefactor. Mirrors `migratePosition`'s
        // guards→crystallize→mutate order; inlined (not `this.harvest()`) because both are `nonReentrant`.
        // Under pagination this runs once per page; it is idempotent at a given position value (the second
        // call reads zero pending yield and returns), so the ordering invariant holds on every page.
        _crystallizeYield();

        // RE-B3: vest only the tranches whose OWN clock has elapsed. Each deposit vests independently at
        // `depositTs + VEST_DURATION`; a not-yet-matured top-up stays escrowed with its clock intact. Matured
        // tranches are removed (swap-and-pop — order is irrelevant, only the maturity of each amount matters).
        DepositTranche[] storage tranches = _escrowTranches[benefactor];
        uint256 matured;
        bool fullSweep = maxTranches >= tranches.length;

        if (fullSweep) {
            uint256 i;
            while (i < tranches.length) {
                if (block.timestamp >= tranches[i].depositTs + VEST_DURATION) {
                    matured += tranches[i].amount;
                    tranches[i] = tranches[tranches.length - 1];
                    tranches.pop();
                } else {
                    i++;
                }
            }
            // The sweep saw every tranche, so any stored resume position is spent.
            if (_vestCursor[benefactor] != 0) _vestCursor[benefactor] = 0;
            if (matured == 0) revert NotVested();
        } else {
            // Bounded walk. It resumes at the stored cursor and wraps at the end of the array, so successive
            // pages advance around the whole array instead of re-examining the same prefix: unmatured entries
            // stay where they are, and a walk that always started at index 0 could never see past the first
            // `maxTranches` of them. A pop moves the LAST entry into the current slot; that entry sits ahead
            // of the cursor and is examined on the next step, so nothing is skipped and nothing is examined
            // twice within one circuit — which is what makes N bounded calls total exactly what one
            // unbounded call would have vested.
            uint256 c = _vestCursor[benefactor];
            for (uint256 s; s < maxTranches; ++s) {
                uint256 len = tranches.length;
                if (len == 0) {
                    c = 0;
                    break;
                }
                if (c >= len) c = 0;
                if (block.timestamp >= tranches[c].depositTs + VEST_DURATION) {
                    matured += tranches[c].amount;
                    tranches[c] = tranches[len - 1];
                    tranches.pop();
                } else {
                    unchecked {
                        ++c;
                    }
                }
            }
            if (c >= tranches.length) c = 0;
            _vestCursor[benefactor] = c;
            if (matured == 0) return; // page held no matured tranche; the cursor moved, so paging progresses
        }

        // Settle at the current (full) escrow weight — the creator purse is already-earned ETH, untouched
        // here — then shrink the accumulator weight by the matured amount and re-baseline `rewardDebt` so the
        // still-escrowed remainder keeps accruing and the vested portion accrues nothing from here.
        _settle(benefactor);
        escrowedPrincipal[benefactor] -= matured;
        rewardDebt[benefactor] = (escrowedPrincipal[benefactor] * accCreatorYieldPerPrincipal) / ACC_PRECISION;
        totalEscrowedPrincipal -= matured;

        vestedPrincipal[benefactor] += matured;
        totalVestedDeployable += matured;
        _totalVested += matured;

        emit PrincipalVested(benefactor, matured, block.timestamp);
    }

    // ┌─────────────────────────┐
    // │   Yield (harvest)       │
    // └─────────────────────────┘

    /// @notice Realize the compounded Aave yield and split it per class (spec 2b §1). Permissionless —
    ///         it only moves the fixed split to fixed destinations.
    ///         escrowed class → 80 creator / 19 target / 1 protocol; vested class → 0 / 99 / 1.
    function harvest() external nonReentrant {
        _crystallizeYield();
    }

    /// @dev The harvest body, factored out so an internal caller (`migratePosition`) can crystallize pending
    ///      yield WITHOUT the external re-entry that `this.harvest()` would incur — both `harvest` and
    ///      `migratePosition` are `nonReentrant`, so a self-external call would trip the guard and revert.
    ///      This books the escrow class's not-yet-harvested yield into the 80/19/1 legs BEFORE a migrate
    ///      redeems escrow principal, so that yield is split (not swept to the recovery address). Only the
    ///      `nonReentrant`-guarded external entrypoints call this; it performs external ETH sends itself and
    ///      MUST NOT be invoked from an unguarded path.
    function _crystallizeYield() internal {
        uint256 y = _pendingYield();
        if (y == 0) return;

        uint256 totalInAave = totalEscrowedPrincipal + totalVestedDeployable;
        // `y > 0` implies position value > principal basis, which requires basis > 0 (value is 0 with no
        // shares). Guard defensively anyway.
        if (totalInAave == 0) return;

        uint256 got = _redeem(y);
        if (got == 0) return;

        // Apportion realized yield across the two principal classes (remainder-safe).
        uint256 escrowedYield = (got * totalEscrowedPrincipal) / totalInAave;
        uint256 vestedYield = got - escrowedYield;

        // Escrowed class → 80 creator / 19 target / 1 protocol.
        uint256 protoE = (escrowedYield * PROTOCOL_BPS) / BPS;
        uint256 targetE = (escrowedYield * TARGET_BPS_ESCROW) / BPS;
        uint256 creatorLeg = escrowedYield - protoE - targetE;

        // Vested class → 0 creator / 99 target / 1 protocol (creator exited; protocol keeps its 1%).
        uint256 protoV = (vestedYield * PROTOCOL_BPS) / BPS;
        uint256 targetV = vestedYield - protoV;

        uint256 protocolLeg = protoE + protoV;
        uint256 targetLeg = targetE + targetV;

        // Creator leg → per-benefactor accumulator (weighted by escrowed principal). If there is no
        // escrowed weight the escrowed class produced no creator leg (escrowedYield == 0), so this is a
        // no-op; the guard protects the division.
        if (creatorLeg > 0 && totalEscrowedPrincipal > 0) {
            accCreatorYieldPerPrincipal += (creatorLeg * ACC_PRECISION) / totalEscrowedPrincipal;
            _totalYieldToCreators += creatorLeg;
        }

        // Target + protocol legs are pushed out now (creator leg stays as ETH for `claimYieldPurse`).
        if (targetLeg > 0) {
            // Booked at ACCRUAL, like its sibling legs: the counter means "routed to this class", and a
            // flush is a pure delivery step.
            _totalYieldToTarget += targetLeg;
            address payout = _targetSink();
            if (payout == address(0)) {
                // No sink wired yet: hold the target leg in the vault instead of reverting. Crystallize is
                // the first statement of deposit, vest, harvest and execute, so a revert here would close
                // all four; accruing keeps them open and `flushTargetFees()` delivers the leg once a sink
                // exists. No value is dropped.
                accumulatedTargetFees += targetLeg;
                emit TargetFeesAccrued(targetLeg, accumulatedTargetFees);
            } else {
                // force-send: a target sink that rejects ETH must not brick harvest for everyone else.
                SafeTransferLib.forceSafeTransferETH(payout, targetLeg);
            }
        }
        if (protocolLeg > 0) {
            _totalProtocolFees += protocolLeg;
            SafeTransferLib.forceSafeTransferETH(protocolTreasury, protocolLeg);
        }

        emit YieldDistributed(creatorLeg, targetLeg, protocolLeg, block.timestamp);
        emit FeesAccumulated(got);
    }

    // ┌─────────────────────────┐
    // │   Yield claim (creator) │
    // └─────────────────────────┘

    /// @notice Pull-payment: withdraw a benefactor's accrued creator-yield purse in native ETH to the
    ///         benefactor's current owner (the creator). Callable by that owner or an approved platform
    ///         agent acting for them. `nonReentrant`, checks-effects-interactions.
    function claimYieldPurse(address benefactor) external nonReentrant returns (uint256 amount) {
        address creator = IOwnable(benefactor).owner();
        if (msg.sender != creator && !masterRegistry.isAgent(msg.sender)) revert NotAuthorized();

        // Settle any accrued-but-unmoved creator yield into the purse (effects) before paying it out.
        _settle(benefactor);
        amount = yieldPurse[benefactor];
        if (amount == 0) return 0;
        yieldPurse[benefactor] = 0; // effect before interaction (CEI)

        // force-send: a creator contract that rejects ETH must not be able to brick its own claim path.
        SafeTransferLib.forceSafeTransferETH(creator, amount);
        emit YieldClaimed(benefactor, creator, amount);
        emit FeesClaimed(benefactor, amount);
        return amount;
    }

    // ┌─────────────────────────┐
    // │   Target fee flush      │
    // └─────────────────────────┘

    /// @notice Deliver the target-leg yield accrued while the target sink was unset to the current sink.
    /// @dev    Permissionless — the destination is always `_targetSink()`, never caller-supplied, so there
    ///         is no redirect surface. Reverts `CommunityPayoutNotSet` while the sink is unset; the balance
    ///         keeps accruing until then. `nonReentrant` + CEI: the accumulator is zeroed before the send,
    ///         so a re-entrant call moves nothing. Force-send, so a sink that rejects ETH cannot make the
    ///         balance unflushable.
    /// @return amount The wei delivered (0 when nothing was accrued).
    function flushTargetFees() external nonReentrant returns (uint256 amount) {
        address payout = _targetSink();
        if (payout == address(0)) revert CommunityPayoutNotSet();

        amount = accumulatedTargetFees;
        if (amount == 0) return 0;
        accumulatedTargetFees = 0; // effect before interaction (CEI)

        SafeTransferLib.forceSafeTransferETH(payout, amount);
        emit TargetFeesFlushed(payout, amount);
        return amount;
    }

    // ┌─────────────────────────┐
    // │   Internal helpers      │
    // └─────────────────────────┘

    /// @dev Where this clone's target leg is owed, resolved at SEND time.
    ///      The canonical answer is the alignment registry's `getCommunityPayout(targetId)`: it is the
    ///      one address the community controls, and the three LP vault families already read it on every
    ///      send. This clone stores a copy, seeded by the factory from that same registry at deploy, and
    ///      keeps it only as the fallback for a target whose registry entry has not been wired yet — and
    ///      as the escape hatch the factory's `setVaultCommunityPayout` writes. Reading the copy first
    ///      would pin the sink at deploy: after a registry re-point every already-deployed clone would go
    ///      on force-sending to the superseded address, with nothing to claw back and no revert to notice.
    function _targetSink() internal view returns (address) {
        address canonical = masterRegistry.alignmentRegistry().getCommunityPayout(targetId);
        return canonical != address(0) ? canonical : communityPayout;
    }

    /// @dev Move a benefactor's accrued-but-unsettled creator yield into their purse and re-baseline
    ///      their `rewardDebt` to the current accumulator at their CURRENT escrow weight.
    function _settle(address benefactor) internal {
        uint256 accumulated = (escrowedPrincipal[benefactor] * accCreatorYieldPerPrincipal) / ACC_PRECISION;
        uint256 debt = rewardDebt[benefactor];
        if (accumulated > debt) {
            yieldPurse[benefactor] += accumulated - debt;
        }
        rewardDebt[benefactor] = accumulated;
    }

    /// @dev WETH value the vault could redeem from its stataToken position right now.
    function _stataValue() internal view returns (uint256) {
        return stataToken.convertToAssets(stataToken.balanceOf(address(this)));
    }

    /// @dev Yield = position value above the tracked principal basis (both classes), guarded against
    ///      rounding underflow.
    function _pendingYield() internal view returns (uint256) {
        uint256 v = _stataValue();
        uint256 basis = totalEscrowedPrincipal + totalVestedDeployable;
        return v > basis ? v - basis : 0;
    }

    /// @dev Redeem up to `assets` WETH from the stataToken and unwrap to native ETH. Caps at
    ///      `maxWithdraw` so ERC-4626 floor-rounding (the position can be worth `assets − 1 wei`) never
    ///      reverts; returns the amount actually redeemed (`assets` minus any sub-wei dust, which stays
    ///      in the position).
    function _redeem(uint256 assets) internal returns (uint256) {
        uint256 avail = stataToken.maxWithdraw(address(this));
        uint256 amt = assets < avail ? assets : avail;
        if (amt > 0) {
            stataToken.withdraw(amt, address(this), address(this));
            weth.withdraw(amt);
        }
        return amt;
    }

    // ┌─────────────────────────┐
    // │   Admin                 │
    // └─────────────────────────┘

    /// @notice Update this clone's FALLBACK target sink (owner = factory).
    /// @dev    The registry's `getCommunityPayout(targetId)` wins whenever it is set, so this writes the
    ///         address used only while the target has no registry entry. It is not a redirect: it cannot
    ///         divert a leg away from a community that has wired its own sink.
    function setCommunityPayout(address payout) external onlyOwner {
        if (payout == address(0)) revert InvalidAddress();
        communityPayout = payout;
        emit CommunityPayoutUpdated(payout);
    }

    /// @notice Emergency (owner = factory): escrow-only Aave-reserve-deprecation migration. Redeems the
    ///         ESCROWED tranche's pro-rata share of the position to native ETH and force-sends it to `to`
    ///         (the protocol's recovery / new-venue address), PRESERVING per-benefactor principal
    ///         accounting on-chain (no zero-and-off-chain-reconcile). The vested tranche is the target's
    ///         corpus and is moved by the target's own deployment path, not here.
    /// @dev    Impairment socialization: the escrowed share is `value * escrowed / (escrowed + vested)`,
    ///         so a position worth less than principal is redeemed pro-rata rather than first-come. A
    ///         shortfall beyond `REDEEM_DUST` is an Aave liquidity event → revert so the owner can retry.
    ///         Sends to an explicit `to` (the factory owner has no `receive()`).
    function migratePosition(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        uint256 escrowed = totalEscrowedPrincipal;
        if (escrowed == 0) revert NoPrincipal();

        // Harvest-first: crystallize any not-yet-harvested Aave yield into the 80/19/1 (escrowed) and
        // 0/99/1 (vested) legs BEFORE redeeming escrow principal. Otherwise the escrow class's pending yield
        // — which the split law routes 80% creator / 19% target / 1% protocol — would be embedded in the
        // pro-rata `escrowValue` below (computed off the yield-inflated position value) and force-sent to the
        // recovery address `to`, misdirecting it out of the accumulator legs. After this call the position
        // value reflects the principal basis, so `escrowValue` is principal-only. Inlined (not `this.harvest`)
        // because both functions are `nonReentrant`.
        _crystallizeYield();

        uint256 vested = totalVestedDeployable;
        uint256 basis = escrowed + vested;
        uint256 value = _stataValue();

        // Escrowed tranche's pro-rata claim on the (possibly impaired) position value.
        uint256 escrowValue = (value * escrowed) / basis;
        if (value < basis) {
            uint256 shortfallBps = ((basis - value) * BPS) / basis;
            emit ImpairmentRealized(shortfallBps, block.timestamp);

            // Socialize the impairment onto the vested tranche too. On an impaired position the vested tranche
            // now backs only `value·vested/basis` realizable WETH, but `deployableCorpus()` still reports the
            // full `vested`; a later `execute(vested)` would then hit `RedeemShortfall` and strand the residual
            // permanently. Scale `totalVestedDeployable` down to the vested tranche's actual realizable value so
            // `deployableCorpus()` never exceeds redeemable WETH. `min(...)` keeps it a no-op on a healthy
            // position (this branch only runs when `value < basis`, but the floor keeps it monotonic).
            uint256 realizableVested = (value * vested) / basis;
            if (realizableVested < totalVestedDeployable) {
                totalVestedDeployable = realizableVested;
            }
        }

        uint256 got = _redeem(escrowValue);
        if (got + REDEEM_DUST < escrowValue) revert RedeemShortfall();

        // RE-B2: zero the escrow BASIS and decommission the vault. The escrow tranche has left the Aave
        // position (relocated to `to`/the new venue), so leaving `totalEscrowedPrincipal` as a live basis
        // would (a) make `_pendingYield` see basis > position value and return ~0 forever (harvest bricks),
        // and (b) let a later `vest()` grow `totalVestedDeployable` against principal that is no longer
        // here, desyncing `execute` into `RedeemShortfall`. Zeroing the basis + closing intake/vesting via
        // the `migrated` flag keeps harvest/vest/execute self-consistent. Per-benefactor escrow entries are
        // frozen-inert (a mapping cannot be iterated to zero each); the on-chain ledger + the `Migrated`
        // event remain the record for reconstructing each benefactor's stake at the new venue.
        totalEscrowedPrincipal = 0;
        migrated = true;

        if (got > 0) SafeTransferLib.forceSafeTransferETH(to, got);
        emit Migrated(to, got);
    }

    // ┌─────────────────────────────────────────┐
    // │  Target-sovereign deployment (spec 2c)  │
    // └─────────────────────────────────────────┘

    /// @notice The ETH-equivalent of the deployable (vested) corpus an ambassador may `execute` against.
    /// @dev    The base figure is the VESTED principal tranche (`totalVestedDeployable`), tracked 1:1 in
    ///         WETH (== ETH). On the UPSIDE it is deliberately NOT the vested tranche's proportional share
    ///         of the live position value: any position value above the principal basis is UNHARVESTED
    ///         yield, which belongs to the yield legs (99 target / 1 protocol on the vested class, realized
    ///         by `harvest()`), NOT to the deployable principal corpus. Deployment is principal-corpus only
    ///         (spec 2c §2), so the bound is the principal, keeping the protocol's 1% yield leg out of reach
    ///         of `execute`.
    ///
    ///         On the DOWNSIDE the nominal basis is not fully redeemable, so the figure is clamped to the
    ///         vested tranche's pro-rata claim on the live position value:
    ///
    ///             min(totalVestedDeployable, value * totalVestedDeployable / basis)
    ///
    ///         with `value = _stataValue()` and `basis = totalEscrowedPrincipal + totalVestedDeployable`
    ///         (`basis == 0` → 0). Reporting the nominal basis while the position is impaired lets
    ///         `execute(nominal)` pass the `ExceedsDeployableCorpus` bound and then hit `RedeemShortfall`,
    ///         stranding the residual — the failure `migratePosition`'s write-down describes. The `min(...)`
    ///         floor keeps the clamp a strict no-op on a healthy position (`value >= basis` makes the second
    ///         term >= the first), so it moves no loss between the escrowed and vested classes: this is an
    ///         ACCOUNTING bound on what the position can actually redeem, not impairment socialization (the
    ///         money model reserves that for escrowed principal on the `migratePosition` path).
    ///
    ///         Being a view it holds no state to re-apply, so it is idempotent by construction: repeated
    ///         reads — and any number of intervening `harvest()` calls — return the same answer at an
    ///         unchanged position value. `execute` calls `_crystallizeYield()` before reading this, so the
    ///         clamp is computed against a freshly-harvested position value; that ordering is load-bearing.
    function deployableCorpus() public view returns (uint256) {
        uint256 vested = totalVestedDeployable;
        uint256 basis = totalEscrowedPrincipal + vested;
        if (basis == 0) return 0;

        uint256 realizable = (_stataValue() * vested) / basis;
        return realizable < vested ? realizable : vested;
    }

    /// @notice Target-sovereign deployment of vested capital. The alignment target — acting through any of
    ///         its ambassadors — may deploy up to `deployableCorpus()` with an ARBITRARY external call:
    ///         any `to`, any `value` (≤ corpus), any `data`. No whitelist, no creator/owner approval, no
    ///         forbidden actions (withdraw-to-EOA is `execute(eoa, amount, "")`). The tithe is freely given;
    ///         the target is sovereign over what has vested. The sole backstop against a rogue ambassador is
    ///         the platform owner's `removeAmbassador` on the alignment registry, which revokes deploy rights
    ///         for any capital not yet moved. Escrowed (unvested) principal is UNTOUCHABLE here — the bound
    ///         is the vested corpus only.
    /// @dev    Auth resolves LIVE against the canonical alignment registry
    ///         (`masterRegistry.alignmentRegistry().isAmbassador(targetId, msg.sender)`) so a platform
    ///         re-point of the alignment registry is honored and there is no stale-cache risk. Strict
    ///         checks-effects-interactions + `nonReentrant`: the corpus is decremented and the redeem is
    ///         settled BEFORE the arbitrary external call, so a malicious `to` re-entering `execute` cannot
    ///         double-spend. Redeems `value` from the Aave vested tranche; an Aave shortfall reverts (no
    ///         partial deploy).
    /// @param  to    Target of the deployment call (any address).
    /// @param  value ETH to deploy (must be ≤ `deployableCorpus()`).
    /// @param  data  Calldata for the deployment call (empty for a plain transfer).
    /// @return result The raw return data of the external call.
    function execute(address to, uint256 value, bytes calldata data)
        external
        nonReentrant
        returns (bytes memory result)
    {
        // Harvest-first: crystallize any not-yet-harvested Aave yield BEFORE this deploy redeems vested
        // principal / shrinks the corpus. Two defects this closes: (1) split-misattribution — an ambassador
        // timing `execute` before a harvest would reweight the vested class's yield into the escrowed
        // 80/19/1 split (or vice-versa) at the post-deploy weight; crystallizing first fixes the apportion
        // at the pre-deploy weights. (2) permanent strand — draining the LAST principal (`totalInAave→0`)
        // would trap all pending yield behind `_crystallizeYield`'s `if (totalInAave == 0) return;` guard
        // with no reopen once `migrated`; crystallizing while `totalInAave > 0` still holds realizes it
        // first. Runs before the auth read; its force-sends precede the arbitrary external call, so CEI
        // holds. Inlined (not `this.harvest()`) because both are `nonReentrant`.
        _crystallizeYield();

        IAlignmentRegistry ar = masterRegistry.alignmentRegistry();
        if (!ar.isAmbassador(targetId, msg.sender)) revert NotAuthorized();

        // RE-B1: the `value` bound alone does NOT bind the corpus — an ambassador could pass `value = 0`
        // (trivially ≤ corpus) and route through `data` to make the vault call `transfer`/`withdraw`/
        // `approve` on its OWN principal-bearing tokens, draining ESCROWED (permanent) principal to an
        // arbitrary address. Deny the vault's principal-bearing targets (its stataToken position and the
        // WETH it holds an unbounded approval on) and itself, so the arbitrary call can never reach the
        // corpus. Legit value-only deployment to any OTHER `to` (incl. an EOA) is unaffected.
        if (to == address(stataToken) || to == address(weth) || to == address(this)) {
            revert ForbiddenExecuteTarget();
        }

        if (value > deployableCorpus()) revert ExceedsDeployableCorpus();

        // Redeem the requested value from the Aave vested tranche to native ETH. `value ≤ vested basis ≤
        // position value`, so `maxWithdraw` covers it and the escrowed tranche is never drawn upon. ERC-4626
        // floor-rounding can leave the redeem short by up to `REDEEM_DUST` (`got = value − dust`); a larger
        // shortfall is an Aave liquidity event → revert (do not partial-deploy). This is a redeem from the
        // TRUSTED stataToken/WETH (which `receive()` handles inertly), not the arbitrary `to` — so it runs
        // before the effects without CEI risk; the arbitrary external call remains strictly last.
        uint256 got = _redeem(value);
        if (got + REDEEM_DUST < value) revert RedeemShortfall();

        // ── Effects (before the arbitrary external call) ──
        // Debit the corpus by `got` — what ACTUALLY left the position — not the requested `value`. The dust
        // (`value − got`) stays in the vested tranche as still-deployable principal; debiting `value` would
        // instead orphan it into position-value-above-basis, leaking that sliver of vested principal into the
        // next harvest's 99/1 yield legs. `deployableCorpus()` is the pro-rata clamp of
        // `totalVestedDeployable` on an impaired position, so it can be strictly LESS than the nominal
        // tranche; the chain that matters here is `got ≤ value ≤ deployableCorpus() ≤ totalVestedDeployable`,
        // so no underflow. Do not restore the old `deployableCorpus() == totalVestedDeployable` identity —
        // it is what let an impaired `execute` pass the bound and then hit `RedeemShortfall`.
        totalVestedDeployable -= got;
        _totalDeployedByTarget += got;

        bytes4 selector;
        if (data.length >= 4) selector = bytes4(data[:4]);
        emit CapitalDeployed(msg.sender, to, got, selector, block.timestamp);

        // ── Interaction: the arbitrary external call ──
        // Forward `got` (what was actually redeemed), NOT `value`: on a dusty redeem forwarding the full
        // `value` would cover the ~dust shortfall from the vault's OTHER native ETH (a creator `yieldPurse`),
        // dipping funds that are not the deployable corpus.
        bool ok;
        (ok, result) = to.call{ value: got }(data);
        if (!ok) {
            // Bubble the callee's revert reason verbatim.
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
        return result;
    }

    // ┌─────────────────────────┐
    // │   Stat surface (2a §5)  │
    // └─────────────────────────┘

    /// @notice Live escrowed (pre-vest) principal across all benefactors.
    function totalPrincipalLocked() external view returns (uint256) {
        return totalEscrowedPrincipal;
    }

    /// @notice Monotonic sum of all principal ever committed to this vault.
    function totalPrincipalCommittedAllTime() external view returns (uint256) {
        return _totalPrincipalCommittedAllTime;
    }

    /// @notice Monotonic sum of all principal that has vested into the target's deployable corpus.
    function totalVested() external view returns (uint256) {
        return _totalVested;
    }

    /// @notice Sum of principal deployed by the target (deployment is a separate follow-on item; 0 here).
    function totalDeployedByTarget() external view returns (uint256) {
        return _totalDeployedByTarget;
    }

    /// @notice Cumulative creator-leg yield routed to the per-benefactor accumulator.
    function totalYieldToCreators() external view returns (uint256) {
        return _totalYieldToCreators;
    }

    /// @notice Cumulative target-leg yield routed to the target sink.
    function totalYieldToTarget() external view returns (uint256) {
        return _totalYieldToTarget;
    }

    /// @notice Cumulative protocol-leg yield routed to `protocolTreasury`.
    function totalProtocolFees() external view returns (uint256) {
        return _totalProtocolFees;
    }

    /// @notice Live redeemable WETH value of the Aave position.
    function currentPositionValue() external view returns (uint256) {
        return _stataValue();
    }

    /// @notice A benefactor's live escrowed (pre-vest) principal.
    function principalOf(address benefactor) external view returns (uint256) {
        return escrowedPrincipal[benefactor];
    }

    /// @notice A benefactor's principal that has vested into the target's deployable corpus.
    function vestedOf(address benefactor) external view returns (uint256) {
        return vestedPrincipal[benefactor];
    }

    /// @notice A benefactor's total claimable creator yield in native ETH: already-settled purse plus the
    ///         live-unsettled accrual on their current escrow weight.
    function pendingYieldOf(address benefactor) external view returns (uint256) {
        return _claimable(benefactor);
    }

    /// @dev Total claimable creator yield = settled purse + live-unsettled accrual at current weight.
    function _claimable(address benefactor) internal view returns (uint256) {
        uint256 accumulated = (escrowedPrincipal[benefactor] * accCreatorYieldPerPrincipal) / ACC_PRECISION;
        uint256 debt = rewardDebt[benefactor];
        uint256 live = accumulated > debt ? accumulated - debt : 0;
        return yieldPurse[benefactor] + live;
    }

    // ┌─────────────────────────┐
    // │   IAlignmentVault views │
    // └─────────────────────────┘
    // Note: `alignmentToken()` (required by MasterRegistry.registerVault's staticcall) is the
    // auto-generated getter of the public `alignmentToken` storage var above — not in IAlignmentVault.

    /// @inheritdoc IAlignmentVault
    function vaultType() external pure override returns (string memory) {
        return "AaveEndowment";
    }

    /// @notice Whether this vault is operationally wired (O2 gate — parity with the LP vaults).
    /// @dev The endowment needs no pool key or DEX wiring: the Aave stataToken position is set at
    ///      initialize and never requires post-deploy operational config. Always ready.
    function isLiquidityReady() external pure returns (bool) {
        return true;
    }

    /// @inheritdoc IAlignmentVault
    function description() external pure override returns (string memory) {
        return "Per-target endowment: permanent, 6-month-vesting creator donations in Aave; yield 80/19/1.";
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Endowment semantics: returns the harvestable yield still IN the Aave position (a preview),
    ///      NOT withdrawn ETH. Realized only by `harvest()`.
    function accumulatedFees() external view override returns (uint256) {
        return _pendingYield();
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Not tradable shares — the total principal basis (escrowed + vested) still in the position.
    function totalShares() external view override returns (uint256) {
        return totalEscrowedPrincipal + totalVestedDeployable;
    }

    /// @inheritdoc IAlignmentVault
    /// @dev A benefactor's all-time principal (permanent — escrowed + vested; never decreases, no refund).
    function getBenefactorContribution(address benefactor) external view override returns (uint256) {
        return escrowedPrincipal[benefactor] + vestedPrincipal[benefactor];
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Not tradable shares — the benefactor's total principal (escrowed + vested), in wei.
    function getBenefactorShares(address benefactor) external view override returns (uint256) {
        return escrowedPrincipal[benefactor] + vestedPrincipal[benefactor];
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Endowment semantics: principal is a PERMANENT donation and is never claimable as cash. The
    ///      only claimable amount is the benefactor's accrued creator-yield purse — returned here so the
    ///      generic interface query reports the real claimable ETH (pulled via `claimYieldPurse`).
    function calculateClaimableAmount(address benefactor) external view override returns (uint256) {
        return _claimable(benefactor);
    }

    /// @inheritdoc IAlignmentVault
    function supportsCapability(bytes32 capability) external pure override returns (bool) {
        return capability == keccak256("YIELD_GENERATION");
    }

    /// @inheritdoc IAlignmentVault
    function currentPolicy() external pure override returns (bytes memory) {
        return "";
    }

    /// @inheritdoc IAlignmentVault
    function validateCompliance(address) external pure override returns (bool) {
        return true;
    }

    /// @inheritdoc IAlignmentVault
    /// @dev No delegation on an endowment — returns the benefactor itself.
    function getBenefactorDelegate(address benefactor) external pure override returns (address) {
        return benefactor;
    }

    // ┌─────────────────────────┐
    // │  Unsupported legacy API │
    // └─────────────────────────┘
    // Endowment has no tradable shares / per-caller fee claims / delegation. The endowment claim path is
    // `claimYieldPurse()`; yield realization is `harvest()`.

    /// @inheritdoc IAlignmentVault
    function claimFees() external pure override returns (uint256) {
        revert NotSupported();
    }

    /// @inheritdoc IAlignmentVault
    function delegateBenefactor(address) external pure override {
        revert NotSupported();
    }

    /// @inheritdoc IAlignmentVault
    function claimFeesAsDelegate(address[] calldata) external pure override returns (uint256) {
        revert NotSupported();
    }
}
