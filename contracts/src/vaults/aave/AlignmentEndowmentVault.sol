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
 * @notice The Aave endowment vault. One impl, clone-deployed PER alignment target by
 *         `AlignmentEndowmentVaultFactory`. N benefactors (aligned collections) pool their pledged
 *         principal into ONE Aave `StaticATokenV2` position per target.
 *
 * @dev Money model. The rules below are the law:
 *
 *      - **Principal is a PERMANENT donation.** There is NO refund path — a benefactor's pledged
 *        principal never returns to them. It is committed to the alignment target forever.
 *      - **One principal balance.** Principal sits in a single pooled bucket (`totalPrincipal`) from
 *        the moment it arrives. There is no escrow class, no vested class, no clock and no state
 *        transition between them: a slice stops earning only when it is PHYSICALLY WITHDRAWN from the
 *        Aave position, because the ETH is gone — not because a flag flipped or a calendar matured.
 *      - **Yield split (flat, every harvest):** 80 creator / 19 target / 1 protocol, on whatever
 *        principal is in the position at that moment — the same split every LP family takes. Hard bps
 *        constants, no setter (the ratio is sacred). The creator leg flows through a per-benefactor
 *        MasterChef accumulator (`accCreatorYieldPerShare` + `rewardDebt`) and is pulled via
 *        `claimYieldPurse()`. Target leg → the registry's community payout for `targetId`, resolved at
 *        send time (native ETH). Protocol leg → `protocolTreasury`.
 *      - **Ambassador assignment is eligibility to WITHDRAW, not withdrawal.** It gates `execute`
 *        (below) and nothing else; it never gates the yield split, which runs flat from the first
 *        deposit whether or not the target has a seated ambassador yet.
 *      - **A withdrawal is pooled, so it lands pro-rata.** `execute` and `releaseCorpusToCommunity`
 *        debit `totalPrincipal` only. A benefactor's principal is their SHARE of that pool
 *        (`principalShares[b] · totalPrincipal / totalPrincipalShares`), so ETH leaving the position
 *        shrinks every benefactor's live principal in proportion, and with it their weight in every
 *        later harvest. No per-benefactor bookkeeping runs at withdraw time, which is what keeps the
 *        withdraw path O(1) against an unbounded benefactor set.
 *      - **Impairment socialization** (pro-rata-on-shortfall) falls out of the same pooling: one
 *        bucket, one basis, so a position worth less than its basis is written down once and every
 *        benefactor's share of it moves together. The write-down runs on every path that reads or
 *        moves the basis, `execute` and deposit included, so a basis never outlives its ETH.
 *      - **A round close is a withdrawal.** When a withdrawal leaves the pool priced under the share
 *        floor the round ends, and the residual principal is REDEEMED OUT of the position into
 *        `roundResidue` before the basis is zeroed — `totalPrincipal == 0` with ETH still in the
 *        position is unreachable. That residue is still corpus: the curated target's sink collects it
 *        through `flushRoundResidue`, and after de-curation `releaseCorpusToCommunity` sweeps it to
 *        the community with everything else.
 *      - **migratePosition** is an Aave-reserve-deprecation emergency that preserves per-benefactor
 *        accounting ON-CHAIN (no off-chain reconcile).
 *
 *      Clone-compatible (EIP-1167): initialized via `initialize()`, owned by the factory. The legacy
 *      tradable-share / delegation methods of `IAlignmentVault` revert `NotSupported` (an endowment has
 *      no tradable shares); the endowment claim path is `claimYieldPurse()`.
 *
 *      NOTE (audit): this is a fund-holding money-core, and the trust story changed with the collapse
 *      above. It used to be that a benefactor's principal was protected FOR A TIME by the vesting
 *      calendar — nothing could withdraw it for 26 weeks, whoever held the ambassador seat. Nothing here
 *      replaces that. The whole withdraw gate is now two live registry reads inside `execute` — is
 *      `msg.sender` a seated ambassador for `targetId`, and is `targetId` still curated — so the
 *      protection a benefactor has is the quality of the appointment and of the curation decision, both
 *      made before the money is exposed. Re-audit required before any deploy, and the governance around
 *      ambassador assignment is part of what must be audited: it is the only gate left.
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
    ///      its WETH) nor itself. The value-bound alone does not bind the position: a call routed through
    ///      `data` could move the stataToken shares out without debiting `totalPrincipal`, desyncing the
    ///      yield basis and leaving the creator purses and accrued target fees this vault holds unbacked.
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
    /// @dev Sacred protocol cut — exactly 1% of all yield. Hard, no setter.
    uint256 internal constant PROTOCOL_BPS = 100; // 1%
    /// @dev Target (community) cut — 19%. The creator takes the remainder, 80%. Same weights the LP
    ///      families split on, and they do not vary with anything.
    uint256 internal constant TARGET_BPS = 1_900; // 19%

    /// @dev Fixed-point precision for the per-benefactor yield accumulator (MasterChef-style).
    uint256 internal constant ACC_PRECISION = 1e18;

    /// @dev A redemption short of the request by ≤ REDEEM_DUST is absorbed as ERC-4626 floor-rounding;
    ///      a larger shortfall is treated as an Aave liquidity event and reverts so the caller can retry
    ///      once liquidity returns (rather than clearing accounting for funds we could not recover).
    uint256 internal constant REDEEM_DUST = 1e6; // wei

    /// @dev The floor under the pool's price per share, as a reciprocal: a round ends once its principal
    ///      has fallen below `1 / MIN_SHARE_PRICE_INVERSE` of its share count. Shares are minted at that
    ///      price (`amount · shares / principal`), so a pool withdrawn down to a sliver would mint a
    ///      correspondingly enormous number of shares to the next depositor — correct arithmetic, but
    ///      repeated it compounds until `amount · shares` overflows and intake is bricked for good. Ending
    ///      the round instead keeps the price in [1e-9, 1], which bounds the share count at
    ///      `Σ deposits · 1e9` and puts every product here far inside uint256. The floor is an OVERFLOW
    ///      bound and nothing else: what a close does with the principal left in the pool is
    ///      `_closeRoundIfPriceCollapsed`'s business, and that residue is NOT small — at a floor-priced pool
    ///      it is the whole of the last deposit (bounded by `shares / 1e9 ≤ Σ deposits`, not by 1e-9 of
    ///      anything), so it is withdrawn as corpus, never left behind to be read as yield.
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
    /// @notice Target-leg yield (native ETH wei) held by the vault because `_targetSink()` was unset at
    ///         crystallize time. Delivered by the permissionless `flushTargetFees()` once a sink exists.
    uint256 public accumulatedTargetFees;
    /// @notice Corpus that a round close redeemed OUT of the Aave position and that the vault now holds as
    ///         native ETH, awaiting delivery (see `_closeRoundIfPriceCollapsed`). This is principal that has
    ///         physically left the position but not yet left the vault: it is in no benefactor's
    ///         `principalOf`, not in `totalPrincipal`, not in `currentPositionValue()`, and not deployable.
    ///         While the target is curated `flushRoundResidue()` delivers it to `_targetSink()`; once
    ///         de-curated only `releaseCorpusToCommunity()` reaches it, and sweeps it with the corpus.
    ///
    ///         It is deliberately NOT folded into `accumulatedTargetFees`, and the reason is narrower than
    ///         "different owners": both counters are delivered to `_targetSink()`, the registry's
    ///         `getCommunityPayout(targetId)`, curated or not — `flushTargetFees`, `flushRoundResidue` and the
    ///         release sweep all pay the SAME address. What the split buys is two things. (i) A gate:
    ///         `flushRoundResidue` reverts `TargetDecurated`, so once a target is de-curated nobody delivers
    ///         its residual corpus except `releaseCorpusToCommunity`, in one send with the corpus still in the
    ///         position — one exit for all of a de-curated target's corpus, not two. `flushTargetFees` has no
    ///         such gate, because the yield leg is the target's on any day. (ii) Two distinguishable departure
    ///         sites: the residue is booked in `totalDeployedByTarget` when it leaves, under
    ///         `RoundResidueFlushed` or `CorpusReleased`, and a fee flush books nothing there. Fold the two
    ///         counters together and both are lost — the fee flush would carry corpus past the gate, and the
    ///         corpus would leave under a fee event, unbooked.
    uint256 public roundResidue;

    /// @notice Which funding round the pool is on. A corpus that is spent to the last wei and then
    ///         re-funded starts a new round, because the old shares have no principal left behind them and
    ///         must not price (or dilute) the new money. This is bookkeeping and nothing else: it is not an
    ///         eligibility state, it gates no withdrawal, and it changes nothing about when principal earns.
    ///         The only thing a round boundary does is retire spent shares — lazily, at each benefactor's
    ///         next touch, against the accumulator value frozen in `_accAtRoundEnd`, so no already-earned
    ///         creator yield is lost when it happens.
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
        // The target sink is NOT seeded here. It lives in one place — the alignment registry — and is read
        // live on every send (`_targetSink`). Until the registry pins one the target leg accrues into
        // `accumulatedTargetFees`, and `flushTargetFees()` delivers it once a sink exists.

        // One-time max approval: the vault is the sole holder of its WETH, deposited each intake into
        // the stataToken. Cheaper + cleaner than re-approving per deposit.
        IWETH(_weth).approve(_stataToken, type(uint256).max);
    }

    // ┌─────────────────────────┐
    // │   Intake (deposit)      │
    // └─────────────────────────┘

    /// @inheritdoc IAlignmentVault
    /// @dev Native ETH only (`currency` must be the zero Currency); `msg.value == amount`. Wraps to
    ///      WETH and supplies the stataToken, crediting `benefactor`'s permanent principal. Open +
    ///      guarded (matches the reference vault): there is no tradable-share surface to inflate, so no
    ///      caller gate is required. `benefactor` MUST be a contract — the yield-claim path reads
    ///      `IOwnable(benefactor).owner()`, so crediting a codeless address would strand it.
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
        // Harvest-first: crystallize any not-yet-harvested Aave yield BEFORE this deposit grows the
        // accumulator weight / inflates the position. Otherwise the next harvest apportions yield the
        // existing benefactors earned during their exclusive window at the POST-join weight, letting the
        // new depositor capture a share of pre-join yield (dilution). Must run before `weth.deposit`/
        // `stataToken.deposit` so `_pendingYield` reads the pre-deposit position value against the
        // pre-deposit basis. `receiveContribution` (the only caller) is `nonReentrant`, so the external
        // `_redeem` + force-sends here cannot be re-entered.
        _crystallizeYield();
        // Write an impaired basis down BEFORE pricing the new shares against it, so a newcomer buys in at
        // what the position actually holds and the loss stays with the shares that held it. Same policy as
        // `migratePosition` / `releaseCorpusToCommunity` / `execute`: once written down, a later Aave
        // recovery is split 80/19/1 as yield, not restored as principal.
        _realizeImpairment();

        // Refuse to mint against a pool that is under the share floor with principal still in it. That is a
        // round whose close is OWED and has not run: `_closeRoundIfPriceCollapsed` runs after every
        // withdrawal, so the only way to stand here is a withdrawal that debited the basis and skipped the
        // close — and there is exactly one: `releaseCorpusToCommunity` on a PARTIAL redeem, which skips it
        // because the close would need a second redeem the same crunch refuses. (`execute` has no partial
        // path; a full release closes on the same call. An Aave impairment deeper than 1 − 1e-9 of the
        // position would write the basis down to the same state, and the same execute or release closes it.)
        // Pricing this deposit at `amount · shares / principal` in that state mints past the `Σ · 1e9` bound
        // the floor exists to hold — measured: 1e39, 1e51, 1e63 shares on three crunch-and-deposit cycles,
        // and the fourth deposit dies in `amount · shares` with an unnamed 0x11 panic, while `principalOf`
        // for the 1e63-share holder overflows too. A named revert that heals when liquidity returns beats an
        // overflow that never does.
        //
        // This is NOT the bound-at-mint that `_closeRoundIfPriceCollapsed` refuses at (2), though it is the
        // same shape — a revert on permissionless intake — so the difference is stated here for the next
        // reader: that bound was refused because an AMBASSADOR could create the reverting state with one
        // `execute` down to 1 wei, permanently and at will, and the settlement paths' try/catch would let
        // mints clear while the 19% leg silently stopped arriving. The ambassador cannot create THIS state:
        // `execute` closes on the same call or reverts whole, and `execute` is frozen on a de-curated target
        // besides. It takes three things at once — (i) a de-curated target, since the release is the only
        // partial path; (ii) a crunch that holds Aave's available WETH short of the corpus by more than
        // `REDEEM_DUST` at each release; (iii) a direct `receiveContribution` caller, since the instances route
        // the tithe to `protocolTreasury` once the registry reports the target de-curated — and it ends with
        // the crunch: the next full release closes the round and the deposit after it opens a fresh one at
        // 1:1. The intake this refuses is a transient one on a de-curated target, and the instances'
        // `pendingVaultCut` retry lane already treats a transient intake revert as safe; the alternative is
        // an intake bricked for good.
        if (totalPrincipal != 0 && totalPrincipal * MIN_SHARE_PRICE_INVERSE < totalPrincipalShares) {
            revert RoundClosePending();
        }

        weth.deposit{ value: amount }(); // approval is set once in initialize
        stataToken.deposit(amount, address(this));

        // Re-funding a corpus that was spent to the last wei opens a new share round. The outstanding
        // shares have no principal behind them (the pool is empty, so `principalOf` is 0 for every one of
        // them); pricing this deposit against them would hand the new benefactor a sliver of a pool they
        // fund entirely. Freeze the accumulator for the closing round so the shares it is retiring can
        // still be settled in full, then start the weight from zero.
        if (totalPrincipal == 0 && totalPrincipalShares != 0) {
            _accAtRoundEnd[fundingRound] = accCreatorYieldPerShare;
            unchecked {
                ++fundingRound;
            }
            totalPrincipalShares = 0;
            emit FundingRoundOpened(fundingRound, block.timestamp);
        }

        // Settle the benefactor's accrued creator yield at their OLD weight (and retire it if it belongs
        // to a closed round), then mint the new weight and re-baseline `rewardDebt` so the new principal
        // earns only future yield.
        _settle(benefactor);

        // Price the new shares off the pool: `amount · shares / principal`. On an untouched pool that is
        // 1:1; after a withdrawal the pool is worth less per share, so the same ETH buys more shares —
        // which is what keeps a later benefactor's weight proportional to what they actually put in.
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

    /// @dev The harvest body, factored out so an internal caller can crystallize pending yield WITHOUT the
    ///      external re-entry that `this.harvest()` would incur — the entrypoints are all `nonReentrant`,
    ///      so a self-external call would trip the guard and revert. This books not-yet-harvested yield
    ///      into the 80/19/1 legs BEFORE any call that moves principal, so that yield is split (not swept
    ///      out with the principal). Only the `nonReentrant`-guarded external entrypoints call this; it
    ///      performs external ETH sends itself and MUST NOT be invoked from an unguarded path.
    function _crystallizeYield() internal {
        uint256 y = _pendingYield();
        if (y == 0) return;

        // `y > 0` implies position value > principal basis, which requires basis > 0 (value is 0 with no
        // shares). Guard defensively anyway.
        if (totalPrincipal == 0) return;

        uint256 got = _redeem(y);
        if (got == 0) return;

        // The flat split, on whatever principal is in the position right now (remainder-safe: the creator
        // leg absorbs the rounding dust).
        uint256 protocolLeg = (got * PROTOCOL_BPS) / BPS;
        uint256 targetLeg = (got * TARGET_BPS) / BPS;
        uint256 creatorLeg = got - protocolLeg - targetLeg;

        // Creator leg → per-benefactor accumulator. There is principal in the position (checked above), so
        // there is weight behind it; the guard protects the division.
        if (creatorLeg > 0 && totalPrincipalShares > 0) {
            accCreatorYieldPerShare += (creatorLeg * ACC_PRECISION) / totalPrincipalShares;
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
                // the first statement of deposit, harvest and execute, so a revert here would close all
                // three; accruing keeps them open and `flushTargetFees()` delivers the leg once a sink
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

    /// @dev Where this clone's target leg is owed, resolved at SEND time, from the alignment registry's
    ///      `getCommunityPayout(targetId)` and NOWHERE else — the same single read the three LP vault
    ///      families already do.
    ///
    ///      This clone deliberately keeps no copy of the answer. It used to hold an owner-writable
    ///      fallback, consulted whenever the registry's answer was zero, and that fallback was a live
    ///      owner redirect wearing a fallback's clothes: the registry's payout is pinned by `onlyOwner`
    ///      `setCommunityPayout`, so the owner also decides whether it is ever pinned at all. An owner who
    ///      simply never pinned it kept the registry's answer at zero forever, and with it a sink they
    ///      could re-point at will through the factory — while the community, having no pinned payout,
    ///      had nothing to rotate and no way to pin one for itself. The write-once pin and payee-only
    ///      `rotateCommunityPayout` in the registry only bind if this is the only address consulted.
    ///
    ///      Zero is therefore an honest answer, not a hole to paper over: it means no community sink
    ///      exists yet. The target leg accrues in `accumulatedTargetFees` and the corpus waits, both
    ///      delivered in full once the registry pins a sink, and neither reachable by anyone else in the
    ///      meantime.
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
    ///      `1 / MIN_SHARE_PRICE_INVERSE` of its share count — see that constant. A close is a WITHDRAWAL:
    ///      the residual principal is redeemed out of the Aave position into the vault's own native balance
    ///      and booked in `roundResidue`, and only then is the basis zeroed. That keeps the one invariant
    ///      this function exists to hold: `totalPrincipal == 0` while ETH is still in the position is
    ///      unreachable (up to `REDEEM_DUST` of ERC-4626 rounding). Zeroing the basis with the ETH still
    ///      in Aave would leave the residue as position-value-above-basis, which the next harvest would
    ///      split as yield — 80% of it to whoever opens the next round — and at a floor-priced pool that
    ///      residue is the whole of the last deposit, not a sliver.
    ///
    ///      Why the residue is redeemed rather than the deposit bounded (REFUSED on the record, so it is
    ///      not rediscovered as the clean idea):
    ///        (1) any bound at mint is a new revert on a permissionless intake, and `receiveContribution`
    ///            is the settlement leg of every mint on the platform;
    ///        (2) REFUSING a deposit that would mint past `Σ · 1e9` shares lets one ambassador `execute`
    ///            down to 1 wei and starve intake for good — and the settlement paths wrap the vault cut in
    ///            try/catch, so mints keep clearing while the 19% leg silently stops arriving;
    ///        (3) CAPPING the mint instead under-weights the newcomer, so shares whose ETH was physically
    ///            withdrawn take a slice of the new deposit every cycle: ghost basis made routine, growing
    ///            with each drain-and-refund.
    ///
    ///      Where this sits in checks-effects-interactions: it is called from `execute` and
    ///      `releaseCorpusToCommunity` AFTER the withdrawal's own redeem and basis debit, and BEFORE the
    ///      arbitrary external call (`execute`) / the force-send (`release`). The only external calls it
    ///      makes are the redeem against the TRUSTED stataToken / WETH (`receive()` takes the unwrap
    ///      inertly); no ETH leaves the vault here and no untrusted address is called, so a hostile or
    ///      absent sink is never in this path. Delivery is the fee-flush shape — `flushRoundResidue`
    ///      while curated, `releaseCorpusToCommunity` after — each `nonReentrant`, counter-zeroed-before-
    ///      send, force-safe. The share state is untouched: the old shares stay outstanding and are
    ///      retired lazily against `_accAtRoundEnd` when the next deposit opens a round, exactly as a
    ///      drain-to-zero closes one; the accumulator is frozen at that deposit, not here, and every
    ///      harvest that ran on these shares was crystallized before the closing withdrawal debited them.
    ///
    ///      A redeem short by more than `REDEEM_DUST` is an Aave liquidity event and reverts, the same
    ///      rule the caller's own redeem is under — the close is part of that withdrawal and does not
    ///      partially settle either.
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
        // NOT booked in `_totalDeployedByTarget` here. Both existing bookings (`execute`, release) are made
        // against a DEPARTURE from the vault, with `CapitalDeployed` / `CorpusReleased` as the event that tells
        // the doors apart; the residue has left the position but not the vault, and which door it leaves by
        // is not yet decided. `flushRoundResidue` and the release sweep book it when it actually departs.
        roundResidue += got;
        totalPrincipal = 0;
        emit RoundResidueAccrued(fundingRound, got, roundResidue);
    }

    /// @dev Write the principal basis down to what the position can actually realize, if it is impaired.
    ///      Leaving a nominal basis above the position's value lets `deployableCorpus()` promise ETH the
    ///      redeem cannot deliver, so the withdraw passes its bound and then hits `RedeemShortfall`,
    ///      stranding the residual permanently. One bucket, so the write-down lands on every benefactor's
    ///      share of it at once — that IS the socialization, there is nothing to apportion between classes.
    ///
    ///      Runs on every path that reads or moves the basis — `migratePosition`, `releaseCorpusToCommunity`,
    ///      `execute` and `_deposit` — so the basis never outlives the ETH behind it. Leaving `execute` out
    ///      let an ambassador drain an impaired position to nothing and leave the lost half standing as a
    ///      GHOST BASIS: the emptied shares kept their weight, the next depositor bought in against a basis
    ///      the position did not hold, and harvest was dead until the new money had doubled. The policy is
    ///      the one migrate and release already applied and is stated, not argued: once written down, a
    ///      later Aave recovery is split 80/19/1 as YIELD, not restored as principal.
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
    ///         `roundResidue` is NOT swept here. It is corpus already out of the Aave position, so the
    ///         reserve deprecation this call answers does not touch it, and it keeps both of its doors after
    ///         a migrate: `flushRoundResidue` while the target is curated, `releaseCorpusToCommunity` after.
    ///         Nor does the `NoPrincipal` check below strand it: with the basis at 0 and a residue still
    ///         held, this call reverts, and the residue is untouched by that revert — both doors reach it
    ///         exactly as before, since neither reads `totalPrincipal` or `migrated`. Widening this owner
    ///         call to reach it is a question of owner power, left as built.
    function migratePosition(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (totalPrincipal == 0) revert NoPrincipal();

        // Harvest-first: crystallize any not-yet-harvested Aave yield into the 80/19/1 legs BEFORE
        // redeeming principal. Otherwise the pending yield — which the split law routes 80% creator /
        // 19% target / 1% protocol — would be redeemed with the principal and force-sent to the recovery
        // address `to`, misdirecting it out of the accumulator legs. Inlined (not `this.harvest()`)
        // because both functions are `nonReentrant`.
        _crystallizeYield();
        _realizeImpairment();

        uint256 amount = totalPrincipal;
        uint256 got = _redeem(amount);
        if (got + REDEEM_DUST < amount) revert RedeemShortfall();

        // Zero the BASIS and decommission the vault. The principal has left the Aave position (relocated
        // to `to`/the new venue), so leaving `totalPrincipal` as a live basis would make `_pendingYield`
        // see basis > position value and return ~0 forever (harvest bricks). Zeroing the basis + closing
        // intake via the `migrated` flag keeps harvest/execute self-consistent. Per-benefactor share
        // entries are frozen-inert (a mapping cannot be iterated to zero each); the on-chain ledger + the
        // `Migrated` event remain the record for reconstructing each benefactor's stake at the new venue.
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
    /// @dev    The base figure is the principal basis (`totalPrincipal`), tracked 1:1 in WETH (== ETH). On
    ///         the UPSIDE it is deliberately NOT the live position value: any value above the principal
    ///         basis is UNHARVESTED yield, which belongs to the yield legs (80/19/1, realized by
    ///         `harvest()`), NOT to the deployable principal corpus. Deployment is principal-corpus only,
    ///         so the bound is the principal, keeping the protocol's 1% yield leg out of reach of
    ///         `execute`.
    ///
    ///         On the DOWNSIDE the nominal basis is not fully redeemable, so the figure is clamped to the
    ///         live position value. Reporting the nominal basis while the position is impaired lets
    ///         `execute(nominal)` pass the `ExceedsDeployableCorpus` bound and then hit `RedeemShortfall`,
    ///         stranding the residual — the failure `_realizeImpairment`'s write-down describes. The clamp
    ///         is a strict no-op on a healthy position, so it moves no value between benefactors: this is
    ///         an ACCOUNTING bound on what the position can actually redeem.
    ///
    ///         Being a view it holds no state to re-apply, so it is idempotent by construction: repeated
    ///         reads — and any number of intervening `harvest()` calls — return the same answer at an
    ///         unchanged position value.
    function deployableCorpus() public view returns (uint256) {
        uint256 basis = totalPrincipal;
        if (basis == 0) return 0;
        uint256 value = _stataValue();
        return value < basis ? value : basis;
    }

    /// @notice Target-sovereign deployment of corpus capital. The alignment target — acting through any of
    ///         its ambassadors — may deploy up to `deployableCorpus()` with an ARBITRARY external call:
    ///         any `to`, any `value` (≤ corpus), any `data`. No whitelist, no creator/owner approval, no
    ///         forbidden actions (withdraw-to-EOA is `execute(eoa, amount, "")`). The tithe is freely
    ///         given; the target is sovereign over it — for as long as the protocol curates it.
    ///
    ///         THE LIMIT OF THE BACKSTOPS, stated plainly because it changed. Two registry-side controls
    ///         answer a rogue ambassador: `removeAmbassador`, which unseats one address, and
    ///         `deactivateAlignmentTarget`, which freezes every seat at once and routes the remaining
    ///         corpus to `releaseCorpusToCommunity` instead. Both bound only what has NOT YET LEFT this
    ///         vault, and after the collapse to one principal balance that set can be EMPTY one block
    ///         after a deposit lands: every wei is deployable the moment it arrives. Under the 26-week
    ///         calendar these controls carried an implicit response window — principal younger than the
    ///         clock could not be taken while the owner reacted — and that window is gone with it. What
    ///         remains is not a guarantee of time; it is the ability to stop the NEXT withdrawal, and
    ///         nothing about the one already made. So the protection this vault actually offers a
    ///         benefactor is the appointment itself: who is seated, and whether the target is still
    ///         curated, decided before the money is exposed rather than after.
    /// @dev    Auth resolves LIVE against the canonical alignment registry
    ///         (`masterRegistry.alignmentRegistry().isAmbassador(targetId, msg.sender)`) so a platform
    ///         re-point of the alignment registry is honored and there is no stale-cache risk. Strict
    ///         checks-effects-interactions + `nonReentrant`: the corpus is decremented and the redeem is
    ///         settled BEFORE the arbitrary external call, so a malicious `to` re-entering `execute` cannot
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
        // Harvest-first: crystallize any not-yet-harvested Aave yield BEFORE this deploy redeems principal
        // / shrinks the corpus. Two defects this closes: (1) the yield earned while the principal was
        // still in the position would otherwise be apportioned at the post-deploy weight, moving it
        // between benefactors; (2) permanent strand — draining the LAST principal (`totalPrincipal → 0`)
        // would trap all pending yield behind `_crystallizeYield`'s `totalPrincipal == 0` guard;
        // crystallizing while principal remains realizes it first. Runs before the auth read; its
        // force-sends precede the arbitrary external call, so CEI holds. Inlined (not `this.harvest()`)
        // because both are `nonReentrant`.
        _crystallizeYield();
        // Write an impaired basis down BEFORE the deploy debits it, on the same law as `migratePosition`
        // and `releaseCorpusToCommunity`. Without this a deploy that empties an impaired position leaves the
        // lost half as a ghost basis that keeps earning on the next depositor's money.
        _realizeImpairment();

        IAlignmentRegistry ar = masterRegistry.alignmentRegistry();
        if (!ar.isAmbassador(targetId, msg.sender)) revert NotAuthorized();
        // De-curation freezes the seat's spending power. The ambassador seat is an appointment made
        // BECAUSE the protocol curates the target; withdrawing the curation withdraws the discretion that
        // came with it, and it does so for every ambassador at once rather than requiring the owner to
        // race a rogue key through `removeAmbassador` one address at a time. What the target already
        // deployed stays the target's to operate — that capital has left this vault. What has not left
        // is no longer spendable by arbitrary call; `releaseCorpusToCommunity()` is its exit instead.
        if (!ar.isAlignmentTargetActive(targetId)) revert TargetDecurated();

        // The `value` bound alone does NOT bind the position — an ambassador could pass `value = 0`
        // (trivially ≤ corpus) and route through `data` to make the vault call `transfer`/`withdraw`/
        // `approve` on its OWN principal-bearing tokens, moving principal out with no debit to
        // `totalPrincipal`. That desyncs the yield basis and leaves the native ETH this vault holds for
        // other people — the creator purses, `accumulatedTargetFees` and `roundResidue` — unbacked. Deny
        // the vault's principal-bearing targets (its stataToken position and the WETH it holds an unbounded
        // approval on) and itself. Legit value-only deployment to any OTHER `to` (incl. an EOA) is unaffected.
        //
        // This three-entry denylist is sufficient for the contract AS WRITTEN, and only conditionally so:
        // its sufficiency rests on three invariants that live outside it, and a denylist that looks
        // self-evidently complete is exactly how the next change removes an entry or leaves one out. A
        // change that breaks any of these reopens the audited routes the denylist closes, and must be
        // reviewed as such:
        //   (a) the vault never grants a token approval other than WETH → stataToken (set once in
        //       `initialize`), so no `transferFrom` on a third contract can reach the position through
        //       `data`;
        //   (b) the stataToken never gains a contract-signature (EIP-1271) permit path — StaticATokenV2's
        //       permit is ECDSA-only and this vault has no `isValidSignature`, so `data` cannot mint a
        //       permit that lets `to` pull the position later;
        //   (c) no registry or factory ever trusts msg.sender-is-a-vault, so a call this vault is made to
        //       place cannot exercise a privilege the vault holds elsewhere.
        if (to == address(stataToken) || to == address(weth) || to == address(this)) {
            revert ForbiddenExecuteTarget();
        }

        if (value > deployableCorpus()) revert ExceedsDeployableCorpus();

        // Redeem the requested value to native ETH. `value ≤ position value`, so `maxWithdraw` covers it.
        // ERC-4626 floor-rounding can leave the redeem short by up to `REDEEM_DUST` (`got = value − dust`);
        // a larger shortfall is an Aave liquidity event → revert (do not partial-deploy). This is a redeem
        // from the TRUSTED stataToken/WETH (which `receive()` handles inertly), not the arbitrary `to` —
        // so it runs before the effects without CEI risk; the arbitrary external call remains strictly
        // last.
        uint256 got = _redeem(value);
        if (got + REDEEM_DUST < value) revert RedeemShortfall();

        // ── Effects (before the arbitrary external call) ──
        // Debit the corpus by `got` — what ACTUALLY left the position — not the requested `value`. The
        // dust (`value − got`) stays in the corpus as still-deployable principal; debiting `value` would
        // instead orphan it into position-value-above-basis, leaking that sliver of principal into the
        // next harvest's yield legs. `deployableCorpus()` clamps to the position value on an impaired
        // position, so it can be strictly LESS than the nominal basis; the chain that matters here is
        // `got ≤ value ≤ deployableCorpus() ≤ totalPrincipal`, so no underflow.
        //
        // No per-benefactor bookkeeping runs here, and that is the design: the debit lowers the pool's
        // price per share, so every benefactor's `principalOf` — and their weight in every later harvest —
        // falls in proportion to what left. A slice stops earning because its ETH is gone.
        totalPrincipal -= got;
        _totalDeployedByTarget += got;
        _closeRoundIfPriceCollapsed();

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

    /// @notice Deliver a DE-CURATED target's remaining corpus to that community's payout sink.
    /// @dev    The companion to the `execute` freeze, and the reason the freeze does not strand what is
    ///         still here. `migratePosition` is an owner emergency and not a route the community can ask
    ///         for, so once `execute` is closed the remaining corpus would otherwise have no way out, and
    ///         de-curation is one-way — `AlignmentRegistryV1` has no reactivate path — so without this it
    ///         would sit in the Aave position for the life of the contract. What this exit reaches is only
    ///         what has NOT been withdrawn: an ambassador who spent the corpus before de-curation left
    ///         nothing here for it to deliver, and this call is not a clawback.
    ///
    ///         Permissionless, and non-discretionary in both arguments it does not take: the amount is the
    ///         whole corpus and the destination is always `_targetSink()` (the registry's
    ///         `getCommunityPayout(targetId)`, and nothing else), never caller-supplied. That is what makes
    ///         it safe to leave open to anyone — it is a delivery, not a spend, so it hands a de-curated
    ///         ambassador nothing they did not already have. Reverts `CommunityPayoutNotSet` while no sink
    ///         is wired; the corpus keeps waiting, and `AlignmentRegistryV1.setCommunityPayout`
    ///         deliberately stays callable on an inactive target so the sink can still be wired after the
    ///         fact.
    ///
    ///         Impairment is realized on the same law as `migratePosition`: on a position worth less than
    ///         its principal basis the basis is WRITTEN DOWN to its realizable value before the redeem.
    ///         The write-down is what makes one call enough — leaving the nominal basis in place would
    ///         leave an unbacked residual behind that every later call could only chip at. A LIQUIDITY
    ///         shortfall is the one thing that can make it take more than one call: the redeem delivers
    ///         what Aave has and the rest waits, still basis, for the next call — this exit never reverts on
    ///         a crunch, because a de-curated corpus must always have a way out.
    ///
    ///         The delivery SWEEPS `roundResidue` along with the corpus. Residue is corpus that a round
    ///         close already redeemed out of the position; on a de-curated target it belongs to the
    ///         community exactly as the corpus still in the position does, and this is the only path that
    ///         reaches it once `flushRoundResidue` is closed by de-curation. Nothing of a de-curated
    ///         target's corpus, in the position or out of it, is left with a route to the target.
    ///
    ///         The `_closeRoundIfPriceCollapsed` call below is NOT redundant with the drain above it and
    ///         stays. The redeem guard bounds what it can find at `≤ REDEEM_DUST` of basis, but that dust
    ///         basis is exactly the overflow state the floor exists for: with the old share count still
    ///         outstanding, a deposit (intake is open after de-curation) priced against a 1e6-wei basis
    ///         mints `amount · shares / 1e6` shares, and this permissionless release can be repeated to
    ///         compound it until `amount · shares` overflows and intake bricks. The close moves that dust
    ///         into the residue (swept in the same call) and zeroes the basis so the next deposit opens a
    ///         fresh round instead.
    /// @return amount The wei delivered — corpus redeemed here plus the residue swept (0 when both are
    ///         empty).
    function releaseCorpusToCommunity() external nonReentrant returns (uint256 amount) {
        IAlignmentRegistry ar = masterRegistry.alignmentRegistry();
        if (ar.isAlignmentTargetActive(targetId)) revert TargetStillCurated();

        address payout = _targetSink();
        if (payout == address(0)) revert CommunityPayoutNotSet();

        // Harvest-first, for the same two reasons `execute` does it: the yield accrued up to now must be
        // apportioned at the PRE-release weights, and draining the last principal would otherwise trap
        // pending yield behind `_crystallizeYield`'s `totalPrincipal == 0` guard.
        _crystallizeYield();
        _realizeImpairment();

        uint256 corpus = totalPrincipal;
        uint256 got;
        if (corpus != 0) {
            // Take what Aave will give right now. This exit tolerates a PARTIAL where `execute` does not:
            // execute's no-partial rule protects the ambassador's atomicity, but this call is repeatable,
            // permissionless and fixed-destination, so a liquidity crunch must not hold a de-curated
            // target's corpus hostage — it delivers what it can and the remainder stays LIVE basis for the
            // next call, never a revert.
            got = _redeem(corpus);

            // ── Effects before the send (CEI) ──
            // Debit by `got`, as `execute` does: what the redeem could not deliver stays in the position as
            // still-releasable principal rather than leaking into the next harvest's yield legs.
            // `_totalDeployedByTarget` is the "moved out on the target's behalf" counter and this is such a
            // move; `CorpusReleased` against `CapitalDeployed` is what tells the two apart.
            totalPrincipal -= got;
            _totalDeployedByTarget += got;
            // Close only on a full drain. A partial leaves a real basis behind, and a close there would need
            // a second redeem the same crunch would refuse; the next full call closes the round instead.
            // While the crunch holds the pool may sit under the floor — one crunch's worth of overshoot in
            // what a deposit in that window mints, bounded by the next full release.
            if (got + REDEEM_DUST >= corpus) _closeRoundIfPriceCollapsed(); // dust → `roundResidue`, swept below
        }

        // Sweep the residue of closed rounds — corpus already out of the position — into the same delivery.
        // Effect before the send (CEI): a re-entrant call from the sink finds the counter at zero. Booked in
        // `_totalDeployedByTarget` here, at departure, inside `CorpusReleased`'s amount.
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

    /// @notice Whether this vault is operationally wired (O2 gate — parity with the LP vaults).
    /// @dev The endowment needs no pool key or DEX wiring: the Aave stataToken position is set at
    ///      initialize and never requires post-deploy operational config. Always ready.
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
