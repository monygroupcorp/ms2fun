// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SSTORE2 } from "solady/utils/SSTORE2.sol";
import { Base64 } from "solady/utils/Base64.sol";

/// @title OnchainImageStore
/// @notice Permanent, permissionless on-chain image storage via SSTORE2.
///
/// @dev Creators who pay to put a cover image on-chain get permanence here at a fraction of the gas of a
/// base64 `data:` URI in collection metadata. SSTORE2 writes the raw bytes as the runtime code of a
/// throwaway contract (~200 gas/byte code deposit vs ~690 gas/byte `SSTORE`) and reads them back with
/// `EXTCODECOPY`. Base64 is applied only on read, inside a `view`, so the 33% base64 storage tax is not paid.
///
/// @dev Stored blobs are permanent. Since EIP-6780 (Cancun), `SELFDESTRUCT` only clears code when the
/// contract is created and destroyed in the same transaction. An SSTORE2 pointer is created in `store` and
/// never destroyed, so neither the uploader, nor this contract, nor its deployer can unmake or overwrite a
/// stored blob. There is no owner, admin, upgrade path or pause. An unwanted image is suppressed by a
/// client-side denylist, never by an on-chain takedown. Callers must treat every `store` as irreversible.
///
/// @dev The MIME allowlist is a security control. `dataUri` emits a `data:<mime>;base64,...` string that
/// downstream consumers render directly. If an arbitrary `mime` were allowed, an uploader could store
/// `text/html` (or any active content type) and have it rendered as trusted markup by a consumer that
/// drops the URI into an `<img>`/`<iframe>`. The allowlist is restricted to inert raster image types so
/// the store cannot smuggle executable content; it excludes `application/json` and document types.
contract OnchainImageStore {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @dev Maximum accepted blob length in bytes. EIP-170 caps deployed contract code at 24,576 bytes.
    /// SSTORE2 prefixes the blob with a single STOP opcode (so the pointer can never be `CALL`ed as code),
    /// so the deployed code is `data.length + 1` bytes. A `data.length` of exactly 24,576 produces 24,577
    /// bytes of code, which exceeds EIP-170, and SSTORE2 reverts `DeploymentFailed`; that boundary is
    /// rejected by SSTORE2/EIP-170, not by `BlobTooLarge`. The last length that round-trips is 24,575.
    /// A local node raising `--code-size-limit` does not change this on mainnet.
    uint256 internal constant MAX_BLOB_BYTES = 24_576;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Content-address index: `keccak256(data) => SSTORE2 pointer`. Used for dedup.
    mapping(bytes32 => address) public pointerOf;

    /// @notice The mime type recorded for a given pointer, set once at first store.
    mapping(address => string) public mimeOf;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted once, on the first store of a given content hash. A dedup hit emits nothing.
    /// @param contentHash keccak256 of the stored bytes (the denylist key).
    /// @param pointer The SSTORE2 storage-contract address holding the bytes.
    /// @param size Length of the stored bytes.
    /// @param uploader The account that first stored these bytes. Recorded for attribution ONLY —
    /// it grants no rights and gates nothing, since the blob is permanent and unowned.
    event BlobStored(bytes32 indexed contentHash, address indexed pointer, uint256 size, address indexed uploader);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev Thrown when `data.length == 0`.
    error EmptyBlob();

    /// @dev Thrown when `data.length > MAX_BLOB_BYTES`.
    error BlobTooLarge();

    /// @dev Thrown when `mime` is not in the raster-image allowlist.
    error MimeNotAllowed();

    /// @dev Thrown when `dataUri` is queried for a pointer that was never stored here.
    error UnknownPointer();

    /*//////////////////////////////////////////////////////////////
                                  WRITE
    //////////////////////////////////////////////////////////////*/

    /// @notice Permanently store `data` on-chain and index it by content hash. Permissionless.
    /// @dev Content-addressed dedup: a repeat store of identical bytes writes nothing new, emits no
    /// event, and returns the existing pointer at roughly the cost of a warm `SLOAD`. Because the index
    /// key is `keccak256(data)`, a content-hash denylist catches re-uploads by any account. The `mime` on a dedup hit is ignored — the mime recorded at first store is authoritative.
    /// @param data The raw image bytes. Must be in the range `(0, 24_576]` (see `MAX_BLOB_BYTES`).
    /// @param mime One of `image/webp`, `image/png`, `image/jpeg`, `image/gif`. Anything else reverts.
    /// @return pointer The SSTORE2 storage-contract address holding `data`.
    function store(bytes calldata data, string calldata mime) external returns (address pointer) {
        if (data.length == 0) revert EmptyBlob();
        if (data.length > MAX_BLOB_BYTES) revert BlobTooLarge();
        if (!_isAllowedMime(mime)) revert MimeNotAllowed();

        bytes32 contentHash = keccak256(data);
        pointer = pointerOf[contentHash];
        if (pointer != address(0)) return pointer; // dedup hit: no new write, no event

        pointer = SSTORE2.write(data);
        pointerOf[contentHash] = pointer;
        mimeOf[pointer] = mime;
        emit BlobStored(contentHash, pointer, data.length, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                                  READ
    //////////////////////////////////////////////////////////////*/

    /// @notice Read back the raw bytes stored at `pointer`.
    /// @dev These bytes are permanent and independent of every other storage write in the system.
    function read(address pointer) external view returns (bytes memory) {
        return SSTORE2.read(pointer);
    }

    /// @notice Build a `data:<mime>;base64,<...>` URI for a stored image.
    /// @dev Base64 is applied on read (free in a `view`), so no base64 tax is paid at storage time.
    /// Reverts `UnknownPointer` if `pointer` was never stored here — this keeps the mime allowlist
    /// meaningful, since a URI is only ever emitted for a pointer with an allowlisted mime on record.
    function dataUri(address pointer) external view returns (string memory) {
        string memory mime = mimeOf[pointer];
        if (bytes(mime).length == 0) revert UnknownPointer();
        return string.concat("data:", mime, ";base64,", Base64.encode(SSTORE2.read(pointer)));
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Raster-image allowlist; see the contract-level NatSpec.
    function _isAllowedMime(string calldata mime) internal pure returns (bool) {
        bytes32 h = keccak256(bytes(mime));
        return h == keccak256("image/webp") || h == keccak256("image/png") || h == keccak256("image/jpeg")
            || h == keccak256("image/gif");
    }
}
