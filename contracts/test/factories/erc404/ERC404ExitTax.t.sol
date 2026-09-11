// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { ERC404ExitTaxSink } from "../../../src/factories/erc404/ERC404ExitTaxSink.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { RevenueSplitLib } from "../../../src/shared/libraries/RevenueSplitLib.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockRevertingVault } from "../../mocks/MockRevertingVault.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @dev A creator whose `owner()` cannot take ETH. Pushing the leg out of the sell is what stops this
///      from bricking sells; `SmartTransferLib`'s WETH fallback is what stops it from stranding the
///      leg at claim time.
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
    ERC404ExitTaxSink internal sink;
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
    bytes32 internal constant EXIT_TAX_SINK = keccak256("exittax.sink");

    uint256 internal maxBondingSupply;
    uint256 internal threshold;

    BondingCurveMath.Params internal curveParams;

    function setUp() public {
        registry = new MockMasterRegistry();
        vault = new MockVault();
        weth = new MockWETH();
        sink = new ERC404ExitTaxSink(address(registry));
        curveParams = BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 });

        instance = _newInstance(address(vault), true);

        maxBondingSupply = MAX_SUPPLY - instance.liquidityReserve();
        threshold = (maxBondingSupply * EXIT_TAX_THRESHOLD_BPS) / 10000;
    }

    // ── Fixtures ──────────────────────────────────────────────────────────────

    /// @param wireSink Whether to seal the exit-tax sink onto the instance. False is the lever's OFF
    ///                 position — a deployment whose factory has no sink configured.
    function _newInstance(address vault_, bool wireSink) internal returns (ERC404BondingInstance inst) {
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
        // `initialize` records `factory = msg.sender`, so `owner` is the factory in this harness and is
        // the only caller `initModule` accepts — the same set-once seal the real factory goes through.
        if (wireSink) inst.initModule(EXIT_TAX_SINK, address(sink));
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

    /// @dev The two accrued legs of `inst`, held by the sink rather than by the instance.
    function _pending(ERC404BondingInstance inst) internal view returns (uint256 vaultCut, uint256 creatorCut) {
        return sink.pending(address(inst));
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
        (uint256 v, uint256 c) = _pending(instance);
        assertEq(v, 0, "no vault leg below the threshold");
        assertEq(c, 0, "no creator leg below the threshold");
        assertEq(address(sink).balance, 0, "the sink was never paid below the threshold");
    }

    // ── 2. Threshold placement ────────────────────────────────────────────────

    /// @dev The tax fires at supply STRICTLY above the threshold and not at or below it, asserted on
    ///      both sides of the boundary with the boundary itself pinned.
    function test_thresholdPlacement_firesOnlyStrictlyAbove() public {
        // At the boundary exactly: nothing is taxed.
        _buyTo(instance, threshold);
        assertEq(instance.totalBondingSupply(), threshold, "boundary supply pinned");

        _sell(instance, 100_000 ether);
        (uint256 v, uint256 c) = _pending(instance);
        assertEq(v, 0, "no tax at the boundary");
        assertEq(c, 0, "no tax at the boundary");

        // One step above it: the whole step is taxed.
        _buyTo(instance, threshold + 1000 ether);
        uint256 gross = _grossRefund(threshold + 1000 ether, 1000 ether);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split((gross * EXIT_TAX_BPS) / 10000);

        _sell(instance, 1000 ether);

        assertEq(instance.totalBondingSupply(), threshold, "sell lands back on the boundary");
        (v, c) = _pending(instance);
        assertEq(v, s.vaultCut, "vault leg accrued above the boundary");
        assertEq(c, s.remainder, "creator leg accrued above the boundary");
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
        (uint256 vaultCut, uint256 creatorCut) = _pending(instance);

        assertEq(protocolCut, s.protocolCut, "protocol leg = 1% of the tax");
        assertEq(vaultCut, s.vaultCut, "vault leg = 19% of the tax");
        assertEq(creatorCut, s.remainder, "creator leg = 80% of the tax plus the dust");
        assertEq(sellerNet, gross - tax, "seller keeps the untaxed remainder");
        assertEq(sellerNet + protocolCut + vaultCut + creatorCut, gross, "the four legs conserve the gross refund");

        assertEq(reserveBefore - instance.reserve(), gross, "reserve debited by the gross refund");
        // The whole gross leaves this contract: the seller's net and the protocol leg go to their
        // destinations, the other two legs go to the sink. So the instance's backing invariant is the
        // one it had before the tax existed, with nothing extra held on top of it.
        assertEq(balanceBefore - address(instance).balance, gross, "the whole gross refund left the instance");
        assertEq(address(instance).balance, instance.reserve() + instance.stakingReserve(), "balance backs the reserve");
        assertEq(address(sink).balance, vaultCut + creatorCut, "the sink holds exactly the two accrued legs");

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
        (uint256 oneShotVault, uint256 oneShotCreator) = _pending(instance);
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
        (uint256 v, uint256 c) = _pending(instance);
        assertEq(v, oneShotVault, "vault leg identical either way");
        assertEq(c, oneShotCreator, "creator leg identical either way");
        assertEq(treasury.balance, oneShotTreasury, "protocol leg identical either way");

        // Non-vacuity: the straddle really did cross the boundary, so both legs were exercised.
        assertGt(oneShotVault, 0, "the above-threshold leg was taxed");
        assertGt(oneShotTreasury, 0, "the below-threshold leg paid the ordinary skim");
    }

    // ── 5. Brick resistance: neither destination can hold a sell hostage ───────

    /// @dev A creator whose `owner()` rejects ETH must not be able to revert every sell. The leg is
    ///      pushed to the sink, not to the creator; the claim then pays it in WETH rather than
    ///      stranding it.
    function test_sellSurvivesACreatorThatCannotReceiveETH() public {
        RejectingOwner rejecting = new RejectingOwner();
        vm.prank(owner);
        instance.transferOwnership(address(rejecting));

        _buyTo(instance, threshold + 500_000 ether);
        _sell(instance, 200_000 ether);

        (, uint256 creatorCut) = _pending(instance);
        assertGt(creatorCut, 0, "the sell completed and accrued the creator leg");

        // Non-vacuity: paying this leg IS a reverting transfer — the plain ETH send fails and only the
        // WETH fallback saves it. A `sellBonding` that paid the creator inline would have carried that
        // failure, which is the whole reason the leg leaves through the sink.
        sink.claim(address(instance), true);
        assertEq(weth.balanceOf(address(rejecting)), creatorCut, "creator paid in WETH");
        (, uint256 after_) = _pending(instance);
        assertEq(after_, 0, "leg cleared");
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

        (uint256 vaultCut,) = _pending(instance);
        assertGt(vaultCut, 0, "the sell completed and accrued the vault leg");

        // Non-vacuity: the destination really is hostile. Paid inline, it reverts — so a push-from-sell
        // implementation would have reverted the sell above.
        vm.expectRevert(MockRevertingVault.VaultAlwaysReverts.selector);
        sink.claim(address(instance), false);
        (uint256 stillThere,) = _pending(instance);
        assertEq(stillThere, vaultCut, "a failed claim restores the accrual");

        // De-curated vaults are not force-fed: the leg falls back to the protocol treasury, so it is
        // never permanently stranded.
        registry.setVaultRegistered(address(hostile), false);
        uint256 treasuryBefore = treasury.balance;
        sink.claim(address(instance), false);
        assertEq(treasury.balance - treasuryBefore, vaultCut, "de-curated vault's leg goes to the treasury");
        (uint256 cleared,) = _pending(instance);
        assertEq(cleared, 0, "leg cleared");
    }

    // ── 6. Claim mechanics ────────────────────────────────────────────────────

    /// @dev The two legs are independently claimable, and a claim of an empty leg reverts rather than
    ///      emitting a zero-value transfer.
    function test_claimLegsAreIndependent() public {
        _buyTo(instance, threshold + 500_000 ether);
        _sell(instance, 200_000 ether);

        (uint256 vaultCut, uint256 creatorCut) = _pending(instance);
        assertGt(vaultCut, 0);
        assertGt(creatorCut, 0);

        sink.claim(address(instance), false);
        (uint256 v, uint256 c) = _pending(instance);
        assertEq(v, 0, "vault leg cleared");
        assertEq(c, creatorCut, "creator leg untouched by the vault claim");
        assertEq(vault.getBenefactorContribution(address(instance)), vaultCut, "vault credited the instance");

        uint256 ownerBefore = owner.balance;
        sink.claim(address(instance), true);
        assertEq(owner.balance - ownerBefore, creatorCut, "creator leg paid to owner()");

        vm.expectRevert(ERC404ExitTaxSink.NothingToClaim.selector);
        sink.claim(address(instance), true);
    }

    /// @dev `withdrawDust` is the owner's lever over the instance's surplus balance, and it cannot
    ///      reach an accrued leg because the leg is not in the instance at all. That is a structural
    ///      property of pushing the tax out at sell time, not a subtraction the owner's own contract
    ///      has to remember to perform.
    function test_withdrawDustCannotReachAnAccruedLeg() public {
        _buyTo(instance, threshold + 500_000 ether);
        _sell(instance, 200_000 ether);

        (uint256 vaultCut, uint256 creatorCut) = _pending(instance);
        uint256 accrued = vaultCut + creatorCut;
        assertGt(accrued, 0, "non-vacuous: there is an accrued leg that a sweep might have reached");
        assertEq(address(sink).balance, accrued, "the accrued legs are held by the sink");

        // The instance holds exactly its reserve, so there is no surplus to sweep at all — and the
        // accrued legs are not part of what it holds.
        assertEq(address(instance).balance, instance.reserve(), "instance holds its reserve and nothing more");
        vm.prank(owner);
        vm.expectRevert();
        instance.withdrawDust();

        assertEq(address(sink).balance, accrued, "the sweep attempt did not move the accrued legs");
    }

    // ── 7. The lever's OFF position ───────────────────────────────────────────

    /// @dev An instance with no sink sealed onto it pays NO exit tax at any supply — the same
    ///      `bondingFeeBps` skim it paid before the mechanism existed, above the threshold included.
    ///      This is what makes "ship with the lever off" a real configuration rather than a promise:
    ///      the factory wires no sink and there is nothing to turn on later, because the slot is
    ///      set-once at create.
    function test_noSinkWired_meansNoExitTaxAtAnySupply() public {
        ERC404BondingInstance off = _newInstance(address(vault), false);
        assertEq(off.modules(EXIT_TAX_SINK), address(0), "fixture must have no sink");

        _buyTo(off, threshold + 1_000_000 ether);
        uint256 S = off.totalBondingSupply();
        assertGt(S, threshold, "non-vacuous: the fixture sits ABOVE the threshold, where the tax would apply");

        uint256 amount = 500_000 ether;
        uint256 gross = _grossRefund(S, amount);
        uint256 expectedFee = (gross * BONDING_FEE_BPS) / 10000;

        uint256 sellerBefore = seller.balance;
        uint256 treasuryBefore = treasury.balance;

        _sell(off, amount);

        assertEq(seller.balance - sellerBefore, gross - expectedFee, "seller pays the ordinary skim only");
        assertEq(treasury.balance - treasuryBefore, expectedFee, "treasury took the flat 1%, not 0.1% of a tax");
        (uint256 v, uint256 c) = _pending(off);
        assertEq(v + c, 0, "nothing accrued");
        assertEq(address(sink).balance, 0, "the sink was never called");
    }

    /// @dev The sink's books are keyed by the caller and gated on the registry, so a stranger cannot
    ///      credit an accrual against a real instance.
    function test_sinkRefusesAStashFromANonInstance() public {
        address stranger = address(0xDEAD);
        registry.setRegisteredInstance(stranger, false);
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(ERC404ExitTaxSink.NotRegisteredInstance.selector);
        sink.stash{ value: 1 ether }(seller);
    }
}
