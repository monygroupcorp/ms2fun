// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console2 } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";

import { PoolManager } from "v4-core/PoolManager.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { Position } from "v4-core/libraries/Position.sol";

import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";

/**
 * @title UniVaultPoolKeyRotationTest
 * @notice PoC: `UniAlignmentVault.setV4PoolKey` (src/vaults/uni/UniAlignmentVault.sol:940-944) has no
 *         "liquidity already deployed" lock and does not reset `lastTickLower/lastTickUpper` or
 *         `totalLPUnits`. Rotating the key while a position is live points `_claimVaultFees`
 *         (:500-533) at (newPoolId, oldTicks) — a position with zero liquidity — and v4-core's
 *         `Position.update` refuses a zero-liquidityDelta poke on an empty position
 *         (lib/v4-core/src/libraries/Position.sol:83-85, CannotUpdateEmptyPosition).
 *
 *         Every user-facing path that touches fees then reverts: `claimFees`, `claimFeesAsDelegate`
 *         and `convertAndAddLiquidity` (which crystallizes fees first, :380-383).
 *
 *         The ZAMM sibling refuses this outright: ZAMMAlignmentVault.sol:325-326 reverts
 *         `PoolKeyLocked()` once `principalInvariant != 0`.
 *
 * RUN: FOUNDRY_CONFIG=foundry.skeptic-v4.toml forge test --match-path test/audit/UniVaultPoolKeyRotation.t.sol
 *      (v4-core's real PoolManager pins `pragma solidity 0.8.26`; the default profile is pinned 0.8.28.)
 */
contract UniVaultPoolKeyRotationTest is Test {
    PoolManager internal manager;
    UniAlignmentVault internal vault;
    MockEXECToken internal token;
    MockZRouter internal router;
    MockVaultPriceValidator internal validator;
    MockAlignmentRegistry internal registry;

    PoolKey internal keyA; // fee 3000 / tickSpacing 60
    PoolKey internal keyB; // fee 10000 / tickSpacing 200

    address internal owner = address(0xB055);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);

    address internal constant WETH_ = address(0x1111111111111111111111111111111111111111);
    address internal constant TREASURY = address(0xFEE);
    uint256 internal constant TARGET_ID = 1;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function setUp() public {
        manager = new PoolManager(address(this));

        token = new MockEXECToken(10_000_000e18);
        router = new MockZRouter();
        validator = new MockVaultPriceValidator();
        registry = new MockAlignmentRegistry();

        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, address(token), true);
        registry.setReferencePool(
            TARGET_ID,
            address(token),
            IAlignmentRegistry.ReferencePool({ pool: address(0xBEEF), kind: 0, twapWindow: 1800 })
        );
        validator.setEthPer1e18Tokens(1e18);

        vm.deal(address(router), 10_000 ether);
        token.transfer(address(router), 5_000_000e18);

        keyA = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        keyB = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: 10000,
            tickSpacing: 200,
            hooks: IHooks(address(0))
        });
        manager.initialize(keyA, SQRT_PRICE_1_1);
        manager.initialize(keyB, SQRT_PRICE_1_1);

        UniAlignmentVault impl = new UniAlignmentVault();
        vault = UniAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            owner,
            WETH_,
            address(manager),
            address(token),
            address(router),
            3000,
            60,
            IVaultPriceValidator(address(validator)),
            IAlignmentRegistry(address(registry)),
            TARGET_ID,
            TREASURY
        );
        vm.prank(owner);
        vault.setV4PoolKey(keyA);

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);
    }

    function _contribute(address who, uint256 amt) internal {
        vm.prank(who);
        vault.receiveContribution{ value: amt }(Currency.wrap(address(0)), amt, who);
    }

    function test_B_rotatingPoolKeyWithLivePositionBricksEveryFeePath() public {
        // ── 1. Deploy a real v4 position through the production path. ──
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalLPUnits(), 0, "no position deployed");
        console2.log("totalLPUnits after convert #1 :", vault.totalLPUnits());
        console2.log(
            "lastTickLower / lastTickUpper :",
            vm.toString(int256(vault.lastTickLower())),
            vm.toString(int256(vault.lastTickUpper()))
        );

        // ── 2. Sanity: with the key untouched, a second convert (which pokes the live position for
        //       fees before minting) succeeds. ──
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(1);
        console2.log("totalLPUnits after convert #2 :", vault.totalLPUnits());

        // ── 3. Owner rotates the fee tier while the position is live. No lock, no tick reset. ──
        vm.prank(owner);
        vault.setV4PoolKey(keyB);

        // ── 4. THE BRICK. `_claimVaultFees` now pokes (poolB, poolA's ticks): an empty position.
        //       Each call below is expected (by the protocol's own docs) to work; each reverts with
        //       v4-core's Position.CannotUpdateEmptyPosition. ──
        _contribute(carol, 10 ether);

        vm.prank(alice);
        (bool claimOk, bytes memory claimErr) = address(vault).call(abi.encodeWithSignature("claimFees()"));

        address[] memory who = new address[](1);
        who[0] = alice;
        (bool delegateOk, bytes memory delegateErr) =
            address(vault).call(abi.encodeWithSignature("claimFeesAsDelegate(address[])", who));

        (bool convertOk, bytes memory convertErr) =
            address(vault).call(abi.encodeWithSignature("convertAndAddLiquidity(uint256)", uint256(1)));

        console2.log("claimFees reverted with        :", vm.toString(claimErr));
        console2.log("claimFeesAsDelegate reverted   :", vm.toString(delegateErr));
        console2.log("convertAndAddLiquidity reverted:", vm.toString(convertErr));
        console2.log("totalEthLocked stranded (wei)  :", vault.totalEthLocked());
        console2.log("totalShares                    :", vault.totalShares());

        // All three carry EXACTLY v4-core's empty-position selector - it is the pool-key rotation,
        // not slippage or config, that is reverting them.
        assertEq(bytes4(claimErr), Position.CannotUpdateEmptyPosition.selector, "claimFees");
        assertEq(bytes4(delegateErr), Position.CannotUpdateEmptyPosition.selector, "claimFeesAsDelegate");
        assertEq(bytes4(convertErr), Position.CannotUpdateEmptyPosition.selector, "convertAndAddLiquidity");

        // ── 5. THE FINDING: after one unguarded owner setter call, no benefactor path works. ──
        assertTrue(convertOk, "convertAndAddLiquidity bricked by unguarded setV4PoolKey (:940-944)");
        assertTrue(claimOk, "claimFees bricked by unguarded setV4PoolKey (:940-944)");
        assertTrue(delegateOk, "claimFeesAsDelegate bricked by unguarded setV4PoolKey (:940-944)");
    }

    /// @notice The brick is REVERSIBLE: rotating the key back restores every path. Recorded so the
    ///         severity is argued on the right facts (owner-only, reversible DoS - not a permanent
    ///         loss of funds), and so the "tick spacing must divide the stale ticks" theory is
    ///         disproved: v4's `checkTicks` never checks spacing; the revert is the empty position.
    function test_B_rotatingBackRestoresTheVault() public {
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.setV4PoolKey(keyB);

        _contribute(bob, 10 ether);
        vm.expectRevert(Position.CannotUpdateEmptyPosition.selector);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.setV4PoolKey(keyA);

        uint256 lpBefore = vault.totalLPUnits();
        vault.convertAndAddLiquidity(1); // works again
        assertGt(vault.totalLPUnits(), lpBefore, "restored");
        console2.log("recovered: totalLPUnits       :", vault.totalLPUnits());
    }
}
