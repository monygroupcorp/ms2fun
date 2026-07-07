// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployBondEscrow} from "../../../src/factories/erc404/DeployBondEscrow.sol";
import {ProtocolTreasuryV1} from "../../../src/treasury/ProtocolTreasuryV1.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Ownable} from "solady/auth/Ownable.sol";

/// @dev Minimal stand-in for a bonding instance — the escrow only reads these two getters.
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

contract DeployBondEscrowTest is Test {
    DeployBondEscrow escrow;
    ProtocolTreasuryV1 treasury;
    MockBondInstance instance;

    address owner = makeAddr("owner");
    address factory = makeAddr("factory");
    address creator = makeAddr("creator");
    address stranger = makeAddr("stranger");

    uint256 constant BOND = 0.5 ether;

    function setUp() public {
        ProtocolTreasuryV1 impl = new ProtocolTreasuryV1();
        bytes memory initData = abi.encodeWithSelector(ProtocolTreasuryV1.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        treasury = ProtocolTreasuryV1(payable(address(proxy)));

        escrow = new DeployBondEscrow(owner, factory, address(treasury));
        instance = new MockBondInstance();

        vm.deal(factory, 100 ether);
    }

    function _post(address inst, address who, uint256 amount) internal {
        vm.prank(factory);
        escrow.postBond{value: amount}(inst, who);
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
        new DeployBondEscrow(address(0), factory, address(treasury));
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        new DeployBondEscrow(owner, address(0), address(treasury));
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        new DeployBondEscrow(owner, factory, address(0));
    }

    // ── postBond ────────────────────────────────────────────────────────────

    function test_postBond_happyPath() public {
        _post(address(instance), creator, BOND);
        (address c, uint256 amt, uint40 createdAt, bool settled) = escrow.bonds(address(instance));
        assertEq(c, creator);
        assertEq(amt, BOND);
        assertEq(createdAt, uint40(block.timestamp));
        assertFalse(settled);
        assertEq(address(escrow).balance, BOND);
    }

    function test_postBond_onlyFactory() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(DeployBondEscrow.OnlyFactory.selector);
        escrow.postBond{value: BOND}(address(instance), creator);
    }

    function test_postBond_revertsOnZeroValue() public {
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.NoBondValue.selector);
        escrow.postBond{value: 0}(address(instance), creator);
    }

    function test_postBond_revertsOnZeroAddresses() public {
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        escrow.postBond{value: BOND}(address(0), creator);
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.InvalidAddress.selector);
        escrow.postBond{value: BOND}(address(instance), address(0));
    }

    function test_postBond_revertsOnDoublePost() public {
        _post(address(instance), creator, BOND);
        vm.prank(factory);
        vm.expectRevert(DeployBondEscrow.BondAlreadyPosted.selector);
        escrow.postBond{value: BOND}(address(instance), creator);
    }

    // ── refund ────────────────────────────────────────────────────────────

    function test_refund_happyPath_paysCreator() public {
        _post(address(instance), creator, BOND);
        instance.setGraduated(true);

        uint256 before = creator.balance;
        vm.prank(stranger); // permissionless
        escrow.refund(address(instance));

        assertEq(creator.balance - before, BOND);
        (, , , bool settled) = escrow.bonds(address(instance));
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
        (, , , bool settled) = escrow.bonds(address(instance));
        assertTrue(settled);
    }

    function test_forfeit_maturitySetPath_usesMaturity() public {
        _post(address(instance), creator, BOND);
        uint256 hardCap = block.timestamp + escrow.maxBondDuration();
        // maturity beyond the hard cap → deadline anchors on maturity, not the hard cap.
        uint256 maturity = hardCap + 60 days;
        instance.setBondingMaturityTime(maturity);
        uint256 deadline = maturity + escrow.graceDays() * 1 days;

        vm.warp(hardCap + escrow.graceDays() * 1 days + 1); // past hard-cap deadline but < maturity deadline
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(address(instance));

        vm.warp(deadline + 1);
        escrow.forfeit(address(instance));
        assertEq(treasury.totalReceived(ProtocolTreasuryV1.Source.BOND_FORFEIT), BOND);
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
        (, , , bool settled) = escrow.bonds(address(instance));
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

        // The re-entrant refund() hits the nonReentrant guard → the payout's inner call reverts →
        // SafeTransferLib bubbles it → the whole refund reverts. No ETH leaves; nothing double-spent.
        vm.expectRevert();
        escrow.refund(address(instance));

        (, , , bool settled) = escrow.bonds(address(instance));
        assertFalse(settled);
        assertEq(address(escrow).balance, BOND);
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
