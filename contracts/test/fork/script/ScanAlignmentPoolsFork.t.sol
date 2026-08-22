// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ScanAlignmentPools } from "../../../script/ScanAlignmentPools.s.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";

/// @dev Exposes the scanner's internal per-venue scans so the reporting path can be asserted on,
///      rather than only observed in console output (console.log is not capturable by a test).
contract ScanAlignmentPoolsHarness is ScanAlignmentPools {
    function scanUniV4Native(address token) external view returns (Best memory) {
        return _scanUniV4Native(token);
    }
}

/**
 * @title ScanAlignmentPoolsFork
 * @notice Guard for `script/ScanAlignmentPools.s.sol`: the per-venue scans must reach their
 *         reporting path for a token whose pools actually exist, and the recommendation must
 *         resolve to the deepest initialized native-ETH V4 tier.
 * @dev Fork-gated and BLOCK-PINNED. `MAINNET_RPC_URL` unset -> `vm.skip(true)`, so the suite
 *      degrades instead of failing when no archive RPC is configured. The pinned block makes the
 *      measured liquidity an exact equality rather than a moving target.
 *      Run: forge test --mp test/fork/script/ScanAlignmentPoolsFork.t.sol -vv
 *
 *      This test is not exercised by the dispatch verify (which compiles it only); running it
 *      requires an archive RPC.
 */
contract ScanAlignmentPoolsForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev Mainnet block at which the reference token's pool state below was measured.
    uint256 constant PINNED_BLOCK = 25_800_000;

    /// @dev Reference alignment target: holds a hookless native-ETH V4 pool at the 1% tier and a
    ///      second, initialized-but-empty tier at 0.30% — the exact pair of cases the scan must
    ///      distinguish.
    address constant REFERENCE_TOKEN = 0x0000000000c5dc95539589fbD24BE07c6C14eCa4;

    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant V4_PM = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant CYPHER_FACTORY = 0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0;

    uint24 constant DEEP_FEE = 10_000;
    int24 constant DEEP_SPACING = 200;
    uint128 constant DEEP_LIQUIDITY = 366_954_816_275_942_792_985;

    uint24 constant EMPTY_FEE = 3000;
    int24 constant EMPTY_SPACING = 60;

    ScanAlignmentPoolsHarness scanner;

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, PINNED_BLOCK);
        scanner = new ScanAlignmentPoolsHarness();
    }

    /// @notice The V4 scan reports a FOUND pool, and reports the deepest tier — not the first
    ///         initialized one. Fails if the loop body stops setting `best`.
    function test_uniV4Scan_reportsDeepestNativeEthPool() public view {
        ScanAlignmentPools.Best memory best = scanner.scanUniV4Native(REFERENCE_TOKEN);

        assertTrue(best.found, "V4 scan reported no native-ETH pool for a token that has one");
        assertEq(best.fee, DEEP_FEE, "wrong fee tier recommended");
        assertEq(best.spacing, DEEP_SPACING, "wrong tick spacing recommended");
        assertEq(best.liq, DEEP_LIQUIDITY, "recommended tier's active liquidity does not match the pinned block");
    }

    /// @notice An initialized tier holding zero active liquidity must not win the recommendation.
    ///         Asserts the losing tier really is initialized-and-empty, so the check is about the
    ///         scan's selection rule and not about an absent pool.
    function test_uniV4Scan_initializedButEmptyTierDoesNotWin() public view {
        PoolKey memory emptyKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(REFERENCE_TOKEN),
            fee: EMPTY_FEE,
            tickSpacing: EMPTY_SPACING,
            hooks: IHooks(address(0))
        });
        PoolId emptyId = emptyKey.toId();
        (uint160 sqrtP,,,) = IPoolManager(V4_PM).getSlot0(emptyId);
        assertTrue(sqrtP != 0, "premise: the empty tier is expected to be initialized at the pinned block");
        assertEq(
            IPoolManager(V4_PM).getLiquidity(emptyId), 0, "premise: the empty tier is expected to hold no liquidity"
        );

        ScanAlignmentPools.Best memory best = scanner.scanUniV4Native(REFERENCE_TOKEN);
        assertTrue(best.found, "V4 scan reported no native-ETH pool for a token that has one");
        assertTrue(best.fee != EMPTY_FEE, "an initialized tier with zero liquidity won the recommendation");
    }

    /// @notice The V3 and Algebra scans must read the pool they found. `expectCall` fails if the
    ///         report path after the pool-exists branch is never reached.
    function test_referenceVenueScans_readTheFoundPool() public {
        address v3Pool = _v3Pool(DEEP_FEE);
        address algebraPool = _algebraPool();
        assertTrue(v3Pool != address(0), "premise: a V3 pool is expected for the reference pair");
        assertTrue(algebraPool != address(0), "premise: an Algebra pool is expected for the reference pair");

        vm.expectCall(v3Pool, abi.encodeWithSignature("liquidity()"));
        vm.expectCall(algebraPool, abi.encodeWithSignature("liquidity()"));

        scanner.run(REFERENCE_TOKEN);
    }

    function _v3Pool(uint24 fee) internal view returns (address pool) {
        (bool ok, bytes memory data) = V3_FACTORY.staticcall(
            abi.encodeWithSignature("getPool(address,address,uint24)", WETH, REFERENCE_TOKEN, fee)
        );
        require(ok, "v3 factory query failed");
        pool = abi.decode(data, (address));
    }

    function _algebraPool() internal view returns (address pool) {
        (bool ok, bytes memory data) =
            CYPHER_FACTORY.staticcall(abi.encodeWithSignature("poolByPair(address,address)", WETH, REFERENCE_TOKEN));
        require(ok, "algebra factory query failed");
        pool = abi.decode(data, (address));
    }
}
