// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { BestRouteAcquirer } from "../../src/shared/libraries/BestRouteAcquirer.sol";
import { MockZQuoter } from "../mocks/MockZQuoter.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

/// @notice zRouter stand-in that records which TYPED leg the acquirer dispatched to and mints the
///         configured output. Enforces `amountOut >= amountLimit` (like the real router) so a minOut
///         breach reverts here. Has NO snwap/snwapMulti — the acquirer must never reach for one.
contract RecordingRouter {
    enum Leg {
        NONE,
        V2,
        V3,
        V4,
        VZ
    }

    MockERC20 public immutable tokenOut;

    Leg public lastLeg;
    uint256 public lastFee; // v3/v4 swapFee or ZAMM feeOrHook
    int24 public lastTickSpace;
    uint256 public lastDeadline;
    address public lastTo;

    // Configured outputs, keyed so a "deeper" pool can out-quote the hardcoded fallback fee.
    mapping(uint256 => uint256) public v4OutByFee;
    mapping(uint256 => uint256) public v3OutByFee;
    mapping(uint256 => uint256) public vzOutByFee;
    uint256 public v2Out;

    constructor(MockERC20 _tokenOut) {
        tokenOut = _tokenOut;
    }

    function setV4Out(uint24 fee, uint256 out) external {
        v4OutByFee[fee] = out;
    }

    function setV3Out(uint24 fee, uint256 out) external {
        v3OutByFee[fee] = out;
    }

    function setVZOut(uint256 feeOrHook, uint256 out) external {
        vzOutByFee[feeOrHook] = out;
    }

    function setV2Out(uint256 out) external {
        v2Out = out;
    }

    function _deliver(
        Leg leg,
        uint256 fee,
        int24 tickSpace,
        address to,
        uint256 amountOut,
        uint256 amountLimit,
        uint256 deadline
    ) internal returns (uint256) {
        require(amountOut >= amountLimit, "RecordingRouter: insufficient output");
        lastLeg = leg;
        lastFee = fee;
        lastTickSpace = tickSpace;
        lastTo = to;
        lastDeadline = deadline;
        tokenOut.mint(to, amountOut);
        return amountOut;
    }

    function swapV4(
        address to,
        bool,
        uint24 swapFee,
        int24 tickSpace,
        address,
        address,
        uint256,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut) {
        amountOut = _deliver(Leg.V4, swapFee, tickSpace, to, v4OutByFee[swapFee], amountLimit, deadline);
        amountIn = msg.value;
    }

    function swapV3(address to, bool, uint24 swapFee, address, address, uint256, uint256 amountLimit, uint256 deadline)
        external
        payable
        returns (uint256 amountIn, uint256 amountOut)
    {
        amountOut = _deliver(Leg.V3, swapFee, int24(0), to, v3OutByFee[swapFee], amountLimit, deadline);
        amountIn = msg.value;
    }

    function swapV2(address to, bool, address, address, uint256, uint256 amountLimit, uint256 deadline)
        external
        payable
        returns (uint256 amountIn, uint256 amountOut)
    {
        amountOut = _deliver(Leg.V2, 0, int24(0), to, v2Out, amountLimit, deadline);
        amountIn = msg.value;
    }

    function swapVZ(
        address to,
        bool,
        uint256 feeOrHook,
        address,
        address,
        uint256,
        uint256,
        uint256,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut) {
        amountOut = _deliver(Leg.VZ, feeOrHook, int24(0), to, vzOutByFee[feeOrHook], amountLimit, deadline);
        amountIn = msg.value;
    }

    receive() external payable { }
}

/// @notice Thin caller so the internal library runs in a real contract context (address(this) = the
///         "vault"): tokens land here and ETH is forwarded from here, mirroring the vault call site.
contract AcquirerHarness {
    function acquireV4(
        address zRouter,
        address zQuoter,
        address tokenOut,
        uint256 ethAmount,
        uint256 minOut,
        uint24 fallbackFee,
        int24 fallbackTickSpacing,
        uint256 fallbackDeadline
    ) external payable returns (uint256) {
        return BestRouteAcquirer.acquireViaV4(
            zRouter, zQuoter, tokenOut, ethAmount, minOut, fallbackFee, fallbackTickSpacing, fallbackDeadline
        );
    }

    function acquireVZ(
        address zRouter,
        address zQuoter,
        address tokenOut,
        uint256 ethAmount,
        uint256 minOut,
        uint256 fallbackFeeOrHook,
        uint256 fallbackDeadline
    ) external payable returns (uint256) {
        return BestRouteAcquirer.acquireViaVZ(
            zRouter, zQuoter, tokenOut, ethAmount, minOut, fallbackFeeOrHook, fallbackDeadline
        );
    }

    receive() external payable { }
}

contract BestRouteAcquirerTest is Test {
    RecordingRouter internal router;
    MockZQuoter internal quoter;
    MockERC20 internal token;
    AcquirerHarness internal harness;

    uint256 internal constant ETH_IN = 1 ether;
    // Uni fixed-pool fallback params (mirror the vault's zRouterFee / zRouterTickSpacing 3000/60).
    uint24 internal constant FIXED_FEE = 3000;
    int24 internal constant FIXED_TICK = 60;
    // ZAMM fixed-pool fallback feeOrHook.
    uint256 internal constant FIXED_FEEORHOOK = 100;

    function setUp() public {
        token = new MockERC20("Align", "ALGN");
        router = new RecordingRouter(token);
        quoter = new MockZQuoter();
        harness = new AcquirerHarness();
        vm.deal(address(this), 100 ether);
    }

    function _callV4(address zQuoter, uint256 minOut) internal returns (uint256) {
        return harness.acquireV4{ value: ETH_IN }(
            address(router), zQuoter, address(token), ETH_IN, minOut, FIXED_FEE, FIXED_TICK, type(uint256).max
        );
    }

    // ── Typed dispatch: each reachable source maps to its own leg ──────────────────────────────

    function test_dispatch_uniV4() public {
        // feeBps 5 -> fee 500 / spacing 10
        router.setV4Out(500, 3e18);
        quoter.setBest(MockZQuoter.AMM.UNI_V4, 5, ETH_IN, 3e18);
        uint256 got = _callV4(address(quoter), 1e18);
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.V4), "V4 leg");
        assertEq(router.lastFee(), 500, "fee 500");
        assertEq(router.lastTickSpace(), int24(10), "spacing 10");
        assertEq(got, 3e18, "returns router output");
        assertEq(token.balanceOf(address(harness)), 3e18, "tokens to caller");
    }

    function test_dispatch_zamm() public {
        router.setVZOut(30, 4e18);
        quoter.setBest(MockZQuoter.AMM.ZAMM, 30, ETH_IN, 4e18);
        uint256 got = _callV4(address(quoter), 1e18);
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.VZ), "VZ leg");
        assertEq(router.lastFee(), 30, "feeOrHook 30");
        assertTrue(router.lastDeadline() != type(uint256).max, "hooked ZAMM (deadline != max)");
        assertEq(got, 4e18, "returns router output");
    }

    function test_dispatch_uniV3() public {
        router.setV3Out(3000, 5e18); // feeBps 30 -> v3 fee 3000
        quoter.setBest(MockZQuoter.AMM.UNI_V3, 30, ETH_IN, 5e18);
        uint256 got = _callV4(address(quoter), 1e18);
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.V3), "V3 leg");
        assertEq(router.lastFee(), 3000, "v3 fee 3000");
        assertEq(got, 5e18);
    }

    function test_dispatch_uniV2_normalDeadline() public {
        router.setV2Out(2e18);
        quoter.setBest(MockZQuoter.AMM.UNI_V2, 30, ETH_IN, 2e18);
        _callV4(address(quoter), 1e18);
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.V2), "V2 leg");
        assertTrue(router.lastDeadline() != type(uint256).max, "uni v2 uses a normal deadline");
    }

    function test_dispatch_sushi_maxDeadlineSentinel() public {
        router.setV2Out(2e18);
        quoter.setBest(MockZQuoter.AMM.SUSHI, 30, ETH_IN, 2e18);
        _callV4(address(quoter), 1e18);
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.V2), "V2 leg");
        assertEq(router.lastDeadline(), type(uint256).max, "sushi uses the max-deadline sentinel");
    }

    // ── Selection: best route picks the deeper pool, not the hardcoded fixed one ────────────────

    function test_selection_picksDeeperPoolNotHardcoded() public {
        // Deeper pool is fee 500 (200e18); the vault's hardcoded fixed fee is 3000 (100e18).
        router.setV4Out(500, 200e18);
        router.setV4Out(FIXED_FEE, 100e18);
        quoter.setBest(MockZQuoter.AMM.UNI_V4, 5, ETH_IN, 200e18);

        uint256 got = _callV4(address(quoter), 100e18);
        assertEq(router.lastFee(), 500, "chose the deeper (fee 500) pool, not the hardcoded 3000");
        assertEq(got, 200e18, "received the deeper pool's larger output");
    }

    // ── Fallback: engages when the quoter is unavailable, and only then ─────────────────────────

    function test_fallback_whenQuoterUnset() public {
        router.setV4Out(FIXED_FEE, 100e18);
        uint256 got = _callV4(address(0), 100e18); // zQuoter unset
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.V4));
        assertEq(router.lastFee(), FIXED_FEE, "fixed fallback fee");
        assertEq(router.lastTickSpace(), FIXED_TICK, "fixed fallback spacing");
        assertEq(router.lastDeadline(), type(uint256).max, "Uni fallback preserves max deadline");
        assertEq(got, 100e18);
    }

    function test_fallback_whenQuoterEmpty() public {
        router.setV4Out(FIXED_FEE, 100e18);
        quoter.setBest(MockZQuoter.AMM.UNI_V4, 5, 0, 0); // amountOut == 0 -> no viable route
        uint256 got = _callV4(address(quoter), 100e18);
        assertEq(router.lastFee(), FIXED_FEE, "empty quote -> fixed fallback");
        assertEq(got, 100e18);
    }

    function test_fallback_whenQuoterReverts() public {
        router.setV4Out(FIXED_FEE, 100e18);
        quoter.setBest(MockZQuoter.AMM.UNI_V4, 5, ETH_IN, 200e18);
        quoter.setShouldRevert(true); // getQuotes reverts -> fixed fallback
        uint256 got = _callV4(address(quoter), 100e18);
        assertEq(router.lastFee(), FIXED_FEE, "reverting quoter -> fixed fallback");
        assertEq(got, 100e18);
    }

    // ── minOut floor: enforced by the router; a breach on the best route reverts (not swallowed) ─

    function test_minOut_enforcedOnBestRoute() public {
        router.setV4Out(500, 150e18);
        router.setV4Out(FIXED_FEE, 999e18); // fixed pool COULD satisfy, but must NOT be silently used
        quoter.setBest(MockZQuoter.AMM.UNI_V4, 5, ETH_IN, 150e18);

        // minOut above the chosen best route's output must revert, not fall back to the fixed pool.
        vm.expectRevert(bytes("RecordingRouter: insufficient output"));
        _callV4(address(quoter), 200e18);
    }

    function test_minOut_enforcedOnFallback() public {
        router.setV4Out(FIXED_FEE, 100e18);
        vm.expectRevert(bytes("RecordingRouter: insufficient output"));
        _callV4(address(0), 150e18); // fixed fallback, minOut too high
    }

    // ── ZAMM-family entry point (acquireViaVZ) ─────────────────────────────────────────────────

    function test_vz_bestRoute() public {
        router.setVZOut(5, 7e18);
        quoter.setBest(MockZQuoter.AMM.ZAMM, 5, ETH_IN, 7e18);
        uint256 got = harness.acquireVZ{ value: ETH_IN }(
            address(router),
            address(quoter),
            address(token),
            ETH_IN,
            1e18,
            FIXED_FEEORHOOK,
            block.timestamp + 15 minutes
        );
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.VZ));
        assertEq(router.lastFee(), 5, "best-route ZAMM fee tier");
        assertEq(got, 7e18);
    }

    function test_vz_fallbackWhenUnset() public {
        router.setVZOut(FIXED_FEEORHOOK, 6e18);
        uint256 got = harness.acquireVZ{ value: ETH_IN }(
            address(router), address(0), address(token), ETH_IN, 1e18, FIXED_FEEORHOOK, block.timestamp + 15 minutes
        );
        assertEq(router.lastFee(), FIXED_FEEORHOOK, "fixed ZAMM feeOrHook fallback");
        assertEq(got, 6e18);
    }
}
