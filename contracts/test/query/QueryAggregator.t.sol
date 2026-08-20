// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { QueryAggregator, IERC1155EditionReader } from "../../src/query/QueryAggregator.sol";
import { QueryAggregatorPreNoesis067 } from "./legacy/QueryAggregatorPreNoesis067.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { TYPE_ERC404 } from "../../src/interfaces/IInstanceLifecycle.sol";

/// @notice noesis-067 — QueryAggregator read-path correctness fixes.
/// @dev Covers: F1 featured pagination window, F2 ERC1155 honest `isActive`, F4 portfolio length guard,
///      and the F3 UUPS slot-layout proof (deprecated `globalMessageRegistry` placeholder).
contract QueryAggregatorTest is Test {
    QueryAggregator internal agg;
    Reverter internal reverter;
    MockFeaturedQueueManager internal fqm;

    address internal owner = makeAddr("owner");

    function setUp() public {
        reverter = new Reverter();
        fqm = new MockFeaturedQueueManager();
        agg = new QueryAggregator();
        // masterRegistry must be non-zero; a Reverter makes every registry read fail-tolerantly (caught).
        // globalMessageRegistry arg is deprecated/ignored (may be zero post-067).
        agg.initialize(address(reverter), address(fqm), address(0), owner);
    }

    // ─────────────────────────── F1: featured pagination window ───────────────────────────

    /// The second arg to FQM.getFeaturedInstances is a COUNT (limit), not an end index. With the prior
    /// bug (`offset + limit`) page 2+ over-fetched by `offset`; the fix must return exactly `limit`.
    function test_F1_featured_returns_exactly_limit_items() public {
        fqm.setTotal(100);

        (QueryAggregator.ProjectCard[] memory projects, uint256 total) = agg.getHomePageData(50, 25);

        // Under the bug the aggregator passed limit=75 and FQM would return min(75, 100-50)=50 items.
        assertEq(projects.length, 25, "must return exactly `limit` items, not offset+limit");
        assertEq(total, 100, "true featured total surfaced for pagination");
    }

    function test_F1_first_page_unaffected() public {
        fqm.setTotal(100);
        (QueryAggregator.ProjectCard[] memory projects,) = agg.getHomePageData(0, 24);
        assertEq(projects.length, 24);
    }

    function test_F1_limit_over_max_reverts() public {
        vm.expectRevert(QueryAggregator.LimitTooHigh.selector);
        agg.getHomePageData(0, 51);
    }

    // ─────────────────────────── F2: honest ERC1155 isActive ───────────────────────────

    function _card(address instance) internal view returns (QueryAggregator.ProjectCard memory) {
        address[] memory arr = new address[](1);
        arr[0] = instance;
        return agg.getProjectCardsBatch(arr)[0];
    }

    function test_F2_unlimited_only_is_active() public {
        MockERC1155Editions m = new MockERC1155Editions();
        m.addEdition({ supply: 0, minted: 3, basePrice: 1 ether }); // supply 0 => UNLIMITED
        QueryAggregator.ProjectCard memory card = _card(address(m));
        assertTrue(card.isActive, "an unlimited edition keeps the collection active");
        assertEq(card.maxSupply, 0, "unlimited => maxSupply reported as 0");
    }

    function test_F2_partially_minted_limited_is_active() public {
        MockERC1155Editions m = new MockERC1155Editions();
        m.addEdition({ supply: 10, minted: 5, basePrice: 1 ether }); // LIMITED, not sold out
        QueryAggregator.ProjectCard memory card = _card(address(m));
        assertTrue(card.isActive, "a limited edition with minted < supply is active");
        assertEq(card.maxSupply, 10);
        assertEq(card.totalSupply, 5);
    }

    function test_F2_sold_out_limited_is_inactive() public {
        MockERC1155Editions m = new MockERC1155Editions();
        m.addEdition({ supply: 10, minted: 10, basePrice: 1 ether }); // LIMITED, sold out
        m.addEdition({ supply: 5, minted: 5, basePrice: 2 ether }); // LIMITED, sold out
        QueryAggregator.ProjectCard memory card = _card(address(m));
        assertFalse(card.isActive, "a fully-minted all-limited collection must report inactive");
        assertEq(card.maxSupply, 15);
        assertEq(card.totalSupply, 15);
    }

    function test_F2_soldout_limited_plus_unlimited_is_active() public {
        MockERC1155Editions m = new MockERC1155Editions();
        m.addEdition({ supply: 10, minted: 10, basePrice: 1 ether }); // sold-out LIMITED
        m.addEdition({ supply: 0, minted: 1, basePrice: 2 ether }); // UNLIMITED
        QueryAggregator.ProjectCard memory card = _card(address(m));
        assertTrue(card.isActive, "presence of any unlimited edition keeps it active");
        assertEq(card.maxSupply, 0, "any unlimited => maxSupply 0");
    }

    // ─────────────────────────── F-F.1: FQM revert must not sink the homepage ───────────────────────────

    /// A broken/upgraded FeaturedQueueManager whose getFeaturedInstances reverts must yield an empty
    /// homepage (empty projects, totalFeatured 0), NOT revert the whole call. Before the fix the FQM
    /// call was the one bare entry-path read and would propagate the revert to the caller.
    function test_FF1_reverting_fqm_yields_empty_homepage() public {
        fqm.setTotal(100);
        fqm.setShouldRevert(true);

        (QueryAggregator.ProjectCard[] memory projects, uint256 total) = agg.getHomePageData(0, 24);

        assertEq(projects.length, 0, "reverting FQM => empty grid, not a revert");
        assertEq(total, 0, "reverting FQM => zero total");
    }

    // ─────────────────────────── F-F.3: card price = floor of LIVE per-edition prices ───────────────────────────

    /// The card currentPrice must be the min of the LIVE getCurrentPrice per edition, not the min of the
    /// static basePrice. With a live bump the two diverge; this assertion FAILS against the old basePrice
    /// floor (which would report min basePrice = 1 ether).
    function test_FF3_card_price_uses_live_price_floor() public {
        MockERC1155Editions m = new MockERC1155Editions();
        m.addEdition({ supply: 10, minted: 5, basePrice: 1 ether }); // min basePrice
        m.addEdition({ supply: 10, minted: 2, basePrice: 3 ether });
        m.setLivePriceBump(0.5 ether); // live = basePrice + 0.5 => min live = 1.5 ether

        QueryAggregator.ProjectCard memory card = _card(address(m));

        assertEq(card.currentPrice, 1.5 ether, "card price = floor of LIVE prices (1 + 0.5), not min basePrice");
    }

    /// If getCurrentPrice reverts, the lens must fall back to basePrice for that edition (failure-tolerance
    /// doctrine) — no revert, and the floor reflects the static basePrice.
    function test_FF3_live_price_revert_falls_back_to_baseprice() public {
        MockERC1155Editions m = new MockERC1155Editions();
        m.addEdition({ supply: 10, minted: 5, basePrice: 1 ether });
        m.addEdition({ supply: 10, minted: 2, basePrice: 3 ether });
        m.setLivePriceBump(0.5 ether);
        m.setPriceReverts(true); // live read reverts => fall back to basePrice

        QueryAggregator.ProjectCard memory card = _card(address(m));

        assertEq(card.currentPrice, 1 ether, "getCurrentPrice revert => fall back to min basePrice, no revert");
    }

    // ─────────────────────────── F-F.4: extraData is documented-unused (always empty) ───────────────────────────

    /// No card hydration path assigns extraData; it must always be empty bytes. Pins the documented
    /// "unused" contract so a future accidental populate is caught.
    function test_FF4_erc1155_card_extradata_empty() public {
        MockERC1155Editions m = new MockERC1155Editions();
        m.addEdition({ supply: 10, minted: 5, basePrice: 1 ether });
        QueryAggregator.ProjectCard memory card = _card(address(m));
        assertEq(card.extraData.length, 0, "extraData is unused => always empty bytes");
    }

    // ─────────────────────────── F4: portfolio length guard ───────────────────────────

    function test_F4_portfolio_reverts_over_max_instances() public {
        address[] memory instances = new address[](51);
        address[] memory vaults = new address[](0);
        for (uint256 i = 0; i < 51; i++) {
            instances[i] = address(reverter);
        }
        vm.expectRevert(QueryAggregator.TooManyInstances.selector);
        agg.getPortfolioData(makeAddr("user"), instances, vaults);
    }

    function test_F4_portfolio_reverts_over_max_vaults() public {
        address[] memory instances = new address[](0);
        address[] memory vaults = new address[](51);
        for (uint256 i = 0; i < 51; i++) {
            vaults[i] = address(reverter);
        }
        vm.expectRevert(QueryAggregator.TooManyInstances.selector);
        agg.getPortfolioData(makeAddr("user"), instances, vaults);
    }

    function test_F4_portfolio_at_max_passes() public {
        address[] memory instances = new address[](50);
        address[] memory vaults = new address[](50);
        for (uint256 i = 0; i < 50; i++) {
            instances[i] = address(reverter);
            vaults[i] = address(reverter);
        }
        // Exactly MAX_QUERY_LIMIT on each array must NOT revert; failure-tolerant reads yield empties.
        (
            QueryAggregator.ERC404Holding[] memory h404,
            QueryAggregator.ERC1155Holding[] memory h1155,
            QueryAggregator.VaultPosition[] memory vp,
            uint256 claimable,
            QueryAggregator.AuctionPosition[] memory ap
        ) = agg.getPortfolioData(makeAddr("user"), instances, vaults);
        assertEq(h404.length, 0);
        assertEq(h1155.length, 0);
        assertEq(vp.length, 0);
        assertEq(claimable, 0);
        assertEq(ap.length, 0);
    }

    // ─────────────────────────── F3: UUPS slot-layout proof ───────────────────────────

    /// Deploy the proxy on the PRE-067 implementation (globalMessageRegistry as a live slot 2), seed it,
    /// then upgrade the SAME proxy to the post-067 QueryAggregator (slot 2 kept as a deprecated
    /// placeholder). Every pre-existing slot must read back identically — a removed (rather than
    /// placeheld) slot would shift `_initialized` and corrupt the registry pointers.
    function test_F3_upgrade_preserves_slot_layout() public {
        address seededMaster = makeAddr("seededMaster");
        address seededFqm = makeAddr("seededFqm");
        address seededGmr = makeAddr("seededGmr");

        QueryAggregatorPreNoesis067 oldImpl = new QueryAggregatorPreNoesis067();
        address proxy = LibClone.deployERC1967(address(oldImpl));
        QueryAggregatorPreNoesis067 legacy = QueryAggregatorPreNoesis067(proxy);
        legacy.initialize(seededMaster, seededFqm, seededGmr, owner);

        // sanity: pre-upgrade slot 2 holds the (soon-to-be-deprecated) pointer
        assertEq(legacy.globalMessageRegistry(), seededGmr);
        assertEq(legacy.masterRegistry(), seededMaster);

        // upgrade the SAME proxy to the post-067 implementation
        QueryAggregator newImpl = new QueryAggregator();
        vm.prank(owner);
        legacy.upgradeToAndCall(address(newImpl), "");

        QueryAggregator upgraded = QueryAggregator(proxy);

        // slots 0 and 1 preserved
        assertEq(address(upgraded.masterRegistry()), seededMaster, "masterRegistry slot preserved");
        assertEq(address(upgraded.featuredQueueManager()), seededFqm, "featuredQueueManager slot preserved");
        // owner (solady fixed slot) preserved
        assertEq(upgraded.owner(), owner, "owner preserved across upgrade");

        // slot 3 (_initialized) preserved: re-initializing must still revert with AlreadyInitialized. If
        // the deprecated slot 2 had been REMOVED, _initialized would have shifted into old slot 2 and read
        // false here. Called as the owner so the owner gate passes and the initialized check is the one
        // actually under test.
        vm.prank(owner);
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        upgraded.initialize(seededMaster, seededFqm, address(0), owner);
    }

    // ───────────────── AB1: ERC404 staking is read off the singleton, not the instance ─────────────────
    //
    // Staking state for an ERC404 instance lives in the `ERC404StakingModule` singleton keyed by
    // instance; the instance itself carries only a `stakingModule()` pointer. These tests stand up that
    // real shape — an instance exposing `stakingModule()`, and a singleton exposing
    // `stakingEnabled(address)` / `stakedBalance(address,address)` /
    // `calculatePendingRewards(address,address)` — and pin the portfolio read against it.

    /// Build an aggregator whose registry answers `getInstanceInfo`, so the portfolio path reaches the
    /// ERC404 branch instead of being caught at the registry read.
    function _aggWithRegistry(MockPortfolioRegistry registry) internal returns (QueryAggregator a) {
        a = new QueryAggregator();
        a.initialize(address(registry), address(fqm), address(0), owner);
    }

    function _one(address instance) internal pure returns (address[] memory instances) {
        instances = new address[](1);
        instances[0] = instance;
    }

    /// A holder whose entire position is staked holds ZERO transferable balance (`stake` moves the coin
    /// into the module's custody), so the instance must still appear in the portfolio on the strength of
    /// its staked balance alone, and its pending rewards must reach `totalClaimable`.
    function test_AB1_fully_staked_holder_appears_with_staked_balance_and_rewards() public {
        address user = makeAddr("stakerFull");
        MockStakingSingleton module = new MockStakingSingleton();
        MockERC404Instance instance = new MockERC404Instance(address(module), 1e24);
        MockPortfolioRegistry registry = new MockPortfolioRegistry("Staked Project");
        QueryAggregator a = _aggWithRegistry(registry);

        module.setEnabled(address(instance), true);
        module.setStaked(address(instance), user, 3_000_000e18);
        module.setPending(address(instance), user, 0.42 ether);
        // every coin is in the module's custody: the instance reports no balance for the holder
        instance.setBalance(user, 0);

        (QueryAggregator.ERC404Holding[] memory h404,,, uint256 claimable,) =
            a.getPortfolioData(user, _one(address(instance)), new address[](0));

        assertEq(h404.length, 1, "fully-staked holder must not be dropped from the portfolio");
        assertEq(h404[0].instance, address(instance), "holding points at the instance");
        assertEq(h404[0].name, "Staked Project", "holding carries the registry name");
        assertEq(h404[0].tokenBalance, 0, "no transferable balance while fully staked");
        assertEq(h404[0].stakedBalance, 3_000_000e18, "staked balance read off the singleton");
        assertEq(h404[0].pendingRewards, 0.42 ether, "pending rewards read off the singleton");
        assertEq(claimable, 0.42 ether, "pending staking rewards reach totalClaimable");
    }

    /// A partial staker reports both sides of the position independently.
    function test_AB1_partial_staker_reports_both_balances() public {
        address user = makeAddr("stakerPartial");
        MockStakingSingleton module = new MockStakingSingleton();
        MockERC404Instance instance = new MockERC404Instance(address(module), 1e24);
        MockPortfolioRegistry registry = new MockPortfolioRegistry("Partial Project");
        QueryAggregator a = _aggWithRegistry(registry);

        module.setEnabled(address(instance), true);
        module.setStaked(address(instance), user, 2_000_000e18);
        module.setPending(address(instance), user, 0.1 ether);
        instance.setBalance(user, 1_500_000e18);

        (QueryAggregator.ERC404Holding[] memory h404,,, uint256 claimable,) =
            a.getPortfolioData(user, _one(address(instance)), new address[](0));

        assertEq(h404.length, 1);
        assertEq(h404[0].tokenBalance, 1_500_000e18, "transferable balance unchanged by staking");
        assertEq(h404[0].nftBalance, 1, "1.5M coin at a 1M unit rounds down to one whole NFT");
        assertEq(h404[0].stakedBalance, 2_000_000e18, "staked balance read off the singleton");
        assertEq(h404[0].pendingRewards, 0.1 ether);
        assertEq(claimable, 0.1 ether);
    }

    /// Staking switched off in the singleton reports zero staking fields without reverting the batch.
    function test_AB1_staking_disabled_reports_zero_without_reverting() public {
        address user = makeAddr("unstakedHolder");
        MockStakingSingleton module = new MockStakingSingleton();
        MockERC404Instance instance = new MockERC404Instance(address(module), 1e24);
        QueryAggregator a = _aggWithRegistry(new MockPortfolioRegistry("Quiet Project"));

        module.setEnabled(address(instance), false);
        module.setStaked(address(instance), user, 5_000_000e18); // stale state behind a closed switch
        instance.setBalance(user, 1_000_000e18);

        (QueryAggregator.ERC404Holding[] memory h404,,, uint256 claimable,) =
            a.getPortfolioData(user, _one(address(instance)), new address[](0));

        assertEq(h404.length, 1);
        assertEq(h404[0].stakedBalance, 0, "a closed staking switch reports zero");
        assertEq(h404[0].pendingRewards, 0);
        assertEq(claimable, 0);
    }

    /// An instance that was never wired to a staking module degrades to zero-values; the never-brick
    /// guarantee holds and the rest of the holding still reads.
    function test_AB1_unset_staking_module_degrades_to_zero() public {
        address user = makeAddr("noModuleHolder");
        MockERC404Instance instance = new MockERC404Instance(address(0), 1e24);
        QueryAggregator a = _aggWithRegistry(new MockPortfolioRegistry("No Staking Project"));
        instance.setBalance(user, 2_000_000e18);

        (QueryAggregator.ERC404Holding[] memory h404,,, uint256 claimable,) =
            a.getPortfolioData(user, _one(address(instance)), new address[](0));

        assertEq(h404.length, 1, "the holding still reads with no staking module wired");
        assertEq(h404[0].tokenBalance, 2_000_000e18);
        assertEq(h404[0].nftBalance, 2);
        assertEq(h404[0].stakedBalance, 0);
        assertEq(h404[0].pendingRewards, 0);
        assertEq(claimable, 0);
    }

    /// A staking module that reverts on every read must not reach the batch: zero staking fields, and
    /// the token side of the holding survives intact.
    function test_AB1_reverting_staking_module_degrades_to_zero() public {
        address user = makeAddr("brokenModuleHolder");
        MockERC404Instance instance = new MockERC404Instance(address(reverter), 1e24);
        QueryAggregator a = _aggWithRegistry(new MockPortfolioRegistry("Broken Module Project"));
        instance.setBalance(user, 3_000_000e18);

        (QueryAggregator.ERC404Holding[] memory h404,,, uint256 claimable,) =
            a.getPortfolioData(user, _one(address(instance)), new address[](0));

        assertEq(h404.length, 1, "a reverting staking module must not fail the portfolio read");
        assertEq(h404[0].tokenBalance, 3_000_000e18);
        assertEq(h404[0].stakedBalance, 0);
        assertEq(h404[0].pendingRewards, 0);
        assertEq(claimable, 0);
    }

    /// A `stakingModule()` pointer at an EOA returns no data at all — the decode must fail inside the
    /// guarded reader's own frame, not the aggregator's, so the batch still completes.
    function test_AB1_eoa_staking_module_degrades_to_zero() public {
        address user = makeAddr("eoaModuleHolder");
        MockERC404Instance instance = new MockERC404Instance(makeAddr("notAContract"), 1e24);
        QueryAggregator a = _aggWithRegistry(new MockPortfolioRegistry("EOA Module Project"));
        instance.setBalance(user, 1_000_000e18);

        (QueryAggregator.ERC404Holding[] memory h404,,, uint256 claimable,) =
            a.getPortfolioData(user, _one(address(instance)), new address[](0));

        assertEq(h404.length, 1);
        assertEq(h404[0].stakedBalance, 0);
        assertEq(h404[0].pendingRewards, 0);
        assertEq(claimable, 0);
    }
}

// ───────────────────────────────────── Mocks ─────────────────────────────────────

/// @dev The `ERC404StakingModule` singleton's read shape: state is keyed by instance, so every getter
///      takes the instance as its first argument. Deliberately exposes NO one-argument staking getter —
///      the instance is not where this state lives.
contract MockStakingSingleton {
    mapping(address => bool) public stakingEnabled;
    mapping(address => mapping(address => uint256)) public stakedBalance;
    mapping(address => mapping(address => uint256)) private pending;

    function setEnabled(address instance, bool v) external {
        stakingEnabled[instance] = v;
    }

    function setStaked(address instance, address user, uint256 amount) external {
        stakedBalance[instance][user] = amount;
    }

    function setPending(address instance, address user, uint256 amount) external {
        pending[instance][user] = amount;
    }

    function calculatePendingRewards(address instance, address user) external view returns (uint256) {
        return pending[instance][user];
    }
}

/// @dev An ERC404 bonding instance as it actually reads: a balance, a unit divisor, and a POINTER at the
///      staking singleton. It has no fallback, so any call for a selector it does not carry reverts —
///      which is what makes a lens reading staking off the instance visible here.
contract MockERC404Instance {
    address public immutable stakingModule;
    uint256 public immutable unit;

    mapping(address => uint256) public balanceOf;

    constructor(address stakingModule_, uint256 unit_) {
        stakingModule = stakingModule_;
        unit = unit_;
    }

    function setBalance(address user, uint256 amount) external {
        balanceOf[user] = amount;
    }

    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC404;
    }
}

/// @dev Master registry stub that answers `getInstanceInfo` for any instance with a fixed name, so the
///      portfolio path reaches the ERC404 branch.
contract MockPortfolioRegistry {
    string private name_;

    constructor(string memory n) {
        name_ = n;
    }

    function getInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = instance;
        info.name = name_;
    }
}

/// @dev Reverts on every call so registry/instance reads exercise the lens's fail-tolerant try/catch.
contract Reverter {
    fallback() external payable {
        revert("Reverter");
    }
}

/// @dev Returns a window of `limit` synthetic instances (each the shared Reverter) and the true total,
///      recording the last `limit` it received so the test can assert the corrected pagination arg.
contract MockFeaturedQueueManager {
    uint256 public total;
    bool public shouldRevert;
    Reverter internal instance;

    constructor() {
        instance = new Reverter();
    }

    function setTotal(uint256 t) external {
        total = t;
    }

    /// @dev F-F.1: models a broken/upgraded FQM whose getFeaturedInstances reverts. The lens must catch
    ///      this and yield an empty homepage, not propagate the revert.
    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    /// @dev Faithfully models the real FQM: returns a window of AT MOST `limit` instances starting at
    ///      `offset`. Because the returned length is `min(limit, total - offset)`, an aggregator that
    ///      (buggily) passed `offset + limit` would get a wider window — the length assertion catches it.
    function getFeaturedInstances(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory instances, uint256 total_)
    {
        if (shouldRevert) revert("FQM broken");
        total_ = total;

        uint256 n = 0;
        if (offset < total) {
            n = total - offset;
            if (n > limit) n = limit;
        }
        instances = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            instances[i] = address(instance);
        }
    }

    function getRentalInfo(address)
        external
        pure
        returns (address renter, uint256 rank, uint256 expires, bool isActive)
    {
        return (address(0), 0, 0, false);
    }
}

/// @dev Minimal ERC1155 edition source for the card-hydration path. Deliberately has NO getCardData
///      (so `_hydrateCardData` falls through to the edition-based ERC1155 branch) and no fallback.
contract MockERC1155Editions {
    IERC1155EditionReader.Edition[] private eds;

    // F-F.3: live-price controls. `livePriceBump` is added to basePrice to model a partway-minted
    // LIMITED_DYNAMIC edition whose live getCurrentPrice exceeds its static basePrice. `priceReverts`
    // forces getCurrentPrice to revert so the lens's basePrice fallback can be asserted.
    uint256 public livePriceBump;
    bool public priceReverts;

    function setLivePriceBump(uint256 bump) external {
        livePriceBump = bump;
    }

    function setPriceReverts(bool v) external {
        priceReverts = v;
    }

    function addEdition(uint256 supply, uint256 minted, uint256 basePrice) external {
        IERC1155EditionReader.Edition memory e;
        e.id = eds.length + 1;
        e.basePrice = basePrice;
        e.supply = supply;
        e.minted = minted;
        e.pricingModel = supply == 0
            ? IERC1155EditionReader.PricingModel.UNLIMITED
            : IERC1155EditionReader.PricingModel.LIMITED_FIXED;
        eds.push(e);
    }

    function nextEditionId() external view returns (uint256) {
        return eds.length + 1;
    }

    function getEdition(uint256 editionId) external view returns (IERC1155EditionReader.Edition memory) {
        return eds[editionId - 1];
    }

    function getCurrentPrice(uint256 editionId) external view returns (uint256) {
        if (priceReverts) revert("getCurrentPrice broken");
        return eds[editionId - 1].basePrice + livePriceBump;
    }
}
