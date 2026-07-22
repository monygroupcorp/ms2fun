// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Instance } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { InvalidAddress, GatingCheckFailed } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockFamilyVault } from "../../mocks/MockFamilyVault.sol";
import { IGatingModule, GatingScope } from "../../../src/gating/IGatingModule.sol";

/// @notice A gating module that always DENIES. Used to prove that under FREE_MINT_ONLY a paid mint is
///         open (the module is never consulted), while any other scope consults it and reverts.
contract DenyGatingModule is IGatingModule {
    function canMint(address, uint256, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bool allowed, bool permanent)
    {
        return (false, false);
    }
    function onMint(address, uint256, uint256) external override { }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/// @notice Treasury that reverts on any ETH receipt — used to prove the protocol cut is failure-isolated.
contract RevertingTreasury {
    receive() external payable {
        revert("no ETH");
    }
}

/// @notice Minimal WETH so SmartTransferLib's fallback can wrap-and-send when the direct transfer fails.
contract MockWETH {
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ERC1155HardeningTest is Test {
    address creator = makeAddr("creator");
    address user1 = makeAddr("user1");
    address gmr = makeAddr("gmr");

    MockWETH weth;

    function setUp() public {
        weth = new MockWETH();
    }

    // Deploy an instance with `this` as the factory so the test can call initializeFreeMint to set scope.
    function _deploy(address gatingModule, address vault, address masterRegistry, address treasury)
        internal
        returns (ERC1155Instance inst)
    {
        inst = new ERC1155Instance(
            "Hardening",
            creator,
            address(this), // factory
            vault,
            "",
            ERC1155Instance.InstanceInit({
                globalMessageRegistry: gmr,
                protocolTreasury: treasury,
                masterRegistry: masterRegistry,
                gatingModule: gatingModule,
                dynamicPricingModule: address(0),
                weth: address(weth)
            }),
            false
        );
    }

    function _addEdition(ERC1155Instance inst, uint256 price, uint256 supply) internal returns (uint256) {
        vm.prank(creator);
        inst.addEdition("Piece", price, supply, "ipfs://ed", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0);
        return inst.nextEditionId() - 1;
    }

    // ── F1: gating-scope enforcement on paid mint ──────────────────────────────

    function test_F1_freeMintOnly_paidMintOpen_evenWhenModuleDenies() public {
        MockFamilyVault vault = new MockFamilyVault("UniswapV4LP");
        ERC1155Instance inst = _deploy(address(new DenyGatingModule()), address(vault), address(0), address(0xFEE));
        inst.initializeFreeMint(0, GatingScope.FREE_MINT_ONLY);
        uint256 ed = _addEdition(inst, 0.01 ether, 100);

        vm.deal(user1, 0.01 ether);
        vm.prank(user1);
        inst.mint{ value: 0.01 ether }(ed, 1, "", "", 0); // ungated despite denying module

        assertEq(inst.balanceOf(user1, ed), 1);
    }

    function test_F1_bothScope_paidMintGated_bypassClosed() public {
        MockFamilyVault vault = new MockFamilyVault("UniswapV4LP");
        ERC1155Instance inst = _deploy(address(new DenyGatingModule()), address(vault), address(0), address(0xFEE));
        inst.initializeFreeMint(0, GatingScope.BOTH);
        uint256 ed = _addEdition(inst, 0.01 ether, 100);

        vm.deal(user1, 0.01 ether);
        vm.prank(user1);
        vm.expectRevert(GatingCheckFailed.selector);
        inst.mint{ value: 0.01 ether }(ed, 1, "", "", 0);
    }

    function test_F1_paidOnlyScope_paidMintGated() public {
        MockFamilyVault vault = new MockFamilyVault("UniswapV4LP");
        ERC1155Instance inst = _deploy(address(new DenyGatingModule()), address(vault), address(0), address(0xFEE));
        inst.initializeFreeMint(0, GatingScope.PAID_ONLY);
        uint256 ed = _addEdition(inst, 0.01 ether, 100);

        vm.deal(user1, 0.01 ether);
        vm.prank(user1);
        vm.expectRevert(GatingCheckFailed.selector);
        inst.mint{ value: 0.01 ether }(ed, 1, "", "", 0);
    }

    // ── Transfer guard: zero-address recipient reverts ─────────────────────────

    function test_transfer_toZeroAddress_reverts() public {
        MockFamilyVault vault = new MockFamilyVault("UniswapV4LP");
        ERC1155Instance inst = _deploy(address(0), address(vault), address(0), address(0xFEE));
        inst.initializeFreeMint(0, GatingScope.BOTH);
        uint256 ed = _addEdition(inst, 0.01 ether, 100);

        vm.deal(user1, 0.01 ether);
        vm.startPrank(user1);
        inst.mint{ value: 0.01 ether }(ed, 1, "", "", 0);

        vm.expectRevert(InvalidAddress.selector);
        inst.safeTransferFrom(user1, address(0), ed, 1, "");

        uint256[] memory ids = new uint256[](1);
        uint256[] memory amts = new uint256[](1);
        ids[0] = ed;
        amts[0] = 1;
        vm.expectRevert(InvalidAddress.selector);
        inst.safeBatchTransferFrom(user1, address(0), ids, amts, "");
        vm.stopPrank();
    }

    function test_transfer_toNonZero_stillSucceeds() public {
        MockFamilyVault vault = new MockFamilyVault("UniswapV4LP");
        ERC1155Instance inst = _deploy(address(0), address(vault), address(0), address(0xFEE));
        inst.initializeFreeMint(0, GatingScope.BOTH);
        uint256 ed = _addEdition(inst, 0.01 ether, 100);

        vm.deal(user1, 0.01 ether);
        vm.startPrank(user1);
        inst.mint{ value: 0.01 ether }(ed, 1, "", "", 0);
        inst.safeTransferFrom(user1, user1, ed, 1, ""); // self-transfer, non-zero recipient
        vm.stopPrank();
        assertEq(inst.balanceOf(user1, ed), 1);
    }

    // ── protocolCut isolation: reverting treasury cannot brick withdraw ────────

    function test_protocolCut_revertingTreasury_doesNotBrickWithdraw() public {
        MockFamilyVault vault = new MockFamilyVault("UniswapV4LP");
        RevertingTreasury treasury = new RevertingTreasury();
        ERC1155Instance inst = _deploy(address(0), address(vault), address(0), address(treasury));
        uint256 ed = _addEdition(inst, 1 ether, 100);

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        inst.mint{ value: 1 ether }(ed, 1, "", "", 0);

        uint256 ownerBefore = creator.balance;

        // Withdraw the full 1 ETH: 1% protocol / 19% vault / 80% artist. The protocol cut goes to a
        // reverting treasury but smartTransferETH falls back to WETH, so withdraw must NOT revert.
        vm.prank(creator);
        inst.withdraw(1 ether);

        // Artist still received the 80% remainder as real ETH.
        assertEq(creator.balance, ownerBefore + 0.8 ether);
        // Protocol cut (1%) landed as WETH on the reverting treasury via the fallback.
        assertEq(weth.balanceOf(address(treasury)), 0.01 ether);
    }
}
