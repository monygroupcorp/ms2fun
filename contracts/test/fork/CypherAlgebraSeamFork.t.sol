// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ForkTestBase } from "./helpers/ForkTestBase.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ALGEBRA_DEFAULT_DEPLOYER,
    IAlgebraFactory,
    IAlgebraNFTPositionManager,
    IAlgebraPool,
    IAlgebraSwapRouter,
    IVolatilityOracle
} from "../../src/interfaces/algebra/IAlgebra.sol";
import { BestRouteAcquirer } from "../../src/shared/libraries/BestRouteAcquirer.sol";

/**
 * @title CypherAlgebraSeamFork
 * @notice Pins `src/interfaces/algebra/IAlgebra.sol` to the Cypher (Algebra Integral) contracts the
 *         Cypher vault family actually calls, at the selector level and at the execution level.
 *
 *         WHY THIS EXISTS. An interface and its test double can agree with each other and both disagree
 *         with the counterparty: a params tuple shaped one way compiles, mocks fine, and hashes to a
 *         selector the deployed contract does not expose, so the call reaches the counterparty's fallback
 *         and reverts. Mock-based coverage cannot see that — only the deployed bytecode can. Two tests
 *         cover it here:
 *
 *           1. `test_selectorAudit_*` walks EVERY function this repo declares against the Cypher factory,
 *              NonfungiblePositionManager, swap router, a live pool and its volatility-oracle plugin, and
 *              asserts each selector appears in the deployed bytecode. It also asserts the Algebra V2
 *              seven-field `exactInputSingle` selector is NOT present, so reverting the tuple to that shape
 *              turns this test red instead of shipping.
 *           2. `test_acquireViaAlgebra_*` and `test_harvestConvertLeg_*` execute the vault's two swap-router
 *              call sites — the acquire fallback (native ETH in, through the unmodified
 *              `BestRouteAcquirer` library) and the harvest convert leg (ERC20 in) — against the REAL
 *              router on a live pool. These reach the router's real dispatch, so a wrong selector reverts.
 *
 *         Fork-gated: `ForkTestBase.loadAddresses()` calls `vm.skip(true)` when WETH has no code (no
 *         `--fork-url`), so this file is inert in the default `forge test` run.
 *         Run: forge test --mp test/fork/CypherAlgebraSeamFork.t.sol --fork-url $MAINNET_RPC_URL -vv
 */
contract CypherAlgebraSeamForkTest is ForkTestBase {
    using SafeERC20 for IERC20;

    // ── Canonical Cypher/Algebra addresses (mirror DeployMainnet). ──
    address constant CYPHER_ALGEBRA_FACTORY = 0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0;
    address constant CYPHER_NFPM = 0x0a984a446A116335ac90425d2D1E69A7199A2f7c;
    address constant CYPHER_SWAP_ROUTER = 0x20C5893f69F635f55b0367C519F3f95e59c0b0Ab;

    /// @dev The Algebra V2 seven-field tuple: `ExactInputSingleParams` with `deployer` omitted. Declaring
    ///      it here (rather than hardcoding a literal) keeps the negative half of the audit honest — the
    ///      selector is derived from a shape, so it stays correct if field types ever change.
    function _v2ExactInputSingleSelector() internal pure returns (bytes4) {
        return bytes4(keccak256("exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))"));
    }

    AlgebraAcquirerHarness internal harness;

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork
        harness = new AlgebraAcquirerHarness();
    }

    // ── 1. Selector audit against deployed bytecode ─────────────────────────────────────────────

    function test_selectorAudit_factoryAndPositionManager() public view {
        bytes memory factoryCode = CYPHER_ALGEBRA_FACTORY.code;
        _assertSelector(factoryCode, IAlgebraFactory.createPool.selector, "factory.createPool");
        _assertSelector(factoryCode, IAlgebraFactory.poolByPair.selector, "factory.poolByPair");

        bytes memory nfpmCode = CYPHER_NFPM.code;
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.mint.selector, "nfpm.mint");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.increaseLiquidity.selector, "nfpm.increaseLiquidity");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.collect.selector, "nfpm.collect");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.decreaseLiquidity.selector, "nfpm.decreaseLiquidity");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.positions.selector, "nfpm.positions");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.approve.selector, "nfpm.approve");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.ownerOf.selector, "nfpm.ownerOf");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.transferFrom.selector, "nfpm.transferFrom");
        _assertSelector(nfpmCode, IAlgebraNFTPositionManager.safeTransferFrom.selector, "nfpm.safeTransferFrom");
    }

    function test_selectorAudit_poolAndOraclePlugin() public view {
        address pool = _livePool();
        bytes memory poolCode = pool.code;
        _assertSelector(poolCode, IAlgebraPool.initialize.selector, "pool.initialize");
        _assertSelector(poolCode, IAlgebraPool.globalState.selector, "pool.globalState");
        _assertSelector(poolCode, IAlgebraPool.plugin.selector, "pool.plugin");

        // The six-field `globalState` decode is a return shape, which a selector cannot pin — so decode it.
        (uint160 price,,,,, bool unlocked) = IAlgebraPool(pool).globalState();
        assertGt(price, 0, "globalState decodes a live price");
        assertTrue(unlocked, "globalState decodes the unlocked flag in the declared slot");

        address plugin = IAlgebraPool(pool).plugin();
        assertTrue(plugin != address(0), "live pool carries a volatility-oracle plugin");
        _assertSelector(plugin.code, IVolatilityOracle.getTimepoints.selector, "plugin.getTimepoints");

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = 1800;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives, uint88[] memory volatilityCumulatives) =
            IVolatilityOracle(plugin).getTimepoints(secondsAgos);
        assertEq(tickCumulatives.length, 2, "getTimepoints returns one tick cumulative per lookback");
        assertEq(volatilityCumulatives.length, 2, "getTimepoints returns one volatility cumulative per lookback");
    }

    /// @notice The declared `positions` return tuple must decode against the deployed NFPM.
    /// @dev Twelve values including the Algebra-specific `deployer`. A return-shape mismatch is invisible
    ///      to a selector check, so this decodes the position the vault-shaped call would read.
    function test_selectorAudit_positionsReturnShapeDecodes() public view {
        (,, address token0, address token1,,,, uint128 liquidity,,,,) =
            IAlgebraNFTPositionManager(CYPHER_NFPM).positions(_liveTokenId());
        assertTrue(token0 != address(0) && token1 != address(0), "positions decodes both pool tokens");
        assertGt(liquidity, 0, "positions decodes a live liquidity value in the declared slot");
    }

    /// @notice The router exposes the Integral eight-field shape and NOT the Algebra V2 seven-field shape.
    /// @dev This is the vacuity pin: drop `deployer` from `ExactInputSingleParams` and the first assert
    ///      fails, because the selector the interface then produces is the one asserted absent below it.
    function test_selectorAudit_swapRouterIsIntegralShape() public view {
        bytes memory routerCode = CYPHER_SWAP_ROUTER.code;
        _assertSelector(routerCode, IAlgebraSwapRouter.exactInputSingle.selector, "router.exactInputSingle");
        assertFalse(
            _hasSelector(routerCode, _v2ExactInputSingleSelector()),
            "deployed router does not expose the seven-field Algebra V2 exactInputSingle"
        );
        assertTrue(
            IAlgebraSwapRouter.exactInputSingle.selector != _v2ExactInputSingleSelector(),
            "declared params tuple is the Integral eight-field shape"
        );
    }

    // ── 2. Execution against the real router ────────────────────────────────────────────────────

    /// @notice The vault's acquire fallback buys the alignment token on the REAL Cypher router.
    /// @dev Runs the unmodified `BestRouteAcquirer.acquireViaAlgebra` with the quoter unset, so the
    ///      best-route leg is skipped and the fixed Algebra leg executes: native ETH forwarded as
    ///      `msg.value` with `tokenIn = WNativeToken`, exactly as the vault calls it.
    function test_acquireViaAlgebra_executesOnRealRouter() public {
        address tokenOut = _liveQuoteToken();
        uint256 ethIn = 1 ether;
        vm.deal(address(this), ethIn);

        uint256 received = harness.acquireAlgebra{ value: ethIn }(
            address(0), // zRouter unused: quoter unset short-circuits the best-route leg
            address(0), // zQuoter unset ⇒ fixed Algebra fallback
            tokenOut,
            ethIn,
            1, // minOut: a live floor is not what this test pins; the seam is
            CYPHER_SWAP_ROUTER,
            WETH,
            block.timestamp + 15 minutes
        );

        assertGt(received, 0, "real router filled the acquire leg");
        assertEq(IERC20(tokenOut).balanceOf(address(harness)), received, "tokens delivered to the caller");
        assertEq(address(this).balance, 0, "the forwarded ETH left the caller as msg.value");
    }

    /// @notice The vault's harvest convert leg (ERC20 in → WETH out) executes on the REAL Cypher router.
    /// @dev Mirrors `CypherAlignmentVault._convertFeesToWETH`: approve the router for the collected
    ///      alignment-token fees, then `exactInputSingle` them to WETH with the vault as recipient.
    function test_harvestConvertLeg_executesOnRealRouter() public {
        address alignmentToken = _liveQuoteToken();
        uint256 amountIn = 1000 * 10 ** uint256(_decimals(alignmentToken));
        deal(alignmentToken, address(this), amountIn);
        // `forceApprove`, as the vault does: the alignment token is arbitrary and may be a non-standard
        // ERC-20 whose `approve` returns no data.
        IERC20(alignmentToken).forceApprove(CYPHER_SWAP_ROUTER, amountIn);

        uint256 wethBefore = IERC20(WETH).balanceOf(address(this));
        uint256 out = IAlgebraSwapRouter(CYPHER_SWAP_ROUTER)
            .exactInputSingle(
                IAlgebraSwapRouter.ExactInputSingleParams({
                    tokenIn: alignmentToken,
                    tokenOut: WETH,
                    deployer: ALGEBRA_DEFAULT_DEPLOYER,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: amountIn,
                    amountOutMinimum: 1,
                    limitSqrtPrice: 0
                })
            );

        assertGt(out, 0, "real router filled the convert leg");
        assertEq(IERC20(WETH).balanceOf(address(this)) - wethBefore, out, "WETH delivered to the recipient");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

    /// @dev A live, factory-created (default-deployer) Cypher pool for the WETH/quote pair.
    function _livePool() internal view returns (address pool) {
        pool = IAlgebraFactory(CYPHER_ALGEBRA_FACTORY).poolByPair(WETH, _liveQuoteToken());
        require(pool != address(0) && pool.code.length > 0, "no live Cypher pool at this fork block");
    }

    /// @dev The quote token of the deepest Cypher WETH pool available at the pinned addresses. USDT rather
    ///      than USDC because the Cypher WETH/USDT pool is the one carrying live depth on this venue.
    function _liveQuoteToken() internal view returns (address) {
        return USDT;
    }

    /// @dev The NFPM's first minted position — always present on a deployed Algebra NFPM, and enough to
    ///      exercise the declared `positions` return shape.
    function _liveTokenId() internal pure returns (uint256) {
        return 1;
    }

    function _decimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok, "decimals() failed");
        return abi.decode(data, (uint8));
    }

    function _assertSelector(bytes memory code, bytes4 selector, string memory what) internal pure {
        require(code.length > 0, string.concat("no deployed code for ", what));
        assertTrue(_hasSelector(code, selector), string.concat("selector absent from deployed bytecode: ", what));
    }

    /// @dev A Solidity dispatch table compares `msg.sig` against each selector pushed as a literal, so the
    ///      four selector bytes appear verbatim in the runtime code of every function the contract exposes.
    function _hasSelector(bytes memory code, bytes4 selector) internal pure returns (bool) {
        if (code.length < 4) return false;
        for (uint256 i = 0; i + 4 <= code.length; ++i) {
            if (
                code[i] == selector[0] && code[i + 1] == selector[1] && code[i + 2] == selector[2]
                    && code[i + 3] == selector[3]
            ) return true;
        }
        return false;
    }

    receive() external payable { }
}

/// @notice Thin caller so the internal library runs in a real contract context (`address(this)` = the
///         "vault"): tokens land here and ETH is forwarded from here, mirroring the vault call site.
contract AlgebraAcquirerHarness {
    function acquireAlgebra(
        address zRouter,
        address zQuoter,
        address tokenOut,
        uint256 ethAmount,
        uint256 minOut,
        address algebraRouter,
        address weth,
        uint256 fallbackDeadline
    ) external payable returns (uint256) {
        return BestRouteAcquirer.acquireViaAlgebra(
            zRouter, zQuoter, tokenOut, ethAmount, minOut, algebraRouter, weth, fallbackDeadline
        );
    }

    receive() external payable { }
}
