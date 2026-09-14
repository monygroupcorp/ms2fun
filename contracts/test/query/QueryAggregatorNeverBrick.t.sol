// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { QueryAggregator } from "../../src/query/QueryAggregator.sol";
import { FeaturedQueueManager } from "../../src/master/FeaturedQueueManager.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { TYPE_ERC404, TYPE_ERC1155 } from "../../src/interfaces/IInstanceLifecycle.sol";

/// @notice No-op FeaturedQueueManager stub: nothing is featured, the window is empty.
contract StubFQM {
    function getRentalInfo(address) external pure returns (address, uint256, uint256, bool) {
        return (address(0), 0, 0, false);
    }

    function getFeaturedInstances(uint256, uint256) external pure returns (address[] memory, uint256) {
        return (new address[](0), 0);
    }
}

/// @notice A FeaturedQueueManager whose reads return four bytes for every selector — the shape a
///         differently-versioned deployment behind the same pointer would present.
contract ShortReturnFQM {
    fallback() external {
        assembly {
            mstore(0, 0xdeadbeef)
            return(0, 4)
        }
    }
}

/// @notice A well-formed ERC404 instance: every getter the card lens reads, all decodable.
contract GoodERC404Instance {
    uint256 public totalBondingSupply = 500e18;
    uint256 public maxSupply = 10_000e18;
    uint256 public unit = 1_000_000 * 1e18;
    uint256 public liquidityReserve = 0;
    uint256 public freeMintAllocation = 0;
    bool public bondingActive = true;
    uint256 public bondingOpenTime = 0;
    bool public graduated = false;

    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC404;
    }

    function curveParams() external pure returns (uint256, uint256, uint256) {
        return (1e18, 1.0438e18, 1e18);
    }

    function contractURI() external pure returns (string memory) {
        return "ipfs://good";
    }
}

/// @notice Answers every selector with four bytes. `instanceType()` declares `bytes32`, so the
///         returndata is too short to decode — the FIXED-SIZE undecodable case.
contract ShortReturnInstance {
    fallback() external {
        assembly {
            mstore(0, 0xdeadbeef)
            return(0, 4)
        }
    }
}

/// @notice Types itself as ERC404 (so the lens proceeds), then answers `contractURI()` with a
///         truncated dynamic frame: a head offset of 0x20 and no length word behind it. This is the
///         DYNAMIC-FRAMED undecodable case — the returndata length is a legal 32 bytes, so no
///         returndata-length check could reject it; only the decode itself can.
contract BadDynamicStringInstance {
    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC404;
    }

    fallback() external {
        assembly {
            mstore(0, 0x20)
            return(0, 32)
        }
    }
}

/// @notice Types itself as ERC1155 and reports three editions, then answers `getEdition(uint256)`
///         with a truncated dynamic frame. The declared return is a struct carrying two strings, so
///         the decode walks past the returndata and reverts.
contract BadDynamicEditionInstance {
    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC1155;
    }

    function nextEditionId() external pure returns (uint256) {
        return 4; // three editions: ids 1..3
    }

    function contractURI() external pure returns (string memory) {
        return "";
    }

    fallback() external {
        assembly {
            mstore(0, 0x20)
            return(0, 32)
        }
    }
}

/// @notice Types itself as ERC1155 and answers `getAllEditionIds()` with a truncated dynamic frame —
///         the portfolio-path equivalent of the card-path dynamic failure.
contract BadDynamicEditionIdsInstance {
    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC1155;
    }

    fallback() external {
        assembly {
            mstore(0, 0x20)
            return(0, 32)
        }
    }
}

/// @notice A vault-shaped address that answers four bytes for every selector.
contract ShortReturnVault {
    fallback() external {
        assembly {
            mstore(0, 0xdeadbeef)
            return(0, 4)
        }
    }
}

/**
 * @notice The never-brick read contract, exercised.
 *
 * @dev The aggregator documents that a broken, upgraded, or non-contract target degrades to
 *      zero-values rather than reverting the batch. `try target.f() returns (T)` does not deliver
 *      that: since solc 0.8.10 a call with return data skips the `extcodesize` check and relies on
 *      `returndatasize`, so a target that returns zero bytes (an EOA), too few bytes, or a
 *      differently-shaped frame fails to decode IN THE CALLER'S FRAME, where `catch` does not reach.
 *      Routing each read through an `external view` reader on the aggregator moves the decode into
 *      the child frame, where the failure is an ordinary revert the caller's `catch` does cover.
 *
 *      Every test below is a live gate on that routing: revert any one converted seam to a bare
 *      `try target.f() returns (T)` and the corresponding test reverts instead of asserting.
 */
contract QueryAggregatorNeverBrickTest is Test {
    QueryAggregator internal agg;
    MockMasterRegistry internal registry;

    function setUp() public {
        registry = new MockMasterRegistry();
        agg = new QueryAggregator();
        agg.initialize(address(registry), address(new StubFQM()), address(0xDEAD), address(this));
        vm.warp(1_000_000);
    }

    function _batch(address inst) internal view returns (QueryAggregator.ProjectCard memory) {
        address[] memory instances = new address[](1);
        instances[0] = inst;
        return agg.getProjectCardsBatch(instances)[0];
    }

    function _assertZeroCard(QueryAggregator.ProjectCard memory card, address expectedInstance) internal {
        assertEq(card.instance, expectedInstance, "instance echoed back");
        assertEq(card.currentPrice, 0, "currentPrice zero");
        assertEq(card.totalSupply, 0, "totalSupply zero");
        assertEq(card.maxSupply, 0, "maxSupply zero");
        assertFalse(card.isActive, "isActive false");
        assertEq(bytes(card.metadataURI).length, 0, "metadataURI empty");
    }

    // ============ Card path: a single bad entry must not revert the batch ============

    /// @dev The case reachable with no upgrade and no attacker: a frontend passes an address that is
    ///      not a contract (a stale pointer after a redeploy, a user-typed address).
    function test_batch_with_eoa_entry_returns_zero_card() public {
        address eoa = address(0xE0A);
        assertEq(eoa.code.length, 0, "precondition: target is not a contract");
        _assertZeroCard(_batch(eoa), eoa);
    }

    /// @dev Fixed-size undecodable: four bytes where `bytes32` was declared.
    function test_batch_with_short_return_entry_returns_zero_card() public {
        address bad = address(new ShortReturnInstance());
        _assertZeroCard(_batch(bad), bad);
    }

    /// @dev Dynamic-framed undecodable: a truncated `string` frame from `contractURI()`. The
    ///      returndata is a legal 32 bytes, so length alone cannot tell this from a valid head.
    function test_batch_with_malformed_string_return_returns_zero_metadata_uri() public {
        BadDynamicStringInstance bad = new BadDynamicStringInstance();
        QueryAggregator.ProjectCard memory card = _batch(address(bad));
        assertEq(card.instance, address(bad), "instance echoed back");
        assertEq(bytes(card.metadataURI).length, 0, "undecodable contractURI leaves the registry value");
    }

    /// @dev Dynamic-framed undecodable inside the per-edition loop: a truncated struct-with-strings
    ///      frame from `getEdition(uint256)`, repeated for every edition in the range.
    function test_batch_with_malformed_edition_struct_returns_zero_card() public {
        BadDynamicEditionInstance bad = new BadDynamicEditionInstance();
        QueryAggregator.ProjectCard memory card = _batch(address(bad));
        assertEq(card.instance, address(bad), "instance echoed back");
        assertEq(card.currentPrice, 0, "no edition decoded => no floor price");
        assertEq(card.totalSupply, 0, "no edition decoded => no minted total");
        assertFalse(card.isActive, "no edition decoded => inactive");
    }

    /// @dev The never-brick promise is about the BATCH surviving, not merely about not reverting:
    ///      the good entries alongside a bad one must still hydrate.
    function test_batch_mixing_good_and_bad_entries_hydrates_the_good_ones() public {
        GoodERC404Instance good1 = new GoodERC404Instance();
        GoodERC404Instance good2 = new GoodERC404Instance();

        address[] memory instances = new address[](5);
        instances[0] = address(good1);
        instances[1] = address(0xE0A); // not a contract
        instances[2] = address(new ShortReturnInstance()); // fixed-size undecodable
        instances[3] = address(new BadDynamicStringInstance()); // dynamic-framed undecodable
        instances[4] = address(good2);

        QueryAggregator.ProjectCard[] memory cards = agg.getProjectCardsBatch(instances);

        assertGt(cards[0].currentPrice, 0, "good entry 0 priced");
        assertTrue(cards[0].isActive, "good entry 0 active");
        assertEq(cards[0].totalSupply, 500e18, "good entry 0 supply");
        assertEq(cards[0].metadataURI, "ipfs://good", "good entry 0 metadata read through");

        _assertZeroCard(cards[1], instances[1]);
        _assertZeroCard(cards[2], instances[2]);

        assertGt(cards[4].currentPrice, 0, "good entry 4 priced");
        assertTrue(cards[4].isActive, "good entry 4 active");
        assertEq(cards[4].metadataURI, "ipfs://good", "good entry 4 metadata read through");
    }

    // ============ Home page: the queue manager is one read the grid must survive ============

    function test_homepage_survives_undecodable_queue_manager() public {
        agg.setRegistries(address(0), address(new ShortReturnFQM()), address(0));
        (QueryAggregator.ProjectCard[] memory projects, uint256 total) = agg.getHomePageData(0, 10);
        assertEq(projects.length, 0, "empty grid, not a revert");
        assertEq(total, 0, "no total");
    }

    // ============ Portfolio path: caller-supplied instances and vaults ============

    function test_portfolio_with_eoa_instance_does_not_revert() public {
        address[] memory instances = new address[](1);
        instances[0] = address(0xE0A);
        (QueryAggregator.ERC404Holding[] memory h404,,, uint256 claimable,) =
            agg.getPortfolioData(address(this), instances, new address[](0));
        assertEq(h404.length, 0, "no holdings");
        assertEq(claimable, 0, "no claimable");
    }

    function test_portfolio_with_short_return_instance_does_not_revert() public {
        address[] memory instances = new address[](1);
        instances[0] = address(new ShortReturnInstance());
        (QueryAggregator.ERC404Holding[] memory h404,,,,) =
            agg.getPortfolioData(address(this), instances, new address[](0));
        assertEq(h404.length, 0, "no holdings");
    }

    function test_portfolio_with_malformed_edition_ids_does_not_revert() public {
        address[] memory instances = new address[](1);
        instances[0] = address(new BadDynamicEditionIdsInstance());
        (, QueryAggregator.ERC1155Holding[] memory h1155,,,) =
            agg.getPortfolioData(address(this), instances, new address[](0));
        assertEq(h1155.length, 0, "undecodable edition id array => no holding");
    }

    function test_portfolio_with_eoa_vault_does_not_revert() public {
        address[] memory vaults = new address[](1);
        vaults[0] = address(0xBEEF01);
        (,, QueryAggregator.VaultPosition[] memory positions, uint256 claimable,) =
            agg.getPortfolioData(address(this), new address[](0), vaults);
        assertEq(positions.length, 0, "no positions");
        assertEq(claimable, 0, "no claimable");
    }

    function test_portfolio_with_short_return_vault_does_not_revert() public {
        address[] memory vaults = new address[](1);
        vaults[0] = address(new ShortReturnVault());
        (,, QueryAggregator.VaultPosition[] memory positions,,) =
            agg.getPortfolioData(address(this), new address[](0), vaults);
        assertEq(positions.length, 0, "no positions");
    }

    // ============ Edition batch: per-edition tolerance ============

    /// @dev `getERC1155EditionsBatch` reverts by design on an instance that cannot answer
    ///      `nextEditionId()` (the range check needs it), but once inside the range each edition is
    ///      independently tolerant: an undecodable edition yields a zero entry carrying its own id.
    function test_editions_batch_tolerates_undecodable_editions() public {
        BadDynamicEditionInstance bad = new BadDynamicEditionInstance();
        QueryAggregator.EditionView[] memory views = agg.getERC1155EditionsBatch(address(bad), 1, 3);
        assertEq(views.length, 3, "one entry per requested edition");
        for (uint256 i = 0; i < views.length; i++) {
            assertEq(views[i].id, i + 1, "id preserved for mapping");
            assertEq(views[i].basePrice, 0, "undecodable edition => zero entry");
            assertEq(bytes(views[i].pieceTitle).length, 0, "undecodable edition => empty title");
        }
    }
}

// ── Featured grid: the registry read behind it must never brick the grid ──────────────────────

/// @notice A registry that answers every rental-eligibility read, so slots can be created.
contract LiveRegistry {
    function isRegisteredInstance(address) external pure returns (bool) {
        return true;
    }

    function getInstanceInfo(address instance) external pure returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = instance;
    }
}

/// @notice Answers four bytes for every selector — too short to hold a `bool`.
contract ShortReturnRegistry {
    fallback() external {
        assembly {
            mstore(0, 0xdeadbeef)
            return(0, 4)
        }
    }
}

/// @notice Answers a full word that is not a canonical boolean, the shape a high-level `bool` decode
///         rejects. Length alone cannot tell this from a valid answer.
contract NonBooleanRegistry {
    fallback() external {
        assembly {
            mstore(0, 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef)
            return(0, 32)
        }
    }
}

/// @notice Reverts on every call — a registry paused or upgraded out from under the pointer.
contract RevertingRegistry {
    fallback() external {
        revert("registry down");
    }
}

/**
 * @notice `getFeaturedInstances` backs the landing page, so its registry read degrades rather than
 *         reverting. The defined fallback is FAIL-OPEN: a registry that cannot be reached or cannot be
 *         decoded leaves the slot visible, which is the pre-existing behaviour, instead of emptying the
 *         grid for every instance at once.
 *
 * @dev Each test below is a live gate on the raw-staticcall routing: replace the guarded call with a
 *      high-level `masterRegistry.isRegisteredInstance(...)` — with or without `try`/`catch` — and the
 *      corresponding test reverts instead of asserting.
 */
contract FeaturedQueueRegistryNeverBrickTest is Test {
    FeaturedQueueManager internal queue;
    LiveRegistry internal live;

    address internal renter = makeAddr("renter");
    address internal treasury = makeAddr("treasury");
    address internal inst1 = makeAddr("featuredInstance1");
    address internal inst2 = makeAddr("featuredInstance2");

    function setUp() public {
        live = new LiveRegistry();
        queue = new FeaturedQueueManager();
        queue.initialize(address(live), address(this));
        queue.setProtocolTreasury(treasury);

        _rent(inst1, 0.02 ether);
        _rent(inst2, 0.01 ether);
    }

    function _rent(address instance, uint256 rankBoost) internal {
        uint256 duration = queue.minDuration();
        uint256 total = queue.quoteDurationCost(duration) + rankBoost;
        vm.deal(renter, renter.balance + total);
        vm.prank(renter);
        queue.rentFeatured{ value: total }(instance, duration, rankBoost);
    }

    function _assertFailOpen(string memory label) internal view {
        (address[] memory result, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 2, string.concat(label, ": both slots counted"));
        assertEq(result.length, 2, string.concat(label, ": both slots returned"));
        assertEq(result[0], inst1, string.concat(label, ": rank order preserved"));
        assertEq(result[1], inst2, string.concat(label, ": rank order preserved"));
    }

    function test_featured_grid_survives_registry_with_no_code() public {
        address noCode = address(0xC0DE1E55);
        assertEq(noCode.code.length, 0, "precondition: registry pointer is not a contract");
        queue.setMasterRegistry(noCode);
        _assertFailOpen("no-code registry");
    }

    function test_featured_grid_survives_short_return_registry() public {
        queue.setMasterRegistry(address(new ShortReturnRegistry()));
        _assertFailOpen("short-return registry");
    }

    function test_featured_grid_survives_non_boolean_registry() public {
        queue.setMasterRegistry(address(new NonBooleanRegistry()));
        _assertFailOpen("non-boolean registry");
    }

    function test_featured_grid_survives_reverting_registry() public {
        queue.setMasterRegistry(address(new RevertingRegistry()));
        _assertFailOpen("reverting registry");
    }
}
