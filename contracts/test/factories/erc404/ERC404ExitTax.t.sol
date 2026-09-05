// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { NothingToClaim } from "../../../src/factories/erc404/ERC404BondingStorage.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { RevenueSplitLib } from "../../../src/shared/libraries/RevenueSplitLib.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockRevertingVault } from "../../mocks/MockRevertingVault.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @dev A creator whose `owner()` cannot take ETH. Accrual is what stops this from bricking sells;
///      `SmartTransferLib`'s WETH fallback is what stops it from stranding the leg at claim time.
contract RejectingOwner {
    receive() external payable {
        revert("no ETH");
    }
}

/// @title ERC404ExitTaxTest
/// @notice Guards for the 10% exit tax above 85% of the buyable bonding pool (noesis-194).
/// @dev Every test here is written to fail if the mechanism is deleted or degraded — a bare
///      "sellBonding succeeded" assertion would pass against a no-op and is not a gate.
contract ERC404ExitTaxTest is Test {
    ERC404BondingInstance internal instance;
    MockMasterRegistry internal registry;
    MockVault internal vault;
    MockWETH internal weth;

    address internal owner = address(0xA11CE);
    address internal seller = address(0xB0B);
    address internal treasury = address(0xFEE);
    address internal mockLiquidityDeployer = address(0x600);
    address internal mockGlobalMsgRegistry = address(0x700);

    uint256 internal constant MAX_SUPPLY = 10_000_000 ether;
    uint256 internal constant LIQUIDITY_RESERVE_BPS = 1000;
    uint256 internal constant BONDING_FEE_BPS = 100;

    /// @dev Mirrors of the contract-side constants. Deliberately re-declared rather than read off the
    ///      instance: they are `internal constant` by ruling (no per-launch surface), and a test that
    ///      read the value it is asserting could not catch a change to it.
    uint256 internal constant EXIT_TAX_THRESHOLD_BPS = 8500;
    uint256 internal constant EXIT_TAX_BPS = 1000;

    uint256 internal maxBondingSupply;
    uint256 internal threshold;

    BondingCurveMath.Params internal curveParams;

    function setUp() public {
        registry = new MockMasterRegistry();
        vault = new MockVault();
        weth = new MockWETH();
        curveParams = BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 });

        instance = _newInstance(address(vault));

        maxBondingSupply = MAX_SUPPLY - instance.liquidityReserve();
        threshold = (maxBondingSupply * EXIT_TAX_THRESHOLD_BPS) / 10000;
    }

    // ── Fixtures ──────────────────────────────────────────────────────────────

    function _newInstance(address vault_) internal returns (ERC404BondingInstance inst) {
        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        inst = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        inst.initialize(
            owner,
            vault_,
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: 1_000_000 ether,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: curveParams
            }),
            mockLiquidityDeployer,
            address(0),
            address(new DN404Mirror(owner))
        );
        inst.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGlobalMsgRegistry,
                protocolTreasury: treasury,
                masterRegistry: address(registry),
                bondingFeeBps: BONDING_FEE_BPS,
                weth: address(weth)
            })
        );
        inst.initializeMetadata("Exit", "EXIT", "", "", "");
        // `setBondingOpenTime` refuses a non-future timestamp, so open one second out and warp onto it.
        inst.setBondingOpenTime(block.timestamp + 1);
        inst.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _buy(ERC404BondingInstance inst, uint256 amount) internal {
        uint256 cost = BondingCurveMath.calculateCost(curveParams, inst.totalBondingSupply(), amount);
        vm.deal(seller, cost);
        vm.prank(seller);
        inst.buyBonding{ value: cost }(amount, cost, false, bytes(""), bytes(""), 0);
    }

    function _sell(ERC404BondingInstance inst, uint256 amount) internal {
        vm.prank(seller);
        inst.sellBonding(amount, 0, bytes32(0), bytes(""), 0);
    }

    /// @dev Gross curve refund for selling `amount` at supply `S` — the value the four legs must sum to.
    function _grossRefund(uint256 S, uint256 amount) internal view returns (uint256) {
        return BondingCurveMath.calculateRefund(curveParams, S, amount);
    }

    /// @dev Buy up to exactly `target` supply, in one call.
    function _buyTo(ERC404BondingInstance inst, uint256 target) internal {
        _buy(inst, target - inst.totalBondingSupply());
    }

    // ── 1. The regression pin: below the threshold, nothing changed ────────────

    /// @dev A sell entirely below the threshold must cost exactly what it cost before the exit tax:
    ///      one whole-amount curve refund, one `bondingFeeBps` skim to the treasury, nothing accrued.
    function test_belowThreshold_isTodaysSkimExactly() public {
        _buy(instance, 1_000_000 ether);

        uint256 S = instance.totalBondingSupply();
        assertLt(S, threshold, "fixture must sit below the threshold");

        uint256 amount = 500_000 ether;
        uint256 gross = _grossRefund(S, amount);
        uint256 expectedFee = (gross * BONDING_FEE_BPS) / 10000;

        uint256 sellerBefore = seller.balance;
        uint256 treasuryBefore = treasury.balance;
        uint256 reserveBefore = instance.reserve();

        _sell(instance, amount);

        assertEq(seller.balance - sellerBefore, gross - expectedFee, "seller net");
        assertEq(treasury.balance - treasuryBefore, expectedFee, "treasury skim");
        assertEq(reserveBefore - instance.reserve(), gross, "reserve debited by the gross refund");
        assertEq(instance.pendingVaultExitTax(), 0, "no vault leg below the threshold");
        assertEq(instance.pendingCreatorExitTax(), 0, "no creator leg below the threshold");
    }

    // ── 2. Threshold placement ────────────────────────────────────────────────

    /// @dev The tax fires at supply STRICTLY above the threshold and not at or below it, asserted on
    ///      both sides of the boundary with the boundary itself pinned.
    function test_thresholdPlacement_firesOnlyStrictlyAbove() public {
        // At the boundary exactly: nothing is taxed.
        _buyTo(instance, threshold);
        assertEq(instance.totalBondingSupply(), threshold, "boundary supply pinned");

        _sell(instance, 100_000 ether);
        assertEq(instance.pendingVaultExitTax(), 0, "no tax at the boundary");
        assertEq(instance.pendingCreatorExitTax(), 0, "no tax at the boundary");

        // One step above it: the whole step is taxed.
        _buyTo(instance, threshold + 1000 ether);
        uint256 gross = _grossRefund(threshold + 1000 ether, 1000 ether);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split((gross * EXIT_TAX_BPS) / 10000);

        _sell(instance, 1000 ether);

        assertEq(instance.totalBondingSupply(), threshold, "sell lands back on the boundary");
        assertEq(instance.pendingVaultExitTax(), s.vaultCut, "vault leg accrued above the boundary");
        assertEq(instance.pendingCreatorExitTax(), s.remainder, "creator leg accrued above the boundary");
        assertGt(s.vaultCut, 0, "non-vacuous: the taxed leg is a real amount");
    }

    // ── 3. Split conservation ─────────────────────────────────────────────────

    /// @dev Seller + protocol + vault + creator equals the gross refund EXACTLY, the reserve is
    ///      debited by exactly that gross, and the rounding dust lands somewhere explicit (the
    ///      creator leg, which is `split`'s remainder) rather than nowhere.
    function test_splitConservation_fourWaysExactly() public {
        _buyTo(instance, threshold + 1_000_000 ether);

        uint256 S = instance.totalBondingSupply();
        uint256 amount = 500_000 ether; // entirely above the threshold
        uint256 gross = _grossRefund(S, amount);
        uint256 tax = (gross * EXIT_TAX_BPS) / 10000;
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(tax);

        uint256 sellerBefore = seller.balance;
        uint256 treasuryBefore = treasury.balance;
        uint256 reserveBefore = instance.reserve();
        uint256 balanceBefore = address(instance).balance;

        _sell(instance, amount);

        uint256 sellerNet = seller.balance - sellerBefore;
        uint256 protocolCut = treasury.balance - treasuryBefore;
        uint256 vaultCut = instance.pendingVaultExitTax();
        uint256 creatorCut = instance.pendingCreatorExitTax();

        assertEq(protocolCut, s.protocolCut, "protocol leg = 1% of the tax");
        assertEq(vaultCut, s.vaultCut, "vault leg = 19% of the tax");
        assertEq(creatorCut, s.remainder, "creator leg = 80% of the tax plus the dust");
        assertEq(sellerNet, gross - tax, "seller keeps the untaxed remainder");
        assertEq(sellerNet + protocolCut + vaultCut + creatorCut, gross, "the four legs conserve the gross refund");

        assertEq(reserveBefore - instance.reserve(), gross, "reserve debited by the gross refund");
        // The accrued legs are liabilities held in the instance's balance, so the balance falls by the
        // gross minus what stayed behind. `reserve` remains fully backed with the legs on top of it.
        assertEq(balanceBefore - address(instance).balance, gross - vaultCut - creatorCut, "balance delta");
        assertEq(
            address(instance).balance,
            instance.reserve() + instance.stakingReserve() + vaultCut + creatorCut,
            "balance backs the reserve plus every accrued leg"
        );

        // The protocol take FALLS above the threshold — 0.1% of the sell, a tenth of today's 1% skim.
        // Asserted rather than merely documented, because it is the counterintuitive half of the ruling.
        assertLt(protocolCut, (gross * BONDING_FEE_BPS) / 10000, "protocol keeps less above the threshold");
    }

    // ── 4. The straddle: per-leg, never a cliff ───────────────────────────────

    /// @dev A sell that starts above the threshold and ends below it is charged per leg. The
    ///      assertion that proves it is not a cliff: splitting the same sell into two transactions at
    ///      the threshold costs the seller the SAME total. Reintroduce a cliff and this goes red.
    function test_straddle_costsTheSameAsTwoSellsAtTheThreshold() public {
        uint256 above = 300_000 ether;
        uint256 below = 400_000 ether;

        _buyTo(instance, threshold + above);
        uint256 S = instance.totalBondingSupply();

        uint256 snap = vm.snapshotState();

        // One straddling transaction.
        uint256 sellerBefore = seller.balance;
        _sell(instance, above + below);
        uint256 oneShot = seller.balance - sellerBefore;
        uint256 oneShotVault = instance.pendingVaultExitTax();
        uint256 oneShotCreator = instance.pendingCreatorExitTax();
        uint256 oneShotTreasury = treasury.balance;

        vm.revertToState(snap);
        assertEq(instance.totalBondingSupply(), S, "snapshot restored the fixture");

        // The same sell, split at the threshold.
        sellerBefore = seller.balance;
        _sell(instance, above);
        assertEq(instance.totalBondingSupply(), threshold, "first leg lands on the boundary");
        _sell(instance, below);
        uint256 twoStep = seller.balance - sellerBefore;

        assertEq(oneShot, twoStep, "a straddling sell costs the seller exactly what two sells cost");
        assertEq(instance.pendingVaultExitTax(), oneShotVault, "vault leg identical either way");
        assertEq(instance.pendingCreatorExitTax(), oneShotCreator, "creator leg identical either way");
        assertEq(treasury.balance, oneShotTreasury, "protocol leg identical either way");

        // Non-vacuity: the straddle really did cross the boundary, so both legs were exercised.
        assertGt(oneShotVault, 0, "the above-threshold leg was taxed");
        assertGt(oneShotTreasury, 0, "the below-threshold leg paid the ordinary skim");
    }

    // ── 5. Brick resistance: neither destination can hold a sell hostage ───────

    /// @dev A creator whose `owner()` rejects ETH must not be able to revert every sell. The leg
    ///      accrues; the claim then pays it in WETH rather than stranding it.
    function test_sellSurvivesACreatorThatCannotReceiveETH() public {
        RejectingOwner rejecting = new RejectingOwner();
        vm.prank(owner);
        instance.transferOwnership(address(rejecting));

        _buyTo(instance, threshold + 500_000 ether);
        _sell(instance, 200_000 ether);

        uint256 creatorCut = instance.pendingCreatorExitTax();
        assertGt(creatorCut, 0, "the sell completed and accrued the creator leg");

        // Non-vacuity: pushing this leg directly IS a reverting transfer — the plain ETH send fails and
        // only the WETH fallback saves it. A `sellBonding` that pushed instead of accruing would have
        // carried that failure, which is the whole reason both legs accrue.
        instance.claimExitTax(true);
        assertEq(weth.balanceOf(address(rejecting)), creatorCut, "creator paid in WETH");
        assertEq(instance.pendingCreatorExitTax(), 0, "leg cleared");
    }

    /// @dev A vault that rejects its contribution must not be able to revert every sell either. The
    ///      sell completes; the vault's own claim is the only thing that fails, and it fails
    ///      idempotently — the accrual survives for a later, successful claim.
    function test_sellSurvivesARejectingVault() public {
        MockRevertingVault hostile = new MockRevertingVault();
        vm.prank(owner);
        instance.migrateVault(address(hostile));

        _buyTo(instance, threshold + 500_000 ether);
        _sell(instance, 200_000 ether);

        uint256 vaultCut = instance.pendingVaultExitTax();
        assertGt(vaultCut, 0, "the sell completed and accrued the vault leg");

        // Non-vacuity: the destination really is hostile. Pushed, it reverts — so a push-from-sell
        // implementation would have reverted the sell above.
        vm.expectRevert(MockRevertingVault.VaultAlwaysReverts.selector);
        instance.claimExitTax(false);
        assertEq(instance.pendingVaultExitTax(), vaultCut, "a failed claim restores the accrual");

        // De-curated vaults are not force-fed: the leg falls back to the protocol treasury, so it is
        // never permanently stranded.
        registry.setVaultRegistered(address(hostile), false);
        uint256 treasuryBefore = treasury.balance;
        instance.claimExitTax(false);
        assertEq(treasury.balance - treasuryBefore, vaultCut, "de-curated vault's leg goes to the treasury");
        assertEq(instance.pendingVaultExitTax(), 0, "leg cleared");
    }

    // ── 6. Claim mechanics ────────────────────────────────────────────────────

    /// @dev The two legs are independently claimable, and a claim of an empty leg reverts rather than
    ///      emitting a zero-value transfer.
    function test_claimLegsAreIndependent() public {
        _buyTo(instance, threshold + 500_000 ether);
        _sell(instance, 200_000 ether);

        uint256 vaultCut = instance.pendingVaultExitTax();
        uint256 creatorCut = instance.pendingCreatorExitTax();
        assertGt(vaultCut, 0);
        assertGt(creatorCut, 0);

        instance.claimExitTax(false);
        assertEq(instance.pendingVaultExitTax(), 0, "vault leg cleared");
        assertEq(instance.pendingCreatorExitTax(), creatorCut, "creator leg untouched by the vault claim");
        assertEq(vault.getBenefactorContribution(address(instance)), vaultCut, "vault credited the instance");

        uint256 ownerBefore = owner.balance;
        instance.claimExitTax(true);
        assertEq(owner.balance - ownerBefore, creatorCut, "creator leg paid to owner()");

        vm.expectRevert(NothingToClaim.selector);
        instance.claimExitTax(true);
    }

    /// @dev `withdrawDust` must never reach an accrued leg: both counters are locked liabilities
    ///      alongside `stakingReserve`, not surplus.
    function test_withdrawDustCannotSweepAnAccruedLeg() public {
        _buyTo(instance, threshold + 500_000 ether);
        _sell(instance, 200_000 ether);

        uint256 accrued = instance.pendingVaultExitTax() + instance.pendingCreatorExitTax();
        assertGt(accrued, 0, "non-vacuous: there is an accrued leg to try to sweep");

        uint256 locked = instance.reserve() + accrued;
        assertEq(address(instance).balance, locked, "balance is exactly the locked liabilities");

        vm.prank(owner);
        vm.expectRevert();
        instance.withdrawDust();

        assertEq(accrued, locked - instance.reserve(), "the legs are what withdrawDust refused to reach");
    }
}
