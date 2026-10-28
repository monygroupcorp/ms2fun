// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { SmartTransferLib } from "../../libraries/SmartTransferLib.sol";
import { IDynamicPricingModule } from "./interfaces/IDynamicPricingModule.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IGlobalMessageRegistry } from "../../registry/interfaces/IGlobalMessageRegistry.sol";
import { IGatingModule, GatingScope } from "../../gating/IGatingModule.sol";

// ── Free mint errors ─────────────────────────────────────────────────────────
error FreeMintDisabled();
error FreeMintAlreadyClaimed();
error FreeMintExhausted();
error FreeMintExceedsSupply();

// ── ERC1155Instance errors ───────────────────────────────────────────────────
error InvalidName();
error InvalidAddress();
error Unauthorized();
error AmountMustBePositive();
error EditionNotFound();
error EditionNotOpen();
error EditionClosed();
error EditionSoldOut();
error ExceedsWalletLimit();
error InvalidCloseTime();
error EditionAlreadyMinted();
error ExceedsSupply();
error ExceedsMaxCost();
error InsufficientPayment();
error InsufficientBalance();
error InvalidTitle();
error InvalidPrice();
error UnlimitedMustHaveZeroSupply();
error LimitedMustHavePositiveSupply();
error DynamicPricingRequiresIncreaseRate();
error EditionLimitReached();
error NoFeesToClaim();
error NoPendingVaultCut();
error LengthMismatch();
error GatingCheckFailed();
error ERC1155RejectedTokens();
error NoDynamicPricingModule();
error OnlyFactory();
error AlreadyInitialized();
/// @dev The clone guard, distinct from `AlreadyInitialized` (the free-mint setup one-shot).
error InstanceAlreadyInitialized();
import { Currency } from "v4-core/types/Currency.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { IInstanceLifecycle, TYPE_ERC1155, STATE_MINTING } from "../../interfaces/IInstanceLifecycle.sol";

/**
 * @title ERC1155Instance
 * @notice ERC1155 token instance for open edition artists
 * @dev Supports unlimited/limited editions with fixed or dynamic pricing, message system, and withdraw tax
 */
// slither-disable-next-line missing-inheritance
contract ERC1155Instance is Ownable, ReentrancyGuard, IInstanceLifecycle {
    // ┌─────────────────────────┐
    // │         Types           │
    // └─────────────────────────┘

    enum PricingModel {
        UNLIMITED, // Unlimited supply, fixed price
        LIMITED_FIXED, // Limited supply, fixed price
        LIMITED_DYNAMIC // Limited supply, exponential price increase
    }

    /// @notice All addresses wired at construction. Passed as one struct to keep the
    ///         constructor under the stack-depth limit without via-ir.
    struct InstanceInit {
        address globalMessageRegistry;
        address protocolTreasury;
        address masterRegistry;
        address gatingModule;
        address dynamicPricingModule;
        address weth;
    }

    struct Edition {
        uint256 id;
        string pieceTitle;
        uint256 basePrice; // Base price for dynamic pricing
        uint256 supply; // 0 = unlimited
        uint256 minted;
        string metadataURI;
        PricingModel pricingModel;
        uint256 priceIncreaseRate; // For dynamic pricing (basis points, e.g., 100 = 1%)
        uint256 openTime; // Unix timestamp; 0 = open immediately
    }

    // ┌─────────────────────────┐
    // │      State Variables     │
    // └─────────────────────────┘

    string public name;
    /// @notice Optional collection symbol (ERC1155 has no standard symbol; empty allowed).
    string public symbol;
    /// @notice ERC-7572 collection-level metadata URI. Single source of truth for this instance's
    ///         collection metadata (name/image/etc.) as read by marketplaces and indexers.
    string public contractURI;
    // slither-disable-next-line immutable-states
    address public creator;
    // slither-disable-next-line immutable-states
    address public factory;
    IAlignmentVault public vault;
    /// @notice The genesis vault, bound at initialization: what buyers pay in against. Pinned so the
    ///         revenue-split family used at settlement cannot diverge from it if `vault` is migrated.
    /// @dev Set once. Immutables live in the runtime code every EIP-1167 clone shares, so per-collection
    ///      values are storage written only by `initialize`, which `_initialized` lets run once.
    ///      Slither's `immutable-states` suggestion does not apply to them.
    address public genesisVault;
    // slither-disable-next-line immutable-states
    IMasterRegistry public masterRegistry;
    IGlobalMessageRegistry public globalMessageRegistry;
    address public protocolTreasury;
    address public weth;

    // Customization
    string public styleUri;

    mapping(uint256 => Edition) public editions;
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    // slither-disable-next-line immutable-states
    IGatingModule public gatingModule;
    // slither-disable-next-line immutable-states
    IDynamicPricingModule public dynamicPricingModule;

    // Free mint, per edition: each edition carries its own allocation, claim counter and per-user
    // claimed flag. A wallet may claim one free token per edition, and editions' allocations are
    // independent. `gatingScope` is collection-level.
    mapping(uint256 => uint256) public freeMintAllocation;
    mapping(uint256 => uint256) public freeMintsClaimed;
    mapping(uint256 => mapping(address => bool)) public freeMintClaimed;
    GatingScope public gatingScope;
    bool private _freeMintInitialized;
    bool public agentDelegationEnabled;

    // Edition schedule: a close time and a per-wallet ceiling beside `openTime`. They live in side
    // mappings, not in `Edition`, because `QueryAggregator.IERC1155EditionReader` declares its own
    // copy of that struct and decodes `getEdition` against it, so a new struct field would break
    // those reads.
    /// @notice Unix timestamp at which an edition stops minting. 0 = never closes.
    /// @dev Exclusive: minting reverts AT this timestamp, mirroring `openTime`, which opens at its own.
    mapping(uint256 => uint256) public editionCloseTime;
    /// @notice Most tokens of an edition one wallet may take, across the paid and free paths
    ///         together. 0 = no ceiling.
    mapping(uint256 => uint256) public editionMaxPerWallet;
    /// @notice Tokens of an edition a wallet has MINTED, paid and free together.
    /// @dev Not `balanceOf`: a balance falls on transfer, so a ceiling read off it would let one wallet
    ///      take the whole edition by emptying itself between mints.
    mapping(uint256 => mapping(address => uint256)) public editionMintedBy;

    uint256 public nextEditionId;
    uint256 public totalProceeds; // Total ETH collected from mints
    uint256 public totalWithdrawn; // Total ETH passed to withdraw() (prevents double-withdrawal and force-feed attacks)
    /// @dev INVARIANT: pendingVaultCut <= address(this).balance at all times.
    ///      Failed vault contributions stay in the contract, tracked here so they
    ///      cannot be re-withdrawn as artist proceeds.
    uint256 public pendingVaultCut;

    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    event TransferBatch(
        address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values
    );

    event ApprovalForAll(address indexed account, address indexed operator, bool approved);

    event EditionAdded(
        uint256 indexed editionId, string pieceTitle, uint256 basePrice, uint256 supply, PricingModel pricingModel
    );

    event Minted(address indexed to, uint256 indexed editionId, uint256 amount, uint256 totalCost);

    event Withdrawn(address indexed creator, uint256 artistAmount, uint256 vaultCut, uint256 protocolCut);

    event VaultContributionFailed(address indexed vault, uint256 amount);
    event VaultContributionRetried(address indexed vault, uint256 amount);
    /// @notice The vault's alignment target has been de-curated (`isVaultRegistered` false), so the
    ///         community cut it would have funded was returned to the creator. Withdraw still succeeds.
    /// @dev INVARIANT: de-curation may destroy value; it may not transfer value to the protocol. No
    ///      `isVaultRegistered`-false branch in this contract routes to `protocolTreasury`.
    event VaultCutReturnedToCreator(address indexed vault, address indexed creator, uint256 amount);
    /// @notice A vault cut stashed by a failed push was returned to the creator on retry, because the
    ///         vault's alignment target was de-curated while it sat.
    /// @dev Distinct from `VaultCutReturnedToCreator`, which the primary withdraw path emits when a
    ///      cut is returned as it is earned. Only that one is new revenue; a single shared event would
    ///      double-count a cut that was stashed once and returned later.
    event PendingVaultCutReturnedToCreator(address indexed vault, address indexed creator, uint256 amount);

    event EditionMetadataUpdated(uint256 indexed editionId, string metadataURI);
    /// @dev ERC-1155 required event. Emitted wherever an edition's metadata URI is set: at creation
    ///      (`addEdition`, where it is fixed) and on change (`updateEditionMetadata`). The
    ///      collection-level ERC-7572 `contractURI` is not a per-id URI and is not a site for this.
    event URI(string value, uint256 indexed id);
    event FreeMintClaimed(address indexed user, uint256 indexed editionId);
    /// @dev Emitted when an edition's free-mint allocation is set, at creation or on adjustment.
    event FreeMintAllocationSet(uint256 indexed editionId, uint256 allocation);
    /// @dev Emitted when an edition's close time or per-wallet ceiling is set, at creation or on
    ///      reschedule. Always carries both, so one event is the whole schedule.
    event EditionScheduleSet(uint256 indexed editionId, uint256 closeTime, uint256 maxPerWallet);
    event ContractURIUpdated();

    // ┌─────────────────────────┐
    // │      Constructor        │
    // └─────────────────────────┘

    // ── Clone guard ───────────────────────────────────────────────────────

    /// @dev True for the implementation from the moment it is deployed, and for a clone from the
    ///      moment the factory initializes it.
    bool private _initialized;

    /// @notice Locks the implementation this file deploys directly.
    /// @dev Collections are EIP-1167 clones of one implementation, and an uninitialized
    ///      implementation could be initialized and owned by anyone. Setting the flag in the
    ///      constructor leaves clones, whose storage starts empty, as the only contracts `initialize`
    ///      can run on.
    constructor() {
        _initialized = true;
    }

    /// @notice Bind a freshly cloned instance to its collection. Called by the factory in the same
    ///         transaction that deploys the clone, so there is no window in which an uninitialized
    ///         clone exists at a known address for anyone else to claim.
    function initialize(
        string calldata _name,
        address _creator,
        address _factory,
        address _vault,
        string calldata _styleUri,
        InstanceInit calldata _init,
        bool _agentCreated,
        string calldata _metadataURI,
        string calldata _symbol
    ) external {
        if (_initialized) revert InstanceAlreadyInitialized();
        _initialized = true;

        if (bytes(_name).length == 0) revert InvalidName();
        if (_creator == address(0)) revert InvalidAddress();
        if (_factory == address(0)) revert InvalidAddress();
        if (_vault == address(0)) revert InvalidAddress();
        if (_init.globalMessageRegistry == address(0)) revert InvalidAddress();

        _initializeOwner(_creator);
        name = _name;
        // symbol is OPTIONAL for ERC1155 (no empty-check, unlike ERC721's InvalidSymbol).
        symbol = _symbol;
        contractURI = _metadataURI;
        creator = _creator;
        factory = _factory;
        vault = IAlignmentVault(payable(_vault));
        genesisVault = _vault;
        masterRegistry = IMasterRegistry(_init.masterRegistry);
        globalMessageRegistry = IGlobalMessageRegistry(_init.globalMessageRegistry);
        protocolTreasury = _init.protocolTreasury;
        weth = _init.weth;
        styleUri = _styleUri;
        nextEditionId = 1;
        if (_init.gatingModule != address(0)) {
            gatingModule = IGatingModule(_init.gatingModule);
        }
        if (_init.dynamicPricingModule != address(0)) {
            dynamicPricingModule = IDynamicPricingModule(_init.dynamicPricingModule);
        }
        emit StateChanged(STATE_MINTING);
        agentDelegationEnabled = _agentCreated;
    }

    /// @notice Update the ERC-7572 collection metadata URI. Owner-only.
    function setContractURI(string calldata newContractURI) external onlyOwner {
        contractURI = newContractURI;
        emit ContractURIUpdated();
    }

    /// @notice Accept ETH pushed by alignment vaults when fees are claimed.
    /// @dev Alignment vaults pay the benefactor (this instance) via a raw ETH push
    ///      (payable(recipient).call{value}("")). Without a receive() that push fails and
    ///      claimFees()/claimAllFees() revert TransferFailed, stranding the fees as unclaimable.
    ///      Force-fed ETH is contained: withdraw() is capped at totalProceeds - totalWithdrawn
    ///      (mint proceeds only), so a direct transfer here cannot inflate creator withdrawals.
    receive() external payable { }

    // ── IInstanceLifecycle ─────────────────────────────────────────────────────

    function instanceType() external pure override returns (bytes32) {
        return TYPE_ERC1155;
    }

    // ── Free mint ─────────────────────────────────────────────────────────────

    /// @notice Set the collection-level gating scope. Called by the factory once after construction.
    /// @dev Free-mint allocation is per edition, set by `addEdition`'s `freeMintAlloc` or
    ///      `setEditionFreeMintAllocation`. Editions do not exist at create time, so only the
    ///      collection-level gating `scope` is stored here; `ERC1155Factory` rejects a non-zero
    ///      `FreeMintParams.allocation`.
    function initializeFreeMint(GatingScope scope) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (_freeMintInitialized) revert AlreadyInitialized();
        _freeMintInitialized = true;
        gatingScope = scope;
    }

    /// @notice Toggle agent delegation for this instance
    function setAgentDelegation(bool enabled) external {
        if (msg.sender != owner()) revert Unauthorized();
        agentDelegationEnabled = enabled;
    }

    /// @notice Claim one free token of a specified edition at zero ETH cost.
    /// @param editionId  The edition to claim from. Must exist.
    /// @param gatingData Passed to gatingModule.canMint if scope requires it.
    // slither-disable-next-line reentrancy-benign,reentrancy-no-eth,unused-return
    function claimFreeMint(uint256 editionId, bytes calldata gatingData) external nonReentrant {
        uint256 alloc = freeMintAllocation[editionId];
        if (alloc == 0) revert FreeMintDisabled();
        if (freeMintClaimed[editionId][msg.sender]) revert FreeMintAlreadyClaimed();
        if (freeMintsClaimed[editionId] >= alloc) revert FreeMintExhausted();

        Edition storage edition = editions[editionId];
        if (bytes(edition.pieceTitle).length == 0) revert EditionNotFound();
        // The open time gates the free path as it does `mint`. The gating block below is skipped
        // with no gating module or under PAID_ONLY scope, so `openTime` is then the only guard
        // against draining the allocation before the public open.
        if (edition.openTime != 0 && block.timestamp < edition.openTime) revert EditionNotOpen();
        // The free allocation is part of the drop, so it ends when the edition closes.
        uint256 closeTime = editionCloseTime[editionId];
        if (closeTime != 0 && block.timestamp >= closeTime) revert EditionClosed();
        // The per-wallet ceiling spans both paths, so a free claim spends one against it.
        uint256 maxPerWallet = editionMaxPerWallet[editionId];
        if (maxPerWallet != 0 && editionMintedBy[editionId][msg.sender] + 1 > maxPerWallet) {
            revert ExceedsWalletLimit();
        }
        if (edition.supply > 0) {
            if (edition.minted >= edition.supply) revert EditionSoldOut();
        }

        if (address(gatingModule) != address(0) && gatingScope != GatingScope.PAID_ONLY) {
            (bool allowed,) = gatingModule.canMint(msg.sender, editionId, 1, edition.openTime, gatingData);
            if (!allowed) revert GatingCheckFailed();
            gatingModule.onMint(msg.sender, editionId, 1);
        }

        freeMintClaimed[editionId][msg.sender] = true;
        freeMintsClaimed[editionId]++;
        edition.minted++;
        editionMintedBy[editionId][msg.sender]++;
        balanceOf[msg.sender][editionId]++;

        emit FreeMintClaimed(msg.sender, editionId);
        emit TransferSingle(msg.sender, address(0), msg.sender, editionId, 1);
    }

    // ┌─────────────────────────┐
    // │   Edition Management    │
    // └─────────────────────────┘

    /// @dev The owner-or-delegated-agent check every edition-management entry point shares.
    function _requireOwnerOrAgent() private view {
        if (msg.sender == owner()) return; // Owner always allowed
        // Direct agent call when delegation is on (non-custodial config)
        if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) return;
        revert Unauthorized();
    }

    /// @dev A close time must fall after the edition opens, so an edition is never created or
    ///      rescheduled into a window already over. `openTime == 0` means open now, so the comparison
    ///      is against the current block there. `closeTime == 0` never closes and is always allowed.
    function _validateSchedule(uint256 openTime, uint256 closeTime) private view {
        if (closeTime == 0) return;
        uint256 opensAt = openTime == 0 ? block.timestamp : openTime;
        if (closeTime <= opensAt) revert InvalidCloseTime();
    }

    /**
     * @notice Add a new edition, with the schedule it runs to.
     * @param pieceTitle Title of the piece
     * @param basePrice Base price (for fixed) or starting price (for dynamic)
     * @param supply Supply limit (0 = unlimited)
     * @param metadataURI Metadata URI for the edition
     * @param pricingModel Pricing model (UNLIMITED, LIMITED_FIXED, LIMITED_DYNAMIC)
     * @param priceIncreaseRate Price increase rate in basis points (for dynamic pricing)
     * @param openTime Unix timestamp; 0 = open immediately
     * @param freeMintAlloc Per-edition free-mint allocation (0 = no free mints). Reserved from supply:
     *        for a limited edition (supply > 0) it must be <= supply, so free claims come out of the
     *        edition's supply; an unlimited edition (supply == 0) accepts any allocation.
     * @param closeTime Unix timestamp at which minting stops; 0 = never closes. Must fall after the
     *        edition opens.
     * @param maxPerWallet Most tokens one wallet may mint of this edition, paid and free together;
     *        0 = no ceiling.
     * @dev The schedule is set in the creating transaction, so the edition is never live and
     *      unbounded. It stays correctable until the first mint via `setEditionSchedule`.
     */
    function addEdition(
        string memory pieceTitle,
        uint256 basePrice,
        uint256 supply,
        string memory metadataURI,
        PricingModel pricingModel,
        uint256 priceIncreaseRate,
        uint256 openTime,
        uint256 freeMintAlloc,
        uint256 closeTime,
        uint256 maxPerWallet
    ) external {
        _requireOwnerOrAgent();
        if (bytes(pieceTitle).length == 0) revert InvalidTitle();
        if (basePrice == 0) revert InvalidPrice();

        if (pricingModel == PricingModel.UNLIMITED) {
            if (supply != 0) revert UnlimitedMustHaveZeroSupply();
        } else {
            if (supply == 0) revert LimitedMustHavePositiveSupply();
        }

        if (pricingModel == PricingModel.LIMITED_DYNAMIC) {
            if (address(dynamicPricingModule) == address(0)) revert NoDynamicPricingModule();
            if (priceIncreaseRate == 0) revert DynamicPricingRequiresIncreaseRate();
        }

        // Reserve-from-supply cap: free allocation is drawn from a limited edition's supply.
        if (supply > 0 && freeMintAlloc > supply) revert FreeMintExceedsSupply();

        _validateSchedule(openTime, closeTime);

        if (nextEditionId > type(uint32).max) revert EditionLimitReached();

        uint256 editionId = nextEditionId++;
        editions[editionId] = Edition({
            id: editionId,
            pieceTitle: pieceTitle,
            basePrice: basePrice,
            supply: supply,
            minted: 0,
            metadataURI: metadataURI,
            pricingModel: pricingModel,
            priceIncreaseRate: priceIncreaseRate,
            openTime: openTime
        });

        if (freeMintAlloc > 0) {
            freeMintAllocation[editionId] = freeMintAlloc;
            emit FreeMintAllocationSet(editionId, freeMintAlloc);
        }

        // Written only when there is a schedule, so an open-ended edition adds no storage or event.
        if (closeTime > 0 || maxPerWallet > 0) {
            editionCloseTime[editionId] = closeTime;
            editionMaxPerWallet[editionId] = maxPerWallet;
            emit EditionScheduleSet(editionId, closeTime, maxPerWallet);
        }

        emit URI(metadataURI, editionId);
        emit EditionAdded(editionId, pieceTitle, basePrice, supply, pricingModel);
    }

    /**
     * @notice Set or clear an edition's close time and per-wallet ceiling, before it has sold.
     * @dev Editable until the first mint and not after: a collector who has paid chose a drop with a
     *      stated end and ceiling, and moving either would change the deal. The free-mint allocation
     *      carries no such bound (`setEditionFreeMintAllocation`); a giveaway the creator can widen
     *      is not a promise about what a buyer paid for.
     * @param editionId The edition to reschedule. Must exist and have no mints.
     * @param closeTime Unix timestamp at which minting stops; 0 = never closes.
     * @param maxPerWallet Most tokens one wallet may mint of this edition; 0 = no ceiling.
     */
    function setEditionSchedule(uint256 editionId, uint256 closeTime, uint256 maxPerWallet) external {
        _requireOwnerOrAgent();
        Edition storage edition = editions[editionId];
        if (edition.id == 0) revert EditionNotFound();
        if (edition.minted > 0) revert EditionAlreadyMinted();

        _validateSchedule(edition.openTime, closeTime);

        editionCloseTime[editionId] = closeTime;
        editionMaxPerWallet[editionId] = maxPerWallet;
        emit EditionScheduleSet(editionId, closeTime, maxPerWallet);
    }

    /**
     * @notice Adjust an edition's free-mint allocation at any time (owner or delegated agent).
     * @dev Same auth as `addEdition`. The allocation can change at any time, including after
     *      mints. The reserve cap holds: for a limited edition the allocation must be <= supply; an
     *      unlimited edition (supply == 0) accepts any value. Lowering below
     *      `freeMintsClaimed[editionId]` is permitted: claimed mints stand and `claimFreeMint` stays
     *      exhausted until the allocation is raised.
     * @param editionId The edition to adjust. Must exist.
     * @param allocation The new free-mint allocation.
     */
    function setEditionFreeMintAllocation(uint256 editionId, uint256 allocation) external {
        _requireOwnerOrAgent();
        Edition storage edition = editions[editionId];
        if (edition.id == 0) revert EditionNotFound();
        if (edition.supply > 0 && allocation > edition.supply) revert FreeMintExceedsSupply();

        freeMintAllocation[editionId] = allocation;
        emit FreeMintAllocationSet(editionId, allocation);
    }

    /**
     * @notice Update edition metadata
     * @param editionId Edition ID
     * @param metadataURI New metadata URI
     */
    function updateEditionMetadata(uint256 editionId, string memory metadataURI) external {
        _requireOwnerOrAgent();
        if (editions[editionId].id == 0) revert EditionNotFound();

        editions[editionId].metadataURI = metadataURI;
        emit URI(metadataURI, editionId);
        emit EditionMetadataUpdated(editionId, metadataURI);
    }

    /**
     * @notice Get global message registry address (public getter for frontend)
     * @return Address of the GlobalMessageRegistry contract
     */
    function getGlobalMessageRegistry() external view returns (address) {
        return address(globalMessageRegistry);
    }

    // ┌─────────────────────────┐
    // │   Pricing Functions    │
    // └─────────────────────────┘

    /**
     * @notice Get current price for an edition
     * @param editionId Edition ID
     * @return price Current price for the next mint
     */
    function getCurrentPrice(uint256 editionId) public view returns (uint256 price) {
        Edition storage edition = editions[editionId];
        if (edition.id == 0) revert EditionNotFound();

        if (edition.pricingModel == PricingModel.UNLIMITED || edition.pricingModel == PricingModel.LIMITED_FIXED) {
            return edition.basePrice;
        } else {
            // LIMITED_DYNAMIC
            return dynamicPricingModule.calculatePrice(edition.basePrice, edition.priceIncreaseRate, edition.minted);
        }
    }

    /**
     * @notice Calculate total cost for minting multiple tokens
     * @param editionId Edition ID
     * @param amount Number of tokens to mint
     * @return totalCost Total cost for minting the amount
     */
    function calculateMintCost(uint256 editionId, uint256 amount) public view returns (uint256 totalCost) {
        Edition storage edition = editions[editionId];
        if (edition.id == 0) revert EditionNotFound();
        if (amount == 0) revert AmountMustBePositive();

        if (edition.pricingModel == PricingModel.UNLIMITED || edition.pricingModel == PricingModel.LIMITED_FIXED) {
            return edition.basePrice * amount;
        } else {
            // LIMITED_DYNAMIC
            return dynamicPricingModule.calculateBatchCost(
                edition.basePrice, edition.priceIncreaseRate, edition.minted, amount
            );
        }
    }

    // ┌─────────────────────────┐
    // │    Minting Functions    │
    // └─────────────────────────┘

    /**
     * @notice Mint tokens with optional message
     * @param editionId Edition ID
     * @param amount Number of tokens to mint
     * @param messageData Optional encoded message data (empty bytes skips registry call, saves gas)
     * @param maxCost Maximum acceptable total cost (0 = no limit, uses msg.value as implicit cap)
     */
    // slither-disable-next-line reentrancy-benign,reentrancy-no-eth,timestamp,unused-return
    function mint(
        uint256 editionId,
        uint256 amount,
        bytes calldata gatingData, // module payload: password hash, or merkle (tierId, maxQty, proof)
        bytes calldata messageData,
        uint256 maxCost
    ) external payable nonReentrant {
        Edition storage edition = editions[editionId];
        if (edition.id == 0) revert EditionNotFound();
        if (amount == 0) revert AmountMustBePositive();

        // Time gate check
        if (edition.openTime != 0) {
            if (block.timestamp < edition.openTime) revert EditionNotOpen();
        }
        // The close time is checked before the gating module so no module sees a mint that cannot
        // happen (`onMint` is a state-changing call).
        uint256 closeTime = editionCloseTime[editionId];
        if (closeTime != 0 && block.timestamp >= closeTime) revert EditionClosed();

        // Per-wallet ceiling, counted off tokens minted (paid and free), see `editionMintedBy`.
        uint256 maxPerWallet = editionMaxPerWallet[editionId];
        if (maxPerWallet != 0 && editionMintedBy[editionId][msg.sender] + amount > maxPerWallet) {
            revert ExceedsWalletLimit();
        }

        // Gating check: forwards the authoritative editionId and openTime; gatingData is the raw
        // module payload. FREE_MINT_ONLY leaves paid buys open (it gates free-mint claims only),
        // as in the ERC404 buyBonding guard and IGatingModule's GatingScope doc; any other scope
        // gates the paid buy.
        if (address(gatingModule) != address(0) && gatingScope != GatingScope.FREE_MINT_ONLY) {
            (bool allowed,) = gatingModule.canMint(msg.sender, editionId, amount, edition.openTime, gatingData);
            if (!allowed) revert GatingCheckFailed();
            gatingModule.onMint(msg.sender, editionId, amount);
        }

        // Supply limit. The unclaimed free-mint reserve is withheld from paid supply so every
        // unclaimed free claim has supply behind it. `freeMintAllocation` can be lowered below
        // `freeMintsClaimed`, so the reserve is clamped at zero. The allocation is capped at supply
        // for a limited edition, so `minted + amount + reserve` gates paid mints to the non-reserved
        // remaining supply without an underflowing subtraction.
        if (edition.pricingModel != PricingModel.UNLIMITED) {
            uint256 claimed = freeMintsClaimed[editionId];
            uint256 alloc = freeMintAllocation[editionId];
            uint256 reserve = alloc > claimed ? alloc - claimed : 0;
            if (edition.minted + amount + reserve > edition.supply) revert ExceedsSupply();
        }

        // Calculate cost
        uint256 totalCost = calculateMintCost(editionId, amount);
        if (maxCost != 0 && totalCost > maxCost) revert ExceedsMaxCost();
        if (msg.value < totalCost) revert InsufficientPayment();

        // Update edition state
        edition.minted += amount;
        editionMintedBy[editionId][msg.sender] += amount;
        balanceOf[msg.sender][editionId] += amount;
        totalProceeds += totalCost;

        // Forward message to global registry. `postForAction` refuses a caller the registry no longer
        // approves (`revokeInstance` flips that), so revocation must not brick the mint: only that one
        // condition is skipped, and every other `postForAction` revert still reverts the mint.
        if (messageData.length > 0 && masterRegistry.isInstanceFromApprovedFactory(address(this))) {
            globalMessageRegistry.postForAction(msg.sender, address(this), messageData);
        }

        // Refund excess
        if (msg.value > totalCost) {
            SmartTransferLib.smartTransferETH(msg.sender, msg.value - totalCost, weth);
        }

        emit TransferSingle(msg.sender, address(0), msg.sender, editionId, amount);
        emit Minted(msg.sender, editionId, amount, totalCost);
    }

    // ┌─────────────────────────┐
    // │   Withdraw Functions    │
    // └─────────────────────────┘

    /**
     * @notice Withdraw proceeds (1% protocol, 19% vault, 80% artist)
     * @dev Applies 1/19/80 split: protocol treasury, alignment vault, artist
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (msg.sender != owner()) revert Unauthorized();
        if (amount == 0) revert AmountMustBePositive();
        // Use proceeds accounting to prevent force-fed ETH from bypassing the 1/19/80 split
        if (amount > totalProceeds - totalWithdrawn) revert InsufficientBalance();
        totalWithdrawn += amount;

        // The split is family-blind: 1% protocol / 19% vault / 80% creator. The family read is a
        // guard only: an unrecognized `vaultType()` on the pinned genesis vault (never the live
        // `vault`) reverts `UnknownVaultFamily` rather than settling against an unclassified vault.
        RevenueSplitLib.isLiquidityFamily(IAlignmentVault(payable(genesisVault)).vaultType());
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);

        // Protocol cut to treasury via smartTransferETH (WETH fallback), so a reverting treasury
        // cannot brick withdraw. The treasury is trusted, so there is no pending-retry lane.
        if (s.protocolCut > 0 && protocolTreasury != address(0)) {
            SmartTransferLib.smartTransferETH(protocolTreasury, s.protocolCut, weth);
        }

        // Vault cut — tracks this instance as benefactor.
        // De-curation gate: if the vault's alignment target was revoked after this instance bound,
        // `isVaultRegistered` reads false and the community cut folds into the creator's remainder
        // instead of feeding the de-curated vault.
        // INVARIANT: de-curation may destroy value; it may not transfer value to the protocol.
        // Gaining a de-curated community's revenue is a conflict of interest, so this branch never
        // routes to `protocolTreasury`. Withdraw succeeds either way, and the fold moves `s.vaultCut`
        // as computed, not a fixed 19%. For an active target a vault revert is a transient issue,
        // not curation, and takes the try/catch + `pendingVaultCut` retry path.
        uint256 vaultCutSent;
        if (s.vaultCut > 0) {
            if (!masterRegistry.isVaultRegistered(address(vault))) {
                // Folded into the remainder, paid below via smartTransferETH.
                s.remainder += s.vaultCut;
                emit VaultCutReturnedToCreator(address(vault), owner(), s.vaultCut);
            } else {
                // A reverting vault accumulates for retry instead of blocking creator proceeds.
                try vault.receiveContribution{ value: s.vaultCut }(
                    Currency.wrap(address(0)), s.vaultCut, address(this)
                ) {
                    vaultCutSent = s.vaultCut;
                } catch {
                    pendingVaultCut += s.vaultCut;
                    emit VaultContributionFailed(address(vault), s.vaultCut);
                }
            }
        }

        // Transfer remainder to artist
        SmartTransferLib.smartTransferETH(owner(), s.remainder, weth);

        emit Withdrawn(owner(), s.remainder, vaultCutSent, s.protocolCut);
    }

    /**
     * @notice Retry sending any accumulated failed vault contributions.
     * @dev Permissionless — anyone can call once the vault is restored.
     */
    function retryVaultContribution() external nonReentrant {
        uint256 pending = pendingVaultCut;
        if (pending == 0) revert NoPendingVaultCut();
        pendingVaultCut = 0;
        // De-curation gate: if the alignment target was revoked while the cut was stashed, the cut
        // returns to the creator as in `withdraw`, never to the treasury. Otherwise it is re-sent
        // to the vault.
        if (!masterRegistry.isVaultRegistered(address(vault))) {
            SmartTransferLib.smartTransferETH(owner(), pending, weth);
            emit PendingVaultCutReturnedToCreator(address(vault), owner(), pending);
        } else {
            vault.receiveContribution{ value: pending }(Currency.wrap(address(0)), pending, address(this));
            emit VaultContributionRetried(address(vault), pending);
        }
    }

    /**
     * @notice Claim accumulated vault fees on behalf of this project and distribute to creator
     * @dev Only callable by the project creator
     *      This instance was registered as the benefactor when tithes were sent to the vault
     *      The creator calls this to claim fees and keep the rewards
     * @dev Vault contributions (via the withdraw tithe) go to pendingETH and convert to
     *      benefactorShares only when convertAndAddLiquidity() is called, so fees are claimable only
     *      after a conversion.
     * @return totalClaimed Amount of ETH claimed from vault
     */
    function claimVaultFees() external onlyOwner nonReentrant returns (uint256 totalClaimed) {
        // Vaults push ETH to the benefactor, landing via receive(). The amount is the balance delta,
        // not the vault's return value; the ETH is held here first, then forwarded to the owner.
        uint256 before = address(this).balance;
        vault.claimFees();
        totalClaimed = address(this).balance - before;

        if (totalClaimed == 0) revert NoFeesToClaim();
        SmartTransferLib.smartTransferETH(owner(), totalClaimed, weth);
    }

    /// @notice Migrate to a new vault. New vault must share this instance's alignment target.
    /// @dev Updates local active vault and appends to registry vault array.
    function migrateVault(address newVault) external onlyOwner {
        vault = IAlignmentVault(payable(newVault));
        masterRegistry.migrateVault(address(this), newVault);
    }

    /// @notice Claim accumulated fees from all vault positions (current and historical).
    /// @dev Vaults push claimed ETH to this instance via receive(); the net amount across every vault
    ///      is the balance delta and is forwarded to the owner. Each claimFees() is wrapped in
    ///      try/catch so a vault that reverts (e.g. AlignmentEndowmentVault's NotSupported()) cannot
    ///      block fee delivery from the rest.
    // slither-disable-next-line calls-loop,unused-return
    function claimAllFees() external onlyOwner nonReentrant {
        uint256 before = address(this).balance;
        address[] memory allVaults = masterRegistry.getInstanceVaults(address(this));
        for (uint256 i = 0; i < allVaults.length; i++) {
            try IAlignmentVault(payable(allVaults[i])).claimFees() { } catch { }
        }
        uint256 received = address(this).balance - before;
        if (received > 0) SmartTransferLib.smartTransferETH(owner(), received, weth);
    }

    // ┌─────────────────────────┐
    // │   ERC1155 Functions    │
    // └─────────────────────────┘

    /**
     * @notice Transfer tokens
     */
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes memory data) external {
        if (to == address(0)) revert InvalidAddress();
        if (from != msg.sender && !isApprovedForAll[from][msg.sender]) revert Unauthorized();
        if (balanceOf[from][id] < amount) revert InsufficientBalance();

        balanceOf[from][id] -= amount;
        balanceOf[to][id] += amount;

        emit TransferSingle(msg.sender, from, to, id, amount);

        /// @dev ERC1155 compliance: Check if recipient is a contract and call receiver hook
        _doSafeTransferAcceptanceCheck(msg.sender, from, to, id, amount, data);
    }

    /**
     * @notice Batch transfer tokens
     */
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) external {
        if (to == address(0)) revert InvalidAddress();
        if (from != msg.sender && !isApprovedForAll[from][msg.sender]) revert Unauthorized();
        if (ids.length != amounts.length) revert LengthMismatch();

        for (uint256 i = 0; i < ids.length; i++) {
            if (balanceOf[from][ids[i]] < amounts[i]) revert InsufficientBalance();
            balanceOf[from][ids[i]] -= amounts[i];
            balanceOf[to][ids[i]] += amounts[i];
        }

        emit TransferBatch(msg.sender, from, to, ids, amounts);

        /// @dev ERC1155 compliance: Check if recipient is a contract and call receiver hook
        _doSafeBatchTransferAcceptanceCheck(msg.sender, from, to, ids, amounts, data);
    }

    /**
     * @notice Set approval for all
     */
    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /**
     * @notice Balances for a set of (account, id) pairs.
     * @dev ERC-1155 required member. Reads the `balanceOf` mapping; reverts `LengthMismatch` when
     *      the arrays differ in length, as the standard requires.
     */
    function balanceOfBatch(address[] memory accounts, uint256[] memory ids)
        external
        view
        returns (uint256[] memory batchBalances)
    {
        if (accounts.length != ids.length) revert LengthMismatch();
        batchBalances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            batchBalances[i] = balanceOf[accounts[i]][ids[i]];
        }
    }

    /**
     * @notice ERC-165 interface detection.
     * @dev Answers for ERC-165 (`0x01ffc9a7`), ERC-1155 (`0xd9b67a26`) and ERC-1155 metadata URI
     *      (`0x0e89341c`), and returns `false`, never reverting, for anything else including
     *      `0xffffffff`, as ERC-165 probes require.
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 // ERC-165
                || interfaceId == 0xd9b67a26 // ERC-1155
                || interfaceId == 0x0e89341c; // ERC-1155 metadata URI
    }

    // ┌─────────────────────────┐
    // │   Metadata Functions    │
    // └─────────────────────────┘

    /**
     * @notice ERC-1155 metadata URI for an edition.
     * @dev Returns `editions[id].metadataURI`, the field `getEdition` exposes. An id that does not
     *      exist answers with the empty string rather than reverting.
     */
    function uri(uint256 id) external view returns (string memory) {
        return editions[id].metadataURI;
    }

    /**
     * @notice Get all edition IDs
     * @return editionIds Array of all edition IDs
     */
    function getAllEditionIds() external view returns (uint256[] memory editionIds) {
        uint256 count = nextEditionId - 1;
        editionIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            editionIds[i] = i + 1;
        }
    }

    /**
     * @notice Get edition count
     * @return count Total number of editions
     */
    function getEditionCount() external view returns (uint256 count) {
        return nextEditionId - 1;
    }

    /**
     * @notice Get full edition details
     * @param editionId Edition ID
     * @return Edition struct containing all edition details
     */
    function getEdition(uint256 editionId) external view returns (Edition memory) {
        Edition storage edition = editions[editionId];
        if (edition.id == 0) revert EditionNotFound();
        return edition;
    }

    // ┌─────────────────────────┐
    // │   Style Management      │
    // └─────────────────────────┘

    /// @notice Set project-level style URI (creator only)
    function setStyle(string memory newStyleUri) external {
        _requireOwnerOrAgent();
        styleUri = newStyleUri;
    }

    // ┌─────────────────────────────────────┐
    // │   ERC1155 Receiver Safety Checks    │
    // └─────────────────────────────────────┘

    /**
     * @dev Internal function to invoke onERC1155Received on a target address
     * @param operator The address which initiated the transfer
     * @param from The address which previously owned the token
     * @param to The address which will own the token
     * @param id The token ID being transferred
     * @param amount The amount of tokens being transferred
     * @param data Additional data with no specified format
     */
    function _doSafeTransferAcceptanceCheck(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) private {
        if (to.code.length > 0) {
            (bool ok, bytes memory ret) = to.call(
                abi.encodeCall(IERC1155Receiver.onERC1155Received, (operator, from, id, amount, data))
            );
            if (!ok || ret.length < 32 || abi.decode(ret, (bytes4)) != IERC1155Receiver.onERC1155Received.selector) {
                revert ERC1155RejectedTokens();
            }
        }
    }

    /**
     * @dev Internal function to invoke onERC1155BatchReceived on a target address
     * @param operator The address which initiated the batch transfer
     * @param from The address which previously owned the tokens
     * @param to The address which will own the tokens
     * @param ids Array of token IDs being transferred
     * @param amounts Array of amounts being transferred
     * @param data Additional data with no specified format
     */
    function _doSafeBatchTransferAcceptanceCheck(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) private {
        if (to.code.length > 0) {
            (bool ok, bytes memory ret) = to.call(
                abi.encodeCall(IERC1155Receiver.onERC1155BatchReceived, (operator, from, ids, amounts, data))
            );
            if (!ok || ret.length < 32 || abi.decode(ret, (bytes4)) != IERC1155Receiver.onERC1155BatchReceived.selector)
            {
                revert ERC1155RejectedTokens();
            }
        }
    }
}

/**
 * @title IERC1155Receiver
 * @dev Interface for contracts that want to support safe transfers from ERC1155 token contracts
 */
interface IERC1155Receiver {
    /**
     * @notice Handle the receipt of a single ERC1155 token type
     * @param operator The address which initiated the transfer
     * @param from The address which previously owned the token
     * @param id The ID of the token being transferred
     * @param value The amount of tokens being transferred
     * @param data Additional data with no specified format
     * @return bytes4 `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))`
     */
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data)
        external
        returns (bytes4);

    /**
     * @notice Handle the receipt of multiple ERC1155 token types
     * @param operator The address which initiated the batch transfer
     * @param from The address which previously owned the tokens
     * @param ids An array containing ids of each token being transferred
     * @param values An array containing amounts of each token being transferred
     * @param data Additional data with no specified format
     * @return bytes4 `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`
     */
    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4);
}

