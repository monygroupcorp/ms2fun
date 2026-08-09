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
    SetStyleFailed,
    ActivateStakingFailed
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
// NOTE (noesis-149): the same treatment for the thirteen externalized CONFIG bodies. `NotInitialized`,
// `InvalidGlobalMessageRegistry`, `ModuleAlreadySet`, `TimeMustBeInFuture`, `OpenTimeMustBeSetFirst`,
// `MaturityMustBeAfterOpenTime`, `OpenTimeNotSet`, `CannotActivateAfterLiquidityDeployed` and
// `StakingAlreadyActive` are now raised ONLY on the Ops side and are declared there (in the shared
// base). `OnlyFactory`, `AlreadyInitialized` and `InvalidOwner` moved to the base too but are STILL
// raised here — by `initialize` and `initializeMetadata` — so they are imported above and stay
// importable FROM this file by name, exactly as before.
error AlreadyDeployed();
error BondingNotActive();
error ExceedsBonding();
error InsufficientBalance();
error InvalidLiquidityDeployer();
error InvalidMaxSupply();
error InvalidMirror();
/// @dev The `ops` delegatecall target has no code. `delegatecall` to a code-less address returns
///      SUCCESS and writes nothing, so every trampoline on this contract would become a silent
///      no-op — including `initializeProtocol`/`initModule` (called by the factory during
///      `createInstance`) and `initTierBands` (the ladder SEAL). `address(0)` is a subset of this
///      check; a non-zero EOA is exactly as broken. Constructor-only, so it costs no runtime bytes.
error InvalidOps();
error InvalidRefund();
error InvalidVault();
error LowETHValue();
error MaxCostExceeded();
error NoReserve();
error TransactionExpired();
error AmountMustBePositive();
error FreeMintNotInitialized();
error PurchaseTooSmall();
error MetadataAlreadySet();
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
    event LiquidityDeployed(address indexed deployer, uint256 amountToken, uint256 amountETH);
    event BondingFeePaid(address indexed buyer, uint256 feeAmount);

    // `FreeMintClaimed` / `Staked` / `Unstaked` / `StakingRewardsClaimed` moved to
    // `ERC404BondingStorage` (noesis-148), and `BondingOpenTimeSet` / `BondingMaturityTimeSet` /
    // `BondingActiveChanged` / `AgentDelegationChanged` / `StakingActivated` / `ModuleSet` moved there
    // by noesis-149: their emitters now run on the Ops side. Same signatures, same topic0 — they are
    // still emitted from THIS instance's address under delegatecall.

    // ┌─────────────────────────┐
    // │      Constructor        │
    // └─────────────────────────┘

    /// @param ops The shared, immutable `ERC404BondingOps` delegatecall target for the externalized
    ///        reroll body. Deployed BEFORE the master and passed here; non-upgradeable (no setter).
    /// @dev Reverts `InvalidOps` if `ops` carries no code (noesis-150). Every externalized entry point
    ///      is a `delegatecall` trampoline whose only failure check is the returned boolean, and a
    ///      `delegatecall` to a code-less address returns `true` having written nothing — so a master
    ///      built with a bad `ops` would produce launches that report success and are silently broken.
    ///      Deploy-time misconfiguration guard: it runs in creation code, so the EIP-170 subject
    ///      (`deployedBytecode`) is unchanged.
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

    // ── Config trampolines (noesis-149 D2 diet) ───────────────────────────────────────────────────
    // The thirteen init/admin/setter bodies below were externalized into the immutable
    // `ERC404BondingOps` and are reached by the same discard-returndata `delegatecall` trampoline
    // noesis-091/-142/-148 established, so each runs in THIS instance's storage context. NO VALUE MOVES
    // on any of these paths — they configure, they do not transfer — which is why D2 was the lowest-risk
    // lever left. For every one of them:
    //   * the selector and parameter types are byte-identical to the pre-move signature, so raw
    //     `msg.data` forwards verbatim and the ABI is unchanged apart from the new generic errors;
    //   * NO guard sits on this side — the factory-only check, the `onlyOwner`-equivalent check in
    //     `setAgentDelegation`, and `_requireOwnerOrAgent` all live on the Ops side ONLY, resolving
    //     against the same `msg.sender` (preserved under delegatecall), the same Ownable slot and the
    //     same `masterRegistry`. A caller who could not call one of these before still cannot;
    //   * returndata is DISCARDED (bubbling re-triggers the via_ir size cliff the diet exists to buy
    //     back), so Ops's specific revert surfaces as this entry point's generic error. Every revert
    //     still HAPPENS and the specific error stays visible in traces.
    // Each entry point gets its OWN generic error — never a shared `ConfigFailed()` — so a failed
    // `createInstance` still identifies which init step broke (`ERC404Factory` calls
    // `initializeProtocol`, `initializeFreeMint`, `initializeStaking`, `initModule` and
    // `setAgentDelegationFromFactory` during create).
    // `initialize`, `initializeMetadata` and `migrateVault` deliberately KEPT their bodies here.
    // `setContractURI` (noesis-085) was AUTHORED as a fourteenth trampoline rather than as an in-instance
    // setter: this contract is the EIP-170 subject, and a body here costs the scarce bytes while the same
    // body on the Ops side costs a bare trampoline. It carries no guard for the same reason as the rest —
    // `_requireOwnerOrAgent` runs on the Ops side against the identical `msg.sender`.

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
     * @param tokenBaseURI_ The PER-TOKEN base URI `tokenURI(tokenId)` composes against
     *        (`params.tokenBaseURI` at the factory).
     * @param contractURI_ The COLLECTION-level ERC-7572 URI (noesis-085) — the project document, the same
     *        string the factory hands the master registry at create. Distinct from `tokenBaseURI_`: one
     *        describes the collection, the other is the prefix for every token. Never conflate them.
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
    /// @dev Same discard-returndata trampoline as `setMetadataURI` (body in `ERC404BondingOps`, guard on
    ///      that side only). This does NOT touch `metadataURI` — the per-token base URI is a separate slot
    ///      with a separate setter.
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
    ///         with `w_0 = 1` and is never stored. Every band must sit ABOVE `idLimit` — that is what
    ///         makes band ids unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///         `_wrapNFTId(.., idLimit)` where `idLimit = totalSupply / unit`, fixed for this instance's
    ///         life), so a reserved band carves NOTHING out of the sellable supply. Band size is a
    ///         PRODUCT CHOICE bounded above by `band_N <= S / w_N` (S = the tier-0 id count), rounded
    ///         DOWN — an uncapped band at exactly `S / w_N` can hold the entire supply if it all
    ///         concentrated there, and a band deliberately capped BELOW that is a scarce tier: it can
    ///         sell out while coin remains, so `BandExhausted` is reachable by design on such a band
    ///         (and reopens as holders `mintDown`).
    /// @dev    The seal's invariants (`_tiersSealed` set-once, ascending bands strictly above `idLimit`,
    ///         `weight >= 2`) are load-bearing for the burn-safety hook and were moved BYTE-FOR-BYTE
    ///         into `ERC404BondingOps.initTierBands`.
    /// @dev    Ascending, non-overlapping bands with strictly increasing weights (`w >= 2`).
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
    /// @dev DN404 tracks this internally and only the mirror exposes it today. Reverts on unminted
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

    // `_requireOwnerOrAgent()` moved to the shared `ERC404BondingStorage` base (noesis-149), unchanged:
    // ten of its callers now execute on the Ops side while `deployLiquidity` still calls it from here,
    // and the base is the only way to guarantee both contracts compile the IDENTICAL gate.

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

    /// @dev `StateChanged` is still emitted, from Ops's qualified `emit IInstanceLifecycle.StateChanged`
    ///      — same topic0, same emitting address (this instance) under delegatecall.
    // slither-disable-next-line low-level-calls,unused-return
    function setBondingActive(bool) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetBondingActiveFailed();
    }

    // slither-disable-next-line low-level-calls,unused-return
    function setStyle(string memory) external {
        (bool ok,) = _ops.delegatecall(msg.data);
        if (!ok) revert SetStyleFailed();
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
