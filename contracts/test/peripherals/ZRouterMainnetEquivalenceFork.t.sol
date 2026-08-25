// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ForkTestBase } from "../fork/helpers/ForkTestBase.sol";
import { zRouter, mainnetChainConfig } from "../../src/peripherals/zRouter.sol";

/// @notice Equivalence check for the move from compile-time constants to deploy-time bindings.
///
///         `src/peripherals/zRouter.sol` is the vendored source of the router already live at
///         `CANONICAL`. On a mainnet fork both are reachable, so the same swap can be put through
///         each and the results compared directly: a router deployed with `mainnetChainConfig()`
///         must produce the same numbers as the live one for every leg mainnet actually carries.
///
///         Runs only against a mainnet fork — `loadAddresses()` skips the suite when the mainnet
///         addresses have no code, which is how the rest of this repo's fork tests stay green under
///         a plain `forge test`. To run it:
///
///           forge test --fork-url <mainnet-rpc> --match-path 'test/peripherals/*Fork.t.sol'
contract ZRouterMainnetEquivalenceForkTest is ForkTestBase {
    /// @dev The router this source was vendored from.
    address internal constant CANONICAL = 0x000000000000FB114709235f1ccBFfb925F600e4;

    /// @dev zAMM V1, the destination `swapVZ` routes to for a non-max deadline.
    address internal constant ZAMM_V1 = 0x000000000000040470635EB91b7CE4D132D616eD;

    zRouter internal canonical;
    zRouter internal rebuilt;

    address internal buyer = address(uint160(0xB0B));

    function setUp() public {
        loadAddresses();
        if (CANONICAL.code.length == 0) vm.skip(true);

        canonical = zRouter(payable(CANONICAL));
        rebuilt = new zRouter(mainnetChainConfig());

        vm.deal(buyer, 1000 ether);
    }

    // ── V3 ────────────────────────────────────────────────────────────────────────────────────

    function test_v3_exactInEth_matchesTheCanonicalRouter() public {
        uint256 snap = vm.snapshotState();

        vm.prank(buyer);
        (, uint256 outCanonical) =
            canonical.swapV3{ value: 1 ether }(buyer, false, 500, address(0), USDC, 1 ether, 0, _deadline());

        vm.revertToState(snap);

        vm.prank(buyer);
        (, uint256 outRebuilt) =
            rebuilt.swapV3{ value: 1 ether }(buyer, false, 500, address(0), USDC, 1 ether, 0, _deadline());

        assertGt(outCanonical, 0, "the equivalence must be over a swap that actually executed");
        assertEq(outRebuilt, outCanonical, "V3 leg must price identically");
    }

    /// @dev The V3 pool address is CREATE2-derived from the factory + init-code hash, both of which
    ///      are now bindings. Landing on the same pool is what the equal output above depends on.
    function test_v3_bindingsResolveToTheSamePool() public view {
        assertEq(rebuilt.V3_FACTORY(), UNISWAP_V3_FACTORY, "v3 factory binding");
        assertGt(rebuilt.V3_FACTORY().code.length, 0, "v3 factory must exist on this fork");
    }

    // ── V4 ────────────────────────────────────────────────────────────────────────────────────

    function test_v4_exactInEth_matchesTheCanonicalRouter() public {
        uint256 snap = vm.snapshotState();

        vm.prank(buyer);
        (, uint256 outCanonical) =
            canonical.swapV4{ value: 1 ether }(buyer, false, 500, 10, address(0), USDC, 1 ether, 0, _deadline());

        vm.revertToState(snap);

        vm.prank(buyer);
        (, uint256 outRebuilt) =
            rebuilt.swapV4{ value: 1 ether }(buyer, false, 500, 10, address(0), USDC, 1 ether, 0, _deadline());

        assertGt(outCanonical, 0, "the equivalence must be over a swap that actually executed");
        assertEq(outRebuilt, outCanonical, "V4 leg must price identically");
    }

    function test_v4_bindingMatchesTheLivePoolManager() public view {
        assertEq(rebuilt.V4_POOL_MANAGER(), UNISWAP_V4_POOL_MANAGER, "v4 pool manager binding");
    }

    // ── zAMM ──────────────────────────────────────────────────────────────────────────────────

    /// @dev zAMM pool depth is not something this test can assume, so the leg is compared at the
    ///      routing seam instead: the venue is stubbed to a fixed answer at zAMM V1's address only.
    ///      A router that routed anywhere else would not hit the stub, so equal answers here mean
    ///      both routers dispatched the same call to the same destination.
    function test_vz_routesToTheSameVenueAsTheCanonicalRouter() public {
        bytes memory answer = abi.encode(uint256(777));

        uint256 snap = vm.snapshotState();

        vm.mockCall(ZAMM_V1, bytes(""), answer); // empty prefix: every call to this address
        vm.prank(buyer);
        (, uint256 outCanonical) =
            canonical.swapVZ{ value: 1 ether }(buyer, false, 30, address(0), USDC, 0, 0, 1 ether, 0, _deadline());

        vm.revertToState(snap);

        vm.mockCall(ZAMM_V1, bytes(""), answer); // empty prefix: every call to this address
        vm.prank(buyer);
        (, uint256 outRebuilt) =
            rebuilt.swapVZ{ value: 1 ether }(buyer, false, 30, address(0), USDC, 0, 0, 1 ether, 0, _deadline());

        assertEq(outCanonical, 777, "the canonical router must reach the stubbed venue");
        assertEq(outRebuilt, outCanonical, "zAMM leg must route to the same venue");
        assertEq(rebuilt.ZAMM(), ZAMM_V1, "zamm binding");
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }
}
