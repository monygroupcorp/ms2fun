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
error EditionSoldOut();
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
    /// @notice The genesis vault (the one bound at construction — what buyers pay in against). Pinned
    ///         immutably so the revenue-split family used at settlement can never diverge from what
    ///         buyers paid into, even if `vault` is later migrated (audit finding #2, defense-in-depth).
    address public immutable genesisVault;
    // slither-disable-next-line immutable-states
    IMasterRegistry public masterRegistry;
    IGlobalMessageRegistry public immutable globalMessageRegistry;
    address public immutable protocolTreasury;
    address public immutable weth;

    // Customization
    string public styleUri;

    mapping(uint256 => Edition) public editions;
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    // slither-disable-next-line immutable-states
    IGatingModule public gatingModule;
    // slither-disable-next-line immutable-states
    IDynamicPricingModule public dynamicPricingModule;

    // Free mint (per-edition; noesis-135). Each edition carries its own allocation, running claim
    // counter, and per-user claimed flag — a wallet may claim one free token PER edition, and each
    // edition's allocation is independent (draining edition A never consumes edition B). The retired
    // collection-wide scalars are gone; `gatingScope` stays collection-level (sub-decision 2, v1).
    mapping(uint256 => uint256) public freeMintAllocation;
    mapping(uint256 => uint256) public freeMintsClaimed;
    mapping(uint256 => mapping(address => bool)) public freeMintClaimed;
    GatingScope public gatingScope;
    bool private _freeMintInitialized;
    bool public agentDelegationEnabled;

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
    /// @dev Emitted when the vault's alignment target has been revoked (`isVaultRegistered` false) and the
    ///      19% tithe is routed to `protocolTreasury` instead of the de-curated vault. Mint still succeeds.
    event VaultCutRedirected(address indexed vault, address indexed treasury, uint256 amount);

    event EditionMetadataUpdated(uint256 indexed editionId, string metadataURI);
    /// @dev ERC-1155 required event. Emitted wherever an edition's metadata URI is set: at creation
    ///      (`addEdition`, where it is fixed) and on change (`updateEditionMetadata`). The
    ///      collection-level ERC-7572 `contractURI` is not a per-id URI and is not a site for this.
    event URI(string value, uint256 indexed id);
    event FreeMintClaimed(address indexed user, uint256 indexed editionId);
    /// @dev Emitted when an edition's free-mint allocation is set (at creation) or later adjusted.
    event FreeMintAllocationSet(uint256 indexed editionId, uint256 allocation);
    event ContractURIUpdated();

    // ┌─────────────────────────┐
    // │      Constructor        │
    // └─────────────────────────┘

    constructor(
        string memory _name,
        address _creator,
        address _factory,
        address _vault,
        string memory _styleUri,
        InstanceInit memory _init,
        bool _agentCreated,
        string memory _metadataURI,
        string memory _symbol
    ) {
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
    /// @dev Free-mint allocation is PER EDITION (noesis-135): it is set at edition creation via
    ///      `addEdition`'s `freeMintAlloc` argument, or adjusted later via
    ///      `setEditionFreeMintAllocation`. Editions do not exist at create time, so there is no
    ///      edition id for a collection-wide allocation to key to and this entry point takes none.
    ///      `ERC1155Factory` rejects a non-zero `FreeMintParams.allocation` rather than accepting a
    ///      value it cannot apply. Only the gating `scope` (collection-level, sub-decision 2) is
    ///      stored here.
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
        // Enforce the scheduled open time on the free path too. Without this a bot could drain the
        // free allocation before the public open — the gating block below is skipped entirely when
        // there is no gating module or the scope is PAID_ONLY, so openTime is the only fair-launch
        // guard on this path. Mirrors the paid mint() gate.
        if (edition.openTime != 0 && block.timestamp < edition.openTime) revert EditionNotOpen();
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
        balanceOf[msg.sender][editionId]++;

        emit FreeMintClaimed(msg.sender, editionId);
        emit TransferSingle(msg.sender, address(0), msg.sender, editionId, 1);
    }

    // ┌─────────────────────────┐
    // │   Edition Management    │
    // └─────────────────────────┘

    /**
     * @notice Add a new edition
     * @param pieceTitle Title of the piece
     * @param basePrice Base price (for fixed) or starting price (for dynamic)
     * @param supply Supply limit (0 = unlimited)
     * @param metadataURI Metadata URI for the edition
     * @param pricingModel Pricing model (UNLIMITED, LIMITED_FIXED, LIMITED_DYNAMIC)
     * @param priceIncreaseRate Price increase rate in basis points (for dynamic pricing)
     * @param openTime Unix timestamp; 0 = open immediately
     * @param freeMintAlloc Per-edition free-mint allocation (0 = no free mints). RESERVE-from-supply
     *        (noesis-135 sub-decision 1): for a limited edition (supply > 0) it must be <= supply, so
     *        free claims come OUT of the edition's supply and never inflate it; an unlimited edition
     *        (supply == 0) accepts any allocation.
     */
    function addEdition(
        string memory pieceTitle,
        uint256 basePrice,
        uint256 supply,
        string memory metadataURI,
        PricingModel pricingModel,
        uint256 priceIncreaseRate,
        uint256 openTime,
        uint256 freeMintAlloc
    ) external {
        if (msg.sender == owner()) {
            // Owner always allowed
        } else if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) {
            // Direct agent call when delegation is on
        } else {
            revert Unauthorized();
        }
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

        emit URI(metadataURI, editionId);
        emit EditionAdded(editionId, pieceTitle, basePrice, supply, pricingModel);
    }

    /**
     * @notice Adjust an edition's free-mint allocation at any time (owner or delegated agent).
     * @dev Same auth branch as `addEdition`. No lock-at-first-mint — the owner can raise or lower an
     *      edition's allocation whenever they like (rth 2026-08-04). The RESERVE-from-supply cap still
     *      holds: for a limited edition the new allocation must be <= supply; an unlimited edition
     *      (supply == 0) accepts any value. Lowering below `freeMintsClaimed[editionId]` is permitted —
     *      already-claimed mints stand, and `claimFreeMint` simply stays exhausted until/unless raised.
     * @param editionId The edition to adjust. Must exist.
     * @param allocation The new free-mint allocation.
     */
    function setEditionFreeMintAllocation(uint256 editionId, uint256 allocation) external {
        if (msg.sender == owner()) {
            // Owner always allowed
        } else if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) {
            // Direct agent call when delegation is on
        } else {
            revert Unauthorized();
        }
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
        if (msg.sender == owner()) {
            // Owner always allowed
        } else if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) {
            // Direct agent call when delegation is on (non-custodial config)
        } else {
            revert Unauthorized();
        }
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

        // Gating check — forwards authoritative editionId + edition openTime; gatingData carries the
        // raw module payload (no password-shaped wrap, so a bytes32[] merkle proof fits).
        // FREE_MINT_ONLY intentionally leaves paid buys open (gates free-mint claims only), mirroring
        // the ERC404 buyBonding guard and IGatingModule's GatingScope doc. Any other scope gates the
        // paid buy — closing the bypass where a Merkle-gated collection's paid mint slipped through.
        if (address(gatingModule) != address(0) && gatingScope != GatingScope.FREE_MINT_ONLY) {
            (bool allowed,) = gatingModule.canMint(msg.sender, editionId, amount, edition.openTime, gatingData);
            if (!allowed) revert GatingCheckFailed();
            gatingModule.onMint(msg.sender, editionId, amount);
        }

        // Check supply limits. Withhold the still-unclaimed free-mint reserve from the paid supply so
        // every promised, unclaimed free claim always has supply behind it — the RESERVE-from-supply
        // contract the allocation docstrings state (noesis-135 sub-decision 1), which the paid path did
        // not previously honor. `freeMintAllocation` can be lowered below `freeMintsClaimed` at any time
        // (setEditionFreeMintAllocation, no lock-at-first-mint), so clamp the reserve at zero. The
        // reserve can never exceed supply: addEdition and setEditionFreeMintAllocation cap the allocation
        // at supply for a limited edition, so `minted + amount + reserve` gates paid mints exactly to the
        // non-reserved remaining supply without a subtraction that could underflow.
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
        balanceOf[msg.sender][editionId] += amount;
        totalProceeds += totalCost;

        // Forward message to global registry
        if (messageData.length > 0) {
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

        // Family-aware mint split (ADR-0003): liquidity-family → 1% protocol / 19% vault / 80%
        // creator; yield-family (endowment) → 1% protocol / 80% vault / 19% creator. Unknown
        // vaultType reverts (UnknownVaultFamily).
        // The family is read from the PINNED genesis vault, never the live `vault` (audit finding #2):
        // a migration swaps `vault`, but the split must stay keyed to what buyers paid in against, so a
        // vault change can never flip an endowment collection's 1/80/19 to 1/19/80.
        bool liquidityFamily = RevenueSplitLib.isLiquidityFamily(IAlignmentVault(payable(genesisVault)).vaultType());
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMintFor(amount, liquidityFamily);

        // Protocol cut to treasury. Use smartTransferETH (WETH fallback) so a reverting/non-receiving
        // treasury cannot brick withdraw — consistent with the try/catch vault-cut path below and the
        // artist remainder payout. No pending-retry lane: the treasury is trusted and the 1% cut is small.
        if (s.protocolCut > 0 && protocolTreasury != address(0)) {
            SmartTransferLib.smartTransferETH(protocolTreasury, s.protocolCut, weth);
        }

        // Vault cut — tracks this instance as benefactor.
        // Target-revocation gate (noesis-113): if the vault's alignment target was revoked AFTER this
        // instance bound (a rug discovered post-hoc), `isVaultRegistered` now reads false. Route the tithe
        // to `protocolTreasury` instead of feeding the de-curated vault — the community 19% is preserved at
        // the safe protocol sink, not stranded and not lost. The mint/withdraw still succeeds either way
        // (never freeze the creator for the DAO's revocation). For an active target, keep the existing
        // try/catch + pendingVaultCut retry path (a vault revert is a transient upgrade issue, not curation).
        uint256 vaultCutSent;
        if (s.vaultCut > 0) {
            if (!masterRegistry.isVaultRegistered(address(vault))) {
                SmartTransferLib.smartTransferETH(protocolTreasury, s.vaultCut, weth);
                emit VaultCutRedirected(address(vault), protocolTreasury, s.vaultCut);
            } else {
                // If the vault reverts (e.g. broken upgrade), accumulate for retry rather than
                // blocking creator proceeds permanently.
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
        // Target-revocation gate (noesis-126): if the vault's alignment target was revoked while this cut was
        // stashed, do not force-feed the de-curated vault on retry — route the tithe to `protocolTreasury`,
        // mirroring the `withdraw` primary path. For an active target, re-send to the vault as before.
        if (!masterRegistry.isVaultRegistered(address(vault))) {
            SmartTransferLib.smartTransferETH(protocolTreasury, pending, weth);
            emit VaultCutRedirected(address(vault), protocolTreasury, pending);
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
     * @dev Fee claiming uses intentional "dragnet" pattern. Vault contributions
     *      (via withdraw tithe) go to pendingETH and only convert to benefactorShares
     *      when convertAndAddLiquidity() is called. Creators must wait for conversion
     *      before claiming fees. Frontend handles dragnet activation to ensure
     *      contributions are included in conversions.
     * @return totalClaimed Amount of ETH claimed from vault
     */
    function claimVaultFees() external onlyOwner nonReentrant returns (uint256 totalClaimed) {
        // Vaults pay the benefactor by pushing ETH (payable(recipient).call{value}("")); receive()
        // is what lets that push land here. Measure the amount by balance-delta rather than trusting
        // the vault's return value — the ETH is custodied here first, then forwarded to the owner.
        uint256 before = address(this).balance;
        // Call vault's claimFees, which uses msg.sender (this contract) as the benefactor
        vault.claimFees();
        totalClaimed = address(this).balance - before;

        // Route all claimed fees to the owner
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
    /// @dev Vaults push claimed ETH to this instance (received via receive()); the net amount pushed
    ///      across every vault is measured by balance-delta and forwarded to the owner. Each
    ///      claimFees() is wrapped in try/catch so one vault that intentionally reverts (e.g. the
    ///      AlignmentEndowmentVault's NotSupported()) can't brick fee delivery for the rest.
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
     * @dev ERC-1155 required member. Reads the same `balanceOf` mapping as the per-id getter; no
     *      additional storage. Reverts `LengthMismatch` when the arrays differ in length, as the
     *      standard requires.
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
     *      (`0x0e89341c`), and returns `false` — never reverts — for anything else, including
     *      `0xffffffff`. Consumers that probe before deciding what a contract is (marketplaces,
     *      indexers, wallets) depend on both halves of that.
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
     * @dev Returns `editions[id].metadataURI` — the same field `getEdition` exposes, so there is one
     *      source of truth for an edition's URI. An id that does not exist answers with the empty
     *      string rather than reverting, so a metadata probe on an uncreated edition is a plain miss.
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
        if (msg.sender == owner()) {
            // Owner always allowed
        } else if (agentDelegationEnabled && masterRegistry.isAgent(msg.sender)) {
            // Direct agent call when delegation is on (non-custodial config)
        } else {
            revert Unauthorized();
        }
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

