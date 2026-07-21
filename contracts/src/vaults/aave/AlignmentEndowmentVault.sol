// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";

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
 * @dev Money model (locked design session 2026-07-21 — see docs/plans/spec-endowment-vault-rework.md
 *      + spec-endowment-yield-accumulator.md; Part 0 of spec-alignment-vault-economics.md is the law):
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
 *        by escrowed principal) and is pulled via `claimYieldPurse()`. Target leg → `communityPayout`
 *        (native ETH). Protocol leg → `protocolTreasury`.
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
    address public communityPayout; // target sink (registry-pinned at deploy, owner-updatable)
    uint256 public targetId; // the alignment target this clone serves (for the stat surface / events)

    // ── Per-benefactor accounting ─────────────────────────────────────────────
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

    // ── Cumulative stat counters (spec 2a §5) ─────────────────────────────────
    uint256 internal _totalPrincipalCommittedAllTime; // monotonic Σ of all principal ever deposited
    uint256 internal _totalVested; // monotonic Σ of all principal ever vested
    uint256 internal _totalDeployedByTarget; // Σ deployed by the target (deployment is a separate item; 0 here)
    uint256 internal _totalYieldToCreators; // Σ creator leg routed to the accumulator
    uint256 internal _totalYieldToTarget; // Σ target leg routed to communityPayout
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
        communityPayout = _communityPayout; // may be set later via setCommunityPayout

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
        weth.deposit{ value: amount }(); // approval is set once in initialize
        stataToken.deposit(amount, address(this));

        if (depositTime[benefactor] == 0) depositTime[benefactor] = block.timestamp;

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
    function vest(address benefactor) external nonReentrant {
        uint256 e = escrowedPrincipal[benefactor];
        if (e == 0) revert NoPrincipal();
        if (block.timestamp < depositTime[benefactor] + VEST_DURATION) revert NotVested();

        // Settle at the current escrow weight (their creator purse is already-earned ETH; untouched here),
        // then remove them from the accumulator weight — from now they accrue nothing on this principal.
        _settle(benefactor);
        escrowedPrincipal[benefactor] = 0;
        rewardDebt[benefactor] = 0;
        totalEscrowedPrincipal -= e;

        vestedPrincipal[benefactor] += e;
        totalVestedDeployable += e;
        _totalVested += e;

        emit PrincipalVested(benefactor, e, block.timestamp);
    }

    // ┌─────────────────────────┐
    // │   Yield (harvest)       │
    // └─────────────────────────┘

    /// @notice Realize the compounded Aave yield and split it per class (spec 2b §1). Permissionless —
    ///         it only moves the fixed split to fixed destinations.
    ///         escrowed class → 80 creator / 19 target / 1 protocol; vested class → 0 / 99 / 1.
    function harvest() external nonReentrant {
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
            if (communityPayout == address(0)) revert CommunityPayoutNotSet();
            _totalYieldToTarget += targetLeg;
            // force-send: a target sink that rejects ETH must not brick harvest for everyone else.
            SafeTransferLib.forceSafeTransferETH(communityPayout, targetLeg);
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
    // │   Internal helpers      │
    // └─────────────────────────┘

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

    /// @notice Update where this clone's target cut is sent (owner = factory).
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

        uint256 basis = escrowed + totalVestedDeployable;
        uint256 value = _stataValue();

        // Escrowed tranche's pro-rata claim on the (possibly impaired) position value.
        uint256 escrowValue = (value * escrowed) / basis;
        if (value < basis) {
            uint256 shortfallBps = ((basis - value) * BPS) / basis;
            emit ImpairmentRealized(shortfallBps, block.timestamp);
        }

        uint256 got = _redeem(escrowValue);
        if (got + REDEEM_DUST < escrowValue) revert RedeemShortfall();

        // Per-benefactor escrow accounting is intentionally PRESERVED (not zeroed): the value is
        // relocated to `to`/the new venue, and the on-chain ledger remains the source of truth for
        // reconstructing each benefactor's stake there.
        if (got > 0) SafeTransferLib.forceSafeTransferETH(to, got);
        emit Migrated(to, got);
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

    /// @notice Cumulative target-leg yield routed to `communityPayout`.
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
