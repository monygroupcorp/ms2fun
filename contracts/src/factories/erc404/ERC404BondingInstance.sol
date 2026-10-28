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
    ClaimRewardsFailed,
    OnlyFactory,
    AlreadyInitialized,
    InvalidOwner,
    InitProtocolFailed,
    SetMetadataURIFailed,
    SetContractURIFailed,
    InitFreeMintFailed,
    InitTierBandsFailed,
    InitStakingFailed,
    InitModuleFailed,
    SetAgentDelegationFailed,
    SetAgentDelegationFromFactoryFailed,
    SetBondingOpenTimeFailed,
    SetBondingMaturityTimeFailed,
    SetBondingActiveFailed,
    ActivateStakingFailed,

    // Graduation: the body lives on the Ops side, so these are declared in the shared base and
    // re-exported from this file by name.
    AlreadyDeployed,
    NoReserve,
    GraduationFailed
} from "./ERC404BondingStorage.sol";
import { LibString } from "solady/utils/LibString.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { SmartTransferLib } from "../../libraries/SmartTransferLib.sol";
import { BondingCurveMath } from "./libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule, IGraduationSkipNFTTarget } from "../../interfaces/ILiquidityDeployerModule.sol";
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
// Errors raised by the Ops-side bodies (`BondingEnded`, `BondingNotConfigured`, `TooEarly`,
// `GatingNotAllowed`, `FreeMint*`, `StakingModuleNotSet`, `NothingToWithdraw`, `WithdrawFailed`,
// `NotInitialized`, `InvalidGlobalMessageRegistry`, `ModuleAlreadySet`, `TimeMustBeInFuture`,
// `OpenTimeMustBeSetFirst`, `MaturityMustBeAfterOpenTime`, `OpenTimeNotSet`,
// `CannotActivateAfterLiquidityDeployed`, `StakingAlreadyActive`) and the generic per-trampoline
// errors are declared in `ERC404BondingStorage.sol`, so both sides compile them. The ones this
// contract raises itself are imported above: `AlreadyInitialized`/`InvalidOwner` by `initialize`,
// `OnlyFactory` by `initializeMetadata` (`initialize` is first-caller-wins and only records
// `factory = msg.sender`, never checks it).
error BondingNotActive();
error ExceedsBonding();
error InsufficientBalance();
error InvalidLiquidityDeployer();
error InvalidMaxSupply();
error InvalidMirror();
/// @dev The `ops` delegatecall target has no code. `delegatecall` to a code-less address returns
///      SUCCESS and writes nothing, so every trampoline on this contract would be a silent
///      no-op — including `initializeProtocol`/`initModule` (called by the factory during
///      `createInstance`) and `initTierBands` (the ladder seal). `address(0)` is a subset of this
///      check; a non-zero EOA is equally broken. Constructor-only, so it costs no runtime bytes.
error InvalidOps();
error InvalidRefund();
error InvalidVault();
error LowETHValue();
error MaxCostExceeded();
error TransactionExpired();
error AmountMustBePositive();
error FreeMintNotInitialized();
error PurchaseTooSmall();
error MetadataAlreadySet();
error InvalidDeclaredMaxAllowance();

/// @notice Read-side of the ERC404Factory's graduation-carve math. Read live at graduation (not
///         snapshotted at create) so owner-tuned market-regime changes (brackets, pool floor) apply to
///         every graduation. The bracket/floor math lives in the factory (the DN404 instance has no
///         EIP-170 headroom).
/// @dev Declared here rather than in the shared base even though `ERC404BondingOps` also needs it
///      (it imports the name from this file). The app's binding generator globs this file, so
///      the declaration here keeps the generated `ICarveParamsSource` binding.
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
contract ERC404BondingInstance is ERC404BondingStorage, IInstanceLifecycle, IGraduationSkipNFTTarget {
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
    // All instance state lives in the shared `ERC404BondingStorage` base so `ERC404BondingOps`
    // inherits a byte-identical layout and runs in this instance's storage under delegatecall.
    // Declare no state var here.

    // Delegatecall target for the externalized bodies. Immutable: set once in the master
    // constructor, no storage slot, no setter. It lives in the master's code, so every EIP-1167
    // clone reads this same shared Ops.
    address internal immutable _ops;

    // ── Events ────────────────────────────────────────────────────────────────
    event BondingSale(address indexed user, uint256 amount, uint256 cost, bool isBuy);
    event BondingFeePaid(address indexed buyer, uint256 feeAmount);

    // `FreeMintClaimed`, `Staked`, `Unstaked`, `StakingRewardsClaimed`, `BondingOpenTimeSet`,
    // `BondingMaturityTimeSet`, `BondingActiveChanged`, `AgentDelegationChanged`, `StakingActivated`
    // and `ModuleSet` are declared in `ERC404BondingStorage`: their emitters run on the Ops side and
    // emit from this instance's address under delegatecall.

    // ┌─────────────────────────┐
    // │      Constructor        │
    // └─────────────────────────┘

    /// @param ops The shared, immutable `ERC404BondingOps` delegatecall target for the externalized
    ///        reroll body. Deployed BEFORE the master and passed here; non-upgradeable (no setter).
    /// @dev Reverts `InvalidOps` if `ops` carries no code. Every externalized entry point is a
    ///      `delegatecall` trampoline whose only failure check is the returned boolean, and a
    ///      `delegatecall` to a code-less address returns `true` having written nothing — so a master
    ///      built with a bad `ops` would produce launches that report success and are silently broken.
    ///      The check runs in creation code, so it adds nothing to the EIP-170 subject
    ///      (`deployedBytecode`).
    constructor(address ops) {
        if (ops.code.length == 0) revert InvalidOps();
        _initialized = true;
        _ops = ops;
    }

    // ┌─────────────────────────┐
    // │      Initialize         │
    // └─────────────────────────┘

    /**
     * @notice Initialize a clone instance. Called by factory immediately after cloning.
     * @dev The DN404 mirror is deployed by the caller (the factory) and passed in. A `new
     *      DN404Mirror` here would inline its ~3,100B of creation code in this contract's runtime
     *      bytecode, and this contract is the EIP-170 subject (every clone is an EIP-1167 proxy in
     *      front of it). `_initializeDN404` links with `caller()`, and the mirror's constructor
     *      records that same address as its `deployer`.
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

    // ── Config trampolines ────────────────────────────────────────────────────────────────────────
    // The init/admin/setter bodies below live in the immutable `ERC404BondingOps` and are reached by
    // a discard-returndata `delegatecall` trampoline, so each runs in this instance's storage
    // context. No value moves on any of these paths. For every one of them:
    //   * the selector and parameter types match the Ops function, so raw `msg.data` forwards
    //     verbatim;
    //   * no guard sits on this side — the factory-only check, the owner check in
    //     `setAgentDelegation`, and `_requireOwnerOrAgent` all live on the Ops side, resolving
    //     against the same `msg.sender` (preserved under delegatecall), the same Ownable slot and the
    //     same `masterRegistry`;
    //   * returndata is discarded (bubbling re-triggers the via_ir size cliff), so Ops's specific
    //     revert surfaces as this entry point's generic error; the specific error stays visible in
    //     traces.
    // Each entry point has its own generic error, so a failed `createInstance` identifies which init
    // step broke (`ERC404Factory` calls `initializeProtocol`, `initializeFreeMint`,
    // `initializeStaking`, `initModule` and `setAgentDelegationFromFactory` during create).
    // `initialize`, `initializeMetadata` and `migrateVault` keep their bodies here. This contract is
    // the EIP-170 subject, so a body here costs scarce bytes while the same body on the Ops side costs
    // a bare trampoline.

    /**
     * @notice Set protocol params. Called by factory immediately after initialize().
     */
    // slither-disable-next-line low-level-calls,unused-return
    function initializeProtocol(ProtocolParams calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert InitProtocolFailed();
    }

    /**
     * @notice Set token name, symbol, styleUri and the two metadata URIs. Called by factory once after
     *         initialize().
     * @param tokenBaseURI_ The per-token base URI `tokenURI(tokenId)` composes against
     *        (`params.tokenBaseURI` at the factory).
     * @param contractURI_ The collection-level ERC-7572 URI — the project document, the same
     *        string the factory hands the master registry at create. Distinct from `tokenBaseURI_`: one
     *        describes the collection, the other is the prefix for every token.
     */
    function initializeMetadata(
        string calldata name_,
        string calldata symbol_,
        string calldata styleUri_,
        string calldata tokenBaseURI_,
        string calldata contractURI_
    ) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (bytes(_name).length != 0) revert MetadataAlreadySet();
        _name = name_;
        _symbol = symbol_;
        styleUri = styleUri_;
        metadataURI = tokenBaseURI_;
        contractURI = contractURI_;
    }

    /// @notice Update the PER-TOKEN base URI for `tokenURI(tokenId)`. Owner or delegated agent.
    // slither-disable-next-line low-level-calls,unused-return
    function setMetadataURI(string calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetMetadataURIFailed();
    }

    /// @notice Update the COLLECTION-level ERC-7572 `contractURI`. Owner or delegated agent.
    /// @dev Trampoline to `ERC404BondingOps`, like `setMetadataURI`. Does not touch `metadataURI`: the
    ///      per-token base URI is a separate slot with a separate setter.
    // slither-disable-next-line low-level-calls,unused-return
    function setContractURI(string calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetContractURIFailed();
    }

    /// @notice Set free mint params. Called by factory once after initialize().
    // slither-disable-next-line low-level-calls,unused-return
    function initializeFreeMint(uint256, GatingScope) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert InitFreeMintFailed();
    }

    /// @notice Seal this instance's Token Tiers ladder. Factory-only, set-once — mutable weights would
    ///         retroactively reprice every outstanding band NFT, so there is no owner setter.
    /// @dev    `bands[i]` describes tier `i + 1`; tier 0 is the implicit ordinary id space `[1..idLimit]`
    ///         with `w_0 = 1` and is never stored. Every band sits above `idLimit` — that makes band
    ///         ids unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///         `_wrapNFTId(.., idLimit)` where `idLimit = totalSupply / unit`, fixed for this instance's
    ///         life), so a reserved band carves nothing out of the sellable supply. Band size is a
    ///         product choice bounded above by `band_N <= S / w_N` (S = the tier-0 id count), rounded
    ///         down — an uncapped band at exactly `S / w_N` can hold the entire supply if it all
    ///         concentrated there, and a band capped below that is a scarce tier: it can sell out while
    ///         coin remains, so `BandExhausted` is reachable by design on such a band (and reopens as
    ///         holders `mintDown`).
    /// @dev    The seal's invariants (`_tiersSealed` set-once, ascending bands strictly above `idLimit`,
    ///         `weight >= 2`) are load-bearing for the burn-safety hook and are enforced in
    ///         `ERC404BondingOps.initTierBands`: ascending, non-overlapping bands with strictly
    ///         increasing weights.
    // slither-disable-next-line low-level-calls,unused-return
    function initTierBands(TierBand[] calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert InitTierBandsFailed();
    }

    /// @notice Wire in a staking module. Called by factory after masterRegistry.registerInstance.
    ///         The module is dormant until the owner calls activateStaking().
    // slither-disable-next-line low-level-calls,unused-return
    function initializeStaking(address) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert InitStakingFailed();
    }

    /// @notice Wire a generic keyed module pointer (e.g. METADATA_RESOLVER). Factory-only, set-once
    ///         per role — the resolution mechanism is sealed at construction (ADR-0006/0007). The
    ///         factory registry-validates `m` before calling; the read path stays defensive (try/catch).
    // slither-disable-next-line low-level-calls,unused-return
    function initModule(bytes32, address) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert InitModuleFailed();
    }

    /// @notice Expose the NFT owner so metadata modules can authorize holder writes.
    /// @dev DN404 tracks this internally and only the mirror exposes it. Reverts on unminted
    ///      ids (TokenDoesNotExist) — correct for holder-write auth (can't act on a nonexistent token).
    function ownerOf(uint256 id) public view returns (address) {
        return _ownerOf(id);
    }

    /// @notice Toggle agent delegation for this instance
    // slither-disable-next-line low-level-calls,unused-return
    function setAgentDelegation(bool) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetAgentDelegationFailed();
    }

    /// @notice Called by factory to enable delegation for agent-created instances
    // slither-disable-next-line low-level-calls,unused-return
    function setAgentDelegationFromFactory() external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetAgentDelegationFromFactoryFailed();
    }

    /// @notice Claim one free mint (= 1 NFT worth of tokens) at zero ETH cost.
    /// @dev Discard-returndata delegatecall trampoline to `ERC404BondingOps`, like `rerollSelectedNFTs`.
    ///      The selector/param types must match `claimFreeMint(bytes)` so raw `msg.data` forwards
    ///      verbatim. Ops's specific reverts (`FreeMintDisabled`, `FreeMintExhausted`,
    ///      `GatingNotAllowed`, ...) surface as the generic `FreeMintFailed()`; the specifics stay
    ///      visible in traces. No `nonReentrant` here — the guard lives on the Ops side and engages via
    ///      the shared fixed slot under delegatecall; guarding both ends would self-revert.
    // slither-disable-next-line low-level-calls,unused-return
    function claimFreeMint(bytes calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert FreeMintFailed();
    }

    // ┌─────────────────────────┐
    // │    Owner Functions      │
    // └─────────────────────────┘

    // `_requireOwnerOrAgent()` lives in the shared `ERC404BondingStorage` base so the Ops side and
    // this contract compile the identical gate.

    // slither-disable-next-line low-level-calls,unused-return
    function setBondingOpenTime(uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetBondingOpenTimeFailed();
    }

    // slither-disable-next-line low-level-calls,unused-return
    function setBondingMaturityTime(uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetBondingMaturityTimeFailed();
    }

    /// @dev `StateChanged` is emitted from Ops's qualified `emit IInstanceLifecycle.StateChanged`; the
    ///      emitting address is this instance under delegatecall.
    // slither-disable-next-line low-level-calls,unused-return
    function setBondingActive(bool) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetBondingActiveFailed();
    }

    /// @notice Set the collection's cosmetic style pointer.
    /// @dev The one config body kept here rather than on the Ops side: `ERC404BondingOps` is the
    ///      contract against the EIP-170 ceiling (the diet gate holds a 500-byte floor under its
    ///      headroom), while this contract has thousands of bytes free. `styleUri` is a cosmetic
    ///      pointer with no protocol meaning, no ordering constraint and no interaction with any
    ///      other entry point.
    ///
    ///      Being in-instance, an unauthorized caller gets `Unauthorized` verbatim rather than a
    ///      generic trampoline error, as with `migrateVault`.
    function setStyle(string memory uri) external {
        _requireOwnerOrAgent();
        styleUri = uri;
    }

    function migrateVault(address newVault) external onlyOwner {
        vault = IAlignmentVault(payable(newVault));
        masterRegistry.migrateVault(address(this), newVault);
    }

    /// @notice Activate staking for this instance. Irreversible. Requires stakingModule to be set.
    // slither-disable-next-line low-level-calls,unused-return
    function activateStaking() external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert ActivateStakingFailed();
    }

    /// @notice Pull fees from every vault registered to this instance and settle the staking stream.
    /// @dev Body in `ERC404BondingOps`. `onlyOwner` and `nonReentrant` live on the Ops side, and
    ///      `msg.sender` is preserved under `delegatecall`, so `onlyOwner` resolves against the same
    ///      caller and Ownable slot. A non-owner call reverts as the generic `ClaimFeesFailed()`.
    // slither-disable-next-line low-level-calls,unused-return
    function claimAllFees() external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert ClaimFeesFailed();
    }

    /// @notice Recover ETH held by the instance that is NOT part of the bonding `reserve`.
    /// @dev Body in `ERC404BondingOps`; the locked-liability guard (`reserve + stakingReserve`) lives
    ///      there and reads this instance's storage under delegatecall. Owner gate and reentrancy
    ///      guard are on the Ops side.
    // slither-disable-next-line low-level-calls,unused-return
    function withdrawDust() external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert WithdrawDustFailed();
    }

    // ┌─────────────────────────┐
    // │   Staking Functions     │
    // └─────────────────────────┘
    // All three bodies live in `ERC404BondingOps` behind the discard-returndata trampoline.
    // `msg.sender` is preserved under `delegatecall`, so every staker-keyed module call
    // (`recordStake` / `recordUnstake` / `computeClaim`) is keyed to the caller, and the ETH payout
    // leaves this instance's balance.

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
        // bondingOpenTime is the open reference for every cohort: no ETH is taken before it, gated or
        // not. A `<` comparison, so an unset (zero) open time reads as open.
        if (block.timestamp < bondingOpenTime) revert TooEarly();
        if (graduated) revert BondingEnded();
        if (totalBondingSupply + amount > maxSupply - liquidityReserve - (freeMintAllocation * unit)) {
            revert ExceedsBonding();
        }

        // Gating (address(0) or gatingActive==false = open). Single curve → editionId 0;
        // gatingData carries the raw module payload.
        if (address(gatingModule) != address(0) && gatingActive && gatingScope != GatingScope.FREE_MINT_ONLY) {
            (bool allowed, bool permanent) = gatingModule.canMint(msg.sender, 0, amount, bondingOpenTime, gatingData);
            if (!allowed) revert GatingNotAllowed();
            if (permanent) gatingActive = false;
            gatingModule.onMint(msg.sender, 0, amount);
        }

        uint256 totalCost = BondingCurveMath.calculateCost(curveParams, totalBondingSupply, amount);
        if (totalCost == 0) revert PurchaseTooSmall();
        // No buy-side fee: entering the curve costs exactly the curve price; bondingFeeBps is taken
        // on exit only (see sellBonding).
        if (maxCost < totalCost) revert MaxCostExceeded();
        if (msg.value < totalCost) revert LowETHValue();

        bool originalSkipNFT = mintNFT ? getSkipNFT(msg.sender) : false;
        if (originalSkipNFT) {
            _setSkipNFT(msg.sender, false);
        }

        totalBondingSupply += amount;
        _transfer(address(this), msg.sender, amount);
        reserve += totalCost;

        // Revocation must not brick the trade. `postForAction` refuses a caller the registry no longer
        // approves, and `revokeInstance` is exactly that flip, so a bare call would revert a commented
        // buy that succeeds uncommented. Pre-checking only that read keeps the skip narrow: every
        // other `postForAction` revert still reverts the buy.
        if (messageData.length > 0 && masterRegistry.isInstanceFromApprovedFactory(address(this))) {
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

        // A sell only decreases supply, so the cap is not a sell constraint: a holder who bought
        // exactly to the cap can still sell back down the curve. Strict `>` (never true in practice,
        // since buys cap supply at maxBondingSupply) so reaching the cap exactly does not strand sellers.
        uint256 maxBondingSupply = maxSupply - liquidityReserve - (freeMintAllocation * unit);
        if (totalBondingSupply > maxBondingSupply) revert ExceedsBonding();

        uint256 balance = balanceOf(msg.sender);
        if (balance < amount) revert InsufficientBalance();

        uint256 refund = BondingCurveMath.calculateRefund(curveParams, totalBondingSupply, amount);
        // Sell fee: bondingFeeBps of the seller's proceeds goes to the protocol treasury; buys are
        // fee-free. Curve solvency is untouched: the full `refund` leaves `reserve`, split between
        // seller and treasury, so reserve == balance is preserved. No treasury set ⇒ no fee.
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

        // Revocation must not brick the trade; see buyBonding. Every other `postForAction` revert
        // still reverts the sell.
        if (messageData.length > 0 && masterRegistry.isInstanceFromApprovedFactory(address(this))) {
            globalMessageRegistry.postForAction(msg.sender, address(this), messageData);
        }

        SmartTransferLib.smartTransferETH(msg.sender, netRefund, weth);
        emit BondingSale(msg.sender, amount, netRefund, false);
    }

    // ┌─────────────────────────┐
    // │   Reroll Functionality  │
    // └─────────────────────────┘

    /// @notice Reroll selected NFTs. The body lives in the immutable `ERC404BondingOps` and is reached
    ///         by a discard-returndata delegatecall, so it runs in this instance's storage context.
    ///         The selector/param types match `rerollSelectedNFTs(uint256,uint256[])` so raw
    ///         `msg.data` forwards verbatim.
    /// @dev    Returndata is discarded: bubbling it (via `bytes memory ret` or inline-asm
    ///         returndatacopy) triggers a via_ir size cliff (+~1.5KB) that breaks the EIP-170 gate.
    ///         Ops's specific reverts (`TokenAmountMustPositive`, ...) surface as the generic
    ///         `RerollFailed()`; the specifics remain visible in traces. No `nonReentrant` here — the
    ///         guard lives on the Ops side and engages via the shared fixed slot under delegatecall;
    ///         guarding both ends would self-revert.
    // slither-disable-next-line low-level-calls,unused-return
    function rerollSelectedNFTs(uint256, uint256[] calldata) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert RerollFailed();
    }

    // ┌─────────────────────────┐
    // │   Token Tiers           │
    // └─────────────────────────┘

    /// @notice Mint up: convert `w_N` units' worth of holdings into one tier-N band NFT.
    /// @dev Same trampoline shape as reroll: the body lives in `ERC404BondingOps` and runs in this
    ///      instance's storage. The selector/param types match `mintUp(uint8,uint256)` so raw
    ///      `msg.data` forwards verbatim. Returndata is discarded (bubbling trips the via_ir size
    ///      cliff), so Ops's specific reverts surface as the generic `TierOpFailed()`; the specifics
    ///      remain visible in traces. No `nonReentrant` here: the guard lives on the Ops side and
    ///      engages via the shared fixed slot; guarding both self-reverts.
    // slither-disable-next-line low-level-calls,unused-return
    function mintUp(uint8, uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert TierOpFailed();
    }

    /// @notice Mint down: the exact inverse of `mintUp` — the band NFT becomes an ordinary NFT again
    ///         and its escrow returns to the caller's liquid balance. See `mintUp` for the trampoline
    ///         contract.
    // slither-disable-next-line low-level-calls,unused-return
    function mintDown(uint256) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert TierOpFailed();
    }

    /// @notice A holder's TRUE coin holdings: liquid ERC20 balance plus the coin escrowed behind every
    ///         band NFT they own (`(w_N - 1) * unit` per band id, derived from the id — never stored).
    /// @dev ERC20 `balanceOf` stays the transferable amount, as DN404 defines it. This is the
    ///      aggregate view for UI/indexers, mirroring the staking module's effective-holdings view.
    /// @dev O(ownedLength × bandCount). View only — never call it on a write path.
    function coinBalanceOf(address holder) external view returns (uint256 total) {
        total = balanceOf(holder);
        uint256 n = tierBands.length;
        if (n == 0) return total;
        uint256[] memory ids = _ownedIds(holder, 0, type(uint256).max);
        uint256 u = unit;
        for (uint256 i = 0; i < ids.length; i++) {
            // Shared band walk, the same code the burn-safety hook uses to size a release, so this
            // view and the escrow accounting agree on what an id is worth.
            (bool isBand,, uint256 weight) = _bandOf(ids[i]);
            if (isBand) total += (weight - 1) * u;
        }
    }

    /// @notice The ids `holder` owns, IN OWNED-ARRAY ORDER — index 0 first, the tail last.
    /// @dev The order is load-bearing. DN404 reconciles `ownedLength == balance / unit` on every
    ///      debit by burning ids LIFO off the tail of `owned[holder]` (see `ERC404BondingStorage`'s
    ///      `_afterNFTTransfers` note). The mirror exposes no enumeration, and an owned set
    ///      reconstructed from Transfer logs carries no order, so without this view no caller can say
    ///      which pieces a pending debit — including `mintUp`'s escrow leg — will burn.
    /// @dev Reads only state DN404 maintains. Unbounded in `ownedLength`, so it is an off-chain view
    ///      (the DN404 helper it wraps is documented the same way) — never call it on a write path.
    /// @param holder The address to enumerate.
    /// @return ids `holder`'s ids, ordered by their index in `owned[holder]`.
    function ownedIdsOf(address holder) external view returns (uint256[] memory ids) {
        ids = _ownedIds(holder, 0, type(uint256).max);
    }

    /// @notice Claim coin released by DN404 burning a band NFT you owned.
    /// @dev The counterpart to the `_afterNFTTransfers` burn-safety hook. The hook fires in the middle
    ///      of DN404's own accounting and so never moves value — it only records
    ///      `pendingEscrowRelease`. This is the pull leg, the only place that coin moves.
    ///      Checks-effects-interactions: the credit is zeroed before the transfer, and `nonReentrant`
    ///      holds on top, so a receiver hook that calls back in finds nothing left to claim.
    /// @dev The returned coin re-materializes the holder's tier-0 NFTs through DN404's own mint loop
    ///      (subject to their skipNFT setting).
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
     * @dev Owner-only (or delegated agent): graduating a collection to the DEX is a creator action,
     *      not something any passerby can trigger. The bonding-open-time guard applies so a
     *      curve can't be graduated before it opens.
     * @param carveRequestBps Fraction (bps) of the protocol carve allowance the creator takes,
     *        on the same axis as `declaredMaxAllowanceBps`. Effective carve ETH =
     *        min(request, allowance(raise) × declaredMaxAllowanceBps / 10000, headroom above the
     *        pool floor). Passing 0 takes no carve.
     */
    /// @dev Discard-returndata trampoline: the body lives in the immutable `ERC404BondingOps` and runs
    ///      in this instance's storage context under `delegatecall`, so the selector and parameter
    ///      types match `deployLiquidity(uint256)` for raw `msg.data` to forward verbatim. Sizing the
    ///      pool from the curve's marginal price, resolving the placeable coin from live balances and
    ///      burning the remainder does not fit this contract's EIP-170 budget. No guard sits on this
    ///      side — `_requireOwnerOrAgent`, the bonding clock checks and `nonReentrant` live on the Ops
    ///      side and resolve against the same `msg.sender`, Ownable slot and shared reentrancy slot;
    ///      guarding both ends would self-revert. Ops's specific reverts (`AlreadyDeployed`,
    ///      `NoReserve`, `TooEarly`, …) surface as the generic `GraduationFailed()` and stay visible
    ///      in traces.
    /// @dev The parameter is named because the name is part of the published ABI the app's generated
    ///      bindings carry. It is read on the Ops side out of the forwarded `msg.data`, never here.
    // slither-disable-next-line low-level-calls,unused-return
    function deployLiquidity(uint256 carveRequestBps) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert GraduationFailed();
    }

    /// @inheritdoc IGraduationSkipNFTTarget
    /// @dev Venue handshake. This instance overrides `_skipNFTDefault` to `false` for every
    ///      address, so any recipient that has not set the flag — contract or not — is minted one NFT
    ///      id per `unit` it receives. Graduation moves the pool's whole coin side through the deployer
    ///      module and on to the venue's counterparties, so without the flag each of them is minted the
    ///      pool's worth of ids, and the module burns its set again on the way out. The cost scales
    ///      linearly with the collection size and dominates the graduation transaction.
    ///
    ///      The module names its own counterparties here because only it knows them, and a venue that
    ///      creates its pool during graduation leaves nothing to read beforehand. Each module calls
    ///      this before its coin moves; the deployer's own leg is flagged by the graduation body
    ///      before the coin is transferred to it.
    ///
    /// @dev No reentrancy guard: `deployLiquidity`'s body is `nonReentrant` and it is the frame that
    ///      calls into the module, which calls back in here. Solady's guard is a single shared lock,
    ///      so a `nonReentrant` here would revert every graduation. The deployer-only check is the
    ///      whole authorization: `liquidityDeployer` is set once at `initialize` and this function
    ///      only sets a DN404 flag.
    function markGraduationSkipNFT(address counterparty) external {
        if (msg.sender != address(liquidityDeployer)) revert NotLiquidityDeployer();
        _setSkipNFT(counterparty, true);
    }

    /// @notice Effective carve ETH for a given raise + request. Exposed so the UI can cap the
    ///         graduation carve control at the live-computed maximum (pass 10000 for the max).
    /// @dev Zero-request / zero-declared short-circuits before touching the factory, so a plain
    ///      deployLiquidity(0) never depends on the factory exposing carve math. The pool floor
    ///      (`minPoolEth`) clamps the carve; it never gates graduation. No line compares `minPoolEth`
    ///      to `ethForPool`, so a collection whose creator misconfigured it can always leave the
    ///      curve rather than hold other people's ETH. `ERC404Factory.effectiveCarveEth` applies the
    ///      clamp.
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
    ///      a non-empty augmentation, it wins; any failure (revert / gas-bomb / ABI-undecodable return /
    ///      code-less address) falls back to base, so tokenURI cannot be bricked by a misbehaving
    ///      module. Uses _ownerAt (revert-free), not _ownerOf.
    ///      `SafeResolverLib.tryResolve` does a low-level `staticcall` + guarded decode: a malformed
    ///      success degrades to base just like a revert (a plain `try…returns(string)` would let the
    ///      decode failure escape the `catch` and revert the read). The lib also degrades on a
    ///      code-less resolver (staticcall succeeds empty).
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
