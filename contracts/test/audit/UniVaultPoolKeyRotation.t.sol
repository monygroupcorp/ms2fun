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
 * @notice The 2026-09-17 pre-testnet audit's proof for M-3, rewritten by the fix it drove.
 *
 *         AS FOUND, `UniAlignmentVault.setV4PoolKey` had no "liquidity already deployed" lock. The
 *         position is identified by (poolId, tickLower, tickUpper) but only the ticks are stored —
 *         `unlockCallback` reads `v4PoolKey` LIVE for the poolId — so re-pointing the key while a
 *         position was open left the real position orphaned under the old poolId and aimed every
 *         later call at a position that was never opened. The zero-`liquidityDelta` fee poke
 *         `_claimVaultFees` makes is refused on an empty position by v4-core
 *         (`Position.CannotUpdateEmptyPosition`), so `claimFees`, `claimFeesAsDelegate` and
 *         `convertAndAddLiquidity` all reverted together with the benefactors' 80% leg inside. One
 *         owner setter call, no event saying what broke. The recorded failing output is in
 *         `contracts/audits/2026-09-17-pre-testnet.md` §3.
 *
 *         AS IT STANDS, PR #423 added the guard the ZAMM sibling has carried since it was written:
 *         `setV4PoolKey` reverts `PoolKeyLocked()` while `totalLPUnits != 0`. These tests assert
 *         that closed rather than recording it open, and they do it against v4-core's REAL
 *         `PoolManager`, which is what this file is for — `test/vaults/UniAlignmentVault.t.sol`
 *         pins both halves of the guard against a mock, and cannot show that the fee poke lands on
 *         a real v4 position.
 *
 *         What is asserted here, and why each one earns its place:
 *           1. the rotation is refused once a REAL v4 position is live, and the stored key does not
 *              move — a revert alone would not prove the second half;
 *           2. after a refused rotation the fee poke still lands: `convertAndAddLiquidity`, which
 *              crystallizes fees before minting, succeeds against the real PoolManager, and no path
 *              can be made to answer `CannotUpdateEmptyPosition` — the selector the finding
 *              measured is now unreachable, not merely unhit;
 *           3. wiring a vault that holds no position is still open, on a key whose tick spacing
 *              differs from the original. That is the whole reason the setter exists, and it also
 *              disproves the theory the hunt raised and discarded — that the brick was tick spacing
 *              failing to divide the stale ticks. v4's `checkTicks` never checks spacing; it was
 *              always the empty position.
 *
 * RUN: FOUNDRY_CONFIG=foundry.audit.toml forge test --match-path test/audit/UniVaultPoolKeyRotation.t.sol
 *      (v4-core's real PoolManager pins `pragma solidity 0.8.26`; the default profile is pinned to
 *      0.8.28 for deploy-determinism, so this file is outside the default set for what it IMPORTS,
 *      not for what it asserts. It is green, and must stay green.)
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

    /// @notice (1) The rotation is refused once a real v4 position is live — and the stored key does
    ///         not move. Before #423 this setter call succeeded and returned no signal at all.
    function test_B_rotationIsRefusedOnceARealV4PositionIsLive() public {
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalLPUnits(), 0, "precondition: a real v4 position must be open");
        console2.log("totalLPUnits after convert #1 :", vault.totalLPUnits());

        vm.prank(owner);
        vm.expectRevert(UniAlignmentVault.PoolKeyLocked.selector);
        vault.setV4PoolKey(keyB);

        // The revert is only half of it: the key the vault will read on its next poke must still be
        // the one the position was opened under.
        (,, uint24 feeAfter, int24 spacingAfter,) = vault.v4PoolKey();
        assertEq(feeAfter, keyA.fee, "stored fee tier moved despite the refusal");
        assertEq(spacingAfter, keyA.tickSpacing, "stored tick spacing moved despite the refusal");
    }

    /// @notice (2) After a refused rotation the fee poke still lands on a real position. This is the
    ///         finding's own three-path assertion, inverted: what it measured was all three paths
    ///         answering `Position.CannotUpdateEmptyPosition` together. That selector is now
    ///         unreachable rather than merely unhit — `convertAndAddLiquidity` crystallizes fees
    ///         before minting, so its success is the poke landing.
    function test_B_theFeePokeStillLandsAfterARefusedRotation() public {
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);
        uint256 lpBefore = vault.totalLPUnits();

        vm.prank(owner);
        vm.expectRevert(UniAlignmentVault.PoolKeyLocked.selector);
        vault.setV4PoolKey(keyB);

        // The path that bricked first, because it pokes before it mints.
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalLPUnits(), lpBefore, "the poke did not land: no liquidity was added");
        console2.log("totalLPUnits after convert #2 :", vault.totalLPUnits());

        // The two claim paths refuse here for their OWN reason — no v4 swap has run, so there are no
        // fees to claim, and bob is nobody's delegate. What matters is the reason: neither may carry
        // v4-core's empty-position selector, which is what the defect produced.
        vm.prank(alice);
        (bool claimOk, bytes memory claimErr) = address(vault).call(abi.encodeWithSignature("claimFees()"));

        address[] memory who = new address[](1);
        who[0] = alice;
        vm.prank(bob);
        (bool delegateOk, bytes memory delegateErr) =
            address(vault).call(abi.encodeWithSignature("claimFeesAsDelegate(address[])", who));

        console2.log("claimFees revert data          :", vm.toString(claimErr));
        console2.log("claimFeesAsDelegate revert data:", vm.toString(delegateErr));

        assertTrue(
            claimOk || bytes4(claimErr) != Position.CannotUpdateEmptyPosition.selector,
            "claimFees still pokes an orphaned position"
        );
        assertTrue(
            delegateOk || bytes4(delegateErr) != Position.CannotUpdateEmptyPosition.selector,
            "claimFeesAsDelegate still pokes an orphaned position"
        );
        assertEq(bytes4(claimErr), UniAlignmentVault.NoFeesToClaim.selector, "claimFees for an unexpected reason");
        assertEq(bytes4(delegateErr), UniAlignmentVault.NotDelegate.selector, "delegate claim for an unexpected reason");
    }

    /// @notice (3) The lock closes only the case that orphans a position. Wiring a vault that holds
    ///         none is the whole reason the setter exists and stays open — shown here on a key whose
    ///         tick spacing (200) differs from the original (60), which also disposes of the theory
    ///         the hunt raised and discarded: that the brick was tick spacing failing to divide the
    ///         stale ticks. v4's `checkTicks` never checks spacing. A position opened under keyB
    ///         pokes perfectly well; it was always the empty position.
    function test_B_wiringAVaultThatHoldsNoPositionIsStillOpen() public {
        assertEq(vault.totalLPUnits(), 0, "precondition: no position yet");

        vm.prank(owner);
        vault.setV4PoolKey(keyB);

        (,, uint24 feeAfter, int24 spacingAfter,) = vault.v4PoolKey();
        assertEq(feeAfter, keyB.fee, "the rewire did not take");
        assertEq(spacingAfter, keyB.tickSpacing, "the rewire did not take");

        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);
        uint256 lpOnB = vault.totalLPUnits();
        assertGt(lpOnB, 0, "no position opened on the rewired key");

        // And the poke lands on it, at a tick spacing of 200.
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalLPUnits(), lpOnB, "the poke did not land on the rewired key");
        console2.log("totalLPUnits on keyB (spacing 200):", vault.totalLPUnits());

        // Now that it holds one, keyB is locked in its turn.
        vm.prank(owner);
        vm.expectRevert(UniAlignmentVault.PoolKeyLocked.selector);
        vault.setV4PoolKey(keyA);
    }
}
