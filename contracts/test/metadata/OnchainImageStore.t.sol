// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { OnchainImageStore } from "../../src/metadata/OnchainImageStore.sol";
import { SSTORE2 } from "solady/utils/SSTORE2.sol";
import { Base64 } from "solady/utils/Base64.sol";
import { LibString } from "solady/utils/LibString.sol";

/// @dev Stand-in for an unrelated on-chain component that owns a mutable `metadataURI`, used to prove
/// that churning arbitrary foreign storage (including overwriting a registry-like URI) cannot touch a
/// stored blob. Deliberately NOT the real MasterRegistryV1 — the registry integration is out of scope.
contract MockRegistry {
    mapping(uint256 => string) public metadataURI;
    mapping(bytes32 => uint256) public junk;

    function setMetadataURI(uint256 id, string calldata uri) external {
        metadataURI[id] = uri;
    }

    function churn(uint256 seed, uint256 n) external {
        for (uint256 i; i < n; ++i) {
            junk[keccak256(abi.encode(seed, i))] = i + 1;
        }
    }
}

contract OnchainImageStoreTest is Test {
    OnchainImageStore internal store;

    event BlobStored(bytes32 indexed contentHash, address indexed pointer, uint256 size, address indexed uploader);

    function setUp() public {
        store = new OnchainImageStore();
    }

    /*//////////////////////////////////////////////////////////////
                        ROUND-TRIP + SIZE BOUNDARIES
    //////////////////////////////////////////////////////////////*/

    function _blob(uint256 n) internal pure returns (bytes memory b) {
        b = new bytes(n);
        for (uint256 i; i < n; ++i) {
            b[i] = bytes1(uint8((i * 31 + 7) & 0xff));
        }
    }

    function test_RoundTrip_1Byte() public {
        bytes memory data = _blob(1);
        address p = store.store(data, "image/png");
        assertEq(store.read(p), data);
    }

    function test_RoundTrip_1KB() public {
        bytes memory data = _blob(1024);
        address p = store.store(data, "image/webp");
        assertEq(store.read(p), data);
    }

    /// @notice 24,575 is the largest length that round-trips: it yields exactly 24,576 bytes of deployed
    /// code (blob + 1 STOP byte), the EIP-170 ceiling.
    function test_RoundTrip_24575_MaxDeployable() public {
        bytes memory data = _blob(24_575);
        address p = store.store(data, "image/jpeg");
        assertEq(store.read(p), data);
        assertEq(store.read(p).length, 24_575);
    }

    /// @notice THE BOUNDARY, EXPLICITLY — which side does 24,576 land on?
    /// The contract guard is `(0, 24_576]` per spec (`store` line: `data.length > MAX_BLOB_BYTES` reverts),
    /// so 24,576 PASSES the length guard. It then reaches `SSTORE2.write`, which prefixes a STOP byte and
    /// deploys `data.length + 1 == 24_577` bytes of code. Empirically, in the forge/anvil test EVM (which
    /// does NOT enforce the EIP-170 24,576-byte code cap) the deploy SUCCEEDS, so 24,576 lands on the
    /// STORE side here and round-trips.
    /// MAINNET DIVERGENCE (the trap the spec calls out): mainnet DOES enforce EIP-170, so this exact
    /// 24,577-byte-code deploy reverts `SSTORE2.DeploymentFailed` on mainnet. The last length that is
    /// storable on BOTH is 24,575 (24,576 bytes of code). Per spec, guarding the mainnet-undeployable
    /// 24,576 case is the CLIENT's job ("Validate against 24,576 in the client"), not this contract's —
    /// the contract deliberately implements the literal `(0, 24_576]` interval. This test pins the fork
    /// behavior and documents the divergence; it does NOT assert mainnet-storability of a 24,576 blob.
    function test_Boundary_24576_StoresOnForkEvmButIs24577BytesOfCode() public {
        bytes memory data = _blob(24_576);
        address p = store.store(data, "image/png"); // passes the (0, 24_576] guard; deploys on this EVM
        assertEq(store.read(p), data, "24,576 round-trips on the non-EIP-170-enforcing test EVM");
        assertEq(p.code.length, 24_577, "deployed code is blob + STOP byte = 24,577 > EIP-170 (mainnet caps at 24,576)");
    }

    function test_Revert_24577_BlobTooLarge() public {
        bytes memory data = _blob(24_577);
        vm.expectRevert(OnchainImageStore.BlobTooLarge.selector);
        store.store(data, "image/png");
    }

    function test_Revert_Empty_EmptyBlob() public {
        vm.expectRevert(OnchainImageStore.EmptyBlob.selector);
        store.store("", "image/png");
    }

    /*//////////////////////////////////////////////////////////////
                                  DEDUP
    //////////////////////////////////////////////////////////////*/

    function test_Dedup_SamePointer_NoSecondEvent_Cheaper() public {
        bytes memory data = _blob(4096);

        // First store: expect the event, capture pointer + gas.
        vm.recordLogs();
        uint256 g0 = gasleft();
        address p1 = store.store(data, "image/webp");
        uint256 firstGas = g0 - gasleft();
        assertEq(vm.getRecordedLogs().length, 1, "first store should emit exactly one BlobStored");

        // Second store of identical bytes (different caller): same pointer, NO event, materially cheaper.
        vm.recordLogs();
        vm.prank(address(0xBEEF));
        uint256 g1 = gasleft();
        address p2 = store.store(data, "image/png"); // mime intentionally different — must be ignored
        uint256 secondGas = g1 - gasleft();

        assertEq(p2, p1, "dedup must return the existing pointer");
        assertEq(vm.getRecordedLogs().length, 0, "dedup hit must emit no event");
        assertEq(store.mimeOf(p1), "image/webp", "first-store mime is authoritative on dedup");
        assertLt(secondGas, firstGas / 10, "dedup must be dramatically cheaper than a fresh write");
    }

    function test_Dedup_ContentHashKeyed() public {
        bytes memory data = _blob(512);
        address p = store.store(data, "image/gif");
        assertEq(store.pointerOf(keccak256(data)), p);
    }

    /*//////////////////////////////////////////////////////////////
                              MIME ALLOWLIST
    //////////////////////////////////////////////////////////////*/

    function test_Mime_AllowlistAccepted() public {
        assertTrue(store.store(_blob(8), "image/webp") != address(0));
        assertTrue(store.store(_blob(9), "image/png") != address(0));
        assertTrue(store.store(_blob(10), "image/jpeg") != address(0));
        assertTrue(store.store(_blob(11), "image/gif") != address(0));
    }

    function test_Mime_TextHtml_Reverts() public {
        vm.expectRevert(OnchainImageStore.MimeNotAllowed.selector);
        store.store(_blob(8), "text/html");
    }

    function test_Mime_ApplicationJson_Reverts() public {
        vm.expectRevert(OnchainImageStore.MimeNotAllowed.selector);
        store.store(_blob(8), "application/json");
    }

    function test_Mime_EmptyString_Reverts() public {
        vm.expectRevert(OnchainImageStore.MimeNotAllowed.selector);
        store.store(_blob(8), "");
    }

    function test_Mime_SvgXml_Reverts() public {
        // image/svg+xml is an active content type — must NOT be on the allowlist.
        vm.expectRevert(OnchainImageStore.MimeNotAllowed.selector);
        store.store(_blob(8), "image/svg+xml");
    }

    /*//////////////////////////////////////////////////////////////
                                 DATAURI
    //////////////////////////////////////////////////////////////*/

    function test_DataUri_ParsesAndDecodesByteIdentical() public {
        bytes memory data = _blob(777);
        address p = store.store(data, "image/webp");

        string memory uri = store.dataUri(p);
        string memory prefix = "data:image/webp;base64,";
        assertTrue(LibString.startsWith(uri, prefix), "wrong data URI prefix");

        string memory payload = LibString.slice(uri, bytes(prefix).length);
        assertEq(Base64.decode(payload), data, "base64 payload must decode byte-identical to input");
    }

    function test_DataUri_UnknownPointer_Reverts() public {
        vm.expectRevert(OnchainImageStore.UnknownPointer.selector);
        store.dataUri(address(0xDEAD));
    }

    /*//////////////////////////////////////////////////////////////
                            THE PERMANENCE PROOF
    //////////////////////////////////////////////////////////////*/

    /// @notice The entire point of the spec. After a blob is stored, NOTHING in the system can unmake it.
    /// We store a blob, then let an unrelated contract perform arbitrary state changes — including writing
    /// and repeatedly overwriting a registry-like `metadataURI` — and store OTHER blobs into the image
    /// store, and still `read(pointer)` returns the original bytes. The pointer's bytes are independent of
    /// every other storage write. (The original spec framed this against `updateInstanceMetadata`; with
    /// the registry view cut, we prove the property directly.)
    function test_Permanence_BlobSurvivesArbitraryStateChanges() public {
        bytes memory original = _blob(3333);
        address p = store.store(original, "image/webp");
        assertEq(store.read(p), original);

        MockRegistry reg = new MockRegistry();

        // A registry-like URI is written, then overwritten several times — mirrors the exact operation
        // the spec called out (`updateInstanceMetadata` overwrite) with the real registry out of scope.
        reg.setMetadataURI(1, "ipfs://QmFirst");
        reg.setMetadataURI(1, "ipfs://QmSecond");
        reg.setMetadataURI(1, "ar://third");
        reg.churn(0xC0FFEE, 64);

        // Unrelated EOA stores different blobs into the SAME image store, mutating its mappings heavily.
        vm.startPrank(address(0xA11CE));
        for (uint256 i = 1; i <= 20; ++i) {
            store.store(_blob(100 + i), "image/png");
        }
        vm.stopPrank();

        // Nuke a lot of foreign storage on the mock registry too.
        reg.churn(0xDECAF, 128);

        // The original blob is untouched by every write above.
        assertEq(store.read(p), original, "stored blob must be independent of all other state writes");
        assertEq(store.pointerOf(keccak256(original)), p, "content index for the blob is stable");
        assertEq(store.mimeOf(p), "image/webp", "recorded mime is stable");
    }

    /// @notice SSTORE2 pointers are created but never destroyed; under EIP-6780 a `SELFDESTRUCT` in a
    /// later transaction cannot clear the code. Sanity: raw SSTORE2 read at the pointer equals the blob.
    function test_Permanence_RawPointerCodeMatchesBlob() public {
        bytes memory data = _blob(2048);
        address p = store.store(data, "image/jpeg");
        assertEq(SSTORE2.read(p), data);
        assertGt(p.code.length, data.length, "pointer holds blob + STOP-byte prefix as code");
    }
}
