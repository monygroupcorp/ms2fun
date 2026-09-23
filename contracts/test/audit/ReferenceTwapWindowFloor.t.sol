// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { MockUniV3RefFactory } from "../master/AlignmentRegistryReferencePool.t.sol";
import { WindowHonouringRefPool } from "../unit/ReferenceWindowCoupling.t.sol";

/**
 * @title ReferenceTwapWindowFloor
 * @notice Audit L-6..L-9 pass, finding L-8: `setReferencePool` validated the target, the token, the pool
 *         code, the kind and that the oracle answers — everything about WHICH pool is read — and never the
 *         magnitude of the window it is read over. `twapWindow = 1` pinned cleanly, and the vaults' only
 *         real price floor then averaged over at most one block, which is a spot read.
 *
 *         `test_aSingleSecondWindowPinsCleanly` is the finding: it is written to FAIL against the fixed
 *         contract and is the reason `MIN_TWAP_WINDOW` exists. The rest of the file pins the floor's
 *         edges, so a later change to the constant cannot quietly narrow what the owner may pin.
 *
 *         The mock honours `secondsAgos` (it reverts above its own depth), so a short window here is
 *         accepted for exactly the reason a short window on a real pool is: the pool CAN serve it. The
 *         probe was never the thing that was missing.
 */
contract ReferenceTwapWindowFloorTest is Test {
    AlignmentRegistryV1 internal registry;
    MockUniV3RefFactory internal uniFactory;

    address internal dao = makeAddr("dao");
    address internal weth = address(uint160(0x1111));
    address internal token = address(uint160(0xF000));

    uint256 internal targetId;

    /// @dev `AlignmentRegistryV1.MIN_TWAP_WINDOW`, which is `internal` and cannot be read from a test —
    ///      transcribed for the same reason `ReferenceWindowCoupling` transcribes `DEFAULT_TWAP_WINDOW`.
    uint32 internal constant MIN_TWAP_WINDOW = 300;

    /// @dev The shortest window pinned anywhere else in this tree (`ReferenceWindowCoupling`). The floor
    ///      is only a floor under a mistake if it leaves the choices already being made alone.
    uint32 internal constant SHORTEST_WINDOW_IN_TREE = 600;

    /// @dev A tick with no meaning beyond being non-zero, so the probe reads a real cumulative delta.
    int24 internal constant MEAN_TICK = 69080;

    function setUp() public {
        uniFactory = new MockUniV3RefFactory();
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(weth, address(uniFactory));
        registry = AlignmentRegistryV1(LibClone.deployERC1967(address(impl)));
        registry.initialize(dao);

        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: token, symbol: "T", info: "", metadataURI: "" });
        vm.prank(dao);
        targetId = registry.registerAlignmentTarget("align", "d", "", assets);
    }

    /// @dev A canonical pool deep enough to serve any window this file asks for, so depth is never what
    ///      a rejection here is about.
    function _deepCanonicalPool() internal returns (WindowHonouringRefPool pool) {
        pool = new WindowHonouringRefPool(weth, token, 7200, MEAN_TICK);
        uniFactory.register(pool.token0(), pool.token1(), pool.fee(), address(pool));
    }

    function _pin(address pool, uint32 window) internal {
        vm.prank(dao);
        registry.setReferencePool(
            targetId, token, IAlignmentRegistry.ReferencePool({ pool: pool, kind: 0, twapWindow: window })
        );
    }

    /// THE FINDING. A one-second window is a one-block average, which is the spot price the pin exists to
    /// avoid quoting — and every other tooth the setter has bites on the pool's identity, not on this.
    /// Red before `MIN_TWAP_WINDOW`: the pin returned without reverting.
    function test_aSingleSecondWindowPinsCleanly() public {
        WindowHonouringRefPool pool = _deepCanonicalPool();

        vm.expectRevert(
            abi.encodeWithSelector(AlignmentRegistryV1.ReferenceTwapWindowTooShort.selector, uint32(1), MIN_TWAP_WINDOW)
        );
        _pin(address(pool), 1);

        IAlignmentRegistry.ReferencePool memory stored = registry.getReferencePool(targetId, token);
        assertEq(stored.pool, address(0), "nothing was pinned");
    }

    /// One second below the floor is still below the floor — the boundary is where the constant says.
    function test_oneSecondUnderTheFloorIsRefused() public {
        WindowHonouringRefPool pool = _deepCanonicalPool();

        vm.expectRevert(
            abi.encodeWithSelector(
                AlignmentRegistryV1.ReferenceTwapWindowTooShort.selector, MIN_TWAP_WINDOW - 1, MIN_TWAP_WINDOW
            )
        );
        _pin(address(pool), MIN_TWAP_WINDOW - 1);
    }

    /// The floor itself is admissible: it is a minimum, not a value to clear.
    function test_theFloorItselfPins() public {
        WindowHonouringRefPool pool = _deepCanonicalPool();

        _pin(address(pool), MIN_TWAP_WINDOW);

        IAlignmentRegistry.ReferencePool memory stored = registry.getReferencePool(targetId, token);
        assertEq(stored.pool, address(pool), "pool pinned");
        assertEq(uint256(stored.twapWindow), uint256(MIN_TWAP_WINDOW), "the window it was proved over");
    }

    /// The shortest window this tree already pins is untouched by the floor.
    function test_theShortestWindowInTheTreeStillPins() public {
        WindowHonouringRefPool pool = _deepCanonicalPool();

        _pin(address(pool), SHORTEST_WINDOW_IN_TREE);

        assertEq(
            uint256(registry.getReferencePool(targetId, token).twapWindow),
            uint256(SHORTEST_WINDOW_IN_TREE),
            "600s pins as before"
        );
    }

    /// The `0` shorthand is measured against the floor AFTER it resolves, so it is checked on the same
    /// number that is probed and stored — and `DEFAULT_TWAP_WINDOW` clears the floor, so the shorthand is
    /// never what the guard rejects.
    function test_theShorthandIsMeasuredOnTheResolvedWindow() public {
        WindowHonouringRefPool pool = _deepCanonicalPool();

        _pin(address(pool), 0);

        assertEq(uint256(registry.getReferencePool(targetId, token).twapWindow), 1800, "resolved, probed, stored");
    }
}
