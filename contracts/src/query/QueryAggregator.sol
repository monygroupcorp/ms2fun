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
    /// @notice A holder's coin across every tier band: the free balance plus the extra denomination
    ///         carried by each banded id they own. Never less than `balanceOf`.
    function coinBalanceOf(address holder) external view returns (uint256);
    /// @notice Coin the burn-safety hook has released to `holder` and that is waiting to be pulled.
    function pendingEscrowRelease(address holder) external view returns (uint256);
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
    /// @notice Unix timestamp at which an edition stops minting; 0 = never closes.
    /// @dev Deliberately not a field on `Edition`: that struct is decoded out of `getEdition` for every
    ///      instance this aggregator reads, including those without the close time, and a field added
    ///      to it would break those decodes. Read on its own, guarded, so an instance that does not
    ///      answer reads as "never closes".
    function editionCloseTime(uint256 editionId) external view returns (uint256);
    /// @notice Most tokens of an edition one wallet may mint; 0 = no ceiling. Guarded like the above.
    function editionMaxPerWallet(uint256 editionId) external view returns (uint256);
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

/// @notice ERC404 bonding-card reads; the lens computes price/active from these existing getters,
///         so the size-locked ERC404 instance carries no `getCardData()`.
interface IERC404Card {
    function totalBondingSupply() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function liquidityReserve() external view returns (uint256);
    function freeMintAllocation() external view returns (uint256);
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
        // The moment this collection's buy path opens, when that moment is still ahead of the block the
        // card was read at; 0 otherwise. `isActive` false answers "can I buy it now?" but not "will I
        // ever be able to?": a graduated curve or sold-out edition run is over, while a scheduled drop
        // is worth coming back for. Read together: active => now, `opensAt` non-zero => then, neither
        // => nothing to wait for. Compared against `block.timestamp` here so a client with a skewed
        // clock cannot disagree with the chain.
        uint256 opensAt;
        // Always empty bytes: no card hydration path assigns it. Reserved; the frontend must not decode it.
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
        /// @dev Coin the holder owns across every tier band, including the denomination locked inside
        ///      banded ids that `tokenBalance` does not count. Equal to `tokenBalance` on an untiered
        ///      instance; strictly greater once the holder owns a banded id.
        uint256 coinBalance;
        /// @dev Coin already released to the holder by the burn-safety hook and waiting on their pull.
        ///      It has left `coinBalance`, so the two never double-count the same coin.
        uint256 pendingEscrowRelease;
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

    /// @dev Retired pointer, never read: the social feed is emit-only and read client-side via event
    ///      logs, and this aggregator serves contract-state snapshots. The slot stays as a layout
    ///      placeholder: the aggregator is UUPS-upgradeable and upgrades preserve storage, so removing or
    ///      reordering it would shift `_initialized` and every appended slot.
    // slither-disable-next-line constable-states,unused-state
    address private __deprecated_globalMessageRegistry;

    uint256 public constant MAX_QUERY_LIMIT = 50;

    /// @notice Hard cap on editions scanned per ERC1155 card. Bounds the per-card loop so a malicious
    ///         instance reporting a huge `nextEditionId` cannot OOG-revert the whole batch.
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
     * @dev The third positional argument is a retired pointer: ignored, accepted so the deployment call
     *      ABI is stable, and never stored.
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
        // The second argument is a COUNT (limit), not an end index, so the returned window is exactly
        // `limit` wide. The FQM call must not be able to revert the whole homepage: a broken or
        // upgraded FeaturedQueueManager yields an empty grid, since this read lens has no server to
        // paper over a revert.
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
                    // A holding is anything the user owns here, including coin they cannot transfer.
                    // `tokenBalance` alone is the wrong test: DN404 burns the band NFT the moment a debit
                    // takes the holder below its unit, so a holder whose whole position is released escrow
                    // reads balanceOf == 0 while the instance still owes them `pendingEscrowRelease`.
                    if (
                        holding.tokenBalance > 0 || holding.stakedBalance > 0 || holding.coinBalance > 0
                            || holding.pendingEscrowRelease > 0
                    ) {
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

        // The instance is the single source of truth for the collection metadata URI (ERC-7572
        // contractURI(), exposed by all three instance types); the registry copy can drift.
        _hydrateContractURI(card);

        // 2–5 don't depend on step 1 succeeding — they use card fields or instance directly
        _hydrateFactory(card);
        _hydrateVault(card);
        _hydrateCardData(card);
        _hydrateFeatured(card);
    }

    /// @dev Overrides card.metadataURI with the instance's own contractURI() (ERC-7572), which every
    ///      known instance type exposes, so the instance is the single source of truth.
    /// @dev The registry copy survives in two cases:
    ///      1. The read yields no decodable answer: an unknown type, a non-contract address, a missing
    ///         getter, an undecodable return. Each arrives as a reverted `readInstanceType` /
    ///         `readContractURI` child call and is caught here (see the contract-level note on the
    ///         self-call idiom).
    ///      2. The instance returns an empty string, as one created with an empty collection URI does.
    ///         Overwriting would blank a card the registry can still describe; empty means "nothing to
    ///         say", not "the URI is nothing".
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
        // Dispatch on the instance's own type discriminator and read its existing public getters;
        // each type's card data is computed lens-side, so the size-locked instances carry no card getter.
        bytes32 typeHash;
        try this.readInstanceType(card.instance) returns (bytes32 t) {
            typeHash = t;
        } catch {
            // No discriminator: fall through to the ERC1155 path below, which is fully guarded (a
            // non-ERC1155 instance yields a zero card there).
        }

        if (typeHash == TYPE_ERC404) {
            // Atomic external self-call: any revert in the underlying reads yields a zero card, not a
            // batch revert (the batch loops call _hydrateProject unwrapped, so reads MUST be revert-safe).
            try this.erc404CardData(card.instance) returns (
                uint256 price, uint256 supply, uint256 max, bool active, uint256 opensAt
            ) {
                card.currentPrice = price;
                card.totalSupply = supply;
                card.maxSupply = max;
                card.isActive = active;
                card.opensAt = opensAt;
            } catch { }
        } else if (typeHash == TYPE_ERC721) {
            try this.erc721CardData(card.instance) returns (uint256 price, uint256 supply, uint256 max, bool active) {
                card.currentPrice = price;
                card.totalSupply = supply;
                card.maxSupply = max;
                card.isActive = active;
                // `opensAt` stays 0 for the auction family: an auction has no scheduled start.
                // `_startAuction` stamps `startTime` with `block.timestamp` the moment a piece reaches the
                // head of its line, so a future start time never exists to be read. A collection with
                // nothing running is waiting on a creator, not on a clock, and 0 says that.
            } catch { }
        } else {
            // ERC1155: compute from edition storage directly.
            _hydrateERC1155CardData(card);
        }
    }

    /// @notice Atomic ERC404 bonding-card reader. `currentPrice` = cost of the next NFT-unit
    ///         (`calculateCost(params, supply, unit)`, matching how buys are priced); `active` = a buy
    ///         placed at this block would succeed; `opensAt` = when one first could, if that is still
    ///         ahead. External so the caller can try/catch the whole group as one unit. Not for direct use.
    /// @dev `max` is the buyable ceiling, not `maxSupply`. The buy path caps at
    ///      `maxSupply - liquidityReserve - freeMintAllocation * unit` and reverts `ExceedsBonding()`
    ///      past it, so reporting raw `maxSupply` would advertise coin no buy can reach.
    function erc404CardData(address instance)
        external
        view
        returns (uint256 price, uint256 supply, uint256 max, bool active, uint256 opensAt)
    {
        IERC404Card c = IERC404Card(instance);
        supply = c.totalBondingSupply();
        uint256 unit_ = c.unit();
        uint256 maxSupply_ = c.maxSupply();
        uint256 reserved = c.liquidityReserve() + c.freeMintAllocation() * unit_;
        // Clamped rather than left to underflow: a configuration that reserves the whole supply has a
        // buyable ceiling of zero, and a revert here would blank the card.
        max = reserved >= maxSupply_ ? 0 : maxSupply_ - reserved;
        // `bondingOpenTime` is the buy path's own gate (it reverts TooEarly() below it). Arming turns
        // a bare timestamp into a promise: `setBondingActive` refuses until an open time is set, and
        // graduation clears the flag. So an armed, ungraduated curve whose open time has not arrived
        // is a real Soon; anything else is not, whatever `bondingOpenTime` holds.
        bool armed = c.bondingActive();
        bool graduated_ = c.graduated();
        uint256 openTime_ = c.bondingOpenTime();
        // `supply < max` completes the predicate against the buyable ceiling: a curve bought out to it
        // is not graduated and stays armed, yet every further buy reverts ExceedsBonding(). Like its
        // siblings (the ERC-1155 leg wants `minted < supply` on an open edition, the ERC-721 leg a
        // live auction), `active` requires a reachable buy.
        active = armed && !graduated_ && block.timestamp >= openTime_ && supply < max;
        if (armed && !graduated_ && block.timestamp < openTime_) opensAt = openTime_;
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
    ///      Creator deposits on pieces still queued behind a head are escrowed but not actionable, and
    ///      are not enumerated: surfacing them would need an unbounded queue walk.
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
            if (a.settled || a.startTime == 0) continue; // settled, or queued and not running

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

    /// @notice Guarded read of a single ERC1155 edition's close time. Not for direct use.
    /// @dev Reverts for an instance predating the edition schedule; every caller treats that as 0.
    function readEditionCloseTime(address instance, uint256 editionId) external view returns (uint256) {
        return IERC1155EditionReader(instance).editionCloseTime(editionId);
    }

    /// @notice Guarded read of a single ERC1155 edition's per-wallet ceiling. Not for direct use.
    /// @dev Reverts for an instance predating the edition schedule; every caller treats that as 0.
    function readEditionMaxPerWallet(address instance, uint256 editionId) external view returns (uint256) {
        return IERC1155EditionReader(instance).editionMaxPerWallet(editionId);
    }

    /// @notice Guarded read of an ERC404 instance's token balance for a user. Not for direct use.
    function readErc404Balance(address instance, address user) external view returns (uint256) {
        return IERC404Balance(instance).balanceOf(user);
    }

    /// @notice Guarded read of an ERC404 instance's units-per-NFT divisor. Not for direct use.
    function readErc404Unit(address instance) external view returns (uint256) {
        return IERC404Balance(instance).unit();
    }

    /// @notice Guarded read of a holder's coin across every tier band. Not for direct use.
    function readErc404CoinBalance(address instance, address user) external view returns (uint256) {
        return IERC404Balance(instance).coinBalanceOf(user);
    }

    /// @notice Guarded read of a holder's unclaimed released escrow. Not for direct use.
    function readErc404PendingEscrowRelease(address instance, address user) external view returns (uint256) {
        return IERC404Balance(instance).pendingEscrowRelease(user);
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
            // `catch` traps errors raised in the external call, not panics raised here in the parent
            // frame. A target answering 0 to nextEditionId() would underflow `nextId - 1`, panicking in
            // QueryAggregator itself and reverting all of getProjectCardsBatch, which takes a
            // caller-supplied address array. The zero answer yields a zero card, like every other bad read.
            if (nextId == 0) return;
            uint256 count = nextId - 1;
            if (count == 0) return;
            if (count > MAX_EDITIONS_PER_CARD) count = MAX_EDITIONS_PER_CARD; // bound the loop, never OOG the batch
            uint256 floorPrice = type(uint256).max; // floor over editions that are OPEN
            uint256 nextOpenTime = type(uint256).max; // earliest openTime among editions still shut
            uint256 nextOpenPrice; // that edition's price, quoted when nothing is open yet
            uint256 totalMinted;
            uint256 maxSupply;
            bool isActive;
            bool hasUnlimited;
            bool hasOpenUnlimited;
            for (uint256 i = 1; i <= count; i++) {
                try this.readEdition(card.instance, i) returns (IERC1155EditionReader.Edition memory ed) {
                    // Card price is the floor of the live per-edition prices, not of static basePrice: a
                    // partway-minted LIMITED_DYNAMIC edition's live price exceeds basePrice. The live read has
                    // its own try/catch and falls back to basePrice on revert.
                    uint256 edPrice = ed.basePrice; // fallback = static floor if the live read reverts
                    try this.readEditionPrice(card.instance, i) returns (uint256 p) {
                        edPrice = p;
                    } catch { }
                    // An edition whose openTime has not arrived reverts EditionNotOpen() at both mint entry
                    // points, so it contributes neither a buyable price nor an active flag; `openTime == 0`
                    // is ungated. Past the close time both entry points revert EditionClosed(), so a finished
                    // drop stops quoting a price and stops reporting itself buyable. The close time is read
                    // on its own and guarded: an instance without the schedule has no such function, and a
                    // revert means "never closes", not "closed".
                    uint256 edCloseTime;
                    // slither-disable-next-line calls-loop
                    try this.readEditionCloseTime(card.instance, i) returns (uint256 t) {
                        edCloseTime = t;
                    } catch { }
                    bool closed = edCloseTime != 0 && block.timestamp >= edCloseTime;
                    bool open = !closed && block.timestamp >= ed.openTime;
                    if (open) {
                        if (edPrice < floorPrice) floorPrice = edPrice;
                    } else if (!closed && ed.openTime < nextOpenTime) {
                        // A closed edition is not the next one to open either: it is over.
                        nextOpenTime = ed.openTime;
                        nextOpenPrice = edPrice;
                    }
                    // These two folds run in this frame, so neither `catch {}` covers them. `getEdition` is
                    // the instance's own answer and may be any uint256: two editions reporting 2**255 minted
                    // would overflow the sum and panic, reverting all of getProjectCardsBatch. Fold checked and
                    // abandon this card (left zero like every other bad read) on overflow. A real collection
                    // cannot reach either ceiling.
                    if (ed.minted > type(uint256).max - totalMinted) return;
                    totalMinted += ed.minted;
                    if (ed.supply == 0) {
                        hasUnlimited = true;
                        if (open) hasOpenUnlimited = true;
                    } else {
                        if (ed.supply > type(uint256).max - maxSupply) return; // see the fold note above
                        maxSupply += ed.supply;
                        if (open && ed.minted < ed.supply) isActive = true;
                    }
                } catch { }
            }
            if (hasUnlimited) maxSupply = 0; // unbounded whether or not it has opened yet
            // Active iff some edition is open and mintable: any open unlimited edition, or any open
            // limited edition with minted < supply. A collection whose every edition is scheduled for a
            // future date is inactive. With nothing open, the price is the earliest opener's, not 0: a
            // scheduled drop is not a free one.
            card.currentPrice =
                floorPrice != type(uint256).max ? floorPrice : (nextOpenTime != type(uint256).max ? nextOpenPrice : 0);
            card.totalSupply = totalMinted;
            card.maxSupply = maxSupply;
            card.isActive = isActive || hasOpenUnlimited;
            // The earliest edition still shut, if any; the loop already found it to quote its price.
            // Reported whether or not another edition is open, as a fact about the collection rather
            // than a display flag; a reader that wants one status resolves `isActive` first. Bounded by
            // MAX_EDITIONS_PER_CARD like every other figure on the card.
            if (nextOpenTime != type(uint256).max) card.opensAt = nextOpenTime;
        } catch { }
    }

    /// @dev The badge gate. `getRentalInfo.isActive` is the RENTAL record — unexpired and paid for —
    ///      and deliberately says nothing about registry standing (see the revocation-visibility spec:
    ///      de-listing removes an instance from the registry's surface, it does not touch the rental).
    ///      Display is a separate question, and the curated grid already answers it: `getHomePageData`
    ///      draws its address list from `getFeaturedInstances`, which filters on expiry AND registry
    ///      liveness. `getProjectCardsBatch` takes caller-supplied addresses and never passes through
    ///      that filter, so the liveness term is applied here — otherwise a revoked instance's card
    ///      carries a live `featuredRank`/`featuredExpires`. Same predicate as the grid's, one path
    ///      later.
    // slither-disable-next-line calls-loop,unused-return
    function _hydrateFeatured(ProjectCard memory card) private view {
        try this.readRentalInfo(card.instance) returns (address, uint256 rank, uint256 expires, bool active) {
            if (active && _registrySaysLive(card.instance)) {
                card.featuredRank = rank;
                card.featuredExpires = expires;
            }
        } catch { }
    }

    /// @dev Registry liveness for the badge gate; never reverts, so a hostile or upgraded dependency
    ///      degrades a field rather than bricking a card. Raw `staticcall` + a returndata-size guard +
    ///      an assembly word read, because a high-level call (even inside `try`/`catch`) reverts on a
    ///      malformed return frame rather than yielding control back, and a guarded external reader
    ///      would widen this contract's ABI. Fails open (treats the instance as live) when the registry
    ///      cannot answer, a narrower failure than stripping the badge from every card at once. Mirrors
    ///      the queue manager's predicate of the same name.
    // slither-disable-next-line calls-loop
    function _registrySaysLive(address instance) private view returns (bool) {
        address registry = address(masterRegistry);
        if (registry == address(0)) return true;

        (bool ok, bytes memory data) =
            registry.staticcall(abi.encodeWithSelector(IMasterRegistry.isRegisteredInstance.selector, instance));
        if (!ok || data.length < 32) return true;

        uint256 word;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            word := mload(add(data, 0x20))
        }
        return word != 0;
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
            // NFT balance = tokenBalance / unit. The units-per-NFT is read live because the shared lens
            // must not bake in one instance's ratio; a zero/failed read leaves nftBalance = 0 so a broken
            // instance never reverts the batch.
            try this.readErc404Unit(instance) returns (uint256 unit_) {
                if (unit_ > 0) {
                    holding.nftBalance = balance / unit_; // round down: standard integer NFT count
                }
            } catch { }
        } catch { }

        // Escrowed coin. Two guarded siblings rather than arithmetic on `tokenBalance`: the band
        // denomination lives in the instance's own band walk, and a lens that re-derived it could
        // disagree with the escrow accounting. `tokenBalance` stays the plain `balanceOf`. An instance
        // with no ladder sealed answers `coinBalanceOf` with its plain balance, and one with neither
        // symbol leaves both at zero rather than failing the batch.
        try this.readErc404CoinBalance(instance, user) returns (uint256 coin) {
            holding.coinBalance = coin;
        } catch { }

        try this.readErc404PendingEscrowRelease(instance, user) returns (uint256 pending) {
            holding.pendingEscrowRelease = pending;
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
        uint256 openTime;
        /// @dev 0 = never closes, which is also what an instance predating the schedule reads as.
        uint256 closeTime;
        /// @dev 0 = no ceiling on what one wallet may take.
        uint256 maxPerWallet;
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
                // Guarded like the close time on the card path: an instance without the edition schedule
                // answers neither, and zero is the truth there (no close, no ceiling).
                uint256 closeTime;
                // slither-disable-next-line calls-loop
                try this.readEditionCloseTime(instance, editionId) returns (uint256 t) {
                    closeTime = t;
                } catch { }
                uint256 maxPerWallet;
                // slither-disable-next-line calls-loop
                try this.readEditionMaxPerWallet(instance, editionId) returns (uint256 m) {
                    maxPerWallet = m;
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
                    priceIncreaseRate: ed.priceIncreaseRate,
                    openTime: ed.openTime,
                    closeTime: closeTime,
                    maxPerWallet: maxPerWallet
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
     * @dev The third positional argument is a retired pointer: ignored, accepted so the admin call ABI
     *      is stable, and never stored.
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
