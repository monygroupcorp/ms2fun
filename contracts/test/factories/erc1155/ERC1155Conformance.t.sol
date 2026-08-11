// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Instance, LengthMismatch } from "../../../src/factories/erc1155/ERC1155Instance.sol";

// ── Reference interfaces ─────────────────────────────────────────────────────
// Declared here so the tests DERIVE every interface id with `type(I).interfaceId` instead of trusting a
// literal. The literals asserted alongside them are the values in the ERC-165 / ERC-1155 specs.

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC1155 {
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory);
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address account, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external;
}

interface IERC1155MetadataURI {
    function uri(uint256 id) external view returns (string memory);
}

/// @notice A plain external caller. Probes go through a raw `staticcall` so the test can tell
///         "returned false" apart from "reverted" — which is the distinction ERC-165 turns on.
contract Prober {
    function probe(address target, bytes4 interfaceId) external view returns (bool ok, bytes memory ret) {
        (ok, ret) = target.staticcall(abi.encodeWithSelector(IERC165.supportsInterface.selector, interfaceId));
    }

    function readUri(address target, uint256 id) external view returns (bool ok, bytes memory ret) {
        (ok, ret) = target.staticcall(abi.encodeWithSelector(IERC1155MetadataURI.uri.selector, id));
    }

    function readBatch(address target, address[] memory accounts, uint256[] memory ids)
        external
        view
        returns (bool ok, bytes memory ret)
    {
        (ok, ret) = target.staticcall(abi.encodeWithSelector(IERC1155.balanceOfBatch.selector, accounts, ids));
    }
}

/// @notice ERC-1155 conformance surface for `ERC1155Instance`: ERC-165 detection, `uri`,
///         `balanceOfBatch`, and the `URI` event. Every assertion here fails if the member it covers is
///         removed — an absent function has no fallback to answer it, so the probe reverts.
contract ERC1155ConformanceTest is Test {
    address creator = makeAddr("creator");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address gmr = makeAddr("gmr");
    address vaultStub = makeAddr("vault");
    address registryStub = makeAddr("registry");
    address wethStub = makeAddr("weth");

    string constant ED1_URI = "ipfs://edition-one";
    string constant ED2_URI = "ipfs://edition-two";

    ERC1155Instance inst;
    Prober prober;

    // Mirrors of the events under test (redeclared so `vm.expectEmit` has a signature to match).
    event URI(string value, uint256 indexed id);

    function setUp() public {
        prober = new Prober();
        inst = new ERC1155Instance(
            "Conformance",
            creator,
            address(this), // factory
            vaultStub,
            "",
            ERC1155Instance.InstanceInit({
                globalMessageRegistry: gmr,
                protocolTreasury: address(0xFEE),
                masterRegistry: registryStub,
                gatingModule: address(0),
                dynamicPricingModule: address(0),
                weth: wethStub
            }),
            false,
            "", // contract-level metadata URI
            "" // symbol (optional for ERC1155)
        );
    }

    function _addEdition(string memory uri_, uint256 price, uint256 supply) internal returns (uint256 id) {
        vm.prank(creator);
        inst.addEdition("Piece", price, supply, uri_, ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, 0);
        return inst.nextEditionId() - 1;
    }

    function _mint(address to, uint256 id, uint256 amount, uint256 price) internal {
        vm.deal(to, price * amount);
        vm.prank(to);
        inst.mint{ value: price * amount }(id, amount, "", "", 0);
    }

    // ── ERC-165 ────────────────────────────────────────────────────────────────

    /// @dev The ids are derived from the interfaces above, then checked against the spec literals.
    function test_interfaceIdsAreDerivedNotAsserted() public pure {
        assertEq(type(IERC165).interfaceId, bytes4(0x01ffc9a7), "ERC-165 id");
        assertEq(type(IERC1155).interfaceId, bytes4(0xd9b67a26), "ERC-1155 id");
        assertEq(type(IERC1155MetadataURI).interfaceId, bytes4(0x0e89341c), "ERC-1155 metadata URI id");
    }

    function test_supportsInterface_claimsErc165Erc1155AndMetadataUri() public view {
        assertTrue(inst.supportsInterface(type(IERC165).interfaceId), "ERC-165 not claimed");
        assertTrue(inst.supportsInterface(type(IERC1155).interfaceId), "ERC-1155 not claimed");
        assertTrue(inst.supportsInterface(type(IERC1155MetadataURI).interfaceId), "metadata URI not claimed");
    }

    /// @dev ERC-165 requires `0xffffffff` to answer `false`. A contract without `supportsInterface` and
    ///      without a fallback reverts with no return data here instead of answering.
    function test_supportsInterface_invalidIdReturnsFalse() public view {
        (bool ok, bytes memory ret) = prober.probe(address(inst), bytes4(0xffffffff));
        assertTrue(ok, "probe reverted instead of answering");
        assertEq(ret.length, 32, "no answer returned");
        assertFalse(abi.decode(ret, (bool)), "0xffffffff must be unsupported");
    }

    function test_supportsInterface_unsupportedIdReturnsFalseNeverReverts() public view {
        bytes4[3] memory unsupported = [
            bytes4(0x80ac58cd), // ERC-721
            bytes4(0x36372b07), // ERC-20
            bytes4(0xdeadbeef) // arbitrary
        ];
        for (uint256 i = 0; i < unsupported.length; i++) {
            (bool ok, bytes memory ret) = prober.probe(address(inst), unsupported[i]);
            assertTrue(ok, "probe reverted instead of answering");
            assertEq(ret.length, 32, "no answer returned");
            assertFalse(abi.decode(ret, (bool)), "unexpected interface claimed");
        }
    }

    // ── uri ────────────────────────────────────────────────────────────────────

    function test_uri_returnsEditionMetadataUri() public {
        uint256 ed1 = _addEdition(ED1_URI, 0.01 ether, 100);
        uint256 ed2 = _addEdition(ED2_URI, 0.01 ether, 100);

        (bool ok, bytes memory ret) = prober.readUri(address(inst), ed1);
        assertTrue(ok, "uri probe reverted");
        assertEq(abi.decode(ret, (string)), ED1_URI);
        assertEq(inst.uri(ed2), ED2_URI);
    }

    /// @dev `uri` must agree with `getEdition` — one source of truth, including after an update.
    function test_uri_agreesWithGetEditionAcrossUpdate() public {
        uint256 ed = _addEdition(ED1_URI, 0.01 ether, 100);
        assertEq(inst.uri(ed), inst.getEdition(ed).metadataURI);

        vm.prank(creator);
        inst.updateEditionMetadata(ed, ED2_URI);
        assertEq(inst.uri(ed), ED2_URI);
        assertEq(inst.uri(ed), inst.getEdition(ed).metadataURI);
    }

    /// @dev An unknown id answers with the empty string rather than reverting, so a metadata probe on a
    ///      not-yet-created edition is a plain miss.
    function test_uri_unknownIdReturnsEmptyString() public view {
        (bool ok, bytes memory ret) = prober.readUri(address(inst), 424_242);
        assertTrue(ok, "uri probe reverted on unknown id");
        assertEq(bytes(abi.decode(ret, (string))).length, 0);
    }

    // ── URI event ──────────────────────────────────────────────────────────────

    function test_uriEvent_firesOnEditionCreation() public {
        uint256 expectedId = inst.nextEditionId();
        vm.expectEmit(true, false, false, true, address(inst));
        emit URI(ED1_URI, expectedId);
        vm.prank(creator);
        inst.addEdition("Piece", 0.01 ether, 100, ED1_URI, ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, 0);
    }

    function test_uriEvent_firesOnMetadataUpdate() public {
        uint256 ed = _addEdition(ED1_URI, 0.01 ether, 100);
        vm.expectEmit(true, false, false, true, address(inst));
        emit URI(ED2_URI, ed);
        vm.prank(creator);
        inst.updateEditionMetadata(ed, ED2_URI);
    }

    // ── balanceOfBatch ─────────────────────────────────────────────────────────

    function test_balanceOfBatch_matchesPerIdBalanceOf() public {
        uint256 ed1 = _addEdition(ED1_URI, 0.01 ether, 100);
        uint256 ed2 = _addEdition(ED2_URI, 0.01 ether, 100);

        _mint(user1, ed1, 3, 0.01 ether);
        _mint(user2, ed2, 5, 0.01 ether);

        // Mixed set: a repeated address, two ids, and two zero-balance pairs.
        address[] memory accounts = new address[](5);
        uint256[] memory ids = new uint256[](5);
        accounts[0] = user1;
        ids[0] = ed1;
        accounts[1] = user1;
        ids[1] = ed2; // zero
        accounts[2] = user2;
        ids[2] = ed2;
        accounts[3] = user2;
        ids[3] = ed1; // zero
        accounts[4] = user1;
        ids[4] = ed1; // repeated address+id

        (bool ok, bytes memory ret) = prober.readBatch(address(inst), accounts, ids);
        assertTrue(ok, "balanceOfBatch probe reverted");
        uint256[] memory batch = abi.decode(ret, (uint256[]));

        assertEq(batch.length, accounts.length, "wrong batch length");
        for (uint256 i = 0; i < accounts.length; i++) {
            assertEq(batch[i], inst.balanceOf(accounts[i], ids[i]), "batch disagrees with balanceOf");
        }
        // Pin the expected values too, so the test cannot pass by echoing a uniformly wrong source.
        assertEq(batch[0], 3);
        assertEq(batch[1], 0);
        assertEq(batch[2], 5);
        assertEq(batch[3], 0);
        assertEq(batch[4], 3);
    }

    function test_balanceOfBatch_emptyArraysReturnEmpty() public view {
        address[] memory accounts = new address[](0);
        uint256[] memory ids = new uint256[](0);
        assertEq(inst.balanceOfBatch(accounts, ids).length, 0);
    }

    function test_balanceOfBatch_revertsOnLengthMismatch() public {
        address[] memory accounts = new address[](2);
        uint256[] memory ids = new uint256[](1);
        accounts[0] = user1;
        accounts[1] = user2;
        ids[0] = 1;

        vm.expectRevert(LengthMismatch.selector);
        inst.balanceOfBatch(accounts, ids);
    }
}
