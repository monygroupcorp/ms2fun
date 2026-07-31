// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { TestableUniAlignmentVault } from "../helpers/TestableUniAlignmentVault.sol";
import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { LibClone } from "solady/utils/LibClone.sol";

/// @notice zRouter stand-in for the FIXED-POOL fallback leg only. Mirrors MockZRouter.swapV4's
///         ETH->token behavior (mint tokenOut at outRatio, enforce amountLimit == minOut) and ALSO
///         records the deadline / fee / tickSpacing the vault passed. This is the observable that
///         distinguishes the two acquisition paths inside BestRouteAcquirer.acquireViaV4:
///           - fixed-pool fallback leg: deadline == type(uint256).max, fee/tick == the vault's
///             configured zRouterFee / zRouterTickSpacing (see UniAlignmentVault._acquire).
///           - best-route leg (only reachable when zQuoter != 0): deadline == block.timestamp.
///         So `lastDeadline == type(uint256).max` proves best-route was NOT engaged.
contract RecordingFallbackRouter {
    uint256 public outRatio = 1e18;

    uint256 public lastDeadline;
    uint24 public lastFee;
    int24 public lastTickSpace;
    bool public swapV4Called;

    receive() external payable { }

    function setOutRatio(uint256 ratio) external {
        outRatio = ratio;
    }

    function swapV4(
        address to,
        bool, /*exactOut*/
        uint24 swapFee,
        int24 tickSpace,
        address tokenIn,
        address tokenOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut) {
        amountIn = swapAmount;
        amountOut = swapAmount * outRatio / 1e18;
        require(amountOut >= amountLimit, "RecordingFallbackRouter: insufficient output");

        swapV4Called = true;
        lastFee = swapFee;
        lastTickSpace = tickSpace;
        lastDeadline = deadline;

        require(tokenIn == address(0), "RecordingFallbackRouter: expected ETH in");
        require(tokenOut != address(0), "RecordingFallbackRouter: expected token out");
        IERC20(tokenOut).transfer(to, amountOut);
    }
}

/// @title BestRouteFallbackPin
/// @notice noesis-106 (b) — regression pin for swap-path finding 1, VAULT level: a vault configured
///         with `zQuoter == address(0)` must still acquire its alignment token via the fixed-pool
///         fallback and complete a convert (no revert, best-route NOT engaged). This is the half of
///         the best-route enablement pin that RUNS in the standard gate (the off-family real-route
///         half is the RPC-gated fork test in test/fork/BestRouteOffFamilyFork.t.sol).
///
///         Pins that the #65/#093 enablement — threading `cfg.zQuoter` to every factory + the
///         deploy-time warn @ zQuoter==0 — can never silently regress the fallback: an unset quoter
///         is a first-class, still-functional configuration, not a broken one.
contract BestRouteFallbackPinTest is Test {
    TestableUniAlignmentVault internal vault;
    TestableUniAlignmentVault internal vaultImpl;
    MockEXECToken internal alignmentToken;
    RecordingFallbackRouter internal router;
    MockVaultPriceValidator internal validator;
    MockAlignmentRegistry internal registry;

    address internal owner = address(0xA11CE);
    address internal alice = address(0xB0B);
    address internal dave = address(0xDA7E);

    address internal mockWETH = address(0x1111111111111111111111111111111111111111);
    address internal mockPoolManager = address(0x2222222222222222222222222222222222222222);

    uint24 internal constant FIXED_FEE = 3000;
    int24 internal constant FIXED_TICK = 60;
    uint256 internal constant TARGET_ID = 1;

    function setUp() public {
        vm.startPrank(owner);

        alignmentToken = new MockEXECToken(1_000_000e18);
        router = new RecordingFallbackRouter();
        validator = new MockVaultPriceValidator();
        registry = new MockAlignmentRegistry();
        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, address(alignmentToken), true);
        // Canonical-reference wiring (noesis-037): the oracle floor reads the DAO-pinned ReferencePool.
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: address(0xBEEF), kind: 0, twapWindow: 1800 })
        );
        validator.setEthPer1e18Tokens(1e18); // 1:1 → an honest 1:1 fallback swap clears the 95% floor

        // Fund the fallback router so it can deliver tokenOut for the ETH->token acquire.
        alignmentToken.transfer(address(router), 100_000e18);

        vaultImpl = new TestableUniAlignmentVault();
        vault = TestableUniAlignmentVault(payable(LibClone.clone(address(vaultImpl))));
        vault.initialize(
            owner,
            mockWETH,
            mockPoolManager,
            address(alignmentToken),
            address(router),
            FIXED_FEE,
            FIXED_TICK,
            IVaultPriceValidator(address(validator)),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );
        // NOTE: setZQuoter is deliberately NEVER called → vault.zQuoter() stays address(0) (fallback-only).

        vault.setV4PoolKey(
            PoolKey({
                currency0: Currency.wrap(address(0)), // native ETH
                currency1: Currency.wrap(address(alignmentToken)),
                fee: FIXED_FEE,
                tickSpacing: FIXED_TICK,
                hooks: IHooks(address(0))
            })
        );

        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(dave, 100 ether);
    }

    /// The pin: with `zQuoter == address(0)` the vault converts SUCCESSFULLY via the fixed-pool
    /// fallback — shares + LP booked — and best-route was NOT engaged (fixed-leg deadline sentinel).
    function test_zQuoterUnset_convertsViaFixedPoolFallback() public {
        assertEq(vault.zQuoter(), address(0), "precondition: quoter unset -> fallback-only config");

        vm.prank(alice);
        (bool ok,) = address(vault).call{ value: 10 ether }("");
        assertTrue(ok, "contribution accepted");

        vm.prank(dave);
        uint256 lpValue = vault.convertAndAddLiquidity(1);

        // Convert completed via the fallback — no revert, real acquisition happened.
        assertGt(lpValue, 0, "convert succeeds via fixed-pool fallback");
        assertGt(vault.benefactorShares(alice), 0, "contributor earns shares from the fallback acquire");
        assertEq(vault.totalPendingETH(), 0, "pending ETH consumed by the convert");

        // best-route NOT engaged: the acquire used the fixed fallback leg.
        assertTrue(router.swapV4Called(), "acquire dispatched to the fixed swapV4 leg");
        assertEq(router.lastDeadline(), type(uint256).max, "fixed fallback deadline sentinel - best-route NOT engaged");
        assertEq(router.lastFee(), FIXED_FEE, "fixed fallback used the vault's configured fee");
        assertEq(router.lastTickSpace(), FIXED_TICK, "fixed fallback used the vault's configured tick spacing");
    }

    /// The fallback still enforces the vault's oracle-derived minOut floor: a degraded (sandwiched)
    /// swap rate cannot slip through just because best-route is off. The router (== the real router's
    /// `amountLimit` behavior) reverts on `received < minOut`.
    function test_zQuoterUnset_fallbackStillEnforcesMinOutFloor() public {
        validator.setEthPer1e18Tokens(1e18); // fair 1:1 floor
        router.setOutRatio(5e17); // fallback pays only half → below the 95% floor

        vm.prank(alice);
        (bool ok,) = address(vault).call{ value: 10 ether }("");
        assertTrue(ok);

        vm.prank(dave);
        vm.expectRevert(bytes("RecordingFallbackRouter: insufficient output"));
        vault.convertAndAddLiquidity(1);
    }
}
