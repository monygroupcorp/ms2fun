// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ProtocolOwnedLiquidityV1 } from "../../src/treasury/ProtocolOwnedLiquidityV1.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/// @notice Minimal MasterRegistry mock for access control testing
contract MockMasterRegistry {
    mapping(address => bool) public isRegisteredInstance;

    function setRegistered(address instance, bool status) external {
        isRegisteredInstance[instance] = status;
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

contract ProtocolOwnedLiquidityTest is Test {
    ProtocolOwnedLiquidityV1 public implementation;
    ProtocolOwnedLiquidityV1 public pol;
    MockMasterRegistry public mockRegistry;
    MockERC20 public token;

    address public owner = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);

    function setUp() public {
        implementation = new ProtocolOwnedLiquidityV1();
        bytes memory initData = abi.encodeWithSelector(ProtocolOwnedLiquidityV1.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        pol = ProtocolOwnedLiquidityV1(payable(address(proxy)));

        mockRegistry = new MockMasterRegistry();
        token = new MockERC20();

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ========== Initialization ==========

    function test_initialize() public view {
        assertEq(pol.owner(), owner);
    }

    function test_initialize_revertDouble() public {
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        pol.initialize(address(0x999));
    }

    // ========== Configuration ==========

    function test_setV4PoolManager() public {
        vm.prank(owner);
        pol.setV4PoolManager(address(0x999));
        assertEq(pol.v4PoolManager(), address(0x999));
    }

    function test_setV4PoolManager_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pol.setV4PoolManager(address(0x999));
    }

    function test_setV4PoolManager_RevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidAddress.selector);
        pol.setV4PoolManager(address(0));
    }

    function test_setWETH() public {
        vm.prank(owner);
        pol.setWETH(address(0x888));
        assertEq(pol.weth(), address(0x888));
    }

    function test_setWETH_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pol.setWETH(address(0x888));
    }

    function test_setWETH_RevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidAddress.selector);
        pol.setWETH(address(0));
    }

    function test_setMasterRegistry() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));
        assertEq(address(pol.masterRegistry()), address(mockRegistry));
    }

    function test_setMasterRegistry_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pol.setMasterRegistry(address(mockRegistry));
    }

    // ========== receivePOL gate (moved verbatim from the treasury) ==========

    function test_receivePOL_RevertRegistryNotConfigured() public {
        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.RegistryNotConfigured.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    function test_receivePOL_RevertNotRegisteredInstance() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));

        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.NotRegisteredInstance.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    function test_receivePOL_RevertV4NotConfigured() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));
        mockRegistry.setRegistered(alice, true);

        vm.prank(owner);
        pol.setWETH(address(0x888));

        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.V4NotConfigured.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    function test_receivePOL_RevertWETHNotConfigured() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));
        mockRegistry.setRegistered(alice, true);

        vm.prank(owner);
        pol.setV4PoolManager(address(0x999));

        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.WETHNotConfigured.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    // ========== claimPOLFees ==========

    function test_claimPOLFees_RevertNoPosition() public {
        // Permissionless — anyone may call — but reverts with no position.
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.NoPOLPosition.selector);
        pol.claimPOLFees(address(0xDEAD));
    }

    // ========== unlockCallback caller check ==========

    function test_unlockCallback_RevertUnauthorized() public {
        vm.prank(owner);
        pol.setV4PoolManager(address(0x999));

        // Only the configured PoolManager may invoke the callback.
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        pol.unlockCallback("");
    }

    // ========== Owner sweeps ==========

    function test_withdrawETH() public {
        vm.deal(address(pol), 5 ether);

        vm.prank(owner);
        pol.withdrawETH(bob, 3 ether);

        assertEq(bob.balance, 13 ether);
        assertEq(pol.getBalance(), 2 ether);
    }

    function test_withdrawETH_RevertNonOwner() public {
        vm.deal(address(pol), 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        pol.withdrawETH(alice, 1 ether);
    }

    function test_withdrawETH_RevertInsufficientBalance() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InsufficientBalance.selector);
        pol.withdrawETH(bob, 1 ether);
    }

    function test_withdrawETH_RevertZeroAddress() public {
        vm.deal(address(pol), 1 ether);
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidRecipient.selector);
        pol.withdrawETH(address(0), 1 ether);
    }

    function test_withdrawERC20() public {
        token.mint(address(pol), 1000);

        vm.prank(owner);
        pol.withdrawERC20(address(token), bob, 500);

        assertEq(token.balanceOf(bob), 500);
        assertEq(token.balanceOf(address(pol)), 500);
    }

    function test_withdrawERC20_RevertNonOwner() public {
        token.mint(address(pol), 1000);
        vm.prank(alice);
        vm.expectRevert();
        pol.withdrawERC20(address(token), alice, 1000);
    }

    // ========== Views ==========

    function test_polInstanceCount_InitiallyZero() public view {
        assertEq(pol.polInstanceCount(), 0);
    }

    function test_getPolPosition_EmptyForUnknown() public view {
        (int24 tickLower, int24 tickUpper, bytes32 salt, uint128 liquidity) = pol.getPolPosition(address(0xDEAD));
        assertEq(tickLower, 0);
        assertEq(tickUpper, 0);
        assertEq(salt, bytes32(0));
        assertEq(liquidity, 0);
    }

    function test_receive_acceptsETH() public {
        vm.prank(alice);
        (bool success,) = address(pol).call{ value: 1 ether }("");
        assertTrue(success);
        assertEq(pol.getBalance(), 1 ether);
    }

    // ========== Helpers ==========

    function _dummyPoolKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0xAAA)),
            currency1: Currency.wrap(address(0xBBB)),
            fee: 3000,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });
    }
}
