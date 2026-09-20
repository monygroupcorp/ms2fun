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
 * @notice M-3 of the 2026-09-17 pre-testnet audit, asserted against the fix rather than the defect.
 *
 *         AS FOUND: `UniAlignmentVault.setV4PoolKey` had no "liquidity already deployed" lock and did
 *         not reset `lastTickLower/lastTickUpper` or `totalLPUnits`. Rotating the key while a position
 *         was live pointed `_claimVaultFees` at (newPoolId, oldTicks) — a position with zero liquidity
 *         — and v4-core's `Position.update` refuses a zero-`liquidityDelta` poke on an empty position
 *         (lib/v4-core/src/libraries/Position.sol:83-85, `CannotUpdateEmptyPosition`). `claimFees`,
 *         `claimFeesAsDelegate` and `convertAndAddLiquidity` all reverted with that one selector, so a
 *         single owner call stranded the benefactors' 80% leg. It was Medium rather than High because
 *         it was owner-only and reversible: rotating the key back restored every path.
 *
 *         AS FIXED (`uni-vault-poolkey-lock`, PR #423): `setV4PoolKey` now carries the guard the ZAMM
 *         sibling has had since it was written — `if (totalLPUnits != 0) revert PoolKeyLocked()`
 *         (UniAlignmentVault.sol:1009, against ZAMMAlignmentVault.sol:325-326). The rotation that
 *         built the brick is refused at the setter, so the brick has no way to exist and there is
 *         nothing left to recover from. What the guard must NOT do is narrow the legitimate call, and
 *         that half is pinned here too: a vault with no position is still freely wireable.
 *
 * RUN: FOUNDRY_CONFIG=foundry.audit.toml forge test --match-path test/audit/UniVaultPoolKeyRotation.t.sol
 *      (v4-core's real PoolManager pins `pragma solidity 0.8.26`; the default profile is pinned 0.8.28.)
 */
contract UniVaultPoolKeyRotationTest is Test {
    PoolManager internal manager;
    UniAlignmentVault internal impl;
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
    address internal delegate = address(0xDE1E6);

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

        impl = new UniAlignmentVault();
        vault = _newVault();
        vm.prank(owner);
        vault.setV4PoolKey(keyA);

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);
    }

    function _newVault() internal returns (UniAlignmentVault v) {
        v = UniAlignmentVault(payable(LibClone.clone(address(impl))));
        v.initialize(
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
    }

    function _contribute(address who, uint256 amt) internal {
        vm.prank(who);
        vault.receiveContribution{ value: amt }(Currency.wrap(address(0)), amt, who);
    }

    /// @notice The rotation that built the brick is refused, and every path it used to kill is alive.
    function test_B_rotatingPoolKeyWithLivePositionIsRefused() public {
        // ── 1. Deploy a real v4 position through the production path. ──
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalLPUnits(), 0, "no position deployed");
        console2.log("totalLPUnits after convert #1 :", vault.totalLPUnits());

        // ── 2. A second convert pokes the live position for fees before minting, so the poke path
        //       this finding was about is exercised before anything is rotated. ──
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(1);
        console2.log("totalLPUnits after convert #2 :", vault.totalLPUnits());

        // ── 3. THE FIX. The owner call that used to brick the vault no longer lands. ──
        vm.prank(owner);
        vm.expectRevert(UniAlignmentVault.PoolKeyLocked.selector);
        vault.setV4PoolKey(keyB);

        // The key the position was minted against is still the key the vault holds, and the ticks
        // `_claimVaultFees` pokes are still that pool's — which is the whole of what went wrong.
        (,, uint24 fee, int24 tickSpacing,) = vault.v4PoolKey();
        assertEq(fee, keyA.fee, "pool key rotated anyway");
        assertEq(tickSpacing, keyA.tickSpacing, "tick spacing rotated anyway");

        // ── 4. Every path the brick killed still reaches its own logic. `convertAndAddLiquidity`
        //       succeeds outright; the two claim paths revert with the VAULT's own no-fees error and
        //       never with v4-core's empty-position selector, which is the brick's signature. ──
        _contribute(carol, 10 ether);
        uint256 lpBefore = vault.totalLPUnits();
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalLPUnits(), lpBefore, "convertAndAddLiquidity still bricked");

        vm.prank(alice);
        (bool claimOk, bytes memory claimErr) = address(vault).call(abi.encodeWithSignature("claimFees()"));

        vm.prank(alice);
        vault.delegateBenefactor(delegate);
        address[] memory who = new address[](1);
        who[0] = alice;
        vm.prank(delegate);
        (bool delegateOk, bytes memory delegateErr) =
            address(vault).call(abi.encodeWithSignature("claimFeesAsDelegate(address[])", who));

        console2.log("claimFees reverted with        :", vm.toString(claimErr));
        console2.log("claimFeesAsDelegate reverted   :", vm.toString(delegateErr));

        assertFalse(claimOk, "no fees have accrued, so claimFees is expected to refuse");
        assertFalse(delegateOk, "no fees have accrued, so claimFeesAsDelegate is expected to refuse");
        assertEq(bytes4(claimErr), UniAlignmentVault.NoFeesToClaim.selector, "claimFees");
        assertEq(bytes4(delegateErr), UniAlignmentVault.NoFeesToClaim.selector, "claimFeesAsDelegate");
        assertTrue(bytes4(claimErr) != Position.CannotUpdateEmptyPosition.selector, "claimFees bricked");
        assertTrue(bytes4(delegateErr) != Position.CannotUpdateEmptyPosition.selector, "claimFeesAsDelegate bricked");
    }

    /// @notice The other half of the guard: it locks a LIVE position's key, not the setter. A vault
    ///         that holds no position is still freely wireable and re-wireable, which is the only way
    ///         an unwired vault ever reaches a pool at all.
    function test_B_wiringAVaultWithNoPositionIsUntouched() public {
        UniAlignmentVault fresh = _newVault();
        assertEq(fresh.totalLPUnits(), 0, "fresh vault holds a position");

        vm.prank(owner);
        fresh.setV4PoolKey(keyA);
        vm.prank(owner);
        fresh.setV4PoolKey(keyB); // rotated again, still before any liquidity

        (,, uint24 fee, int24 tickSpacing,) = fresh.v4PoolKey();
        assertEq(fee, keyB.fee, "unwired vault refused a rotation");
        assertEq(tickSpacing, keyB.tickSpacing, "unwired vault refused a rotation");
        console2.log("unwired vault wired and re-wired, fee tier :", fee);
    }
}
