// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Factory } from "../../../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import {
    FreeMintDisabled,
    FreeMintAlreadyClaimed,
    FreeMintExhausted,
    EditionNotOpen
} from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract MockVaultERC1155FM {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

contract ERC1155FreeMintTest is Test {
    ERC1155Factory factory;
    MockMasterRegistry mockRegistry;
    MockVaultERC1155FM mockVault;
    ComponentRegistry componentRegistry;

    uint256 internal _saltCounter;

    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address mockGMR = makeAddr("gmr");

    uint256 constant FREE_ALLOC = 5;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.startPrank(protocol);
        vm.etch(CREATEX, CREATEX_BYTECODE);
        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVaultERC1155FM();

        ComponentRegistry impl = new ComponentRegistry();
        address proxy = LibClone.deployERC1967(address(impl));
        componentRegistry = ComponentRegistry(proxy);
        componentRegistry.initialize(protocol);

        factory = new ERC1155Factory(address(mockRegistry), mockGMR, address(componentRegistry), address(0xBEEF));
        vm.stopPrank();
    }

    function _deploy(uint256 alloc, GatingScope scope) internal returns (ERC1155Instance) {
        vm.startPrank(creator);
        address inst = factory.createInstance(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: "FreeMintEdition",
                symbol: "", // optional collection symbol (noesis-084)
                metadataURI: "ipfs://meta",
                creator: creator,
                vault: address(mockVault),
                styleUri: "",
                gatingModule: address(0),
                freeMint: FreeMintParams({ allocation: alloc, scope: scope })
            })
        );
        vm.stopPrank();
        return ERC1155Instance(payable(inst));
    }

    function _addEdition(ERC1155Instance inst, uint256 supply) internal returns (uint256 editionId) {
        vm.prank(creator);
        inst.addEdition(
            "Piece 1", 0.01 ether, supply, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0
        );
        return inst.nextEditionId() - 1;
    }

    // ── allocation stored ─────────────────────────────────────────────────────

    function test_erc1155_freeMintAllocationStored() public {
        ERC1155Instance inst = _deploy(FREE_ALLOC, GatingScope.BOTH);
        assertEq(inst.freeMintAllocation(), FREE_ALLOC);
    }

    // ── claimFreeMint happy path ──────────────────────────────────────────────

    function test_erc1155_claimFreeMint_mintsOneToken() public {
        ERC1155Instance inst = _deploy(FREE_ALLOC, GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100);

        vm.prank(user1);
        inst.claimFreeMint(editionId, "");

        assertEq(inst.balanceOf(user1, editionId), 1);
        assertEq(inst.freeMintsClaimed(), 1);
        assertTrue(inst.freeMintClaimed(user1));
    }

    // ── reverts ───────────────────────────────────────────────────────────────

    function test_erc1155_freeMint_revertsWhenDisabled() public {
        ERC1155Instance inst = _deploy(0, GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100);
        vm.prank(user1);
        vm.expectRevert(FreeMintDisabled.selector);
        inst.claimFreeMint(editionId, "");
    }

    function test_erc1155_freeMint_revertsWhenAlreadyClaimed() public {
        ERC1155Instance inst = _deploy(FREE_ALLOC, GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        vm.prank(user1);
        vm.expectRevert(FreeMintAlreadyClaimed.selector);
        inst.claimFreeMint(editionId, "");
    }

    function test_erc1155_freeMint_revertsWhenExhausted() public {
        ERC1155Instance inst = _deploy(1, GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        vm.prank(user2);
        vm.expectRevert(FreeMintExhausted.selector);
        inst.claimFreeMint(editionId, "");
    }

    // ── openTime gate on the free path (noesis-115 finding #3) ──────────────────

    function _addEditionAt(ERC1155Instance inst, uint256 supply, uint256 openTime)
        internal
        returns (uint256 editionId)
    {
        vm.prank(creator);
        inst.addEdition(
            "Piece 1", 0.01 ether, supply, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, openTime
        );
        return inst.nextEditionId() - 1;
    }

    /// Free claim before the scheduled open must revert even on the ungated path
    /// (gatingModule == address(0), so the gating block is skipped) — no bot pre-drain.
    function test_erc1155_freeMint_revertsBeforeOpenTime_ungated() public {
        ERC1155Instance inst = _deploy(FREE_ALLOC, GatingScope.BOTH);
        uint256 openTime = block.timestamp + 1 days;
        uint256 editionId = _addEditionAt(inst, 100, openTime);

        vm.prank(user1);
        vm.expectRevert(EditionNotOpen.selector);
        inst.claimFreeMint(editionId, "");
    }

    /// PAID_ONLY scope also skips the gating block; openTime is still enforced.
    function test_erc1155_freeMint_revertsBeforeOpenTime_paidOnlyScope() public {
        ERC1155Instance inst = _deploy(FREE_ALLOC, GatingScope.PAID_ONLY);
        uint256 openTime = block.timestamp + 1 days;
        uint256 editionId = _addEditionAt(inst, 100, openTime);

        vm.prank(user1);
        vm.expectRevert(EditionNotOpen.selector);
        inst.claimFreeMint(editionId, "");
    }

    /// At or after openTime the free claim succeeds.
    function test_erc1155_freeMint_succeedsAtOpenTime() public {
        ERC1155Instance inst = _deploy(FREE_ALLOC, GatingScope.BOTH);
        uint256 openTime = block.timestamp + 1 days;
        uint256 editionId = _addEditionAt(inst, 100, openTime);

        vm.warp(openTime);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);

        vm.warp(openTime + 3 days);
        vm.prank(user2);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user2, editionId), 1);
    }

    /// openTime == 0 means open immediately (no regression).
    function test_erc1155_freeMint_openTimeZeroOpensImmediately() public {
        ERC1155Instance inst = _deploy(FREE_ALLOC, GatingScope.BOTH);
        uint256 editionId = _addEditionAt(inst, 100, 0);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);
    }
}
