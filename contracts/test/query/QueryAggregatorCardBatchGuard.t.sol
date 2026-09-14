// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { QueryAggregator, IERC1155EditionReader } from "../../src/query/QueryAggregator.sol";

/// @notice Answers 0 to `nextEditionId()` and nothing else — the shape the ERC1155 card leg is
///         designated to tolerate ("a non-ERC1155 instance yields a zero card there",
///         QueryAggregator.sol:572). Before noesis-320 the `nextId - 1` decrement ran in the parent
///         frame, so this answer underflowed to panic 0x11 outside the reach of the attached
///         `catch {}` and reverted the whole batch.
contract ZeroEditionCounter {
    function nextEditionId() external pure returns (uint256) {
        return 0;
    }
}

/// @notice Answers nothing at all: an address with code and no matching selector.
contract SilentInstance { }

/// @notice A healthy ERC1155-shaped instance carrying one open, unsold edition. Present so the guard
///         is shown to reject only the degenerate counter, never a real card.
contract HealthyEditionCounter {
    function nextEditionId() external pure returns (uint256) {
        return 2; // one edition, 1-indexed
    }

    function getEdition(uint256 id) external pure returns (IERC1155EditionReader.Edition memory) {
        return IERC1155EditionReader.Edition({
            id: id,
            pieceTitle: "",
            basePrice: 0.05 ether,
            supply: 10,
            minted: 0,
            metadataURI: "",
            pricingModel: IERC1155EditionReader.PricingModel.LIMITED_FIXED,
            priceIncreaseRate: 0,
            openTime: 0 // ungated: every timestamp clears it
        });
    }

    function getCurrentPrice(uint256) external pure returns (uint256) {
        return 0.05 ether;
    }
}

/// @notice noesis-320 — the ERC1155 card leg was the one card path doing its arithmetic in the
///         parent frame, so a zero edition counter took every sibling card in the batch with it.
///         `getProjectCardsBatch` takes a caller-supplied, unfiltered address array, and the two
///         comments at QueryAggregator.sol:572 and :578 promise this leg is revert-safe.
contract QueryAggregatorCardBatchGuardTest is Test {
    QueryAggregator internal agg;

    function setUp() public {
        agg = new QueryAggregator();
        agg.initialize(makeAddr("registry"), makeAddr("queue"), address(0), address(this));
    }

    /// CONTROL: an address answering nothing yields a zero card and the batch survives. This must
    /// keep passing — it is what proves the guard did not start swallowing real cards.
    function test_silentInstanceYieldsZeroCard() public {
        address[] memory a = new address[](1);
        a[0] = address(new SilentInstance());

        QueryAggregator.ProjectCard[] memory cards = agg.getProjectCardsBatch(a);

        assertEq(cards.length, 1, "batch returns one card");
        assertEq(cards[0].totalSupply, 0, "zero card: no supply");
        assertEq(cards[0].maxSupply, 0, "zero card: no cap");
        assertEq(cards[0].currentPrice, 0, "zero card: no price");
        assertFalse(cards[0].isActive, "zero card: not active");
    }

    /// THE FIX. Reverting the `if (nextId == 0) return;` guard in `_hydrateERC1155CardData` turns
    /// this test red with panic 0x11 — the decrement underflows in QueryAggregator's own frame,
    /// which the attached `catch {}` does not cover.
    function test_zeroEditionCounterYieldsZeroCardInsteadOfRevertingTheBatch() public {
        address[] memory a = new address[](1);
        a[0] = address(new ZeroEditionCounter());

        QueryAggregator.ProjectCard[] memory cards = agg.getProjectCardsBatch(a);

        assertEq(cards.length, 1, "batch returns one card");
        assertEq(cards[0].totalSupply, 0, "zero card: no supply");
        assertEq(cards[0].maxSupply, 0, "zero card: no cap");
        assertEq(cards[0].currentPrice, 0, "zero card: no price");
        assertFalse(cards[0].isActive, "zero card: not active");
    }

    /// BLAST RADIUS: one poisoned address must no longer take its healthy siblings down. The
    /// healthy card either side is asserted to still carry its real figures, so this test fails
    /// both ways — on a revert, and on a guard that quietly zeroed everything.
    function test_onePoisonedAddressLeavesHealthySiblingsIntact() public {
        address[] memory a = new address[](3);
        a[0] = address(new HealthyEditionCounter());
        a[1] = address(new ZeroEditionCounter());
        a[2] = address(new HealthyEditionCounter());

        QueryAggregator.ProjectCard[] memory cards = agg.getProjectCardsBatch(a);

        assertEq(cards.length, 3, "batch returns every card it was asked for");

        assertTrue(cards[0].isActive, "healthy sibling stays active");
        assertEq(cards[0].currentPrice, 0.05 ether, "healthy sibling keeps its floor price");
        assertEq(cards[0].maxSupply, 10, "healthy sibling keeps its cap");

        assertFalse(cards[1].isActive, "poisoned instance yields a zero card");
        assertEq(cards[1].currentPrice, 0, "poisoned instance carries no price");

        assertTrue(cards[2].isActive, "healthy sibling stays active");
        assertEq(cards[2].currentPrice, 0.05 ether, "healthy sibling keeps its floor price");
        assertEq(cards[2].maxSupply, 10, "healthy sibling keeps its cap");
    }
}
