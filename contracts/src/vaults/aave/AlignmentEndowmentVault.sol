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
 * @notice The Aave endowment vault. One impl, clone-deployed per alignment target by
 *         `AlignmentEndowmentVaultFactory`. N benefactors (aligned collections) pool their pledged
 *         principal into one Aave `StaticATokenV2` position per target.
 *
 * @dev Money model:
 *
 *      - **Principal is a permanent donation.** There is no refund path; a benefactor's pledged
 *        principal is committed to the alignment target forever.
 *      - **One principal balance.** Principal sits in a single pooled bucket (`totalPrincipal`) from
 *        the moment it arrives. A slice stops earning only when it is physically withdrawn from the
 *        Aave position, because the ETH is gone.
 *      - **Yield split (flat, every harvest):** 80 creator / 19 target / 1 protocol, on whatever
 *        principal is in the position at that moment, the same split every LP family takes. The bps
 *        are constants with no setter. The creator leg flows through a per-benefactor MasterChef
 *        accumulator (`accCreatorYieldPerShare` + `rewardDebt`) and is pulled via `claimYieldPurse()`.
 *        Target leg: the registry's community payout for `targetId`, resolved at send time (native
 *        ETH). Protocol leg: `protocolTreasury`. The accumulator moves in whole units, so a creator
 *        leg too small for the live share count to divide is carried in `creatorYieldRemainder`
 *        until a later harvest can express it, never booked as paid and never dropped (see
 *        `_creditCreatorLeg`).
 *      - **Ambassador assignment is eligibility to withdraw, not withdrawal.** It gates `execute`
 *        and nothing else; the yield split runs flat from the first deposit whether or not the
 *        target has a seated ambassador.
 *      - **A withdrawal is pooled, so it lands pro-rata.** `execute` and `releaseCorpusToCommunity`
 *        debit `totalPrincipal` only. A benefactor's principal is their share of that pool
 *        (`principalShares[b] · totalPrincipal / totalPrincipalShares`), so ETH leaving the position
 *        shrinks every benefactor's live principal in proportion, and with it their weight in every
 *        later harvest. No per-benefactor bookkeeping runs at withdraw time, which keeps the
 *        withdraw path O(1) against an unbounded benefactor set.
 *      - **Impairment is socialized pro-rata** by the same pooling: one bucket, one basis, so a
 *        position worth less than its basis is written down once and every benefactor's share moves
 *        together. The write-down runs on every path that reads or moves the basis (`execute`,
 *        deposit, release, migrate), so a basis never outlives its ETH.
 *      - **A round close is a withdrawal.** When a withdrawal leaves the pool priced under the share
 *        floor the round ends, and the residual principal is redeemed out of the position into
 *        `roundResidue` before the basis is zeroed, so `totalPrincipal == 0` with ETH still in the
 *        position is unreachable. That residue is still corpus: the curated target's sink collects it
 *        through `flushRoundResidue`, and after de-curation `releaseCorpusToCommunity` sweeps it to
 *        the community with everything else.
 *      - **migratePosition** is an Aave-reserve-deprecation emergency that preserves per-benefactor
 *        accounting on-chain.
 *
 *      Clone-compatible (EIP-1167): initialized via `initialize()`, owned by the factory. The
 *      tradable-share / delegation methods of `IAlignmentVault` revert `NotSupported` (an endowment
 *      has no tradable shares); the endowment claim path is `claimYieldPurse()`.
 *
 *      Trust: this vault holds funds. The whole withdraw gate is two live registry reads inside
 *      `execute`: `msg.sender` is a seated ambassador for `targetId`, and `targetId` is still
 *      curated. A benefactor's protection is therefore the quality of the appointment and of the
 *      curation decision, both made before the money is exposed. See
 *      `contracts/audits/2026-09-17-pre-testnet.md` §1.2 (T3) and F5-F7 (§1.4).
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
    error ExceedsDeployableCorpus();
    /// @dev `execute` may not target the vault's own principal-bearing assets (the stataToken position or
    ///      its WETH), itself, or the alignment registry. The value-bound alone does not bind the position:
    ///      a call routed through `data` could move the stataToken shares out without debiting
    ///      `totalPrincipal`, desyncing the yield basis and leaving the creator purses and accrued target
    ///      fees this vault holds unbacked. Nor does it bind the vault's identity: the registry keys the
    ///      community-payout rotation on `msg.sender`, so a vault that is itself a community's pinned sink
    ///      would otherwise let any ambassador rotate that payout away in a free zero-value call.
    error ForbiddenExecuteTarget();
    /// @dev The vault has been migrated (decommissioned): intake is permanently closed.
    error VaultMigrated();
    /// @dev The alignment target has been de-curated, so the ambassador seat's discretionary deploy power
    ///      over the corpus is frozen. What is still HERE is not stranded by that freeze:
    ///      `releaseCorpusToCommunity()` delivers it to the community's own registry-pinned sink rather
    ///      than to an arbitrary call. It says nothing about what was already withdrawn, and de-curation
    ///      is one-way — `AlignmentRegistryV1` has no reactivate path — so the freeze and that exit are
    ///      both permanent once taken.
    error TargetDecurated();
    /// @dev `releaseCorpusToCommunity()` is the de-curation exit and nothing else: while the target is still
    ///      curated the corpus is the target's to deploy through `execute`.
    error TargetStillCurated();
    /// @dev A deposit found the pool priced under the share floor with principal still in it: a round close is
    ///      owed and has not run yet. Reachable only while an Aave liquidity crunch holds a DE-CURATED pool
    ///      under the floor (see the guard in `_deposit`); it clears when the crunch does.
    error RoundClosePending();

    // ┌─────────────────────────┐
    // │       Constants         │
    // └─────────────────────────┘
    uint256 internal constant BPS = 10_000;
    /// @dev Protocol cut: exactly 1% of all yield. No setter.
    uint256 internal constant PROTOCOL_BPS = 100; // 1%
    /// @dev Target (community) cut: 19%. The creator takes the remainder, 80%. Same weights the LP
    ///      families split on.
    uint256 internal constant TARGET_BPS = 1_900; // 19%

    /// @dev Fixed-point precision for the per-benefactor yield accumulator (MasterChef-style).
    uint256 internal constant ACC_PRECISION = 1e18;

    /// @dev A redemption short of the request by ≤ REDEEM_DUST is absorbed as ERC-4626 floor-rounding;
    ///      a larger shortfall is treated as an Aave liquidity event and reverts so the caller can retry
    ///      once liquidity returns (rather than clearing accounting for funds we could not recover).
    uint256 internal constant REDEEM_DUST = 1e6; // wei

    /// @dev The floor under the pool's price per share, as a reciprocal: a round ends once its principal
    ///      has fallen below `1 / MIN_SHARE_PRICE_INVERSE` of its share count. Shares are minted at that
    ///      price (`amount · shares / principal`), so a pool withdrawn to a sliver would mint an enormous
    ///      number of shares to the next depositor, and repeated it compounds until `amount · shares`
    ///      overflows and intake is bricked. Ending the round keeps the price in [1e-9, 1], which bounds
    ///      the share count at `Σ deposits · 1e9` and puts every product here far inside uint256. The
    ///      floor is an overflow bound only: the principal left in the pool at a close is not small (at a
    ///      floor-priced pool it is the whole of the last deposit, bounded by `shares / 1e9 ≤ Σ deposits`),
    ///      so `_closeRoundIfPriceCollapsed` withdraws it as corpus rather than leaving it to be read as yield.
    uint256 internal constant MIN_SHARE_PRICE_INVERSE = 1e9;

    // ┌─────────────────────────┐
    // │         Storage         │
    // └─────────────────────────┘
    bool private _initialized;
    IStataToken public stataToken; // this clone's Aave position (waEthWETH)
    IWETH public weth;
    address public protocolTreasury; // 1% protocol cut sink
    IMasterRegistry public masterRegistry; // agent authorization
    address public alignmentToken; // satisfies registerVault's alignmentToken() check
    uint256 public targetId; // the alignment target this clone serves (for the stat surface / events)

    /// @notice Set once by `migratePosition`: the vault is decommissioned. Intake closes permanently so a
    ///         post-migrate deposit cannot re-open a dead position.
    bool public migrated;

    // ── Per-benefactor accounting ─────────────────────────────────────────────
    /// @notice A benefactor's immutable weight in the pooled corpus. Minted at deposit against the pool's
    ///         live price (`totalPrincipal / totalPrincipalShares`) and never burned or rescaled: a
    ///         withdrawal moves the price, not the shares, which is what makes withdrawal O(1) over an
    ///         unbounded benefactor set. Live principal is `principalOf()`.
    mapping(address => uint256) public principalShares;
    /// @notice MasterChef reward debt (settled snapshot of `principalShares * acc / 1e18`).
    mapping(address => uint256) public rewardDebt;
    /// @notice Accrued, still-unclaimed creator yield (native ETH wei) held by the vault for the benefactor.
    mapping(address => uint256) public yieldPurse;
    /// @notice The funding round a benefactor's shares were minted in (see `fundingRound`).
    mapping(address => uint256) public fundingRoundOf;

    // ── Aggregates / accumulator ──────────────────────────────────────────────
    /// @notice The live principal basis: every wei of principal still in the Aave position. Grows on
    ///         deposit, shrinks only when principal is physically withdrawn (`execute`,
    ///         `releaseCorpusToCommunity`, `migratePosition`) or written down by impairment.
    uint256 public totalPrincipal;
    /// @notice Σ live `principalShares` — the accumulator's weight denominator.
    uint256 public totalPrincipalShares;
    /// @notice Creator-yield-per-share accumulator, scaled by 1e18 (MasterChef).
    uint256 public accCreatorYieldPerShare;
    /// @notice Creator-leg yield (native ETH wei) that the per-share accumulator could not express at the
    ///         weight standing when it was crystallized, held for the next harvest to fold in. The
    ///         accumulator moves in whole units of `1 / ACC_PRECISION` per share, so a leg worth less than
    ///         `totalPrincipalShares / ACC_PRECISION` wei buys no movement at all; that wei waits here
    ///         instead of being credited to nobody. It is creator money — not corpus, not a fee: no flush
    ///         reaches it and nothing delivers it but the accumulator itself, on the first later harvest
    ///         whose pooled leg clears one unit. `totalYieldToCreators()` deliberately excludes it; see
    ///         `_creditCreatorLeg`.
    uint256 public creatorYieldRemainder;
    /// @notice Target-leg yield (native ETH wei) held by the vault because `_targetSink()` was unset at
    ///         crystallize time. Delivered by the permissionless `flushTargetFees()` once a sink exists.
    uint256 public accumulatedTargetFees;
    /// @notice Corpus that a round close redeemed out of the Aave position and that the vault holds as
    ///         native ETH, awaiting delivery (see `_closeRoundIfPriceCollapsed`). It has left the position
    ///         but not the vault: it is in no benefactor's `principalOf`, not in `totalPrincipal`, not in
    ///         `currentPositionValue()`, and not deployable. While the target is curated
    ///         `flushRoundResidue()` delivers it to `_targetSink()`; once de-curated only
    ///         `releaseCorpusToCommunity()` reaches it, and sweeps it with the corpus.
    ///
    ///         It is kept apart from `accumulatedTargetFees` although both are delivered to the same
    ///         `_targetSink()`. (i) Gate: `flushRoundResidue` reverts `TargetDecurated`, so after
    ///         de-curation the residual corpus has one exit, `releaseCorpusToCommunity`; `flushTargetFees`
    ///         has no such gate because the yield leg is the target's on any day. (ii) Booking: the residue
    ///         is booked in `totalDeployedByTarget` when it leaves, under `RoundResidueFlushed` or
    ///         `CorpusReleased`, and a fee flush books nothing there. Merged, a fee flush would carry
    ///         corpus past the gate and corpus would leave under a fee event, unbooked.
    uint256 public roundResidue;

    /// @notice Which funding round the pool is on. A corpus that is spent to the last wei and then
    ///         re-funded starts a new round, because the old shares have no principal left behind them and
    ///         must not price (or dilute) the new money. It is bookkeeping only: not an eligibility state,
    ///         it gates no withdrawal and changes nothing about when principal earns. A round boundary
    ///         retires spent shares lazily, at each benefactor's next touch, against the accumulator value
    ///         frozen in `_accAtRoundEnd`, so no already-earned creator yield is lost.
    uint256 public fundingRound;
    /// @dev `accCreatorYieldPerShare` as it stood when each closed round ended — the value a stale-round
    ///      benefactor's final settlement is computed against.
    mapping(uint256 => uint256) internal _accAtRoundEnd;

    // ── Cumulative stat counters ──────────────────────────────────────────────
    uint256 internal _totalPrincipalCommittedAllTime; // monotonic Σ of all principal ever deposited
    uint256 internal _totalDeployedByTarget; // Σ principal that left the vault on the target's behalf: execute, flushRoundResidue, release
    uint256 internal _totalYieldToCreators; // Σ creator leg routed to the accumulator
    uint256 internal _totalYieldToTarget; // Σ target leg routed to the target sink
    uint256 internal _totalProtocolFees; // Σ protocol leg routed to protocolTreasury

    // ┌─────────────────────────┐
    // │         Events          │
    // └─────────────────────────┘
    event PrincipalDeposited(address indexed benefactor, uint256 amount, uint256 indexed targetId, uint256 timestamp);
    event YieldDistributed(uint256 creatorLeg, uint256 targetLeg, uint256 protocolLeg, uint256 timestamp);
    event YieldClaimed(address indexed benefactor, address indexed recipient, uint256 amount);
    event ImpairmentRealized(uint256 shortfallBps, uint256 timestamp);
    event Migrated(address indexed to, uint256 amount);
    /// @notice Emitted when a fully-spent corpus is re-funded and a new share round opens.
    event FundingRoundOpened(uint256 indexed round, uint256 timestamp);
    /// @notice Emitted when a crystallized target leg is held in the vault because the target sink is unset.
    event TargetFeesAccrued(uint256 amount, uint256 totalAccrued);
    /// @notice Emitted when the accrued target leg is delivered to the community sink.
    event TargetFeesFlushed(address indexed payout, uint256 amount);
    /// @notice Emitted when a round close redeems the residual corpus out of the position into `roundResidue`.
    event RoundResidueAccrued(uint256 indexed round, uint256 amount, uint256 totalResidue);
    /// @notice Emitted when `roundResidue` is delivered to the curated target's sink by `flushRoundResidue`.
    event RoundResidueFlushed(address indexed payout, uint256 amount);
    /// @notice Emitted when the alignment target (via an ambassador) deploys corpus capital.
    ///         `selector` = the first 4 bytes of `data` (0x00000000 for a plain value transfer).
    event CapitalDeployed(
        address indexed ambassador, address indexed to, uint256 value, bytes4 selector, uint256 timestamp
    );
    /// @notice Emitted when a de-curated target's remaining corpus is delivered to its community sink.
    ///         Distinct from `CapitalDeployed` so the two ways corpus leaves — an ambassador's discretionary
    ///         call and this non-discretionary release — stay separable off-chain despite sharing a counter.
    event CorpusReleased(address indexed payout, uint256 amount);

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
        uint256 _targetId
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
        // The target sink is not stored here. It lives in the alignment registry and is read live on
        // every send (`_targetSink`); until the registry pins one the target leg accrues into
        // `accumulatedTargetFees`, and `flushTargetFees()` delivers it once a sink exists.

        // One-time max approval: the vault is the sole holder of its WETH, deposited each intake into
        // the stataToken.
        IWETH(_weth).approve(_stataToken, type(uint256).max);
    }

    // ┌─────────────────────────┐
    // │   Intake (deposit)      │
    // └─────────────────────────┘

    /// @inheritdoc IAlignmentVault
    /// @dev Native ETH only (`currency` must be the zero Currency); `msg.value == amount`. Wraps to
    ///      WETH and supplies the stataToken, crediting `benefactor`'s permanent principal. Open to any
    ///      caller: there is no tradable-share surface to inflate. `benefactor` must be a contract; the
    ///      yield-claim path reads `IOwnable(benefactor).owner()`, so crediting a codeless address would
    ///      strand it.
    function receiveContribution(Currency currency, uint256 amount, address benefactor)
        external
        payable
        override
        nonReentrant
    {
        if (migrated) revert VaultMigrated(); // no intake into a decommissioned vault
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
        // Harvest-first: crystallize pending Aave yield before this deposit grows the accumulator weight,
        // or the next harvest would apportion yield the existing benefactors earned at the post-join
        // weight and the new depositor would capture pre-join yield. Runs before `weth.deposit` /
        // `stataToken.deposit` so `_pendingYield` reads the pre-deposit position against the pre-deposit
        // basis. `receiveContribution` (the only caller) is `nonReentrant`, so the external `_redeem` and
        // force-sends here cannot be re-entered.
        _crystallizeYield();
        // Write an impaired basis down before pricing the new shares against it, so a newcomer buys in at
        // what the position actually holds and the loss stays with the shares that held it. Once written
        // down, a later Aave recovery is split 80/19/1 as yield, not restored as principal.
        _realizeImpairment();

        // Refuse to mint against a pool that is under the share floor with principal still in it, i.e. a
        // round whose close is owed and has not run. `_closeRoundIfPriceCollapsed` runs after every
        // withdrawal, so the only way to be here is `releaseCorpusToCommunity` on a partial redeem (a
        // close there would need a second redeem the same crunch refuses); an Aave impairment deeper than
        // 1 − 1e-9 of the position reaches the same state until the next execute or release closes it.
        // Minting at `amount · shares / principal` in that state exceeds the `Σ · 1e9` share bound and
        // compounds until `amount · shares` overflows, so intake reverts with a named error that clears
        // when liquidity returns.
        //
        // An ambassador cannot create this state: `execute` closes in the same call or reverts whole, and
        // is frozen on a de-curated target. It takes a de-curated target (the release is the only partial
        // path), a crunch holding Aave's available WETH short of the corpus by more than `REDEEM_DUST` at
        // each release, and a direct `receiveContribution` caller (the instances route the tithe to
        // `protocolTreasury` once the target is de-curated). The refusal is transient, and the instances'
        // `pendingVaultCut` retry lane treats a transient intake revert as safe.
        if (totalPrincipal != 0 && totalPrincipal * MIN_SHARE_PRICE_INVERSE < totalPrincipalShares) {
            revert RoundClosePending();
        }

        weth.deposit{ value: amount }(); // approval is set once in initialize
        stataToken.deposit(amount, address(this));

        // Re-funding a corpus that was spent to the last wei opens a new share round: the outstanding
        // shares have no principal behind them, and pricing this deposit against them would hand the new
        // benefactor a sliver of a pool they fund entirely. The accumulator is frozen for the closing
        // round so its shares can still be settled in full, then the weight restarts from zero.
        if (totalPrincipal == 0 && totalPrincipalShares != 0) {
            _accAtRoundEnd[fundingRound] = accCreatorYieldPerShare;
            unchecked {
                ++fundingRound;
            }
            totalPrincipalShares = 0;
            emit FundingRoundOpened(fundingRound, block.timestamp);
        }

        // Settle the benefactor's accrued creator yield at their old weight (retiring it if it belongs to
        // a closed round), then mint the new weight and re-baseline `rewardDebt` so the new principal
        // earns only future yield.
        _settle(benefactor);

        // Price the new shares off the pool: `amount · shares / principal`. On an untouched pool that is
        // 1:1; after a withdrawal the pool is worth less per share, so the same ETH buys more shares,
        // keeping a later benefactor's weight proportional to what they put in.
        uint256 newShares = totalPrincipalShares == 0 ? amount : (amount * totalPrincipalShares) / totalPrincipal;

        principalShares[benefactor] += newShares;
        totalPrincipalShares += newShares;
        totalPrincipal += amount;
        rewardDebt[benefactor] = (principalShares[benefactor] * accCreatorYieldPerShare) / ACC_PRECISION;

        _totalPrincipalCommittedAllTime += amount;

        emit ContributionReceived(benefactor, amount);
        emit PrincipalDeposited(benefactor, amount, targetId, block.timestamp);
    }

    // ┌─────────────────────────┐
    // │   Yield (harvest)       │
    // └─────────────────────────┘

    /// @notice Realize the compounded Aave yield and split it 80 creator / 19 target / 1 protocol.
    ///         Permissionless — it only moves the fixed split to fixed destinations.
    function harvest() external nonReentrant {
        _crystallizeYield();
    }

    /// @dev The harvest body, callable internally without the re-entry that `this.harvest()` would incur
    ///      (the entrypoints are all `nonReentrant`). It books not-yet-harvested yield into the 80/19/1
    ///      legs before any call that moves principal, so that yield is split rather than swept out with
    ///      the principal. It performs external ETH sends itself and must only be called from
    ///      `nonReentrant`-guarded entrypoints.
    function _crystallizeYield() internal {
        // Spend any carried creator remainder first, before the returns below. A migrated vault and a
        // round closed by a collapsed share price both leave `totalPrincipal == 0` with shares
        // outstanding, and a harvest with nothing to realize returns at `y == 0`; a remainder left behind
        // them would stay uncreditable until new yield arrived, which on a decommissioned vault is never.
        // It also credits the carry when a round boundary makes it creditable: `_deposit` crystallizes
        // before it opens the new round, so the old round's holders are credited at their own weight.
        _creditCreatorLeg(0);

        uint256 y = _pendingYield();
        if (y == 0) return;

        // `y > 0` implies position value > principal basis, which requires basis > 0. Guarded defensively.
        if (totalPrincipal == 0) return;

        uint256 got = _redeem(y);
        if (got == 0) return;

        // The flat split, on whatever principal is in the position now (the creator leg absorbs the
        // rounding dust).
        uint256 protocolLeg = (got * PROTOCOL_BPS) / BPS;
        uint256 targetLeg = (got * TARGET_BPS) / BPS;
        uint256 creatorLeg = got - protocolLeg - targetLeg;

        _creditCreatorLeg(creatorLeg);

        // Target + protocol legs are pushed out now (creator leg stays as ETH for `claimYieldPurse`).
        if (targetLeg > 0) {
            // Booked at accrual, like its sibling legs: the counter means "routed to this class", and a
            // flush is a pure delivery step.
            _totalYieldToTarget += targetLeg;
            address payout = _targetSink();
            if (payout == address(0)) {
                // No sink wired: hold the target leg instead of reverting. Crystallize is the first
                // statement of deposit, harvest and execute, so a revert here would close all three;
                // `flushTargetFees()` delivers the leg once a sink exists.
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

    /// @dev Route a creator leg into the per-benefactor accumulator, the only way a benefactor is paid:
    ///      a wei the accumulator does not carry is a wei nobody can claim.
    ///
    ///      The accumulator moves in whole units of `1 / ACC_PRECISION` per share, so a leg worth less than
    ///      `totalPrincipalShares / ACC_PRECISION` wei moves it by nothing. The share-price floor admits
    ///      prices down to 1e-9 (`MIN_SHARE_PRICE_INVERSE`), so a pool drained to the floor and refunded
    ///      carries ~1e27 shares per ETH and every creator leg under a gwei falls in that class.
    ///
    ///      So the leg is pooled with what earlier harvests could not express, the pool is credited by
    ///      whatever the division can carry, and the shortfall is carried in `creatorYieldRemainder` for
    ///      the next harvest. Carrying the remainder credits benefactors on the harvest that earned it
    ///      whenever any part of the leg fits, and recovers the truncation dust of an ordinary harvest
    ///      too. `_totalYieldToCreators` takes the wei the accumulator's movement can demand, so the stat
    ///      surface is an upper bound on what creators can claim, never a payment the vault cannot make;
    ///      the rest is `creatorYieldRemainder`. Across any sequence of harvests the two sum to the
    ///      creator legs exactly.
    ///
    ///      Pure accounting: no external call, no ETH movement. The creator leg is already native ETH in
    ///      the vault and leaves only through `claimYieldPurse`.
    function _creditCreatorLeg(uint256 leg) internal {
        uint256 pot = creatorYieldRemainder + leg;
        if (pot == 0) return;

        uint256 shares = totalPrincipalShares;
        if (shares == 0) {
            // No weight to divide by, so nobody to credit; hold the whole pot. Defensive: a live basis
            // implies a deposit minted shares, but a guard that swallowed the leg would strand it.
            creatorYieldRemainder = pot;
            return;
        }

        // The most accumulator movement `pot` can buy.
        uint256 perShare = (pot * ACC_PRECISION) / shares;
        if (perShare == 0) {
            // Not even one unit: hold the whole pot for a later harvest, and book nothing.
            creatorYieldRemainder = pot;
            return;
        }

        // What that movement can demand across the whole weight, rounded up. Rounding down would let the
        // sub-wei fraction in `perShare · shares / ACC_PRECISION` (a fraction whenever `shares <
        // ACC_PRECISION`) be paid for once and credited again on every later harvest, until the
        // accumulator promises more creator yield than the vault took in. Rounding up costs the pot at
        // most one wei and keeps the counter an upper bound on what the accumulator can pay. It never
        // exceeds `pot`, because `perShare · shares ≤ pot · ACC_PRECISION` by the floor above, so the
        // subtraction is safe.
        uint256 cost = (perShare * shares + ACC_PRECISION - 1) / ACC_PRECISION;

        accCreatorYieldPerShare += perShare;
        _totalYieldToCreators += cost;
        // Strictly less than one unit's worth of wei (`shares / ACC_PRECISION`): what is left could not
        // have bought another unit.
        creatorYieldRemainder = pot - cost;
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

    /// @notice Deliver the corpus residue of closed rounds (`roundResidue`) to the CURATED target's sink.
    /// @dev    The sibling of `flushTargetFees`, with the same guards — permissionless, destination always
    ///         `_targetSink()`, `nonReentrant`, counter zeroed before the send (CEI), force-send so a sink
    ///         that rejects ETH cannot make the residue undeliverable — plus one it does not share: it
    ///         reverts `TargetDecurated` once the target is de-curated. That is the whole point of keeping
    ///         the residue out of `accumulatedTargetFees`: after de-curation this corpus is the community's,
    ///         and `releaseCorpusToCommunity` is its only exit. While curated, delivering it here hands the
    ///         ambassador nothing new — an `execute` of the same value to the same sink was already theirs.
    /// @return amount The wei delivered (0 when nothing was accrued).
    function flushRoundResidue() external nonReentrant returns (uint256 amount) {
        if (!masterRegistry.alignmentRegistry().isAlignmentTargetActive(targetId)) revert TargetDecurated();
        address payout = _targetSink();
        if (payout == address(0)) revert CommunityPayoutNotSet();

        amount = roundResidue;
        if (amount == 0) return 0;
        roundResidue = 0; // effect before interaction (CEI)
        _totalDeployedByTarget += amount; // booked at departure, like every other booking on this counter

        SafeTransferLib.forceSafeTransferETH(payout, amount);
        emit RoundResidueFlushed(payout, amount);
        return amount;
    }

    // ┌─────────────────────────┐
    // │   Internal helpers      │
    // └─────────────────────────┘

    /// @dev Where this clone's target leg is owed, resolved at send time from the alignment registry's
    ///      `getCommunityPayout(targetId)` and nowhere else, the same single read the LP vault families do.
    ///
    ///      The clone keeps no copy of the answer. A local owner-writable fallback consulted when the
    ///      registry answers zero would be a live owner redirect: the registry's payout is pinned by
    ///      `onlyOwner` `setCommunityPayout`, so an owner who never pins it keeps the answer at zero and a
    ///      sink they can re-point at will, while the community has nothing to rotate. The write-once pin
    ///      and payee-only `rotateCommunityPayout` in the registry only bind if this is the only address
    ///      consulted.
    ///
    ///      Zero means no community sink exists: the target leg accrues in `accumulatedTargetFees` and the
    ///      corpus waits, both delivered in full once the registry pins a sink, and neither reachable by
    ///      anyone else meanwhile.
    function _targetSink() internal view returns (address) {
        return masterRegistry.alignmentRegistry().getCommunityPayout(targetId);
    }

    /// @dev The accumulator value a benefactor's claim is measured against: the live one while their shares
    ///      belong to the open round, otherwise the value frozen when their round closed.
    function _accFor(address benefactor) internal view returns (uint256) {
        uint256 round = fundingRoundOf[benefactor];
        return round == fundingRound ? accCreatorYieldPerShare : _accAtRoundEnd[round];
    }

    /// @dev Move a benefactor's accrued-but-unsettled creator yield into their purse and re-baseline their
    ///      `rewardDebt` to the accumulator at their CURRENT weight. Shares left over from a closed round
    ///      are retired here — after they have been settled in full against that round's frozen
    ///      accumulator, so retiring them pays out everything they earned and forfeits nothing.
    function _settle(address benefactor) internal {
        uint256 round = fundingRoundOf[benefactor];
        uint256 acc = round == fundingRound ? accCreatorYieldPerShare : _accAtRoundEnd[round];
        uint256 accumulated = (principalShares[benefactor] * acc) / ACC_PRECISION;
        uint256 debt = rewardDebt[benefactor];
        if (accumulated > debt) {
            yieldPurse[benefactor] += accumulated - debt;
        }
        if (round == fundingRound) {
            rewardDebt[benefactor] = accumulated;
        } else {
            principalShares[benefactor] = 0;
            rewardDebt[benefactor] = 0;
            fundingRoundOf[benefactor] = fundingRound;
        }
    }

    /// @dev WETH value the vault could redeem from its stataToken position right now.
    function _stataValue() internal view returns (uint256) {
        return stataToken.convertToAssets(stataToken.balanceOf(address(this)));
    }

    /// @dev Yield = position value above the tracked principal basis, guarded against rounding underflow.
    function _pendingYield() internal view returns (uint256) {
        uint256 v = _stataValue();
        uint256 basis = totalPrincipal;
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

    /// @dev Close the round once a withdrawal has left the pool worth less than
    ///      `1 / MIN_SHARE_PRICE_INVERSE` of its share count (see that constant). A close is a withdrawal:
    ///      the residual principal is redeemed out of the Aave position into the vault's native balance
    ///      and booked in `roundResidue`, and only then is the basis zeroed. That holds the invariant that
    ///      `totalPrincipal == 0` while ETH is still in the position is unreachable (up to `REDEEM_DUST` of
    ///      ERC-4626 rounding). Zeroing the basis with the ETH still in Aave would leave the residue as
    ///      position-value-above-basis, which the next harvest would split as yield, 80% of it to whoever
    ///      opens the next round; at a floor-priced pool that residue is the whole of the last deposit.
    ///
    ///      Why the residue is redeemed rather than the deposit bounded:
    ///        (1) any bound at mint is a new revert on a permissionless intake, and `receiveContribution`
    ///            is the settlement leg of every mint on the platform;
    ///        (2) refusing a deposit that would mint past `Σ · 1e9` shares lets one ambassador `execute`
    ///            down to 1 wei and starve intake for good, and the settlement paths wrap the vault cut in
    ///            try/catch, so mints keep clearing while the 19% leg silently stops arriving;
    ///        (3) capping the mint instead under-weights the newcomer, so shares whose ETH was physically
    ///            withdrawn take a slice of the new deposit every cycle (ghost basis).
    ///
    ///      Checks-effects-interactions: it is called from `execute` and `releaseCorpusToCommunity` after
    ///      the withdrawal's own redeem and basis debit, and before the arbitrary external call
    ///      (`execute`) / the force-send (`release`). Its only external calls are the redeem against the
    ///      trusted stataToken / WETH (`receive()` takes the unwrap inertly); no ETH leaves the vault and
    ///      no untrusted address is called. Delivery is the fee-flush shape: `flushRoundResidue` while
    ///      curated, `releaseCorpusToCommunity` after, each `nonReentrant`, counter zeroed before the send,
    ///      force-safe. Share state is untouched: the old shares stay outstanding and are retired lazily
    ///      against `_accAtRoundEnd` when the next deposit opens a round, exactly as a drain-to-zero closes
    ///      one; the accumulator is frozen at that deposit, and every harvest on these shares was
    ///      crystallized before the closing withdrawal debited them.
    ///
    ///      A redeem short by more than `REDEEM_DUST` is an Aave liquidity event and reverts, the same rule
    ///      the caller's own redeem is under; the close does not partially settle.
    function _closeRoundIfPriceCollapsed() internal {
        uint256 shares = totalPrincipalShares;
        if (shares == 0) return;
        uint256 basis = totalPrincipal;
        if (basis == 0) return;
        if (basis * MIN_SHARE_PRICE_INVERSE >= shares) return;

        // ── Interaction with the trusted position only: the residue leaves Aave. ──
        uint256 got = _redeem(basis);
        if (got + REDEEM_DUST < basis) revert RedeemShortfall();

        // ── Effects: it is now vault-held corpus, and the basis behind the shares is gone. ──
        // Not booked in `_totalDeployedByTarget` here: the bookings are made against a departure from the
        // vault, and the residue has left the position but not the vault. `flushRoundResidue` and the
        // release sweep book it when it departs.
        roundResidue += got;
        totalPrincipal = 0;
        emit RoundResidueAccrued(fundingRound, got, roundResidue);
    }

    /// @dev Write the principal basis down to what the position can actually realize, if it is impaired.
    ///      A nominal basis above the position's value lets `deployableCorpus()` promise ETH the redeem
    ///      cannot deliver, so the withdraw passes its bound and then hits `RedeemShortfall`, stranding the
    ///      residual. One bucket, so the write-down lands on every benefactor's share at once; there is
    ///      nothing to apportion between classes.
    ///
    ///      Runs on every path that reads or moves the basis (`migratePosition`,
    ///      `releaseCorpusToCommunity`, `execute`, `_deposit`) so the basis never outlives the ETH behind
    ///      it. Without it in `execute`, an ambassador could drain an impaired position and leave the lost
    ///      half as ghost basis: the emptied shares would keep their weight, the next depositor would buy
    ///      in against a basis the position does not hold, and harvest would stall until the new money had
    ///      doubled. Once written down, a later Aave recovery is split 80/19/1 as yield, not restored as
    ///      principal.
    function _realizeImpairment() internal {
        uint256 basis = totalPrincipal;
        if (basis == 0) return;
        uint256 value = _stataValue();
        if (value >= basis) return;

        emit ImpairmentRealized(((basis - value) * BPS) / basis, block.timestamp);
        totalPrincipal = value;
    }

    // ┌─────────────────────────┐
    // │   Admin                 │
    // └─────────────────────────┘

    // There is deliberately no owner-side community-payout setter here. The target sink is the alignment
    // registry's answer alone (see `_targetSink`); the owner pins it there once and the address receiving
    // it rotates it thereafter, so this contract holds no capability to point a community's money anywhere.

    /// @notice Emergency (owner = factory): Aave-reserve-deprecation migration. Redeems the position's
    ///         principal to native ETH and force-sends it to `to` (the protocol's recovery / new-venue
    ///         address), PRESERVING per-benefactor accounting on-chain (no zero-and-off-chain-reconcile).
    /// @dev    Impairment socialization: the basis is written down to the position's realizable value
    ///         first, so a position worth less than principal is redeemed pro-rata across every benefactor
    ///         rather than first-come. A shortfall beyond `REDEEM_DUST` is an Aave liquidity event →
    ///         revert so the owner can retry. Sends to an explicit `to` (the factory owner has no
    ///         `receive()`).
    ///
    ///         `roundResidue` is not swept here. It is corpus already out of the Aave position, so the
    ///         reserve deprecation does not touch it, and it keeps both of its doors after a migrate:
    ///         `flushRoundResidue` while the target is curated, `releaseCorpusToCommunity` after. The
    ///         `NoPrincipal` check does not strand it either: with the basis at 0 and a residue held,
    ///         this call reverts and leaves the residue untouched, and neither door reads `totalPrincipal`
    ///         or `migrated`.
    function migratePosition(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (totalPrincipal == 0) revert NoPrincipal();

        // Harvest-first: crystallize pending Aave yield into the 80/19/1 legs before redeeming principal,
        // or it would be redeemed with the principal and force-sent to the recovery address `to`,
        // bypassing the accumulator legs. Inlined (not `this.harvest()`) because both are `nonReentrant`.
        _crystallizeYield();
        _realizeImpairment();

        uint256 amount = totalPrincipal;
        uint256 got = _redeem(amount);
        if (got + REDEEM_DUST < amount) revert RedeemShortfall();

        // Zero the basis and decommission the vault. The principal has left the Aave position, so a live
        // basis would make `_pendingYield` see basis > position value and return ~0 forever. Zeroing it
        // and closing intake via `migrated` keeps harvest/execute self-consistent. Per-benefactor share
        // entries are frozen inert (a mapping cannot be iterated to zero each); the on-chain ledger and
        // the `Migrated` event are the record for reconstructing each stake at the new venue.
        totalPrincipal = 0;
        migrated = true;

        if (got > 0) SafeTransferLib.forceSafeTransferETH(to, got);
        emit Migrated(to, got);
    }

    // ┌─────────────────────────────────────────┐
    // │  Target-sovereign deployment            │
    // └─────────────────────────────────────────┘

    /// @notice The ETH-equivalent of the corpus an ambassador may `execute` against: the whole principal
    ///         balance.
    /// @dev    The base figure is the principal basis (`totalPrincipal`), tracked 1:1 in WETH (== ETH). It
    ///         is deliberately not the live position value on the upside: value above the basis is
    ///         unharvested yield, which belongs to the yield legs (80/19/1, realized by `harvest()`), so
    ///         the bound is the principal and the protocol's 1% yield leg stays out of reach of `execute`.
    ///
    ///         On the downside the nominal basis is not fully redeemable, so the figure is clamped to the
    ///         live position value. Reporting the nominal basis on an impaired position would let
    ///         `execute(nominal)` pass the `ExceedsDeployableCorpus` bound and then hit `RedeemShortfall`,
    ///         stranding the residual. The clamp is a no-op on a healthy position and moves no value between
    ///         benefactors: it is an accounting bound on what the position can redeem.
    ///
    ///         Being a view it is idempotent: repeated reads, and any number of intervening `harvest()`
    ///         calls, return the same answer at an unchanged position value.
    function deployableCorpus() public view returns (uint256) {
        uint256 basis = totalPrincipal;
        if (basis == 0) return 0;
        uint256 value = _stataValue();
        return value < basis ? value : basis;
    }

    /// @notice Target-sovereign deployment of corpus capital. The alignment target, acting through any of
    ///         its ambassadors, may deploy up to `deployableCorpus()` with an arbitrary external call:
    ///         any `to`, any `value` (≤ corpus), any `data`. No whitelist, no creator/owner approval
    ///         (withdraw-to-EOA is `execute(eoa, amount, "")`). The tithe is freely given; the target is
    ///         sovereign over it for as long as the protocol curates it.
    ///
    ///         The registry-side controls are `removeAmbassador`, which unseats one address, and
    ///         `deactivateAlignmentTarget`, which freezes every seat at once and routes the remaining
    ///         corpus to `releaseCorpusToCommunity`. Both bound only what has not left this vault, and
    ///         every wei is deployable the moment it arrives, so they stop the next withdrawal and say
    ///         nothing about one already made. The protection a benefactor has is the appointment itself:
    ///         who is seated, and whether the target is still curated.
    /// @dev    Auth resolves live against the canonical alignment registry
    ///         (`masterRegistry.alignmentRegistry().isAmbassador(targetId, msg.sender)`), so a re-point of
    ///         the alignment registry is honored and there is no stale cache. Strict
    ///         checks-effects-interactions + `nonReentrant`: the corpus is decremented and the redeem is
    ///         settled before the arbitrary external call, so a malicious `to` re-entering `execute` cannot
    ///         double-spend. An Aave shortfall reverts (no partial deploy).
    /// @param  to    Target of the deployment call (any address).
    /// @param  value ETH to deploy (must be ≤ `deployableCorpus()`).
    /// @param  data  Calldata for the deployment call (empty for a plain transfer).
    /// @return result The raw return data of the external call.
    function execute(address to, uint256 value, bytes calldata data)
        external
        nonReentrant
        returns (bytes memory result)
    {
        // Harvest-first: crystallize pending Aave yield before this deploy redeems principal. Otherwise
        // (1) yield earned while the principal was in the position would be apportioned at the
        // post-deploy weight, and (2) draining the last principal (`totalPrincipal → 0`) would trap all
        // pending yield behind `_crystallizeYield`'s `totalPrincipal == 0` guard. Its force-sends precede
        // the arbitrary external call, so CEI holds. Inlined (not `this.harvest()`) because both are
        // `nonReentrant`.
        _crystallizeYield();
        // Write an impaired basis down before the deploy debits it, on the same law as `migratePosition`
        // and `releaseCorpusToCommunity`; otherwise a deploy that empties an impaired position leaves the
        // lost half as a ghost basis that keeps earning on the next depositor's money.
        _realizeImpairment();

        IAlignmentRegistry ar = masterRegistry.alignmentRegistry();
        if (!ar.isAmbassador(targetId, msg.sender)) revert NotAuthorized();
        // De-curation freezes the seat's spending power for every ambassador at once. The seat is an
        // appointment made because the protocol curates the target; withdrawing the curation withdraws the
        // discretion that came with it. Capital already deployed has left this vault; what has not left is
        // not spendable by arbitrary call, and `releaseCorpusToCommunity()` is its exit.
        if (!ar.isAlignmentTargetActive(targetId)) revert TargetDecurated();

        // The `value` bound alone does not bind the position: an ambassador could pass `value = 0` and
        // route through `data` to make the vault call `transfer`/`withdraw`/`approve` on its own
        // principal-bearing tokens, moving principal out with no debit to `totalPrincipal`. That desyncs
        // the yield basis and leaves the native ETH held for others (creator purses,
        // `accumulatedTargetFees`, `roundResidue`) unbacked. Nor does it bind what the vault's identity can
        // sign for elsewhere: a zero-value call is free and its `msg.sender` is this vault. So the vault's
        // principal-bearing targets (its stataToken position and the WETH it holds an unbounded approval
        // on), itself, and the alignment registry are denied. Value-only deployment to any other `to`
        // (including an EOA) is unaffected.
        //
        // The denylist is sufficient only given invariants that live outside it; a change that breaks one
        // reopens a route the denylist closes:
        //   (a) the vault never grants a token approval other than WETH → stataToken (set once in
        //       `initialize`), so no `transferFrom` on a third contract can reach the position through
        //       `data`;
        //   (b) the stataToken has no contract-signature (EIP-1271) permit path (StaticATokenV2's permit
        //       is ECDSA-only and this vault has no `isValidSignature`), so `data` cannot mint a permit
        //       that lets `to` pull the position later;
        //   (c) the alignment registry keys a privilege on msg.sender-is-a-vault:
        //       `AlignmentRegistryV1.rotateCommunityPayout` authorizes on `msg.sender ==
        //       communityPayout[targetId]` alone, so when a community's payout is pinned to a vault, that
        //       vault's call surface is the rotation key. Without the registry entry any seated ambassador
        //       could spend a zero-value `execute` at the registry and move the community's money to an
        //       address of their own. Any other contract that trusts msg.sender-is-a-vault belongs in
        //       this list in the same change that grants the trust.
        if (to == address(stataToken) || to == address(weth) || to == address(this) || to == address(ar)) {
            revert ForbiddenExecuteTarget();
        }

        if (value > deployableCorpus()) revert ExceedsDeployableCorpus();

        // Redeem the requested value to native ETH. `value ≤ position value`, so `maxWithdraw` covers it.
        // ERC-4626 floor-rounding can leave the redeem short by up to `REDEEM_DUST` (`got = value − dust`);
        // a larger shortfall is an Aave liquidity event and reverts (no partial deploy). The redeem is
        // against the trusted stataToken/WETH (`receive()` handles the unwrap inertly), not the arbitrary
        // `to`, so it runs before the effects without CEI risk; the arbitrary call stays strictly last.
        uint256 got = _redeem(value);
        if (got + REDEEM_DUST < value) revert RedeemShortfall();

        // ── Effects (before the arbitrary external call) ──
        // Debit the corpus by `got`, what actually left the position, not the requested `value`. The dust
        // (`value − got`) stays in the corpus as still-deployable principal; debiting `value` would orphan
        // it into position-value-above-basis and leak it into the next harvest's yield legs.
        // `deployableCorpus()` clamps to the position value on an impaired position, so it can be less
        // than the nominal basis; `got ≤ value ≤ deployableCorpus() ≤ totalPrincipal`, so no underflow.
        //
        // No per-benefactor bookkeeping runs here: the debit lowers the pool's price per share, so every
        // benefactor's `principalOf`, and their weight in every later harvest, falls in proportion.
        totalPrincipal -= got;
        _totalDeployedByTarget += got;
        _closeRoundIfPriceCollapsed();

        bytes4 selector;
        if (data.length >= 4) selector = bytes4(data[:4]);
        emit CapitalDeployed(msg.sender, to, got, selector, block.timestamp);

        // ── Interaction: the arbitrary external call ──
        // Forward `got` (what was redeemed), not `value`: on a dusty redeem, forwarding `value` would cover
        // the shortfall from the vault's other native ETH (a creator `yieldPurse`).
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

    /// @notice Deliver a de-curated target's remaining corpus to that community's payout sink.
    /// @dev    The companion to the `execute` freeze. `migratePosition` is an owner emergency and not a
    ///         route the community can ask for, and de-curation is one-way (`AlignmentRegistryV1` has no
    ///         reactivate path), so without this the corpus would sit in the Aave position for the life of
    ///         the contract. It reaches only what has not been withdrawn; it is not a clawback.
    ///
    ///         Permissionless, and non-discretionary in both arguments it does not take: the amount is the
    ///         whole corpus and the destination is always `_targetSink()` (the registry's
    ///         `getCommunityPayout(targetId)`), never caller-supplied. It is a delivery, not a spend, so
    ///         leaving it open to anyone hands a de-curated ambassador nothing they did not already have.
    ///         Reverts `CommunityPayoutNotSet` while no sink is wired; the corpus waits, and
    ///         `AlignmentRegistryV1.setCommunityPayout` stays callable on an inactive target so the sink
    ///         can still be wired.
    ///
    ///         Impairment is realized on the same law as `migratePosition`: the basis is written down to
    ///         its realizable value before the redeem, which is what makes one call enough. A liquidity
    ///         shortfall can make it take more than one call: the redeem delivers what Aave has and the
    ///         rest stays basis for the next call. This exit never reverts on a crunch, because a
    ///         de-curated corpus must always have a way out.
    ///
    ///         The delivery sweeps `roundResidue` along with the corpus. Residue is corpus a round close
    ///         already redeemed out of the position; on a de-curated target it belongs to the community
    ///         like the corpus still in the position, and this is the only path that reaches it once
    ///         `flushRoundResidue` is closed by de-curation.
    ///
    ///         The `_closeRoundIfPriceCollapsed` call below is not redundant with the drain above it. The
    ///         redeem guard bounds what it can find at `≤ REDEEM_DUST` of basis, but a dust basis with the
    ///         old share count outstanding is the overflow state the floor exists for: a deposit (intake
    ///         is open after de-curation) priced against a 1e6-wei basis mints `amount · shares / 1e6`
    ///         shares, and this permissionless release can be repeated to compound it until
    ///         `amount · shares` overflows. The close moves that dust into the residue (swept in the same
    ///         call) and zeroes the basis so the next deposit opens a fresh round.
    /// @return amount The wei delivered: corpus redeemed here plus the residue swept (0 when both are
    ///         empty).
    function releaseCorpusToCommunity() external nonReentrant returns (uint256 amount) {
        IAlignmentRegistry ar = masterRegistry.alignmentRegistry();
        if (ar.isAlignmentTargetActive(targetId)) revert TargetStillCurated();

        address payout = _targetSink();
        if (payout == address(0)) revert CommunityPayoutNotSet();

        // Harvest-first, as `execute` does: yield accrued so far is apportioned at the pre-release
        // weights, and draining the last principal would otherwise trap pending yield behind
        // `_crystallizeYield`'s `totalPrincipal == 0` guard.
        _crystallizeYield();
        _realizeImpairment();

        uint256 corpus = totalPrincipal;
        uint256 got;
        if (corpus != 0) {
            // Take what Aave will give right now. This exit tolerates a partial where `execute` does not:
            // execute's no-partial rule protects the ambassador's atomicity, but this call is repeatable,
            // permissionless and fixed-destination, so a liquidity crunch must not hold a de-curated
            // target's corpus hostage; the remainder stays live basis for the next call.
            got = _redeem(corpus);

            // ── Effects before the send (CEI) ──
            // Debit by `got`, as `execute` does: what the redeem could not deliver stays in the position
            // as releasable principal rather than leaking into the next harvest's yield legs.
            // `_totalDeployedByTarget` counts principal moved out on the target's behalf, and
            // `CorpusReleased` against `CapitalDeployed` tells the two apart.
            totalPrincipal -= got;
            _totalDeployedByTarget += got;
            // Close only on a full drain. A partial leaves a real basis behind, and a close there would
            // need a second redeem the same crunch would refuse; the next full call closes the round.
            // While the crunch holds, the pool may sit under the floor, which bounds what a deposit in
            // that window mints to one crunch's worth of overshoot.
            if (got + REDEEM_DUST >= corpus) _closeRoundIfPriceCollapsed(); // dust → `roundResidue`, swept below
        }

        // Sweep the residue of closed rounds (corpus already out of the position) into the same delivery.
        // Effect before the send (CEI): a re-entrant call from the sink finds the counter at zero. Booked
        // in `_totalDeployedByTarget` here, at departure, inside `CorpusReleased`'s amount.
        uint256 residue = roundResidue;
        if (residue != 0) {
            roundResidue = 0;
            _totalDeployedByTarget += residue;
        }
        amount = got + residue;
        if (amount == 0) return 0;

        // Force-send: a community sink that rejects ETH must not make its own corpus unreleasable.
        SafeTransferLib.forceSafeTransferETH(payout, amount);
        emit CorpusReleased(payout, amount);
        return amount;
    }

    // ┌─────────────────────────┐
    // │   Stat surface          │
    // └─────────────────────────┘

    /// @notice Live principal across all benefactors — the basis still in the Aave position.
    function totalPrincipalLocked() external view returns (uint256) {
        return totalPrincipal;
    }

    /// @notice Monotonic sum of all principal ever committed to this vault.
    function totalPrincipalCommittedAllTime() external view returns (uint256) {
        return _totalPrincipalCommittedAllTime;
    }

    /// @notice Sum of principal moved out of the VAULT on the target's behalf: `execute`,
    ///         `releaseCorpusToCommunity` (corpus and swept residue alike) and `flushRoundResidue`. Every
    ///         booking is made at a departure, under its departure event; a round close books nothing, because
    ///         the residue it redeems is still in the vault.
    function totalDeployedByTarget() external view returns (uint256) {
        return _totalDeployedByTarget;
    }

    /// @notice Cumulative creator-leg yield the per-benefactor accumulator actually took on — the wei it
    ///         can pay out, not the wei the 80/19/1 split cut. The two differ by `creatorYieldRemainder`,
    ///         the part no harvest has yet been able to express per-share; that is still creator money and
    ///         is booked here on the harvest that credits it.
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

    /// @notice A benefactor's live principal: their share of the pooled corpus. Falls in proportion to
    ///         every withdrawal, because the ETH behind it is gone.
    function principalOf(address benefactor) public view returns (uint256) {
        if (fundingRoundOf[benefactor] != fundingRound) return 0;
        uint256 shares = totalPrincipalShares;
        if (shares == 0) return 0;
        return (principalShares[benefactor] * totalPrincipal) / shares;
    }

    /// @notice A benefactor's total claimable creator yield in native ETH: already-settled purse plus the
    ///         live-unsettled accrual on their current weight.
    function pendingYieldOf(address benefactor) external view returns (uint256) {
        return _claimable(benefactor);
    }

    /// @dev Total claimable creator yield = settled purse + live-unsettled accrual at current weight.
    function _claimable(address benefactor) internal view returns (uint256) {
        uint256 accumulated = (principalShares[benefactor] * _accFor(benefactor)) / ACC_PRECISION;
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

    /// @notice Whether this vault is operationally wired (parity with the LP vaults).
    /// @dev The endowment needs no pool key or DEX wiring: the Aave stataToken position is set at
    ///      initialize. Always ready.
    function isLiquidityReady() external pure returns (bool) {
        return true;
    }

    /// @inheritdoc IAlignmentVault
    function description() external pure override returns (string memory) {
        return "Per-target endowment: permanent creator donations in Aave; yield 80/19/1.";
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Endowment semantics: returns the harvestable yield still IN the Aave position (a preview),
    ///      NOT withdrawn ETH. Realized only by `harvest()`.
    function accumulatedFees() external view override returns (uint256) {
        return _pendingYield();
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Not tradable shares — the live principal basis still in the position.
    function totalShares() external view override returns (uint256) {
        return totalPrincipal;
    }

    /// @inheritdoc IAlignmentVault
    /// @dev A benefactor's live principal. Permanent — it never returns to them, and it falls only when
    ///      the target withdraws it.
    function getBenefactorContribution(address benefactor) external view override returns (uint256) {
        return principalOf(benefactor);
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Not tradable shares — the benefactor's live principal, in wei.
    function getBenefactorShares(address benefactor) external view override returns (uint256) {
        return principalOf(benefactor);
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
