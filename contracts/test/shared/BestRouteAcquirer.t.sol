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

/// @notice Quoter whose reply is hand-encoded, so a test can put ANY word in the `source` slot —
///         including members that exist upstream and not in our mirror — and can truncate the reply.
///         A normal Solidity mock cannot express this: its own enum type would reject the value first.
contract RawSourceQuoter {
    uint256 public source;
    uint256 public feeBps;
    uint256 public amountOut;
    uint256 public replyWords = 5; // full head: four `best` words + the offset to `quotes`

    function set(uint256 _source, uint256 _feeBps, uint256 _amountOut) external {
        source = _source;
        feeBps = _feeBps;
        amountOut = _amountOut;
    }

    function setReplyWords(uint256 n) external {
        replyWords = n;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        bytes memory full = abi.encode(source, feeBps, uint256(1 ether), amountOut, uint256(0xa0), uint256(0));
        uint256 n = replyWords * 32;
        if (n >= full.length) return full;
        bytes memory out = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = full[i];
        }
        return out;
    }
}

/// @notice The decode shape `BestRouteAcquirer` used to have: the reply read through a typed
///         FIVE-member enum inside a `try`/`catch` whose stated contract was "a quoter that reverts
///         or is not a contract degrades to the fallback". Kept as a CONTROL so the tests below are
///         not vacuous — it shows the same inputs that now degrade used to revert past the catch.
interface ILegacyFiveMemberQuoter {
    enum AMM {
        UNI_V2,
        SUSHI,
        ZAMM,
        UNI_V3,
        UNI_V4
    }

    struct Quote {
        AMM source;
        uint256 feeBps;
        uint256 amountIn;
        uint256 amountOut;
    }

    function getQuotes(bool exactOut, address tokenIn, address tokenOut, uint256 swapAmount)
        external
        view
        returns (Quote memory best, Quote[] memory quotes);
}

contract LegacyTypedDecodeControl {
    /// @return caught true if the `catch` clause actually ran. For a REPLY-decode failure it does
    ///         not: the callee returned fine and the decode runs in this frame, past the catch — so
    ///         this function reverts rather than returning either value.
    function readCaught(address q) external view returns (bool caught) {
        try ILegacyFiveMemberQuoter(q).getQuotes(false, address(0), address(1), 1 ether) returns (
            ILegacyFiveMemberQuoter.Quote memory, ILegacyFiveMemberQuoter.Quote[] memory
        ) {
            return false;
        } catch {
            return true;
        }
    }
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

    // ── Widened / malformed quoter replies: degrade, never revert ───────────────────────────────
    //
    // The mainnet `zQuoter.AMM` carries NINE members; this library mirrors them and maps the first
    // five. The four it does not map, a tenth member it has never seen, an address with no code, and
    // a truncated reply must all reach the fixed-pool fallback. Every one of these used to revert
    // the whole acquisition instead — `test_control_*` below is the proof that they did.

    /// The exact upstream drift the mirror was written against: a source our enum has a NAME for but
    /// no typed leg. Quoted, unmapped, degraded — not reverted.
    function test_fallback_whenSourceIsQuotedButUnmapped() public {
        RawSourceQuoter raw = new RawSourceQuoter();
        router.setV4Out(FIXED_FEE, 100e18);
        // 5..8 = CURVE, LIDO, WETH_WRAP, V4_HOOKED.
        for (uint256 src = 5; src <= 8; src++) {
            raw.set(src, 30, 200e18);
            uint256 got = _callV4(address(raw), 100e18);
            assertEq(router.lastFee(), FIXED_FEE, "unmapped source -> fixed fallback");
            assertEq(got, 100e18);
        }
    }

    /// A member that does not exist upstream TODAY. Widening the mirror to nine only moves the cliff;
    /// the range check is what removes it, so a tenth member degrades like any other.
    function test_fallback_whenSourceIsBeyondTheWidenedEnum() public {
        RawSourceQuoter raw = new RawSourceQuoter();
        router.setV4Out(FIXED_FEE, 100e18);
        raw.set(9, 30, 200e18);
        assertEq(_callV4(address(raw), 100e18), 100e18, "source 9 -> fixed fallback");
        assertEq(router.lastFee(), FIXED_FEE);
        raw.set(type(uint256).max, 30, 200e18);
        assertEq(_callV4(address(raw), 100e18), 100e18, "source 2^256-1 -> fixed fallback");
        assertEq(router.lastFee(), FIXED_FEE);
    }

    /// `setZQuoter` to an address that holds no code: the call succeeds with empty returndata. The
    /// library's own docstring always claimed this degraded; until the hand decode it did not.
    function test_fallback_whenQuoterHasNoCode() public {
        router.setV4Out(FIXED_FEE, 100e18);
        uint256 got = _callV4(address(0xDEAD), 100e18);
        assertEq(router.lastFee(), FIXED_FEE, "no-code quoter -> fixed fallback");
        assertEq(got, 100e18);
    }

    function test_fallback_whenReplyIsTruncated() public {
        RawSourceQuoter raw = new RawSourceQuoter();
        router.setV4Out(FIXED_FEE, 100e18);
        raw.set(uint256(uint8(MockZQuoter.AMM.UNI_V4)), 5, 200e18);
        raw.setReplyWords(4); // `best` complete but the `quotes` offset missing -> not a whole head
        assertEq(_callV4(address(raw), 100e18), 100e18, "short reply -> fixed fallback");
        assertEq(router.lastFee(), FIXED_FEE);
    }

    /// A fee word too wide for the casts the V4 leg makes. `uint24(feeBps * 100)` and
    /// `uint16(feeBps)` truncate DIFFERENTLY, so a swap would go to one pool with another pool's
    /// tick spacing. Refused, not routed.
    function test_fallback_whenFeeBpsWouldTruncate() public {
        RawSourceQuoter raw = new RawSourceQuoter();
        router.setV4Out(FIXED_FEE, 100e18);
        raw.set(uint256(uint8(MockZQuoter.AMM.UNI_V4)), uint256(type(uint16).max) + 1, 200e18);
        assertEq(_callV4(address(raw), 100e18), 100e18, "oversized feeBps -> fixed fallback");
        assertEq(router.lastFee(), FIXED_FEE);
    }

    /// A widened reply still ROUTES when the source is one we map — the guard degrades the unknown,
    /// it does not disable best-route selection.
    function test_widenedReply_stillDispatchesMappedSource() public {
        RawSourceQuoter raw = new RawSourceQuoter();
        router.setV4Out(100 * 100, 7e18); // 100 bps -> fee 10000, spacing 200
        raw.set(uint256(uint8(MockZQuoter.AMM.UNI_V4)), 100, 200e18);
        uint256 got = _callV4(address(raw), 1e18);
        assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.V4));
        assertEq(router.lastFee(), 100 * 100, "best route still taken");
        assertEq(router.lastTickSpace(), int24(200));
        assertEq(got, 7e18);
    }

    // ── Control: the decode shape this replaced, on the same inputs ──────────────────────────────

    /// NON-VACUITY. Reading the same replies through a typed five-member enum inside a `try`/`catch`
    /// reverts — the catch does NOT run, so the acquirer's "unmappable source -> fallback" branch was
    /// unreachable. This is the defect; the tests above are its absence.
    function test_control_legacyTypedDecodeRevertsPastTheCatch() public {
        LegacyTypedDecodeControl control = new LegacyTypedDecodeControl();
        RawSourceQuoter raw = new RawSourceQuoter();

        raw.set(5, 30, 200e18); // CURVE: in range for nine members, out of range for five
        vm.expectRevert();
        control.readCaught(address(raw));

        vm.expectRevert();
        control.readCaught(address(0xDEAD)); // no code: empty returndata, decode fails past the catch
    }

    /// The one case the old `try`/`catch` genuinely did handle, kept so the control is honest about
    /// what it proves: an EXPLICIT revert inside the quoter is a failed call, and that the catch does
    /// catch.
    function test_control_legacyTypedDecodeCatchesAnExplicitRevert() public {
        LegacyTypedDecodeControl control = new LegacyTypedDecodeControl();
        quoter.setShouldRevert(true);
        assertTrue(control.readCaught(address(quoter)), "explicit revert IS caught");
    }

    function test_fallback_whenQuoterReverts() public {
        router.setV4Out(FIXED_FEE, 100e18);
        quoter.setBest(MockZQuoter.AMM.UNI_V4, 5, ETH_IN, 200e18);
        quoter.setShouldRevert(true); // getQuotes reverts -> fixed fallback
        uint256 got = _callV4(address(quoter), 100e18);
        assertEq(router.lastFee(), FIXED_FEE, "reverting quoter -> fixed fallback");
        assertEq(got, 100e18);
    }

    /// The mainnet quoter's `AMM` enum carries nine sources; the acquirer maps five. A best route on
    /// one of the four it cannot map — CURVE, LIDO, WETH_WRAP, V4_HOOKED — must degrade to the vault's
    /// fixed pool, which is the same answer an unset quoter gets. The route is not merely unexecuted:
    /// the acquirer must still be able to READ a source it has no leg for, because the quote arrives
    /// as return data the vault decodes, and a decode that rejects the value reverts the whole convert
    /// in the vault's own frame, where the `try`/`catch` around `getQuotes` cannot reach it.
    function test_fallback_whenSourceIsOffTheMappableFive() public {
        MockZQuoter.AMM[4] memory unmappable =
            [MockZQuoter.AMM.CURVE, MockZQuoter.AMM.LIDO, MockZQuoter.AMM.WETH_WRAP, MockZQuoter.AMM.V4_HOOKED];

        for (uint256 i = 0; i < unmappable.length; i++) {
            router.setV4Out(FIXED_FEE, 100e18);
            quoter.setBest(unmappable[i], 5, ETH_IN, 200e18); // a REAL route, on a venue we cannot call
            uint256 got = _callV4(address(quoter), 100e18);
            assertEq(uint256(router.lastLeg()), uint256(RecordingRouter.Leg.V4), "fixed fallback leg");
            assertEq(router.lastFee(), FIXED_FEE, "unmappable source -> fixed fallback pool");
            assertEq(got, 100e18, "the fallback's output, not the unreachable quote's");
        }
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
