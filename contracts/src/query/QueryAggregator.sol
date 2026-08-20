// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";
import { IAlignmentVault } from "../interfaces/IAlignmentVault.sol";
import { IInstanceLifecycle, TYPE_ERC404, TYPE_ERC1155, TYPE_ERC721 } from "../interfaces/IInstanceLifecycle.sol";
import { IContractURI } from "../interfaces/IContractURI.sol";
import { BondingCurveMath } from "../factories/erc404/libraries/BondingCurveMath.sol";

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

/// @notice The ERC404 instance's pointer at its staking singleton. `address(0)` = staking was never
///         wired for this instance.
interface IERC404StakingHost {
    function stakingModule() external view returns (address);
}

/// @notice Interface for ERC404 staking queries.
/// @dev Staking is a SINGLETON keyed by instance (`ERC404StakingModule`), not per-instance state, so
///      every getter takes the instance as its first argument and none of them live on the instance
///      itself. The singleton is reached through `IERC404StakingHost.stakingModule()`, the same routing
///      `MetadataOverlayModule` and `TierRevealModule` use.
interface IERC404Staking {
    function stakingEnabled(address instance) external view returns (bool);
    function stakedBalance(address instance, address user) external view returns (uint256);
    function calculatePendingRewards(address instance, address staker) external view returns (uint256);
}

/// @notice ERC404 bonding-card reads (existing getters; the lens computes price/active from these,
///         so no `getCardData()` is needed on the instance — keeps the size-locked ERC404 untouched).
interface IERC404Card {
    function totalBondingSupply() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function unit() external view returns (uint256);
    function bondingActive() external view returns (bool);
    function bondingOpenTime() external view returns (uint256);
    function graduated() external view returns (bool);
    function curveParams() external view returns (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor);
}

/// @notice ERC721 auction-card reads.
interface IERC721Card {
    struct Auction {
        uint24 tokenId;
        string tokenURI;
        uint256 minBid;
        address highBidder;
        uint256 highBid;
        uint40 startTime;
        uint40 endTime;
        bool settled;
    }
    function lines() external view returns (uint8);
    function nextTokenId() external view returns (uint24);
    function getActiveAuction(uint8 line) external view returns (uint24 tokenId);
    function getAuction(uint24 tokenId) external view returns (Auction memory);
    /// @dev The address a creator deposit is refunded to (`settleAuction` / `reclaimUnsold`), i.e. who
    ///      holds the deposit position. A delegated agent may queue a piece, but the deposit returns to
    ///      the owner, so ownership — not the queueing caller — identifies that position.
    function owner() external view returns (address);
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
 *      FAILURE TOLERANCE: every external read reached from a hydration/portfolio method is issued
 *      through an `external view` reader on this contract (the `read*` group below, joined by
 *      `erc404CardData` / `erc721CardData`) and wrapped in `try/catch` at the call site, so a broken,
 *      upgraded, or non-contract target never reverts the batch. Missing data surfaces as
 *      zero-values / empty strings in the returned structs.
 *
 *      WHY THE SELF-CALL, AND NOT A BARE `try target.f() returns (T)`: since solc 0.8.10 a call with
 *      return data omits the `extcodesize` check and relies on `returndatasize` instead, so a target
 *      that is an EOA (zero bytes returned) or that returns fewer/differently-shaped bytes than `T`
 *      fails to DECODE. That decode runs in the CALLER's frame, and `catch` does not cover it — the
 *      revert escapes the `try`. Routing the call through an `external view` reader moves the decode
 *      into the CHILD frame, where a decode failure is an ordinary revert of the child call and the
 *      parent's `catch` does cover it. This holds for every return shape, including the
 *      dynamically-framed ones (structs containing strings, `string`, `uint256[]`) that no
 *      returndata-length check could validate.
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
        // Computed lens-side per instance type (see _hydrateCardData / erc404CardData / erc721CardData)
        uint256 currentPrice;
        uint256 totalSupply;
        uint256 maxSupply;
        bool isActive;
        // F-F.4: currently unused — no card hydration path (ERC404/ERC721/ERC1155) assigns extraData,
        // so it is always empty bytes. Vestige of the removed getCardData() 5-tuple. The frontend must
        // NOT decode it. Kept as a reserved forward-compat field; do not populate without a spec update.
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

    /// @notice A single ETH escrow a user holds inside an ERC721 auction instance.
    /// @dev One entry per (auction, role) escrow: a user who is both the creator and the high bidder on
    ///      the same piece holds two distinct amounts and gets two entries. `amount` is ESCROWED, never
    ///      withdrawable-now, and is deliberately excluded from `totalClaimable` (see getPortfolioData).
    struct AuctionPosition {
        address instance;
        string name;
        uint256 tokenId;
        /// @notice ETH held for this position: the user's high bid, or the creator's deposit.
        uint256 amount;
        /// @notice True when this entry is the creator's queue deposit; false when it is a high bid.
        bool isCreatorDeposit;
        /// @notice Auction end timestamp — when the escrow becomes actionable.
        uint256 endTime;
        /// @notice The auction has ended with bids: `settleAuction` releases this escrow (mints to the
        ///         winner, refunds the creator deposit). Permissionless.
        bool settleable;
        /// @notice The auction has ended with no bids: `reclaimUnsold` returns the deposit (less the
        ///         protocol cut when a treasury is set). Creator positions only.
        bool reclaimable;
    }

    /// @dev Internal accumulator for getPortfolioData loop — avoids stack-too-deep.
    struct PortfolioAccumulator {
        ERC404Holding[] tempERC404;
        ERC1155Holding[] tempERC1155;
        AuctionPosition[] tempAuction;
        uint256 erc404Count;
        uint256 erc1155Count;
        uint256 auctionCount;
        uint256 totalClaimable;
    }

    // ============ State Variables ============

    IMasterRegistry public masterRegistry;
    IFeaturedQueueManager public featuredQueueManager;

    /// @dev DEPRECATED (noesis-067): formerly `IGlobalMessageRegistry public globalMessageRegistry`.
    ///      The social feed is emit-only and read client-side via event logs (EventIndexer); this
    ///      aggregator serves contract-state snapshots, so the pointer was never read. Removed from the
    ///      read path but the STORAGE SLOT is retained as a layout-safe placeholder. The aggregator is
    ///      deployed directly (`new QueryAggregator()` in DeployCore), not behind a proxy today, but it is
    ///      UUPS-upgradeable and the upgrade path preserves storage, so the slot must not be reordered or
    ///      removed (doing so would shift `_initialized` and every appended slot). Do not repurpose
    ///      without a slot-map review.
    // slither-disable-next-line constable-states,unused-state
    address private __deprecated_globalMessageRegistry;

    uint256 public constant MAX_QUERY_LIMIT = 50;

    /// @notice Hard cap on editions scanned per ERC1155 card. Bounds the per-card loop so a malicious
    ///         instance reporting a huge `nextEditionId` cannot OOG-revert the whole batch (spec F-D).
    uint256 public constant MAX_EDITIONS_PER_CARD = 100;

    /// @notice Hard cap on auction lines scanned per ERC721 instance. `ERC721AuctionInstance` bounds its
    ///         own `lines` to 1..3 at construction; this lens does not take that on trust, so an instance
    ///         reporting a larger line count cannot expand the per-instance read loop.
    uint8 public constant MAX_AUCTION_LINES_PER_INSTANCE = 3;

    /// @notice Escrow roles a single auction can hold for one user: high bid and creator deposit.
    uint256 private constant AUCTION_POSITIONS_PER_LINE = 2;

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
     * @dev Restricted to the owner. The constructor makes the deploying account the owner from the moment
     *      the CREATE lands, so the deployer's own `new` + `initialize` pair is unaffected, while a third
     *      party cannot claim the uninitialized instance in the gap between the two transactions and set
     *      `_owner` to an address of their choosing.
     */
    function initialize(
        address _masterRegistry,
        address _featuredQueueManager,
        address, /* _globalMessageRegistry (deprecated, ignored) */
        address _owner
    )
        external
        onlyOwner
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
        // F-F.1: the FQM call is the one entry-path external read that must not be able to revert the
        // whole homepage. A broken/upgraded FeaturedQueueManager yields an empty grid, not a revert —
        // this read lens has no server to paper over a revert, so it degrades to an empty result set.
        address[] memory featuredAddresses;
        try this.readFeaturedInstances(offset, limit) returns (address[] memory addrs, uint256 total_) {
            featuredAddresses = addrs;
            totalFeatured = total_;
        } catch {
            return (new ProjectCard[](0), 0);
        }

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
     * @return auctionPositions All ETH the user has escrowed in ERC721 auctions — high bids and creator
     *         deposits — each flagged with the act that releases it
     * @dev `auctionPositions` is deliberately NOT summed into `totalClaimable`. `totalClaimable` means
     *      funds withdrawable now; auction escrow is held by the auction until it settles or is
     *      reclaimed, so folding it in would overstate withdrawable funds on a money surface.
     */
    function getPortfolioData(address user, address[] calldata instances, address[] calldata vaultAddrs)
        external
        view
        returns (
            ERC404Holding[] memory erc404Holdings,
            ERC1155Holding[] memory erc1155Holdings,
            VaultPosition[] memory vaultPositions,
            uint256 totalClaimable,
            AuctionPosition[] memory auctionPositions
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
        // Worst case per ERC721 instance: every scanned line holds both a high bid and a creator deposit.
        acc.tempAuction =
            new AuctionPosition[](instances.length * MAX_AUCTION_LINES_PER_INSTANCE * AUCTION_POSITIONS_PER_LINE);

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

        auctionPositions = new AuctionPosition[](acc.auctionCount);
        for (uint256 i = 0; i < acc.auctionCount; i++) {
            auctionPositions[i] = acc.tempAuction[i];
        }

        vaultPositions = _getVaultPositions(user, vaultAddrs);

        totalClaimable = acc.totalClaimable;
        for (uint256 i = 0; i < vaultPositions.length; i++) {
            totalClaimable += vaultPositions[i].claimable;
        }
    }

    // slither-disable-next-line calls-loop
    function _processPortfolioInstance(address instance, address user, PortfolioAccumulator memory acc) private view {
        try this.readInstanceType(instance) returns (bytes32 typeHash) {
            try this.readInstanceInfo(instance) returns (IMasterRegistry.InstanceInfo memory info) {
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
                } else if (typeHash == TYPE_ERC721) {
                    // Escrowed ETH, not a holding: it stays out of `acc.totalClaimable` by construction.
                    try this.erc721AuctionPositions(instance, user) returns (AuctionPosition[] memory found) {
                        for (uint256 p = 0; p < found.length; p++) {
                            found[p].name = info.name;
                            acc.tempAuction[acc.auctionCount++] = found[p];
                        }
                    } catch { }
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
        try this.readInstanceInfo(instance) returns (IMasterRegistry.InstanceInfo memory info) {
            card.name = info.name;
            card.metadataURI = info.metadataURI;
            card.creator = info.creator;
            card.registeredAt = info.registeredAt;
            card.factory = info.factory;
            card.vault = info.vaults.length > 0 ? info.vaults[info.vaults.length - 1] : address(0);
        } catch { }

        // §6 anti-drift (noesis-084, completed by noesis-085): ALL THREE instance types now expose an
        // ERC-7572 contractURI(), so the INSTANCE is the single source of truth for the collection
        // metadata URI — read it through and stop trusting the possibly-drifted registry copy. The read
        // is uniform: no type is exempt any more.
        _hydrateContractURI(card);

        // 2–5 don't depend on step 1 succeeding — they use card fields or instance directly
        _hydrateFactory(card);
        _hydrateVault(card);
        _hydrateCardData(card);
        _hydrateFeatured(card);
    }

    /// @dev §6 read-through: override card.metadataURI with the instance's own contractURI(). Uniform
    ///      across all three known instance types since noesis-085 — ERC404 got its ERC-7572 getter, so
    ///      there is no longer a type that has to be trusted to the registry.
    /// @dev Two ways the registry copy SURVIVES, both deliberate:
    ///      1. The read does not produce a decodable answer — an unknown type, a non-contract address, a
    ///         getter that is not there, a return value that does not decode. All of these arrive as a
    ///         reverted `readInstanceType` / `readContractURI` child call and are caught here, matching
    ///         this file's never-brick read contract (see the contract-level note on the self-call idiom).
    ///      2. The instance returns an EMPTY string. Every ERC404 instance deployed BEFORE noesis-085 —
    ///         and any instance created with an empty collection URI — reads back "". Overwriting
    ///         unconditionally would BLANK a card that the registry could still describe, which is a
    ///         regression, not anti-drift. Empty is "I have nothing to say", not "the URI is nothing".
    // slither-disable-next-line calls-loop
    function _hydrateContractURI(ProjectCard memory card) private view {
        bytes32 typeHash;
        try this.readInstanceType(card.instance) returns (bytes32 t) {
            typeHash = t;
        } catch {
            return; // no discriminator → keep the registry value
        }

        if (typeHash == TYPE_ERC404 || typeHash == TYPE_ERC1155 || typeHash == TYPE_ERC721) {
            try this.readContractURI(card.instance) returns (string memory u) {
                if (bytes(u).length != 0) card.metadataURI = u;
            } catch { }
        }
        // Any other type: keep the registry copy — nothing is known about its metadata surface.
    }

    // slither-disable-next-line calls-loop
    function _hydrateFactory(ProjectCard memory card) private view {
        if (card.factory == address(0)) return;
        try this.readFactoryInfo(card.factory) returns (IMasterRegistry.FactoryInfo memory info) {
            card.contractType = info.contractType;
            card.factoryTitle = info.title;
        } catch { }
    }

    // slither-disable-next-line calls-loop
    function _hydrateVault(ProjectCard memory card) private view {
        if (card.vault == address(0)) return;
        try this.readVaultInfo(card.vault) returns (IMasterRegistry.VaultInfo memory info) {
            card.vaultName = info.name;
        } catch { }
    }

    // slither-disable-next-line calls-loop
    function _hydrateCardData(ProjectCard memory card) private view {
        // Dispatch on the instance's own type discriminator and read its EXISTING public getters.
        // (The old design called IInstance.getCardData(), which NO instance implements — so ERC404 and
        //  ERC721 cards silently fell through to the ERC1155 path and rendered as blank/"Ended". Fixed by
        //  computing each type's card data lens-side, adding no code to the size-locked instances.)
        bytes32 typeHash;
        try this.readInstanceType(card.instance) returns (bytes32 t) {
            typeHash = t;
        } catch {
            // No discriminator → fall through to the ERC1155 path below, which is itself fully guarded
            // (a non-ERC1155 instance yields a zero card there). Preserves the pre-dispatch fallback.
        }

        if (typeHash == TYPE_ERC404) {
            // Atomic external self-call: any revert in the underlying reads yields a zero card, not a
            // batch revert (the batch loops call _hydrateProject unwrapped, so reads MUST be revert-safe).
            try this.erc404CardData(card.instance) returns (uint256 price, uint256 supply, uint256 max, bool active) {
                card.currentPrice = price;
                card.totalSupply = supply;
                card.maxSupply = max;
                card.isActive = active;
            } catch { }
        } else if (typeHash == TYPE_ERC721) {
            try this.erc721CardData(card.instance) returns (uint256 price, uint256 supply, uint256 max, bool active) {
                card.currentPrice = price;
                card.totalSupply = supply;
                card.maxSupply = max;
                card.isActive = active;
            } catch { }
        } else {
            // ERC1155: compute from edition storage directly.
            _hydrateERC1155CardData(card);
        }
    }

    /// @notice Atomic ERC404 bonding-card reader. `currentPrice` = cost of the next NFT-unit
    ///         (`calculateCost(params, supply, unit)`, matching how buys are priced); `isActive` mirrors
    ///         the frontend phase machine (bonding open AND started AND not graduated). External so the
    ///         caller can try/catch the whole group as one unit. Not for direct use.
    function erc404CardData(address instance)
        external
        view
        returns (uint256 price, uint256 supply, uint256 max, bool active)
    {
        IERC404Card c = IERC404Card(instance);
        supply = c.totalBondingSupply();
        max = c.maxSupply();
        active = c.bondingActive() && block.timestamp >= c.bondingOpenTime() && !c.graduated();
        uint256 unit_ = c.unit();
        if (unit_ > 0) {
            (uint256 k, uint256 pole, uint256 nf) = c.curveParams();
            price = BondingCurveMath.calculateCost(BondingCurveMath.Params(k, pole, nf), supply, unit_);
        }
    }

    /// @notice Atomic ERC721 auction-card reader. `currentPrice` = the first LIVE line's current bid
    ///         (highBid, or minBid if no bids yet); `isActive` = a live auction exists (unsettled AND
    ///         before endTime). `supply` = pieces minted so far; `maxSupply` = 0 (open queue, unbounded).
    ///         External so the caller can try/catch the whole group. Not for direct use.
    function erc721CardData(address instance)
        external
        view
        returns (uint256 price, uint256 supply, uint256 max, bool active)
    {
        IERC721Card c = IERC721Card(instance);
        supply = uint256(c.nextTokenId()) - 1; // nextTokenId is 1-indexed; -1 = pieces minted
        max = 0; // open queue: no fixed cap (0 = unlimited, same convention as unlimited ERC1155)
        uint8 lineCount = c.lines();
        for (uint8 i = 0; i < lineCount; i++) {
            uint24 tokenId = c.getActiveAuction(i);
            if (tokenId == 0) continue; // no active auction on this line
            IERC721Card.Auction memory a = c.getAuction(tokenId);
            if (!a.settled && block.timestamp < a.endTime) {
                active = true;
                price = a.highBid > 0 ? a.highBid : a.minBid;
                break; // first live line sets the card price
            }
        }
    }

    /// @notice Atomic ERC721 auction-escrow reader: every ETH position `user` holds inside one auction
    ///         instance. External so the caller can try/catch the whole group — a target that is not an
    ///         auction instance, that reverts, or that returns undecodable data yields no positions
    ///         instead of failing the portfolio read. Not for direct use.
    /// @dev Enumeration is bounded and complete for escrow that is live or actionable. `lineQueueHead`
    ///      advances only when an auction settles or is reclaimed, so the head of each line is the only
    ///      auction on that line that can hold a bid, and `getActiveAuction` returns it whether it is
    ///      live or ended-unsettled (it returns 0 once settled). Cost is at most
    ///      `MAX_AUCTION_LINES_PER_INSTANCE` head reads per instance rather than a queue walk.
    ///      Creator deposits on pieces still QUEUED BEHIND a head are escrowed but not yet actionable —
    ///      those auctions have not started, so nothing can be settled or reclaimed on them. Surfacing
    ///      them would require an unbounded queue walk; a follow-on can add a paged queue reader if the
    ///      pre-start deposit needs its own line in the portfolio.
    ///      `tokenId` 0 is the "no live auction" sentinel and is never a real piece — `nextTokenId`
    ///      starts at 1 — so a 0 is skipped rather than passed to `getAuction` (which reverts on it).
    // slither-disable-next-line calls-loop,timestamp
    function erc721AuctionPositions(address instance, address user)
        external
        view
        returns (AuctionPosition[] memory positions)
    {
        IERC721Card c = IERC721Card(instance);
        address creator = c.owner();

        uint8 lineCount = c.lines();
        if (lineCount > MAX_AUCTION_LINES_PER_INSTANCE) lineCount = MAX_AUCTION_LINES_PER_INSTANCE;

        AuctionPosition[] memory temp = new AuctionPosition[](uint256(lineCount) * AUCTION_POSITIONS_PER_LINE);
        uint256 n;

        for (uint8 i = 0; i < lineCount; i++) {
            uint24 tokenId = c.getActiveAuction(i);
            if (tokenId == 0) continue; // no unsettled auction at this line's head
            IERC721Card.Auction memory a = c.getAuction(tokenId);
            if (a.settled || a.startTime == 0) continue; // settled, or queued and not yet running

            bool ended = block.timestamp >= a.endTime;
            bool hasBids = a.highBidder != address(0);

            // 1. High bidder — the bid is escrowed until settlement. Outbid bidders are refunded on the
            //    bid path, so only the CURRENT high bidder has ETH held here; there is no refund to claim.
            if (hasBids && a.highBidder == user) {
                temp[n++] = AuctionPosition({
                    instance: instance,
                    name: "",
                    tokenId: uint256(tokenId),
                    amount: a.highBid,
                    isCreatorDeposit: false,
                    endTime: uint256(a.endTime),
                    settleable: ended,
                    reclaimable: false
                });
            }

            // 2. Creator deposit — `minBid` is the queue deposit, refunded at settlement or reclaim.
            if (creator == user && a.minBid > 0) {
                temp[n++] = AuctionPosition({
                    instance: instance,
                    name: "",
                    tokenId: uint256(tokenId),
                    amount: a.minBid,
                    isCreatorDeposit: true,
                    endTime: uint256(a.endTime),
                    settleable: ended && hasBids,
                    reclaimable: ended && !hasBids
                });
            }
        }

        positions = new AuctionPosition[](n);
        for (uint256 j = 0; j < n; j++) {
            positions[j] = temp[j];
        }
    }

    // ============ Guarded External Readers ============
    //
    // One `external view` reader per external read reached from a hydration/portfolio method, so the
    // call site can `try this.readX(...) { } catch { }` and have the CHILD frame own the ABI decode.
    // A target that is an EOA, that is missing the selector, that reverts, or that returns bytes which
    // do not decode to the declared return type all surface identically: a reverted child call, caught
    // by the caller, leaving the zero-value fallback in place.
    //
    // These are on the public ABI because `this.` self-calls require it. They are plain pass-throughs
    // with no state access beyond the two registry pointers; calling one directly is equivalent to
    // calling the underlying contract, and it is not the intended entry point for consumers.

    /// @notice Guarded read of the featured queue window. Not for direct use.
    function readFeaturedInstances(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory instances, uint256 total)
    {
        return featuredQueueManager.getFeaturedInstances(offset, limit);
    }

    /// @notice Guarded read of an instance's featured-rental record. Not for direct use.
    function readRentalInfo(address instance)
        external
        view
        returns (address renter, uint256 effectiveRank, uint256 expiresAt, bool isActive)
    {
        return featuredQueueManager.getRentalInfo(instance);
    }

    /// @notice Guarded read of the registry's instance record. Not for direct use.
    function readInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory) {
        return masterRegistry.getInstanceInfo(instance);
    }

    /// @notice Guarded read of the registry's factory record. Not for direct use.
    function readFactoryInfo(address factory) external view returns (IMasterRegistry.FactoryInfo memory) {
        return masterRegistry.getFactoryInfoByAddress(factory);
    }

    /// @notice Guarded read of the registry's vault record. Not for direct use.
    function readVaultInfo(address vault) external view returns (IMasterRegistry.VaultInfo memory) {
        return masterRegistry.getVaultInfo(vault);
    }

    /// @notice Guarded read of an instance's type discriminator. Not for direct use.
    function readInstanceType(address instance) external view returns (bytes32) {
        return IInstanceLifecycle(instance).instanceType();
    }

    /// @notice Guarded read of an instance's ERC-7572 collection URI. Not for direct use.
    function readContractURI(address instance) external view returns (string memory) {
        return IContractURI(instance).contractURI();
    }

    /// @notice Guarded read of an ERC1155 instance's edition cursor. Not for direct use.
    function readNextEditionId(address instance) external view returns (uint256) {
        return IERC1155EditionReader(instance).nextEditionId();
    }

    /// @notice Guarded read of a single ERC1155 edition record. Not for direct use.
    function readEdition(address instance, uint256 editionId)
        external
        view
        returns (IERC1155EditionReader.Edition memory)
    {
        return IERC1155EditionReader(instance).getEdition(editionId);
    }

    /// @notice Guarded read of a single ERC1155 edition's live price. Not for direct use.
    function readEditionPrice(address instance, uint256 editionId) external view returns (uint256) {
        return IERC1155EditionReader(instance).getCurrentPrice(editionId);
    }

    /// @notice Guarded read of an ERC404 instance's token balance for a user. Not for direct use.
    function readErc404Balance(address instance, address user) external view returns (uint256) {
        return IERC404Balance(instance).balanceOf(user);
    }

    /// @notice Guarded read of an ERC404 instance's units-per-NFT divisor. Not for direct use.
    function readErc404Unit(address instance) external view returns (uint256) {
        return IERC404Balance(instance).unit();
    }

    /// @notice Guarded read of the staking singleton an ERC404 instance is wired to. Not for direct use.
    function readStakingModule(address instance) external view returns (address) {
        return IERC404StakingHost(instance).stakingModule();
    }

    /// @notice Guarded read of the staking switch the singleton holds for `instance`. Not for direct use.
    function readStakingEnabled(address module, address instance) external view returns (bool) {
        return IERC404Staking(module).stakingEnabled(instance);
    }

    /// @notice Guarded read of a user's staked balance on an ERC404 instance. Not for direct use.
    function readStakedBalance(address module, address instance, address user) external view returns (uint256) {
        return IERC404Staking(module).stakedBalance(instance, user);
    }

    /// @notice Guarded read of a user's pending staking rewards on an ERC404 instance. Not for direct use.
    function readPendingRewards(address module, address instance, address user) external view returns (uint256) {
        return IERC404Staking(module).calculatePendingRewards(instance, user);
    }

    /// @notice Guarded read of an ERC1155 instance's edition id set. Not for direct use.
    function readAllEditionIds(address instance) external view returns (uint256[] memory) {
        return IERC1155Balance(instance).getAllEditionIds();
    }

    /// @notice Guarded read of a user's balance of one ERC1155 edition. Not for direct use.
    function readErc1155Balance(address instance, address user, uint256 editionId) external view returns (uint256) {
        return IERC1155Balance(instance).balanceOf(user, editionId);
    }

    /// @notice Guarded read of a user's benefactor shares in a vault. Not for direct use.
    function readVaultShares(address vault, address user) external view returns (uint256) {
        return IAlignmentVault(payable(vault)).getBenefactorShares(user);
    }

    /// @notice Guarded read of a user's benefactor contribution to a vault. Not for direct use.
    function readVaultContribution(address vault, address user) external view returns (uint256) {
        return IAlignmentVault(payable(vault)).getBenefactorContribution(user);
    }

    /// @notice Guarded read of a user's claimable amount in a vault. Not for direct use.
    function readVaultClaimable(address vault, address user) external view returns (uint256) {
        return IAlignmentVault(payable(vault)).calculateClaimableAmount(user);
    }

    // slither-disable-next-line calls-loop
    function _hydrateERC1155CardData(ProjectCard memory card) private view {
        try this.readNextEditionId(card.instance) returns (uint256 nextId) {
            uint256 count = nextId - 1;
            if (count == 0) return;
            if (count > MAX_EDITIONS_PER_CARD) count = MAX_EDITIONS_PER_CARD; // F-D: bound the loop, never OOG the batch
            uint256 floorPrice = type(uint256).max;
            uint256 totalMinted;
            uint256 maxSupply;
            bool isActive;
            bool hasUnlimited;
            for (uint256 i = 1; i <= count; i++) {
                try this.readEdition(card.instance, i) returns (IERC1155EditionReader.Edition memory ed) {
                    // F-F.3: card price is the floor of the LIVE per-edition prices, not the floor of
                    // static basePrice. A partway-minted LIMITED_DYNAMIC edition's live getCurrentPrice
                    // exceeds basePrice, so a basePrice floor understated the real buy price. Read the
                    // live price per edition (own try/catch, falling back to basePrice on revert to
                    // preserve the failure-tolerance doctrine) and take the min of that.
                    uint256 edPrice = ed.basePrice; // fallback = static floor if the live read reverts
                    try this.readEditionPrice(card.instance, i) returns (uint256 p) {
                        edPrice = p;
                    } catch { }
                    if (edPrice < floorPrice) floorPrice = edPrice;
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
        try this.readRentalInfo(card.instance) returns (address, uint256 rank, uint256 expires, bool active) {
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
        try this.readErc404Balance(instance, user) returns (uint256 balance) {
            holding.tokenBalance = balance;
            // NFT balance = tokenBalance / unit. Live-read the instance's actual units-per-NFT rather
            // than hardcoding 1e24 (1M tokens/NFT): the shared lens must not bake one instance's ratio,
            // and a per-instance override would silently mis-count NFTs. Guard against a zero/failed read
            // (leaves nftBalance = 0) so a broken instance never reverts the batch.
            try this.readErc404Unit(instance) returns (uint256 unit_) {
                if (unit_ > 0) {
                    holding.nftBalance = balance / unit_; // round down: standard integer NFT count
                }
            } catch { }
        } catch { }

        // Get staking info. Staking state lives in the `ERC404StakingModule` singleton keyed by
        // instance, so the instance is asked for its module first and every getter is then addressed to
        // the singleton with the instance as its first argument. An instance with no module wired
        // (`address(0)`), or a module that reverts or returns undecodable data, leaves both staking
        // fields at zero rather than failing the batch.
        try this.readStakingModule(instance) returns (address module) {
            if (module != address(0)) {
                try this.readStakingEnabled(module, instance) returns (bool enabled) {
                    if (enabled) {
                        try this.readStakedBalance(module, instance, user) returns (uint256 staked) {
                            holding.stakedBalance = staked;
                        } catch { }

                        try this.readPendingRewards(module, instance, user) returns (uint256 pending) {
                            holding.pendingRewards = pending;
                        } catch { }
                    }
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
        try this.readAllEditionIds(instance) returns (uint256[] memory editionIds) {
            // Single pass: record the edition id alongside its balance for every non-zero holding,
            // then trim. Avoids a second balanceOf sweep over the same editions.
            uint256[] memory tempIds = new uint256[](editionIds.length);
            uint256[] memory tempBalances = new uint256[](editionIds.length);
            uint256 nonZeroCount = 0;

            for (uint256 i = 0; i < editionIds.length; i++) {
                try this.readErc1155Balance(instance, user, editionIds[i]) returns (uint256 balance) {
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

            try this.readVaultShares(vaultAddr, user) returns (uint256 shares) {
                if (shares > 0) {
                    // slither-disable-next-line uninitialized-local
                    VaultPosition memory pos;
                    pos.vault = vaultAddr;
                    pos.shares = shares;

                    // Get vault name
                    try this.readVaultInfo(vaultAddr) returns (IMasterRegistry.VaultInfo memory info) {
                        pos.name = info.name;
                    } catch { }

                    // Get contribution
                    try this.readVaultContribution(vaultAddr, user) returns (uint256 contribution) {
                        pos.contribution = contribution;
                    } catch { }

                    // Get claimable
                    try this.readVaultClaimable(vaultAddr, user) returns (uint256 claimable) {
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
            try this.readEdition(instance, editionId) returns (IERC1155EditionReader.Edition memory ed) {
                uint256 currentPrice;
                // slither-disable-next-line calls-loop
                try this.readEditionPrice(instance, editionId) returns (uint256 price) {
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
