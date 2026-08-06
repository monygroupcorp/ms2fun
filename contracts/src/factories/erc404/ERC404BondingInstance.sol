// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ERC404BondingStorage,
    RerollFailed,
    TierOpFailed,
    InvalidBand,
    BandIdOverflow,
    NothingToClaim,
    EscrowReleaseFailed,
    BondingEnded,
    BondingNotConfigured,
    TooEarly,
    GatingNotAllowed,
    StakingModuleNotSet,
    FreeMintFailed,
    ClaimFeesFailed,
    WithdrawDustFailed,
    StakeFailed,
    UnstakeFailed,
    ClaimRewardsFailed
} from "./ERC404BondingStorage.sol";
import { LibString } from "solady/utils/LibString.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { SmartTransferLib } from "../../libraries/SmartTransferLib.sol";
import { BondingCurveMath } from "./libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IGlobalMessageRegistry } from "../../registry/interfaces/IGlobalMessageRegistry.sol";
import {
    IInstanceLifecycle,
    TYPE_ERC404,
    STATE_BONDING,
    STATE_PAUSED,
    STATE_GRADUATED
} from "../../interfaces/IInstanceLifecycle.sol";
import { IGatingModule, GatingScope } from "../../gating/IGatingModule.sol";
import { IERC404StakingModule } from "../../interfaces/IERC404StakingModule.sol";
import { SafeResolverLib } from "../../metadata/SafeResolverLib.sol";

// ── Errors ────────────────────────────────────────────────────────────────────
// NOTE (noesis-148): the errors the six externalized value-path bodies revert with —
// `BondingEnded`, `BondingNotConfigured`, `TooEarly`, `GatingNotAllowed`, `FreeMintDisabled`,
// `FreeMintAlreadyClaimed`, `FreeMintExhausted`, `StakingModuleNotSet`, `NothingToWithdraw`,
// `WithdrawFailed` — now live in `ERC404BondingStorage.sol` so BOTH sides compile them, alongside the
// generic per-trampoline errors. The ones this contract still raises itself are imported above.
error AlreadyInitialized();
error AlreadyDeployed();
error BondingNotActive();
error CannotActivateAfterLiquidityDeployed();
error ExceedsBonding();
error InsufficientBalance();
error InvalidGlobalMessageRegistry();
error InvalidLiquidityDeployer();
error InvalidMaxSupply();
error InvalidMirror();
error InvalidOwner();
error InvalidRefund();
error InvalidVault();
error LowETHValue();
error MaturityMustBeAfterOpenTime();
error MaxCostExceeded();
error NoReserve();
error OpenTimeMustBeSetFirst();
error OpenTimeNotSet();
error TimeMustBeInFuture();
error TransactionExpired();
error AmountMustBePositive();
error FreeMintNotInitialized();
error StakingAlreadyActive();
error PurchaseTooSmall();
error OnlyFactory();
error NotInitialized();
error MetadataAlreadySet();
error ModuleAlreadySet();
error InvalidDeclaredMaxAllowance();

/// @notice Read-side of the ERC404Factory's graduation-carve math. The instance reads it LIVE at
///         graduation (not snapshotted at create) so owner-tuned market-regime changes (brackets,
///         pool floor) apply to every future graduation. The bracket/floor math itself lives in the
///         factory (EIP-170 headroom: the DN404 instance has none to spare).
interface ICarveParamsSource {
    function effectiveCarveEth(uint256 raise, uint256 declaredMaxBps, uint256 carveRequestBps)
        external
        view
        returns (uint256);
}

/**
 * @title ERC404BondingInstance
 * @notice AMM-agnostic ERC404 bonding token. Graduation delegates to an ILiquidityDeployerModule.
 */
contract ERC404BondingInstance is ERC404BondingStorage, IInstanceLifecycle {
    // ┌─────────────────────────┐
    // │         Types           │
    // └─────────────────────────┘

    /// @dev Factory-computed from profile + nftCount.
    struct BondingParams {
        uint256 maxSupply;
        uint256 unit;
        uint256 liquidityReserveBps;
        // Creator's immutable disclosure: fraction (bps, <= 10000) of the protocol carve
        // allowance this creator may ever take at graduation.
        uint16 declaredMaxAllowanceBps;
        BondingCurveMath.Params curve;
    }

    /// @dev Factory's own config — protocol-controlled.
    struct ProtocolParams {
        address globalMessageRegistry;
        address protocolTreasury;
        address masterRegistry;
        uint256 bondingFeeBps;
        address weth;
    }

    // ┌─────────────────────────┐
    // │      State Variables    │
    // └─────────────────────────┘
    // ALL instance state lives in the shared `ERC404BondingStorage` base (single source of truth) so
    // `ERC404BondingOps` inherits a byte-identical layout and executes reroll in this instance's storage
    // under delegatecall (noesis-091). Never declare a state var here — put it in the base.

    // Delegatecall target for the externalized reroll body (EIP-170 diet). Immutable: set once in the
    // master constructor, no storage slot, no setter, non-upgradeable (rth 2026-07-22). Because it is
    // immutable it lives in the master's code, so every EIP-1167 clone reads this same shared Ops.
    address internal immutable _ops;

    // ── Events ────────────────────────────────────────────────────────────────
    event BondingSale(address indexed user, uint256 amount, uint256 cost, bool isBuy);
    event BondingOpenTimeSet(uint256 openTime);
    event BondingMaturityTimeSet(uint256 maturityTime);
    event BondingActiveChanged(bool active);
    event LiquidityDeployed(address indexed deployer, uint256 amountToken, uint256 amountETH);
    event BondingFeePaid(address indexed buyer, uint256 feeAmount);
    event AgentDelegationChanged(bool enabled);
    event StakingActivated(address indexed stakingModule);
    event ModuleSet(bytes32 indexed role, address module);

    // `FreeMintClaimed` / `Staked` / `Unstaked` / `StakingRewardsClaimed` moved to
    // `ERC404BondingStorage` (noesis-148): their emitters now run on the Ops side. Same signatures,
    // same topic0 — they are still emitted from THIS instance's address under delegatecall.

    // ┌─────────────────────────┐
    // │      Constructor        │
    // └─────────────────────────┘

    /// @param ops The shared, immutable `ERC404BondingOps` delegatecall target for the externalized
    ///        reroll body. Deployed BEFORE the master and passed here; non-upgradeable (no setter).
    constructor(address ops) {
        _initialized = true;
        _ops = ops;
    }

    // ┌─────────────────────────┐
    // │      Initialize         │
    // └─────────────────────────┘

    /**
     * @notice Initialize a clone instance. Called by factory immediately after cloning.
     * @dev The DN404 mirror is deployed by the CALLER (the factory) and passed in. It used to be
     *      constructed here with `new DN404Mirror(msg.sender)`, but `new` is a CREATE: the whole
     *      3,100B of `DN404Mirror` creation code had to sit inline in THIS contract's runtime
     *      bytecode, and this contract is the EIP-170 subject (every clone is an EIP-1167 proxy in
     *      front of it). Moving the `new` to `ERC404Factory` relocates that blob to a contract with
     *      room to spare and changes nothing semantically: `_initializeDN404` still links with
     *      `caller()`, and the mirror's constructor still records that same address as its
     *      `deployer`.
     * @dev Safety of the `mirror` parameter rests on ATOMICITY, not on DN404's own guards
     *      (`SenderNotDeployer` / `AlreadyLinked` protect the mirror, not this instance — a mirror
     *      built with a zero deployer passes both). `ERC404Factory.createInstance` clones and
     *      initializes in one call, so the mirror is always factory-supplied and no external caller
     *      can ever hand a fresh clone a mirror of its own.
     * @param mirror The DN404Mirror the caller just deployed for this instance.
     */
    function initialize(
        address owner,
        address vault_,
        BondingParams calldata bonding,
        address _liquidityDeployer,
        address _gatingModule,
        address mirror
    ) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        if (bonding.maxSupply == 0) revert InvalidMaxSupply();
        if (owner == address(0)) revert InvalidOwner();
        if (vault_ == address(0)) revert InvalidVault();
        if (_liquidityDeployer == address(0)) revert InvalidLiquidityDeployer();
        if (mirror == address(0)) revert InvalidMirror();

        _initializeOwner(owner);

        factory = msg.sender;
        vault = IAlignmentVault(payable(vault_));

        if (bonding.declaredMaxAllowanceBps > 10000) revert InvalidDeclaredMaxAllowance();

        maxSupply = bonding.maxSupply;
        liquidityReserve = (bonding.maxSupply * bonding.liquidityReserveBps) / 10000; // round down: slightly less reserved for LP
        curveParams = bonding.curve;
        unit = bonding.unit;
        declaredMaxAllowanceBps = bonding.declaredMaxAllowanceBps;

        liquidityDeployer = ILiquidityDeployerModule(_liquidityDeployer);
        gatingModule = IGatingModule(_gatingModule);
        gatingActive = _gatingModule != address(0);

        _initializeDN404(bonding.maxSupply, address(this), mirror);
    }

    /**
     * @notice Set protocol params. Called by factory immediately after initialize().
     */
    function initializeProtocol(ProtocolParams calldata protocol) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (!_initialized) revert NotInitialized();

        if (protocol.globalMessageRegistry == address(0)) revert InvalidGlobalMessageRegistry();

        masterRegistry = IMasterRegistry(protocol.masterRegistry);
        globalMessageRegistry = IGlobalMessageRegistry(protocol.globalMessageRegistry);
        protocolTreasury = protocol.protocolTreasury;
        weth = protocol.weth;
        bondingFeeBps = protocol.bondingFeeBps;
    }

    /**
     * @notice Set token name, symbol, and styleUri. Called by factory once after initialize().
     */
    function initializeMetadata(
        string calldata name_,
        string calldata symbol_,
        string calldata styleUri_,
        string calldata tokenBaseURI_
    ) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (bytes(_name).length != 0) revert MetadataAlreadySet();
        _name = name_;
        _symbol = symbol_;
        styleUri = styleUri_;
        metadataURI = tokenBaseURI_;
    }

    function setMetadataURI(string calldata uri) external {
        _requireOwnerOrAgent();
        metadataURI = uri;
    }

    /// @notice Set free mint params. Called by factory once after initialize().
    /// @param allocation NFT count reserved for free claims (0 = disabled).
    /// @param scope      Controls which entry points the gating module guards.
    function initializeFreeMint(uint256 allocation, GatingScope scope) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (_freeMintInitialized) revert AlreadyInitialized();
        _freeMintInitialized = true;
        freeMintAllocation = allocation;
        gatingScope = scope;
    }

    /// @notice Seal this instance's Token Tiers ladder. Factory-only, set-once — mutable weights would
    ///         retroactively reprice every outstanding band NFT, so there is no owner setter.
    /// @dev    `bands[i]` describes tier `i + 1`; tier 0 is the implicit ordinary id space `[1..idLimit]`
    ///         with `w_0 = 1` and is never stored. Every band must sit ABOVE `idLimit` — that is what
    ///         makes band ids unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///         `_wrapNFTId(.., idLimit)` where `idLimit = totalSupply / unit`, fixed for this instance's
    ///         life), so a reserved band carves NOTHING out of the sellable supply. Band size is the
    ///         product's `band_N = S / w_N` (S = the tier-0 id count), rounded DOWN — with a 10-to-1
    ///         ladder on S = 4000 that is 400 ids for tier 1 and 40 for tier 2, each band able to hold
    ///         the entire supply if it all concentrated there.
    /// @param  bands Ascending, non-overlapping bands with strictly increasing weights (`w >= 2`).
    function initTierBands(TierBand[] calldata bands) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (_tiersSealed) revert AlreadyInitialized();
        if (unit == 0) revert NotInitialized();
        _tiersSealed = true;

        uint256 n = bands.length;
        if (n == 0) revert InvalidBand();
        uint256 idLimit = maxSupply / unit; // == DN404's idLimit: totalSupply is fixed at maxSupply
        uint256 prevEnd = idLimit; // bands start strictly above the ordinary id space
        uint256 prevWeight = 1; // w_0
        for (uint256 i = 0; i < n; i++) {
            uint256 idStart = bands[i].idStart;
            uint256 weight = bands[i].weight;
            if (idStart <= prevEnd) revert InvalidBand();
            if (weight <= prevWeight) revert InvalidBand();
            uint256 size = idLimit / weight; // round down: a band never over-promises ids
            if (size == 0) revert InvalidBand();
            uint256 idEnd = idStart + size - 1;
            // DN404's `_restrictNFTId` bounds ids to uint32 — an id above that is unownable.
            if (idEnd > type(uint32).max) revert BandIdOverflow();
            if (bands[i].idEnd != idEnd) revert InvalidBand();
            tierBands.push(bands[i]);
            bandNextFree[i] = idStart;
            prevEnd = idEnd;
            prevWeight = weight;
        }
        emit TierBandsSealed(n);
    }

    /// @notice Wire in a staking module. Called by factory after masterRegistry.registerInstance.
    ///         The module is dormant until the owner calls activateStaking().
    function initializeStaking(address _stakingModule) external {
        if (msg.sender != factory) revert OnlyFactory();
        stakingModule = IERC404StakingModule(_stakingModule);
    }

    /// @notice Wire a generic keyed module pointer (e.g. METADATA_RESOLVER). Factory-only, set-once
    ///         per role — the resolution mechanism is sealed at construction (ADR-0006/0007). The
    ///         factory registry-validates `m` before calling; the read path stays defensive (try/catch).
    function initModule(bytes32 role, address m) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (modules[role] != address(0)) revert ModuleAlreadySet();
        modules[role] = m;
        emit ModuleSet(role, m);
    }

    /// @notice Expose the NFT owner so metadata modules can authorize holder writes.
    /// @dev DN404 tracks this internally and only the mirror exposes it today. Reverts on unminted
    ///      ids (TokenDoesNotExist) — correct for holder-write auth (can't act on a nonexistent token).
    function ownerOf(uint256 id) public view returns (address) {
        return _ownerOf(id);
    }

    /// @notice Toggle agent delegation for this instance
    function setAgentDelegation(bool enabled) external {
        if (msg.sender != owner()) revert InvalidOwner();
        agentDelegationEnabled = enabled;
        emit AgentDelegationChanged(enabled);
    }

    /// @notice Called by factory to enable delegation for agent-created instances
    function setAgentDelegationFromFactory() external {
        if (msg.sender != factory) revert OnlyFactory();
        agentDelegationEnabled = true;
    }

    /// @notice Claim one free mint (= 1 NFT worth of tokens) at zero ETH cost.
    /// @dev The body is externalized into the immutable `ERC404BondingOps` (EIP-170 diet — noesis-148)
    ///      and reached by the same discard-returndata delegatecall trampoline `rerollSelectedNFTs`
    ///      uses, so it runs in THIS instance's storage context. The selector/param types MUST stay
    ///      `claimFreeMint(bytes)` so raw `msg.data` forwards verbatim. Ops's specific reverts
    ///      (`FreeMintDisabled`, `FreeMintExhausted`, `GatingNotAllowed`, ...) surface to the caller as
    ///      the generic `FreeMintFailed()`; the specifics stay visible in traces and every revert still
    ///      HAPPENS. NO `nonReentrant` here — the guard lives on the Ops side and engages via the shared
    ///      fixed slot under delegatecall; guarding both ends would self-revert.
    // slither-disable-next-line low-level-calls,unused-return
    function claimFreeMint(bytes calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert FreeMintFailed();
    }

    // ┌─────────────────────────┐
    // │    Owner Functions      │
    // └─────────────────────────┘

    /// @notice Authorize the caller for a non-custodial config/lifecycle action: the owner always,
    ///         or a platform-vetted agent when this instance has agent delegation enabled. Value-
    ///         extracting fns (withdrawDust/claimAllFees/migrateVault) do NOT use this — they stay
    ///         bare `onlyOwner`. Revocation is live: `isAgent` is re-read at call time, so a revoked
    ///         agent is blocked immediately even with a stale `agentDelegationEnabled == true`.
    function _requireOwnerOrAgent() internal view {
        if (msg.sender == owner()) return;
        if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) return;
        revert Unauthorized();
    }

    // slither-disable-next-line timestamp
    function setBondingOpenTime(uint256 timestamp) external {
        _requireOwnerOrAgent();
        if (timestamp <= block.timestamp) revert TimeMustBeInFuture();
        bondingOpenTime = timestamp;
        emit BondingOpenTimeSet(timestamp);
    }

    // slither-disable-next-line timestamp
    function setBondingMaturityTime(uint256 timestamp) external {
        _requireOwnerOrAgent();
        if (timestamp <= block.timestamp) revert TimeMustBeInFuture();
        if (bondingOpenTime == 0) revert OpenTimeMustBeSetFirst();
        if (timestamp <= bondingOpenTime) revert MaturityMustBeAfterOpenTime();
        bondingMaturityTime = timestamp;
        emit BondingMaturityTimeSet(timestamp);
    }

    function setBondingActive(bool _active) external {
        _requireOwnerOrAgent();
        if (bondingOpenTime == 0) revert OpenTimeNotSet();
        if (_active && graduated) revert CannotActivateAfterLiquidityDeployed();
        bondingActive = _active;
        emit BondingActiveChanged(_active);
        emit StateChanged(_active ? STATE_BONDING : STATE_PAUSED);
    }

    function setStyle(string memory uri) external {
        _requireOwnerOrAgent();
        styleUri = uri;
    }

    function migrateVault(address newVault) external onlyOwner {
        vault = IAlignmentVault(payable(newVault));
        masterRegistry.migrateVault(address(this), newVault);
    }

    /// @notice Activate staking for this instance. Irreversible. Requires stakingModule to be set.
    function activateStaking() external {
        _requireOwnerOrAgent();
        if (address(stakingModule) == address(0)) revert StakingModuleNotSet();
        if (stakingActive) revert StakingAlreadyActive();
        stakingActive = true;
        stakingModule.enableStaking();
        emit StakingActivated(address(stakingModule));
    }

    /// @notice Pull fees from every vault registered to this instance and settle the staking stream.
    /// @dev Body externalized into `ERC404BondingOps` (noesis-148). NO `onlyOwner` and NO
    ///      `nonReentrant` here — BOTH live on the Ops side, and `msg.sender` is preserved under
    ///      `delegatecall` so `onlyOwner` resolves against the same caller and the same Ownable slot.
    ///      A non-owner call therefore still reverts, as the generic `ClaimFeesFailed()`.
    // slither-disable-next-line low-level-calls,unused-return
    function claimAllFees() external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert ClaimFeesFailed();
    }

    /// @notice Recover ETH held by the instance that is NOT part of the bonding `reserve`.
    /// @dev Body externalized into `ERC404BondingOps` (noesis-148); the locked-liability guard
    ///      (`reserve + stakingReserve`, noesis-061 F1) lives there unchanged and reads THIS instance's
    ///      storage under delegatecall. Owner gate + reentrancy guard are on the Ops side only.
    // slither-disable-next-line low-level-calls,unused-return
    function withdrawDust() external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert WithdrawDustFailed();
    }

    // ┌─────────────────────────┐
    // │   Staking Functions     │
    // └─────────────────────────┘
    // All three bodies live in `ERC404BondingOps` (noesis-148) behind the standard discard-returndata
    // trampoline. `msg.sender` is preserved under `delegatecall`, so every staker-keyed module call
    // (`recordStake` / `recordUnstake` / `computeClaim`) is keyed to the same address it always was,
    // and the ETH payout still leaves THIS instance's balance.

    /// @notice Stake `amount` tokens. Tokens are held by this contract while staked.
    // slither-disable-next-line low-level-calls,unused-return
    function stake(uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert StakeFailed();
    }

    /// @notice Unstake `amount` tokens and auto-claim any pending ETH rewards.
    // slither-disable-next-line low-level-calls,unused-return
    function unstake(uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert UnstakeFailed();
    }

    /// @notice Claim pending ETH staking rewards without unstaking.
    // slither-disable-next-line low-level-calls,unused-return
    function claimStakingRewards() external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert ClaimRewardsFailed();
    }

    // ┌─────────────────────────┐
    // │    Buy/Sell Functions   │
    // └─────────────────────────┘

    // slither-disable-next-line reentrancy-benign,reentrancy-no-eth,timestamp
    function buyBonding(
        uint256 amount,
        uint256 maxCost,
        bool mintNFT,
        bytes calldata gatingData, // module payload: password hash, or merkle (tierId, maxQty, proof)
        bytes calldata messageData,
        uint256 deadline
    ) external payable nonReentrant {
        if (deadline != 0 && block.timestamp > deadline) revert TransactionExpired();
        if (!bondingActive) revert BondingNotActive();
        if (graduated) revert BondingEnded();
        if (totalBondingSupply + amount > maxSupply - liquidityReserve - (freeMintAllocation * unit)) {
            revert ExceedsBonding();
        }

        // Gating check (address(0) or gatingActive==false = open). Single curve → editionId 0;
        // bondingOpenTime is the authoritative open reference; gatingData carries the raw module payload.
        if (address(gatingModule) != address(0) && gatingActive && gatingScope != GatingScope.FREE_MINT_ONLY) {
            (bool allowed, bool permanent) = gatingModule.canMint(msg.sender, 0, amount, bondingOpenTime, gatingData);
            if (!allowed) revert GatingNotAllowed();
            if (permanent) gatingActive = false;
            gatingModule.onMint(msg.sender, 0, amount);
        }

        uint256 totalCost = BondingCurveMath.calculateCost(curveParams, totalBondingSupply, amount);
        if (totalCost == 0) revert PurchaseTooSmall();
        // No buy-side fee: entering the curve costs exactly the curve price. The protocol fee
        // (bondingFeeBps) is taken on exit only — see sellBonding.
        if (maxCost < totalCost) revert MaxCostExceeded();
        if (msg.value < totalCost) revert LowETHValue();

        bool originalSkipNFT = mintNFT ? getSkipNFT(msg.sender) : false;
        if (originalSkipNFT) {
            _setSkipNFT(msg.sender, false);
        }

        totalBondingSupply += amount;
        _transfer(address(this), msg.sender, amount);
        reserve += totalCost;

        if (messageData.length > 0) {
            globalMessageRegistry.postForAction(msg.sender, address(this), messageData);
        }

        if (originalSkipNFT) {
            _setSkipNFT(msg.sender, true);
        }

        if (msg.value > totalCost) {
            SmartTransferLib.smartTransferETH(msg.sender, msg.value - totalCost, weth);
        }

        emit BondingSale(msg.sender, amount, totalCost, true);
    }

    // slither-disable-next-line timestamp
    function sellBonding(
        uint256 amount,
        uint256 minRefund,
        bytes32 passwordHash,
        bytes calldata messageData,
        uint256 deadline
    ) external nonReentrant {
        if (deadline != 0 && block.timestamp > deadline) revert TransactionExpired();
        if (!bondingActive) revert BondingNotActive();
        if (graduated) revert BondingEnded();

        // A sell only DECREASES supply, so the bonding cap is not a sell constraint: a holder who
        // bought exactly to the cap must still be able to sell back down the curve before graduation.
        // The "no trading after graduation" concern is already covered by the `graduated` check above.
        // Use strict `>` (never true in practice, since buys cap supply AT maxBondingSupply) so reaching
        // the cap exactly does not strand sellers.
        uint256 maxBondingSupply = maxSupply - liquidityReserve - (freeMintAllocation * unit);
        if (totalBondingSupply > maxBondingSupply) revert ExceedsBonding();

        uint256 balance = balanceOf(msg.sender);
        if (balance < amount) revert InsufficientBalance();

        uint256 refund = BondingCurveMath.calculateRefund(curveParams, totalBondingSupply, amount);
        // Bonding sell fee (F3 follow-up): take bondingFeeBps from the seller's proceeds into protocol
        // revenue. The protocol fee is charged on curve EXIT only — buys are fee-free. This monetizes
        // exits, including free-mint redemptions that dilute the reserve (F3, risk-accepted), without
        // touching curve solvency: the full `refund` still leaves `reserve`, split between seller and
        // treasury, so reserve == balance is preserved. No treasury set ⇒ no skim (seller gets full refund).
        uint256 sellFee = protocolTreasury != address(0) ? (refund * bondingFeeBps) / 10000 : 0; // round down: favors seller
        uint256 netRefund = refund - sellFee;
        // minRefund is the seller's slippage floor on what they RECEIVE (net of fee); `reserve` must
        // still cover the gross `refund` it is debited by.
        if (netRefund < minRefund || reserve < refund) revert InvalidRefund();

        _transfer(msg.sender, address(this), amount);
        totalBondingSupply -= amount;
        reserve -= refund;

        if (sellFee > 0) {
            SafeTransferLib.safeTransferETH(protocolTreasury, sellFee);
            emit BondingFeePaid(msg.sender, sellFee);
        }

        if (messageData.length > 0) {
            globalMessageRegistry.postForAction(msg.sender, address(this), messageData);
        }

        SmartTransferLib.smartTransferETH(msg.sender, netRefund, weth);
        emit BondingSale(msg.sender, amount, netRefund, false);
    }

    // ┌─────────────────────────┐
    // │   Reroll Functionality  │
    // └─────────────────────────┘

    /// @notice Reroll selected NFTs. The body is externalized into the immutable `ERC404BondingOps`
    ///         (EIP-170 diet — noesis-091) and reached by a discard-returndata delegatecall, so it runs
    ///         in THIS instance's storage context. The selector/param types MUST stay
    ///         `rerollSelectedNFTs(uint256,uint256[])` so raw `msg.data` forwards verbatim.
    /// @dev    Returndata is discarded deliberately: bubbling it (via `bytes memory ret` or inline-asm
    ///         returndatacopy) re-triggers a via_ir size cliff (+~1.5KB) that blows the EIP-170 gate.
    ///         Consequently Ops's specific reverts (`TokenAmountMustPositive`, ...) surface to the caller
    ///         as the generic `RerollFailed()`; the specifics remain visible in traces, and every revert
    ///         still HAPPENS (safety intact). NO `nonReentrant` here — the guard lives on the Ops side and
    ///         engages via the shared fixed slot under delegatecall; guarding both ends would self-revert.
    // slither-disable-next-line low-level-calls,unused-return
    function rerollSelectedNFTs(uint256, uint256[] calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert RerollFailed();
    }

    // ┌─────────────────────────┐
    // │   Token Tiers           │
    // └─────────────────────────┘

    /// @notice Mint up: convert `w_N` units' worth of holdings into one tier-N band NFT.
    /// @dev Same shape as the reroll trampoline (noesis-091): the body lives in the immutable
    ///      `ERC404BondingOps` and is reached by a discard-returndata delegatecall, so it runs in THIS
    ///      instance's storage. The selector/param types MUST stay `mintUp(uint8,uint256)` so raw
    ///      `msg.data` forwards verbatim. Returndata is discarded (bubbling trips the via_ir size
    ///      cliff), so Ops's specific reverts surface as the generic `TierOpFailed()` — the specifics
    ///      remain visible in traces and every revert still HAPPENS. NO `nonReentrant` here: the guard
    ///      lives on the Ops side and engages via the shared fixed slot; guarding both self-reverts.
    // slither-disable-next-line low-level-calls,unused-return
    function mintUp(uint8, uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert TierOpFailed();
    }

    /// @notice Mint down: the exact inverse of `mintUp` — the band NFT becomes an ordinary NFT again
    ///         and its escrow returns to the caller's liquid balance. See `mintUp` for the trampoline
    ///         contract; the selector must stay `mintDown(uint256)`.
    // slither-disable-next-line low-level-calls,unused-return
    function mintDown(uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert TierOpFailed();
    }

    /// @notice A holder's TRUE coin holdings: liquid ERC20 balance plus the coin escrowed behind every
    ///         band NFT they own (`(w_N - 1) * unit` per band id, derived from the id — never stored).
    /// @dev ERC20 `balanceOf` is deliberately UNCHANGED (locked decision): it stays the transferable
    ///      amount, exactly as DN404 defines it. This is the aggregate view for UI/indexers, mirroring
    ///      the staking module's effective-holdings precedent.
    /// @dev O(ownedLength × bandCount). A VIEW ONLY — never call it on a write path.
    function coinBalanceOf(address holder) external view returns (uint256 total) {
        total = balanceOf(holder);
        uint256 n = tierBands.length;
        if (n == 0) return total;
        uint256[] memory ids = _ownedIds(holder, 0, type(uint256).max);
        uint256 u = unit;
        for (uint256 i = 0; i < ids.length; i++) {
            // Shared band walk (noesis-143) — the same code the burn-safety hook uses to size a release,
            // so this view and the escrow accounting can never disagree about what an id is worth.
            (bool isBand,, uint256 weight) = _bandOf(ids[i]);
            if (isBand) total += (weight - 1) * u;
        }
    }

    /// @notice Claim coin released by DN404 burning a band NFT you owned.
    /// @dev The counterpart to the `_afterNFTTransfers` burn-safety hook (noesis-143). The hook fires in
    ///      the middle of DN404's own accounting and therefore must never move value — it only records
    ///      `pendingEscrowRelease`. This is the PULL leg, and the only place that coin moves.
    ///      Checks-effects-interactions: the credit is zeroed BEFORE the transfer, and `nonReentrant`
    ///      holds on top of that, so a receiver hook that calls back in finds nothing left to claim.
    /// @dev The returned coin re-materializes the holder's tier-0 NFTs through DN404's own mint loop
    ///      (subject to their skipNFT setting) — nothing is hand-minted here.
    function claimReleasedEscrow() external nonReentrant {
        uint256 amount = pendingEscrowRelease[msg.sender];
        if (amount == 0) revert NothingToClaim();
        // Solvency assert, not a trust boundary: the coin has sat in this instance's own balance since
        // `mintUp` escrowed it. If it is somehow not here, the tier accounting is broken and paying out
        // would raid the curve's own tokens — revert instead.
        if (balanceOf(address(this)) < amount) revert EscrowReleaseFailed();

        pendingEscrowRelease[msg.sender] = 0;
        totalPendingEscrowRelease -= amount;

        _transfer(address(this), msg.sender, amount);
    }

    /// @notice Band ids currently outstanding for tier `tierN` (1-based). Derived, never stored: the
    ///         high-water cursor minus the returned-id stack is the single source of truth.
    function bandOutstanding(uint8 tierN) external view returns (uint256) {
        if (tierN == 0 || tierN > tierBands.length) revert InvalidBand();
        uint256 idx = uint256(tierN) - 1;
        return (bandNextFree[idx] - tierBands[idx].idStart) - bandFreed[idx].length;
    }

    // ┌─────────────────────────┐
    // │  Liquidity Deployment   │
    // └─────────────────────────┘

    /**
     * @notice Deploy liquidity via the pluggable ILiquidityDeployerModule, optionally taking the
     *         creator carve (tithed 80/19/1 by the module).
     * @dev Owner-only: graduating a collection to the DEX is a creator action (Mony, 2026-07-03),
     *      not something any passerby can trigger. The bonding-open-time guard still applies so a
     *      curve can't be graduated before it opens.
     * @param carveRequestBps Fraction (bps) of the protocol carve allowance the creator takes NOW,
     *        on the same axis as `declaredMaxAllowanceBps`. Effective carve ETH =
     *        min(request, allowance(raise) × declaredMaxAllowanceBps / 10000, headroom above the
     *        pool floor). Passing 0 reproduces the historic no-carve graduation exactly.
     */
    // slither-disable-next-line reentrancy-eth,timestamp
    function deployLiquidity(uint256 carveRequestBps) external nonReentrant {
        _requireOwnerOrAgent();
        if (bondingOpenTime == 0) revert BondingNotConfigured();
        if (block.timestamp < bondingOpenTime) revert TooEarly();
        if (graduated) revert AlreadyDeployed();
        if (reserve == 0) revert NoReserve();

        // CEI: capture and zero reserve before external calls
        uint256 ethToSend = reserve;
        reserve = 0;
        bondingActive = false;

        uint256 carveEth = _effectiveCarve(ethToSend, carveRequestBps);

        _transfer(address(this), address(liquidityDeployer), liquidityReserve);

        liquidityDeployer.deployLiquidity{ value: ethToSend }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethToSend,
                tokenReserve: liquidityReserve,
                protocolTreasury: protocolTreasury,
                vault: address(vault),
                token: address(this),
                instance: address(this),
                creator: owner(),
                carveEth: carveEth
            })
        );

        graduated = true;
        emit LiquidityDeployed(address(liquidityDeployer), liquidityReserve, ethToSend);
        emit StateChanged(STATE_GRADUATED);
    }

    /// @notice Effective carve ETH for a given raise + request. Exposed so the UI can cap the
    ///         graduation carve control at the live-computed maximum (pass 10000 for the max).
    /// @dev Zero-request / zero-declared short-circuits BEFORE touching the factory, so a plain
    ///      deployLiquidity(0) never depends on the factory exposing carve math (exact pre-carve
    ///      behavior). The pool floor (`minPoolEth`) clamps — it never gates.
    function previewCarve(uint256 carveRequestBps) external view returns (uint256) {
        return _effectiveCarve(reserve, carveRequestBps);
    }

    function _effectiveCarve(uint256 raise, uint256 carveRequestBps) private view returns (uint256) {
        uint256 declared = declaredMaxAllowanceBps;
        if (carveRequestBps == 0 || declared == 0 || raise == 0) return 0;
        return ICarveParamsSource(factory).effectiveCarveEth(raise, declared, carveRequestBps);
    }

    // ── IInstanceLifecycle ─────────────────────────────────────────────────────

    function instanceType() external pure override returns (bytes32) {
        return TYPE_ERC404;
    }

    // ┌─────────────────────────┐
    // │   DN404 Overrides        │
    // └─────────────────────────┘

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    // `_unit()` is inherited from ERC404BondingStorage (shared by the instance and Ops).

    /// @dev Defensive metadata-resolution seam (ADR-0006/0007): if a resolver is wired and returns
    ///      a non-empty augmentation, it wins; ANY failure (revert / gas-bomb / ABI-undecodable return /
    ///      code-less address) falls back to base — tokenURI can never be bricked by a misbehaving
    ///      module, for EVERY resolver-return class. Uses _ownerAt (revert-free), NOT _ownerOf.
    ///      `SafeResolverLib.tryResolve` does a low-level `staticcall` + guarded decode: a malformed
    ///      (undecodable) success degrades to base just like a revert (a plain `try…returns(string)`
    ///      would let that decode failure ESCAPE the `catch` and revert the read — noesis-107). The lib
    ///      also swallows the code-less-resolver case (staticcall succeeds empty → degrades), so the
    ///      former explicit `m.code.length` guard is no longer needed.
    function _tokenURI(uint256 tokenId) internal view override returns (string memory) {
        string memory base = string.concat(metadataURI, LibString.toString(tokenId));
        address m = modules[METADATA_RESOLVER];
        if (m != address(0)) {
            (, string memory aug) = SafeResolverLib.tryResolve(m, address(this), tokenId, _ownerAt(tokenId));
            if (bytes(aug).length != 0) return aug; // augmented wins
        }
        return base;
    }

    function _skipNFTDefault(address) internal pure override returns (bool) {
        return false;
    }

    receive() external payable override { }
}
