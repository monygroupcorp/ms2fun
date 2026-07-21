// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ProtocolTreasuryV1 } from "../../src/treasury/ProtocolTreasuryV1.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/// @notice Minimal ERC721 mock for testing treasury NFT handling
contract MockERC721 {
    mapping(uint256 => address) public ownerOf;

    function mint(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from, "Not owner");
        ownerOf[tokenId] = to;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        require(ownerOf[tokenId] == from, "Not owner");
        ownerOf[tokenId] = to;
        // Call onERC721Received if recipient is a contract
        if (to.code.length > 0) {
            (bool success, bytes memory ret) = to.call(
                abi.encodeWithSignature(
                    "onERC721Received(address,address,uint256,bytes)", msg.sender, from, tokenId, data
                )
            );
            require(success && abi.decode(ret, (bytes4)) == bytes4(0x150b7a02), "Not receiver");
        }
    }
}

/// @notice Minimal ERC20 mock
contract MockERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ProtocolTreasuryTest is Test {
    ProtocolTreasuryV1 public implementation;
    ProtocolTreasuryV1 public treasury;
    MockERC721 public nft;
    MockERC20 public token;

    address public owner = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);

    function setUp() public {
        implementation = new ProtocolTreasuryV1();
        bytes memory initData = abi.encodeWithSelector(ProtocolTreasuryV1.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        treasury = ProtocolTreasuryV1(payable(address(proxy)));

        nft = new MockERC721();
        token = new MockERC20();

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ========== Initialization ==========

    function test_initialize() public view {
        assertEq(treasury.owner(), owner);
    }

    function test_initialize_revertDouble() public {
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        treasury.initialize(address(0x999));
    }

    // ========== Revenue Intake ==========

    function test_deposit_bondingFee() public {
        vm.prank(alice);
        treasury.deposit{ value: 1 ether }(ProtocolTreasuryV1.Source.BONDING_FEE);

        assertEq(treasury.getBalance(), 1 ether);
        (uint256 received,) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.BONDING_FEE);
        assertEq(received, 1 ether);
    }

    function test_deposit_bondForfeit() public {
        // The one live producer path (DeployBondEscrow) tags forfeited bonds BOND_FORFEIT.
        vm.prank(alice);
        treasury.deposit{ value: 2 ether }(ProtocolTreasuryV1.Source.BOND_FORFEIT);

        (uint256 received,) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.BOND_FORFEIT);
        assertEq(received, 2 ether);
    }

    function test_deposit_multipleSourcesTrackedSeparately() public {
        vm.prank(alice);
        treasury.deposit{ value: 1 ether }(ProtocolTreasuryV1.Source.BONDING_FEE);
        vm.prank(bob);
        treasury.deposit{ value: 2 ether }(ProtocolTreasuryV1.Source.CREATION_FEE);
        vm.prank(alice);
        treasury.deposit{ value: 0.5 ether }(ProtocolTreasuryV1.Source.QUEUE_REVENUE);

        (uint256 bonding,) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.BONDING_FEE);
        (uint256 creation,) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.CREATION_FEE);
        (uint256 queue,) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.QUEUE_REVENUE);

        assertEq(bonding, 1 ether);
        assertEq(creation, 2 ether);
        assertEq(queue, 0.5 ether);
        assertEq(treasury.getBalance(), 3.5 ether);
    }

    function test_deposit_revertZeroValue() public {
        vm.prank(alice);
        vm.expectRevert(ProtocolTreasuryV1.NoValue.selector);
        treasury.deposit{ value: 0 }(ProtocolTreasuryV1.Source.BONDING_FEE);
    }

    function test_receive_taggedAsOther() public {
        vm.prank(alice);
        (bool success,) = address(treasury).call{ value: 1 ether }("");
        assertTrue(success);

        (uint256 other,) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.OTHER);
        assertEq(other, 1 ether);
    }

    // ========== ETH Withdrawal ==========

    function test_withdrawETH() public {
        vm.prank(alice);
        treasury.deposit{ value: 5 ether }(ProtocolTreasuryV1.Source.BONDING_FEE);

        vm.prank(owner);
        treasury.withdrawETH(bob, 3 ether);

        assertEq(bob.balance, 13 ether);
        assertEq(treasury.getBalance(), 2 ether);
    }

    function test_withdrawETH_revertNonOwner() public {
        vm.prank(alice);
        treasury.deposit{ value: 1 ether }(ProtocolTreasuryV1.Source.BONDING_FEE);

        vm.prank(alice);
        vm.expectRevert();
        treasury.withdrawETH(alice, 1 ether);
    }

    function test_withdrawETH_revertInsufficientBalance() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolTreasuryV1.InsufficientBalance.selector);
        treasury.withdrawETH(bob, 1 ether);
    }

    function test_withdrawETH_revertZeroAddress() public {
        vm.prank(alice);
        treasury.deposit{ value: 1 ether }(ProtocolTreasuryV1.Source.BONDING_FEE);

        vm.prank(owner);
        vm.expectRevert(ProtocolTreasuryV1.InvalidRecipient.selector);
        treasury.withdrawETH(address(0), 1 ether);
    }

    // ========== Aggregate `totalWithdrawn` accounting (noesis-066 fix) ==========

    function test_totalWithdrawn_startsZero() public view {
        assertEq(treasury.totalWithdrawn(), 0);
        (, uint256 withdrawn) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.BONDING_FEE);
        assertEq(withdrawn, 0);
    }

    function test_totalWithdrawn_aggregatesAcrossWithdrawals() public {
        vm.prank(alice);
        treasury.deposit{ value: 6 ether }(ProtocolTreasuryV1.Source.BONDING_FEE);

        vm.prank(owner);
        treasury.withdrawETH(bob, 2 ether);
        vm.prank(owner);
        treasury.withdrawETH(bob, 1 ether);

        // Aggregate, honest — not the forever-zero the old per-source mapping reported.
        assertEq(treasury.totalWithdrawn(), 3 ether);

        // The view now surfaces the aggregate withdrawn for any source query.
        (uint256 received, uint256 withdrawn) = treasury.getRevenueBySource(ProtocolTreasuryV1.Source.BONDING_FEE);
        assertEq(received, 6 ether);
        assertEq(withdrawn, 3 ether);
    }

    // ========== ERC721 ==========

    function test_receiveERC721() public {
        nft.mint(alice, 1);

        vm.prank(alice);
        nft.safeTransferFrom(alice, address(treasury), 1, "");

        assertEq(nft.ownerOf(1), address(treasury));
    }

    function test_withdrawERC721() public {
        nft.mint(address(treasury), 42);

        vm.prank(owner);
        treasury.withdrawERC721(address(nft), bob, 42);

        assertEq(nft.ownerOf(42), bob);
    }

    function test_withdrawERC721_revertNonOwner() public {
        nft.mint(address(treasury), 1);

        vm.prank(alice);
        vm.expectRevert();
        treasury.withdrawERC721(address(nft), alice, 1);
    }

    // ========== ERC20 ==========

    function test_withdrawERC20() public {
        token.mint(address(treasury), 1000);

        vm.prank(owner);
        treasury.withdrawERC20(address(token), bob, 500);

        assertEq(token.balanceOf(bob), 500);
        assertEq(token.balanceOf(address(treasury)), 500);
    }

    function test_withdrawERC20_revertNonOwner() public {
        token.mint(address(treasury), 1000);

        vm.prank(alice);
        vm.expectRevert();
        treasury.withdrawERC20(address(token), alice, 1000);
    }

    // ========== UUPS storage-layout safety (noesis-066) ==========
    // The treasury is a live-deployed UUPS proxy. The POL/conductor carve-out replaced removed vars
    // with same-position `deprecated_*` placeholders. These tests assert the load-bearing slots did
    // NOT shift — read directly from proxy storage via vm.load.

    /// @dev slot 0 holds the `totalReceived` mapping base. A deposit writes keccak(key, 0); the base
    ///      slot itself stays zero, and the packed slot 2 must hold `_initialized` at byte 20.
    function test_layout_initializedStillAtSlot2Byte20() public view {
        // slot 2 = deprecated_revenueConductor (bytes 0-19, zero) | _initialized (byte 20, true).
        // With the conductor placeholder zeroed, the whole slot equals 1 << 160.
        bytes32 slot2 = vm.load(address(treasury), bytes32(uint256(2)));
        assertEq(uint256(slot2), uint256(1) << 160, "_initialized must remain packed at slot 2 byte 20");
    }

    function test_layout_deprecatedSlotsAreZeroAndInert() public {
        // The migrated placeholders (slots 1,3,4,5,6,7) are untouched by the lean contract and read 0.
        assertEq(uint256(vm.load(address(treasury), bytes32(uint256(1)))), 0, "slot1 (deprecated totalWithdrawn)");
        assertEq(uint256(vm.load(address(treasury), bytes32(uint256(3)))), 0, "slot3 (deprecated v4PoolManager)");
        assertEq(uint256(vm.load(address(treasury), bytes32(uint256(4)))), 0, "slot4 (deprecated weth)");
        assertEq(uint256(vm.load(address(treasury), bytes32(uint256(5)))), 0, "slot5 (deprecated masterRegistry)");
        assertEq(uint256(vm.load(address(treasury), bytes32(uint256(6)))), 0, "slot6 (deprecated _polPositions)");
        assertEq(uint256(vm.load(address(treasury), bytes32(uint256(7)))), 0, "slot7 (deprecated polInstances)");
    }

    /// @dev The appended aggregate `totalWithdrawn` lives at slot 8 (after the deprecated tail),
    ///      proving new state is append-only and does not collide with the preserved slots.
    function test_layout_totalWithdrawnAtSlot8() public {
        vm.prank(alice);
        treasury.deposit{ value: 4 ether }(ProtocolTreasuryV1.Source.OTHER);
        vm.prank(owner);
        treasury.withdrawETH(bob, 1 ether);

        assertEq(uint256(vm.load(address(treasury), bytes32(uint256(8)))), 1 ether, "totalWithdrawn must be at slot 8");
        assertEq(treasury.totalWithdrawn(), 1 ether);
    }
}
