// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";
import { IAlignmentVault } from "../interfaces/IAlignmentVault.sol";
import { IInstance } from "../interfaces/IInstance.sol";
import { IInstanceLifecycle, TYPE_ERC404, TYPE_ERC1155 } from "../interfaces/IInstanceLifecycle.sol";

/// @notice Interface for FeaturedQueueManager
/// @dev The real FeaturedQueueManager signature is getFeaturedInstances(offset, limit) — the second
///      positional argument is a COUNT (limit), not an end index. Call sites must pass `limit`.
interface IFeaturedQueueManager {
    function getFeaturedInstances(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory instances, uint256 total);

    function getRentalInfo(address instance)
        external
        view
        returns (address renter, uint256 effectiveRank, uint256 expiresAt, bool isActive);
}

/// @notice Interface for ERC404 balance queries
interface IERC404Balance {
    function balanceOf(address account) external view returns (uint256);
    /// @notice Token units that represent one whole NFT (the ERC404 divisor)
    function unit() external view returns (uint256);
}

/// @notice Interface for ERC1155 balance queries
interface IERC1155Balance {
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function getEditionCount() external view returns (uint256);
    function getAllEditionIds() external view returns (uint256[] memory);
}

/// @notice Minimal ERC1155 edition data interface for batch reads
interface IERC1155EditionReader {
    enum PricingModel {
        UNLIMITED,
        LIMITED_FIXED,
        LIMITED_DYNAMIC
    }

    struct Edition {
        uint256 id;
        string pieceTitle;
        uint256 basePrice;
        uint256 supply;
        uint256 minted;
        string metadataURI;
        PricingModel pricingModel;
        uint256 priceIncreaseRate;
        uint256 openTime;
    }
    function getEdition(uint256 editionId) external view returns (Edition memory);
    function getCurrentPrice(uint256 editionId) external view returns (uint256);
    function nextEditionId() external view returns (uint256);
}

/// @notice Interface for ERC404 staking queries
interface IERC404Staking {
    function stakingEnabled() external view returns (bool);
    function stakedBalance(address user) external view returns (uint256);
    function calculatePendingRewards(address staker) external view returns (uint256);
}

/**
 * @title QueryAggregator
 * @notice Read-only aggregator that batches queries across multiple registry contracts
 * @dev Reduces frontend RPC calls by aggregating data from:
 *      - MasterRegistry (instances, factories, vaults)
 *      - FeaturedQueueManager (featured queue positions)
 *      - Individual instance contracts (dynamic card data)
 *
 *      Vault leaderboards and instance enumeration are handled off-chain via EventIndexer.
 *
 *      FAILURE TOLERANCE: All external calls in hydration/portfolio methods use silent
 *      try/catch so that a single broken or upgraded contract never reverts the batch.
 *      Missing data surfaces as zero-values / empty strings in the returned structs.
 */
contract QueryAggregator is SafeOwnableUUPS {
    // ============ Custom Errors ============

    error InvalidAddress();
    error LimitTooHigh();
    error TooManyInstances();

    // ============ Data Structures ============

    /// @notice All data needed to render a project card in the UI
    struct ProjectCard {
        // From MasterRegistry.InstanceInfo
        address instance;
        string name;
        string metadataURI;
        address creator;
        uint256 registeredAt;
        // From MasterRegistry.FactoryInfo
        address factory;
        string contractType;
        string factoryTitle;
        // From MasterRegistry.VaultInfo
        address vault;
        string vaultName;
        // From instance.getCardData()
        uint256 currentPrice;
        uint256 totalSupply;
        uint256 maxSupply;
        bool isActive;
        bytes extraData;
        // From FeaturedQueueManager
        uint256 featuredRank;
        uint256 featuredExpires;
    }

    /// @notice ERC404 token holdings for a user
    struct ERC404Holding {
        address instance;
        string name;
        uint256 tokenBalance;
        uint256 nftBalance;
        uint256 stakedBalance;
        uint256 pendingRewards;
    }

    /// @notice ERC1155 edition holdings for a user
    struct ERC1155Holding {
        address instance;
        string name;
        uint256[] editionIds;
        uint256[] balances;
    }

    /// @notice Vault benefactor position for a user
    struct VaultPosition {
        address vault;
        string name;
        uint256 contribution;
        uint256 shares;
        uint256 claimable;
    }

    /// @dev Internal accumulator for getPortfolioData loop — avoids stack-too-deep.
    struct PortfolioAccumulator {
        ERC404Holding[] tempERC404;
        ERC1155Holding[] tempERC1155;
        uint256 erc404Count;
        uint256 erc1155Count;
        uint256 totalClaimable;
    }

    // ============ State Variables ============

    IMasterRegistry public masterRegistry;
    IFeaturedQueueManager public featuredQueueManager;

    /// @dev DEPRECATED (noesis-067): formerly `IGlobalMessageRegistry public globalMessageRegistry`.
    ///      The social feed is emit-only and read client-side via event logs (EventIndexer); this
    ///      aggregator serves contract-state snapshots, so the pointer was never read. Removed from the
    ///      read path but the STORAGE SLOT is retained as a layout-safe placeholder — this is a deployed
    ///      UUPS proxy, so the slot must not be reordered/removed (doing so would shift `_initialized`
    ///      and every appended slot). Do not repurpose without a slot-map review.
    // slither-disable-next-line constable-states,unused-state
    address private __deprecated_globalMessageRegistry;

    uint256 public constant MAX_QUERY_LIMIT = 50;

    bool private _initialized;

    // ============ Events ============

    // slither-disable-next-line unindexed-event-address
    event Initialized(address masterRegistry, address featuredQueueManager);

    /// @notice Emitted when an owner updates registry addresses via setRegistries.
    // slither-disable-next-line unindexed-event-address
    event RegistriesUpdated(address masterRegistry, address featuredQueueManager);

    // ============ Constructor ============

    constructor() {
        _initializeOwner(msg.sender);
    }

    // ============ Initialization ============

    /**
     * @notice Initialize the aggregator with registry addresses
     * @param _masterRegistry MasterRegistry contract address
     * @param _featuredQueueManager FeaturedQueueManager contract address
     * @param _owner Owner address
     * @dev The third positional argument is the DEPRECATED globalMessageRegistry pointer (noesis-067).
     *      It is ignored — accepted only to preserve the deployment call ABI — and never stored.
     */
    function initialize(
        address _masterRegistry,
        address _featuredQueueManager,
        address, /* _globalMessageRegistry (deprecated, ignored) */
        address _owner
    )
        external
    {
        if (_initialized) revert AlreadyInitialized();
        if (_masterRegistry == address(0)) revert InvalidAddress();
        if (_featuredQueueManager == address(0)) revert InvalidAddress();
        if (_owner == address(0)) revert InvalidAddress();

        _initialized = true;
        _setOwner(_owner);

        masterRegistry = IMasterRegistry(_masterRegistry);
        featuredQueueManager = IFeaturedQueueManager(_featuredQueueManager);

        emit Initialized(_masterRegistry, _featuredQueueManager);
    }

    // ============ Main Query Methods ============

    /**
     * @notice Fetches featured projects for the home page
     * @param offset Starting index in featured queue
     * @param limit Number of projects to return (max 50)
     * @return projects Fully populated ProjectCard array
     * @return totalFeatured Total count in featured queue (for pagination)
     */
    function getHomePageData(uint256 offset, uint256 limit)
        external
        view
        returns (ProjectCard[] memory projects, uint256 totalFeatured)
    {
        if (limit > MAX_QUERY_LIMIT) revert LimitTooHigh();

        // Get active featured instances — getFeaturedInstances handles filtering,
        // pagination clamping, and returns the true active total in one call.
        // NOTE: the second argument is a COUNT (limit), not an end index. Passing `offset + limit`
        // (the prior bug) made FQM over-fetch by `offset` on page 2+, potentially exceeding
        // MAX_QUERY_LIMIT; pass `limit` so the returned window is exactly `limit` wide.
        (address[] memory featuredAddresses, uint256 total) = featuredQueueManager.getFeaturedInstances(offset, limit);

        totalFeatured = total;

        // Hydrate each into ProjectCard
        projects = new ProjectCard[](featuredAddresses.length);
        for (uint256 i = 0; i < featuredAddresses.length; i++) {
            projects[i] = _hydrateProject(featuredAddresses[i]);
        }
    }

    /**
     * @notice Fetches ProjectCard data for multiple instances
     * @param instances Array of instance addresses
     * @return cards Fully populated ProjectCard array
     */
    function getProjectCardsBatch(address[] calldata instances) external view returns (ProjectCard[] memory cards) {
        if (instances.length > MAX_QUERY_LIMIT) revert TooManyInstances();

        cards = new ProjectCard[](instances.length);
        for (uint256 i = 0; i < instances.length; i++) {
            cards[i] = _hydrateProject(instances[i]);
        }
    }

    /**
     * @notice Fetches all holdings for a user across specified instances and vaults
     * @param user User address to query
     * @param instances Array of instance addresses to check
     * @param vaultAddrs Array of vault addresses to check for benefactor positions
     * @return erc404Holdings All ERC404 token/NFT holdings with non-zero balance
     * @return erc1155Holdings All ERC1155 edition holdings with non-zero balance
     * @return vaultPositions All vault benefactor positions with non-zero shares
     * @return totalClaimable Sum of all claimable rewards (ETH)
     */
    function getPortfolioData(address user, address[] calldata instances, address[] calldata vaultAddrs)
        external
        view
        returns (
            ERC404Holding[] memory erc404Holdings,
            ERC1155Holding[] memory erc1155Holdings,
            VaultPosition[] memory vaultPositions,
            uint256 totalClaimable
        )
    {
        // Bound both client-supplied arrays (mirrors getProjectCardsBatch) so a huge wallet cannot
        // make the single eth_call time out, and to honor the frontend's documented cap invariant.
        if (instances.length > MAX_QUERY_LIMIT || vaultAddrs.length > MAX_QUERY_LIMIT) {
            revert TooManyInstances();
        }

        // slither-disable-next-line uninitialized-local
        PortfolioAccumulator memory acc;
        acc.tempERC404 = new ERC404Holding[](instances.length);
        acc.tempERC1155 = new ERC1155Holding[](instances.length);

        for (uint256 i = 0; i < instances.length; i++) {
            _processPortfolioInstance(instances[i], user, acc);
        }

        erc404Holdings = new ERC404Holding[](acc.erc404Count);
        for (uint256 i = 0; i < acc.erc404Count; i++) {
            erc404Holdings[i] = acc.tempERC404[i];
        }

        erc1155Holdings = new ERC1155Holding[](acc.erc1155Count);
        for (uint256 i = 0; i < acc.erc1155Count; i++) {
            erc1155Holdings[i] = acc.tempERC1155[i];
        }

        vaultPositions = _getVaultPositions(user, vaultAddrs);

        totalClaimable = acc.totalClaimable;
        for (uint256 i = 0; i < vaultPositions.length; i++) {
            totalClaimable += vaultPositions[i].claimable;
        }
    }

    // slither-disable-next-line calls-loop
    function _processPortfolioInstance(address instance, address user, PortfolioAccumulator memory acc) private view {
        try IInstanceLifecycle(instance).instanceType() returns (bytes32 typeHash) {
            try masterRegistry.getInstanceInfo(instance) returns (IMasterRegistry.InstanceInfo memory info) {
                if (typeHash == TYPE_ERC404) {
                    ERC404Holding memory holding = _getERC404Holding(instance, user, info.name);
                    if (holding.tokenBalance > 0 || holding.stakedBalance > 0) {
                        acc.tempERC404[acc.erc404Count++] = holding;
                        acc.totalClaimable += holding.pendingRewards;
                    }
                } else if (typeHash == TYPE_ERC1155) {
                    ERC1155Holding memory holding = _getERC1155Holding(instance, user, info.name);
                    if (holding.editionIds.length > 0) {
                        acc.tempERC1155[acc.erc1155Count++] = holding;
                    }
                }
            } catch { }
        } catch { }
    }

    // ============ Internal Helpers ============

    /**
     * @notice Hydrate an instance address into a full ProjectCard
     * @dev Each data source is fetched independently; any single failure
     *      leaves that section as zero-values without affecting the rest.
     */
    // slither-disable-next-line calls-loop
    function _hydrateProject(address instance) internal view returns (ProjectCard memory card) {
        card.instance = instance;

        // 1. Registry info (if this fails, we still populate what we can from other sources)
        try masterRegistry.getInstanceInfo(instance) returns (IMasterRegistry.InstanceInfo memory info) {
            card.name = info.name;
            card.metadataURI = info.metadataURI;
            card.creator = info.creator;
            card.registeredAt = info.registeredAt;
            card.factory = info.factory;
            card.vault = info.vaults.length > 0 ? info.vaults[info.vaults.length - 1] : address(0);
        } catch { }

        // 2–5 don't depend on step 1 succeeding — they use card fields or instance directly
        _hydrateFactory(card);
        _hydrateVault(card);
        _hydrateCardData(card);
        _hydrateFeatured(card);
    }

    // slither-disable-next-line calls-loop
    function _hydrateFactory(ProjectCard memory card) private view {
        if (card.factory == address(0)) return;
        try masterRegistry.getFactoryInfoByAddress(card.factory) returns (IMasterRegistry.FactoryInfo memory info) {
            card.contractType = info.contractType;
            card.factoryTitle = info.title;
        } catch { }
    }

    // slither-disable-next-line calls-loop
    function _hydrateVault(ProjectCard memory card) private view {
        if (card.vault == address(0)) return;
        try masterRegistry.getVaultInfo(card.vault) returns (IMasterRegistry.VaultInfo memory info) {
            card.vaultName = info.name;
        } catch { }
    }

    // slither-disable-next-line calls-loop
    function _hydrateCardData(ProjectCard memory card) private view {
        // ERC404 and future types implement IInstance.getCardData() directly
        try IInstance(card.instance).getCardData() returns (
            uint256 price, uint256 supply, uint256 max, bool active, bytes memory extra
        ) {
            card.currentPrice = price;
            card.totalSupply = supply;
            card.maxSupply = max;
            card.isActive = active;
            card.extraData = extra;
        } catch {
            // ERC1155 instances: compute card data from edition storage directly
            _hydrateERC1155CardData(card);
        }
    }

    // slither-disable-next-line calls-loop
    function _hydrateERC1155CardData(ProjectCard memory card) private view {
        try IERC1155EditionReader(card.instance).nextEditionId() returns (uint256 nextId) {
            uint256 count = nextId - 1;
            if (count == 0) return;
            uint256 floorPrice = type(uint256).max;
            uint256 totalMinted;
            uint256 maxSupply;
            bool isActive;
            bool hasUnlimited;
            for (uint256 i = 1; i <= count; i++) {
                try IERC1155EditionReader(card.instance).getEdition(i) returns (
                    IERC1155EditionReader.Edition memory ed
                ) {
                    if (ed.basePrice < floorPrice) floorPrice = ed.basePrice;
                    totalMinted += ed.minted;
                    if (ed.supply == 0) {
                        hasUnlimited = true;
                    } else {
                        maxSupply += ed.supply;
                        if (ed.minted < ed.supply) isActive = true;
                    }
                } catch { }
            }
            if (hasUnlimited) maxSupply = 0;
            // Honest active flag: active iff any UNLIMITED edition exists OR any LIMITED edition still
            // has minted < supply. `isActive` already captured the LIMITED case in the loop; OR in the
            // unlimited case here. A fully-minted, all-limited collection correctly reports inactive.
            card.currentPrice = floorPrice == type(uint256).max ? 0 : floorPrice;
            card.totalSupply = totalMinted;
            card.maxSupply = maxSupply;
            card.isActive = isActive || hasUnlimited;
        } catch { }
    }

    // slither-disable-next-line calls-loop,unused-return
    function _hydrateFeatured(ProjectCard memory card) private view {
        try featuredQueueManager.getRentalInfo(card.instance) returns (
            address, uint256 rank, uint256 expires, bool active
        ) {
            if (active) {
                card.featuredRank = rank;
                card.featuredExpires = expires;
            }
        } catch { }
    }

    /**
     * @notice Get ERC404 holding for a user
     */
    // slither-disable-next-line calls-loop
    function _getERC404Holding(address instance, address user, string memory name_)
        internal
        view
        returns (ERC404Holding memory holding)
    {
        holding.instance = instance;
        holding.name = name_;

        // Get token balance
        try IERC404Balance(instance).balanceOf(user) returns (uint256 balance) {
            holding.tokenBalance = balance;
            // NFT balance = tokenBalance / unit. Live-read the instance's actual units-per-NFT rather
            // than hardcoding 1e24 (1M tokens/NFT): the shared lens must not bake one instance's ratio,
            // and a per-instance override would silently mis-count NFTs. Guard against a zero/failed read
            // (leaves nftBalance = 0) so a broken instance never reverts the batch.
            try IERC404Balance(instance).unit() returns (uint256 unit_) {
                if (unit_ > 0) {
                    holding.nftBalance = balance / unit_; // round down: standard integer NFT count
                }
            } catch { }
        } catch { }

        // Get staking info
        try IERC404Staking(instance).stakingEnabled() returns (bool enabled) {
            if (enabled) {
                try IERC404Staking(instance).stakedBalance(user) returns (uint256 staked) {
                    holding.stakedBalance = staked;
                } catch { }

                try IERC404Staking(instance).calculatePendingRewards(user) returns (uint256 pending) {
                    holding.pendingRewards = pending;
                } catch { }
            }
        } catch { }
    }

    /**
     * @notice Get ERC1155 holding for a user
     */
    // slither-disable-next-line calls-loop
    function _getERC1155Holding(address instance, address user, string memory name_)
        internal
        view
        returns (ERC1155Holding memory holding)
    {
        holding.instance = instance;
        holding.name = name_;

        // Get all edition IDs
        try IERC1155Balance(instance).getAllEditionIds() returns (uint256[] memory editionIds) {
            // Single pass: record the edition id alongside its balance for every non-zero holding,
            // then trim. Avoids a second balanceOf sweep over the same editions.
            uint256[] memory tempIds = new uint256[](editionIds.length);
            uint256[] memory tempBalances = new uint256[](editionIds.length);
            uint256 nonZeroCount = 0;

            for (uint256 i = 0; i < editionIds.length; i++) {
                try IERC1155Balance(instance).balanceOf(user, editionIds[i]) returns (uint256 balance) {
                    if (balance > 0) {
                        tempIds[nonZeroCount] = editionIds[i];
                        tempBalances[nonZeroCount] = balance;
                        nonZeroCount++;
                    }
                } catch { }
            }

            // Trim to non-zero balances
            if (nonZeroCount > 0) {
                holding.editionIds = new uint256[](nonZeroCount);
                holding.balances = new uint256[](nonZeroCount);

                for (uint256 i = 0; i < nonZeroCount; i++) {
                    holding.editionIds[i] = tempIds[i];
                    holding.balances[i] = tempBalances[i];
                }
            }
        } catch { }
    }

    /**
     * @notice Get vault positions for a user from provided vault addresses
     * @param user User address
     * @param vaultAddrs Vault addresses to check (provided by frontend via EventIndexer)
     */
    // slither-disable-next-line calls-loop
    function _getVaultPositions(address user, address[] calldata vaultAddrs)
        internal
        view
        returns (VaultPosition[] memory positions)
    {
        VaultPosition[] memory tempPositions = new VaultPosition[](vaultAddrs.length);
        uint256 positionCount = 0;

        for (uint256 i = 0; i < vaultAddrs.length; i++) {
            address vaultAddr = vaultAddrs[i];

            try IAlignmentVault(payable(vaultAddr)).getBenefactorShares(user) returns (uint256 shares) {
                if (shares > 0) {
                    // slither-disable-next-line uninitialized-local
                    VaultPosition memory pos;
                    pos.vault = vaultAddr;
                    pos.shares = shares;

                    // Get vault name
                    try masterRegistry.getVaultInfo(vaultAddr) returns (IMasterRegistry.VaultInfo memory info) {
                        pos.name = info.name;
                    } catch { }

                    // Get contribution
                    try IAlignmentVault(payable(vaultAddr)).getBenefactorContribution(user) returns (
                        uint256 contribution
                    ) {
                        pos.contribution = contribution;
                    } catch { }

                    // Get claimable
                    try IAlignmentVault(payable(vaultAddr)).calculateClaimableAmount(user) returns (uint256 claimable) {
                        pos.claimable = claimable;
                    } catch { }

                    tempPositions[positionCount++] = pos;
                }
            } catch { }
        }

        // Trim to actual size
        positions = new VaultPosition[](positionCount);
        for (uint256 i = 0; i < positionCount; i++) {
            positions[i] = tempPositions[i];
        }
    }

    // ============ ERC1155 Edition Queries ============

    struct EditionView {
        uint256 id;
        string pieceTitle;
        uint256 basePrice;
        uint256 currentPrice;
        uint256 supply;
        uint256 minted;
        string metadataURI;
        IERC1155EditionReader.PricingModel pricingModel;
        uint256 priceIncreaseRate;
    }

    /// @notice Batch-fetch edition data for an ERC1155 instance (replaces instance-level getEditionsBatch)
    /// @param instance The ERC1155Instance address
    /// @param startId First edition ID (1-indexed, inclusive)
    /// @param endId Last edition ID (inclusive)
    function getERC1155EditionsBatch(address instance, uint256 startId, uint256 endId)
        external
        view
        returns (EditionView[] memory result)
    {
        IERC1155EditionReader reader = IERC1155EditionReader(instance);
        uint256 maxEditionId = reader.nextEditionId() - 1;
        require(startId >= 1 && startId <= maxEditionId, "invalid startId");
        require(endId >= startId && endId <= maxEditionId, "invalid endId");

        result = new EditionView[](endId - startId + 1);
        for (uint256 i = 0; i < result.length; i++) {
            uint256 editionId = startId + i;
            // Failure-tolerant per edition (matches the lens doctrine): a single broken/upgraded
            // edition read yields a zero-valued entry (with its id preserved for mapping) instead of
            // reverting the whole batch.
            // slither-disable-next-line calls-loop
            try reader.getEdition(editionId) returns (IERC1155EditionReader.Edition memory ed) {
                uint256 currentPrice;
                // slither-disable-next-line calls-loop
                try reader.getCurrentPrice(editionId) returns (uint256 price) {
                    currentPrice = price;
                } catch { }
                result[i] = EditionView({
                    id: ed.id,
                    pieceTitle: ed.pieceTitle,
                    basePrice: ed.basePrice,
                    currentPrice: currentPrice,
                    supply: ed.supply,
                    minted: ed.minted,
                    metadataURI: ed.metadataURI,
                    pricingModel: IERC1155EditionReader.PricingModel(uint8(ed.pricingModel)),
                    priceIncreaseRate: ed.priceIncreaseRate
                });
            } catch {
                result[i].id = editionId;
            }
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Update registry addresses
     * @param _masterRegistry New MasterRegistry address (ignored if zero)
     * @param _featuredQueueManager New FeaturedQueueManager address (ignored if zero)
     * @dev The third positional argument is the DEPRECATED globalMessageRegistry pointer (noesis-067).
     *      It is ignored — accepted only to preserve the admin call ABI — and never stored.
     */
    function setRegistries(
        address _masterRegistry,
        address _featuredQueueManager,
        address /* _globalMessageRegistry (deprecated, ignored) */
    )
        external
        onlyOwner
    {
        if (_masterRegistry != address(0)) {
            masterRegistry = IMasterRegistry(_masterRegistry);
        }
        if (_featuredQueueManager != address(0)) {
            featuredQueueManager = IFeaturedQueueManager(_featuredQueueManager);
        }
        emit RegistriesUpdated(address(masterRegistry), address(featuredQueueManager));
    }
}
