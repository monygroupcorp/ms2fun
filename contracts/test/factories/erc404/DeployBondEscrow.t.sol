// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { DeployBondEscrow } from "../../../src/factories/erc404/DeployBondEscrow.sol";
import { ProtocolTreasuryV1 } from "../../../src/treasury/ProtocolTreasuryV1.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";

/// @dev Minimal stand-in for a bonding instance. The escrow only reads `graduated`;
///      `bondingMaturityTime` is kept so the tests below can prove it is NOT read.
contract MockBondInstance {
    bool public graduated;
    uint256 public bondingMaturityTime;

    function setGraduated(bool g) external {
        graduated = g;
    }

    function setBondingMaturityTime(uint256 t) external {
        bondingMaturityTime = t;
    }
}

/// @dev Malicious creator that tries to re-enter the escrow on receiving its refund.
contract ReentrantCreator {
    DeployBondEscrow public immutable escrow;
    address public instance;
    bool public attackForfeit;

    constructor(DeployBondEscrow _escrow) {
        escrow = _escrow;
    }

    function arm(address _instance, bool _forfeit) external {
        instance = _instance;
        attackForfeit = _forfeit;
    }

    receive() external payable {
        // Re-enter on the payout. The nonReentrant guard + settled flag must make this revert,
        // so the whole outer call unwinds — no double-spend.
        if (attackForfeit) {
            escrow.forfeit(instance);
        } else {
            escrow.refund(instance);
        }
    }
}

/// @dev A creator that is a smart wallet rejecting plain ETH. Its bond must still be deliverable —
///      the escrow wraps to WETH and sends it to this same address (the WETH-fallback path).
contract RejectingCreator {
    receive() external payable {
        revert("no plain ETH");
    }
}

contract DeployBondEscrowTest is Test {
    DeployBondEscrow escrow;
    ProtocolTreasuryV1 treasury;
    MockBondInstance instance;
    MockWETH weth;

    address owner = makeAddr("owner");
    address factory = makeAddr("factory");
    address creator = makeAddr("creator");
    address stranger = makeAddr("stranger");

    uint256 constant BOND = 0.5 ether;

    /// @dev Mirror of `SmartTransferLib.ETHTransferFallbackToWETH` for `vm.expectEmit` matching
    ///      (the library emits it from the escrow's context on the plain-ETH-rejected path).
    event ETHTransferFallbackToWETH(address indexed to, uint256 amount);

    function setUp() public {
        ProtocolTreasuryV1 impl = new ProtocolTreasuryV1();
        bytes memory initData = abi.encodeWithSelector(ProtocolTreasuryV1.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        treasury = ProtocolTreasuryV1(payable(address(proxy)));

        weth = new MockWETH();
        escrow = new DeployBondEscrow(owner, factory, address(treasury), address(weth));
        instance = new MockBondInstance();

        vm.deal(factory, 100 ether);
    }

    function _post(address inst, address who, uint256 amount) internal {
        // Keep bondAmount in lockstep with the posted value so the exact-value guard
        // (msg.value == bondAmount) is satisfied. Set-in-_post (rather than setUp) preserves
        // the constructor test's default `bondAmount == 0` assertion.
        vm.prank(owner);
        escrow.setBondAmount(amount);
        vm.prank(factory);
        escrow.postBond{ value: amount }(inst, who);
    }

    // ── Construction ──────────────────────────────────────────────────────────

    function test_constructor_setsWiringAndDefaults() public view {
        assertEq(escrow.owner(), owner);
        assertEq(escrow.factory(), factory);
        assertEq(escrow.protocolTreasury(), address(treasury));
        assertEq(escrow.bondAmount(), 0); // lever OFF by default
        assertEq(escrow.graceDays(), 30);
        assertEq(escrow.maxBondDuration(), 180 days);
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        new DeployBondEscrow(address(0), factory, address(treasury), address(weth));
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        new DeployBondEscrow(owner, address(0), address(treasury), address(weth));
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        new DeployBondEscrow(owner, factory, address(0), address(weth));
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        new DeployBondEscrow(owner, factory, address(treasury), address(0));
    }

    function test_constructor_setsWeth() public view {
        assertEq(escrow.weth(), address(weth));
    }

    // ── postBond ────────────────────────────────────────────────────────────

    function test_postBond_happyPath() public {
        _post(address(instance), creator, BOND);
        (address c, uint256 amt, uint40 createdAt, bool settled, uint40 maxDur, uint32 grace) =
            escrow.bonds(address(instance));
        assertEq(c, creator);
        assertEq(amt, BOND);
        assertEq(createdAt, uint40(block.timestamp));
        assertFalse(settled);
        assertEq(maxDur, uint40(escrow.maxBondDuration()), "maxBondDuration snapshotted at post");
        assertEq(grace, uint32(escrow.graceDays()), "graceDays snapshotted at post");
        assertEq(address(escrow).balance, BOND);
    }

    function test_postBond_onlyFactory() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(DeployBondEscrow.OnlyFactory.selector);
        escrow.postBond{ value: BOND }(address(instance), creator);
    }

    function test_postBond_revertsOnZeroValue() public {
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.NoBondValue.selector);
        escrow.postBond{ value: 0 }(address(instance), creator);
    }

    function test_postBond_revertsOnZeroAddresses() public {
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        escrow.postBond{ value: BOND }(address(0), creator);
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        escrow.postBond{ value: BOND }(address(instance), address(0));
    }

    function test_postBond_revertsOnDoublePost() public {
        _post(address(instance), creator, BOND);
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.BondAlreadyPosted.selector);
        escrow.postBond{ value: BOND }(address(instance), creator);
    }

    // ── postBond exact-value guard (msg.value == bondAmount) ─────────────────

    function test_postBond_revertsOnOverpay() public {
        vm.prank(owner);
        escrow.setBondAmount(BOND);
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.IncorrectBondValue.selector);
        escrow.postBond{ value: BOND + 1 }(address(instance), creator);
    }

    function test_postBond_revertsOnUnderpay() public {
        vm.prank(owner);
        escrow.setBondAmount(BOND);
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.IncorrectBondValue.selector);
        escrow.postBond{ value: BOND - 1 }(address(instance), creator);
    }

    function test_postBond_exactValueSucceeds() public {
        _post(address(instance), creator, BOND);
        (address c, uint256 amt,, bool settled,,) = escrow.bonds(address(instance));
        assertEq(c, creator);
        assertEq(amt, BOND);
        assertFalse(settled);
        assertEq(address(escrow).balance, BOND);
    }

    // ── refund ────────────────────────────────────────────────────────────

    function test_refund_happyPath_paysCreator() public {
        _post(address(instance), creator, BOND);
        instance.setGraduated(true);

        uint256 before = creator.balance;
        vm.prank(stranger); // permissionless
        escrow.refund(address(instance));

        assertEq(creator.balance - before, BOND);
        (,,, bool settled,,) = escrow.bonds(address(instance));
        assertTrue(settled);
        assertEq(address(escrow).balance, 0);
    }

    function test_refund_revertsIfNotGraduated() public {
        _post(address(instance), creator, BOND);
        vm.expectRevert(DeployBondEscrow.NotGraduated.selector);
        escrow.refund(address(instance));
    }

    function test_refund_revertsIfNoBond() public {
        vm.expectRevert(DeployBondEscrow.NoBond.selector);
        escrow.refund(address(instance));
    }

    function test_refund_revertsOnDoubleRefund() public {
        _post(address(instance), creator, BOND);
        instance.setGraduated(true);
        escrow.refund(address(instance));
        vm.expectRevert(DeployBondEscrow.BondAlreadySettled.selector);
        escrow.refund(address(instance));
    }

    // ── forfeit ────────────────────────────────────────────────────────────

    function test_forfeit_maturityZeroPath_usesHardCap() public {
        _post(address(instance), creator, BOND);
        // maturity 0 → deadline = createdAt + maxBondDuration + grace
        uint256 deadline = block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days;

        vm.warp(deadline); // exactly at deadline is NOT past it
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(address(instance));

        vm.warp(deadline + 1);
        vm.prank(stranger); // permissionless
        escrow.forfeit(address(instance));

        assertEq(treasury.totalReceived(ProtocolTreasuryV1.Source.BOND_FORFEIT), BOND);
        assertEq(address(treasury).balance, BOND);
        assertEq(address(escrow).balance, 0);
        (,,, bool settled,,) = escrow.bonds(address(instance));
        assertTrue(settled);
    }

    function test_forfeit_maturityBeyondHardCap_doesNotExtendDeadline() public {
        _post(address(instance), creator, BOND);
        uint256 hardCap = block.timestamp + escrow.maxBondDuration();
        // Same setup the old behaviour was pinned on: maturity 60 days beyond the hard cap. The
        // deadline must stay on the hard cap, so the forfeit that used to revert here now lands.
        instance.setBondingMaturityTime(hardCap + 60 days);

        vm.warp(hardCap + escrow.graceDays() * 1 days + 1);
        escrow.forfeit(address(instance));
        assertEq(treasury.totalReceived(ProtocolTreasuryV1.Source.BOND_FORFEIT), BOND);
        assertEq(address(escrow).balance, 0);
    }

    function test_forfeit_absurdMaturity_stillForfeitableAtHardCap() public {
        _post(address(instance), creator, BOND);
        uint256 deadline = block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days;
        // The decision case's own example: a creator parks maturity in the year 3000.
        instance.setBondingMaturityTime(32_503_680_000);

        vm.warp(deadline + 1);
        vm.prank(stranger); // permissionless
        escrow.forfeit(address(instance));
        assertEq(treasury.totalReceived(ProtocolTreasuryV1.Source.BOND_FORFEIT), BOND);
        assertEq(address(treasury).balance, BOND);
    }

    function test_forfeit_stillRevertsBeforeHardCapDeadline() public {
        _post(address(instance), creator, BOND);
        uint256 deadline = block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days;
        instance.setBondingMaturityTime(32_503_680_000);

        // One second early still reverts — the fix must not make everything forfeitable.
        vm.warp(deadline);
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(address(instance));
    }

    function test_refund_stillWinsAfterGraduation() public {
        _post(address(instance), creator, BOND);
        // Graduation lands long after the forfeit deadline: the bond is still the creator's.
        vm.warp(block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days + 365 days);
        instance.setGraduated(true);

        vm.expectRevert(DeployBondEscrow.AlreadyGraduated.selector);
        escrow.forfeit(address(instance));

        uint256 before = creator.balance;
        escrow.refund(address(instance));
        assertEq(creator.balance - before, BOND, "late graduation still refunds the creator");
    }

    // ── forfeit terms are snapshotted at post ──────────────────────────────

    function test_forfeit_usesSnapshottedGraceDays() public {
        _post(address(instance), creator, BOND);
        uint256 deadline = block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days;

        // Owner lengthens the grace window AFTER the bond is posted. Reading the live value here
        // would push this bond's deadline out; the recorded one must govern.
        vm.prank(owner);
        escrow.setGraceDays(3650);

        vm.warp(deadline + 1);
        escrow.forfeit(address(instance));
        assertEq(treasury.totalReceived(ProtocolTreasuryV1.Source.BOND_FORFEIT), BOND);
    }

    function test_forfeit_usesSnapshottedMaxBondDuration() public {
        _post(address(instance), creator, BOND);
        uint256 deadline = block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days;

        // The direction that matters: the owner SHORTENS the term after the bond was posted. A
        // live read would let the protocol forfeit this bond earlier than its posted terms.
        vm.prank(owner);
        escrow.setMaxBondDuration(1 days);

        vm.warp(deadline);
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(address(instance));

        vm.warp(deadline + 1);
        escrow.forfeit(address(instance));
        assertEq(treasury.totalReceived(ProtocolTreasuryV1.Source.BOND_FORFEIT), BOND);
    }

    function test_settersStillGovernNewBonds() public {
        _post(address(instance), creator, BOND);

        vm.prank(owner);
        escrow.setMaxBondDuration(10 days);
        vm.prank(owner);
        escrow.setGraceDays(2);

        MockBondInstance later = new MockBondInstance();
        _post(address(later), creator, BOND);
        uint256 laterDeadline = block.timestamp + 10 days + 2 days;

        // The new bond picks up the new terms — the snapshot records values, it does not freeze them.
        vm.warp(laterDeadline);
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(address(later));

        vm.warp(laterDeadline + 1);
        escrow.forfeit(address(later));
        assertEq(treasury.totalReceived(ProtocolTreasuryV1.Source.BOND_FORFEIT), BOND);

        // ...and the first bond is still on its own, longer, recorded terms.
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(address(instance));
    }

    function test_postBond_revertsWhenTermsDoNotFitTheRecord() public {
        vm.prank(owner);
        escrow.setMaxBondDuration(uint256(type(uint40).max) + 1);
        vm.prank(owner);
        escrow.setBondAmount(BOND);
        vm.expectRevert(DeployBondEscrow.BondTermsOutOfRange.selector);
        vm.prank(factory);
        escrow.postBond{ value: BOND }(address(instance), creator);
    }

    function test_forfeit_revertsIfGraduated() public {
        _post(address(instance), creator, BOND);
        instance.setGraduated(true);
        vm.warp(block.timestamp + 999 days);
        vm.expectRevert(DeployBondEscrow.AlreadyGraduated.selector);
        escrow.forfeit(address(instance));
    }

    function test_forfeit_revertsBeforeDeadline() public {
        _post(address(instance), creator, BOND);
        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(address(instance));
    }

    function test_forfeit_revertsOnDoubleForfeit() public {
        _post(address(instance), creator, BOND);
        vm.warp(block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days + 1);
        escrow.forfeit(address(instance));
        vm.expectRevert(DeployBondEscrow.BondAlreadySettled.selector);
        escrow.forfeit(address(instance));
    }

    // ── release (owner escape hatch) ───────────────────────────────────────

    function test_release_onlyOwner_paysCreator() public {
        _post(address(instance), creator, BOND);
        uint256 before = creator.balance;
        vm.prank(owner);
        escrow.release(address(instance));
        assertEq(creator.balance - before, BOND);
        (,,, bool settled,,) = escrow.bonds(address(instance));
        assertTrue(settled);
    }

    function test_release_revertsForNonOwner() public {
        _post(address(instance), creator, BOND);
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        escrow.release(address(instance));
    }

    function test_release_revertsIfSettled() public {
        _post(address(instance), creator, BOND);
        instance.setGraduated(true);
        escrow.refund(address(instance));
        vm.prank(owner);
        vm.expectRevert(DeployBondEscrow.BondAlreadySettled.selector);
        escrow.release(address(instance));
    }

    // ── Reentrancy on payout ───────────────────────────────────────────────

    function test_refund_reentrancy_cannotDoubleSpend() public {
        ReentrantCreator attacker = new ReentrantCreator(escrow);
        _post(address(instance), address(attacker), BOND);
        instance.setGraduated(true);
        attacker.arm(address(instance), false);

        // The re-entrant refund() hits the nonReentrant guard, so the inner ETH transfer reverts.
        // Under the WETH-fallback delivery, that reverting plain-ETH attempt no longer bricks the
        // whole refund: SmartTransferLib catches it and wraps the bond to WETH for the SAME creator.
        // The bond is therefore delivered EXACTLY ONCE (as WETH) — the settled-before-interaction
        // flag + nonReentrant guard still make a second payout impossible.
        escrow.refund(address(instance));

        (,,, bool settled,,) = escrow.bonds(address(instance));
        assertTrue(settled);
        assertEq(address(escrow).balance, 0);
        assertEq(address(attacker).balance, 0, "no plain ETH lands on the rejecting attacker");
        assertEq(weth.balanceOf(address(attacker)), BOND, "bond delivered once, as WETH");

        // A follow-up refund must still revert — no double-spend after the WETH delivery.
        vm.expectRevert(DeployBondEscrow.BondAlreadySettled.selector);
        escrow.refund(address(instance));
    }

    // ── WETH fallback on the creator-paying legs (ETH-rejecting creator) ─────

    /// @dev A creator whose `receive()` reverts must still get its bond on `refund` — delivered as
    ///      WETH to the SAME creator (no revert, no stranded bond, no new recipient).
    function test_refund_wethFallback_whenCreatorRejectsETH() public {
        RejectingCreator rejecter = new RejectingCreator();
        _post(address(instance), address(rejecter), BOND);
        instance.setGraduated(true);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit ETHTransferFallbackToWETH(address(rejecter), BOND);

        vm.prank(stranger); // permissionless
        escrow.refund(address(instance)); // must NOT revert despite the reverting receive()

        assertEq(address(rejecter).balance, 0, "no plain ETH lands on the rejecting creator");
        assertEq(weth.balanceOf(address(rejecter)), BOND, "bond delivered as WETH to the same creator");
        assertEq(address(escrow).balance, 0, "escrow fully paid out");
        (,,, bool settled,,) = escrow.bonds(address(instance));
        assertTrue(settled);
    }

    /// @dev Same rescue via the owner `release` escape hatch.
    function test_release_wethFallback_whenCreatorRejectsETH() public {
        RejectingCreator rejecter = new RejectingCreator();
        _post(address(instance), address(rejecter), BOND);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit ETHTransferFallbackToWETH(address(rejecter), BOND);

        vm.prank(owner);
        escrow.release(address(instance)); // must NOT revert

        assertEq(address(rejecter).balance, 0, "no plain ETH lands on the rejecting creator");
        assertEq(weth.balanceOf(address(rejecter)), BOND, "bond delivered as WETH to the same creator");
        assertEq(address(escrow).balance, 0, "escrow fully paid out");
        (,,, bool settled,,) = escrow.bonds(address(instance));
        assertTrue(settled);
    }

    /// @dev The accepting-creator fast path is unchanged: a plain EOA receives REAL ETH, no WETH
    ///      minted — proving the fallback only engages when the direct transfer fails.
    function test_refund_acceptingCreator_deliversPlainETH_noWeth() public {
        _post(address(instance), creator, BOND);
        instance.setGraduated(true);

        uint256 before = creator.balance;
        vm.prank(stranger);
        escrow.refund(address(instance));

        assertEq(creator.balance - before, BOND, "plain ETH delivered on the fast path");
        assertEq(weth.balanceOf(creator), 0, "no WETH minted for an accepting creator");
        assertEq(address(escrow).balance, 0);
    }

    // ── Owner levers ───────────────────────────────────────────────────────

    function test_setBondAmount_onlyOwner() public {
        vm.prank(owner);
        escrow.setBondAmount(1 ether);
        assertEq(escrow.bondAmount(), 1 ether);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        escrow.setBondAmount(2 ether);
    }

    function test_setGraceDays_and_MaxBondDuration_onlyOwner() public {
        vm.startPrank(owner);
        escrow.setGraceDays(7);
        escrow.setMaxBondDuration(90 days);
        vm.stopPrank();
        assertEq(escrow.graceDays(), 7);
        assertEq(escrow.maxBondDuration(), 90 days);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        escrow.setGraceDays(1);
    }

    function test_setProtocolTreasury_onlyOwner_nonZero() public {
        vm.prank(owner);
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        escrow.setProtocolTreasury(address(0));

        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        escrow.setProtocolTreasury(newTreasury);
        assertEq(escrow.protocolTreasury(), newTreasury);
    }
}
