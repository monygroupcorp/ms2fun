// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MetadataUtils
 * @notice Utility functions for metadata handling
 */
library MetadataUtils {
    /**
     * @notice Validate metadata URI format
     * @dev Scheme allowlist (rth 2026-07-22): content-addressed `ipfs://`/`ar://` and hosted
     *      `https://` are accepted. `data:` is accepted ONLY when media-typed as `data:image/` or
     *      `data:application/json` — on-chain-permanent metadata is kept, but the `data:text/html,`
     *      / `data:application/javascript,` stored-XSS forms are rejected at the contract boundary.
     *      `http://` is dropped entirely (browser-mixed-content-blocked, plaintext, mutable).
     * @param uri Metadata URI to validate
     * @return True if URI is valid
     */
    function isValidURI(string memory uri) internal pure returns (bool) {
        bytes memory uriBytes = bytes(uri);
        if (uriBytes.length == 0) return false;

        // Content-addressed and hosted schemes.
        if (startsWith(uri, "https://") || startsWith(uri, "ipfs://") || startsWith(uri, "ar://")) {
            return true;
        }

        // `data:` is admitted only for image or JSON media types; `data:text/html`, bare `data:`,
        // and any other media type are rejected to close the stored-XSS surface on-chain.
        if (startsWith(uri, "data:image/") || startsWith(uri, "data:application/json")) {
            return true;
        }

        return false;
    }

    /**
     * @notice Check if string starts with prefix
     * @param str String to check
     * @param prefix Prefix to check for
     * @return True if string starts with prefix
     */
    function startsWith(string memory str, string memory prefix) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        bytes memory prefixBytes = bytes(prefix);

        if (prefixBytes.length > strBytes.length) {
            return false;
        }

        for (uint256 i = 0; i < prefixBytes.length; i++) {
            if (strBytes[i] != prefixBytes[i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Validate name for URL safety (case-insensitive)
     * @dev COUPLING INVARIANT (paired with {toNameHash} — the two define slug uniqueness together):
     *      the charset admitted HERE must be fully normalized by {toNameHash} with case-folding as the
     *      ONLY normalization. Every admitted byte either passes through unchanged or is an ASCII
     *      `A-Z` that folds to `a-z`; no two distinct admitted names may collide under {toNameHash}
     *      except by that intended case-fold. Widening this charset (e.g. unicode, extra separators)
     *      WITHOUT matching {toNameHash} would produce homoglyph collisions or case-variant splits — a
     *      silent namespace-integrity bug, not a compile error. Edit both functions in lockstep.
     * @param name Name to validate
     * @return True if name is valid
     */
    function isValidName(string memory name) internal pure returns (bool) {
        bytes memory nameBytes = bytes(name);

        if (nameBytes.length == 0 || nameBytes.length > 64) {
            return false;
        }

        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];

            // Allow alphanumeric and hyphens/underscores
            if (!((char >= 0x30 && char <= 0x39) // 0-9
                        || (char >= 0x41 && char <= 0x5A) // A-Z
                        || (char >= 0x61 && char <= 0x7A) // a-z
                        || char == 0x2D // -
                        || char == 0x5F)) {
                // _
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Convert string to lowercase bytes32 hash
     * @dev COUPLING INVARIANT (paired with {isValidName} — the two define slug uniqueness together):
     *      case-folding ASCII `A-Z`→`a-z` is the ONLY normalization applied here; all other admitted
     *      bytes pass through to keccak unchanged. This must round-trip the exact charset {isValidName}
     *      admits, so `"Foo"`/`"foo"`/`"FOO"` collide by design while `"foo-bar"`/`"foo_bar"` stay
     *      distinct. If {isValidName}'s charset is widened, extend this normalization in lockstep or
     *      slug uniqueness silently breaks (see the invariant note on {isValidName}).
     * @param str String to hash
     * @return Hash of lowercase string
     */
    function toNameHash(string memory str) internal pure returns (bytes32) {
        bytes memory strBytes = bytes(str);
        bytes memory lowerBytes = new bytes(strBytes.length);

        for (uint256 i = 0; i < strBytes.length; i++) {
            bytes1 char = strBytes[i];
            if (char >= 0x41 && char <= 0x5A) {
                // Convert uppercase to lowercase
                lowerBytes[i] = bytes1(uint8(char) + 32);
            } else {
                lowerBytes[i] = char;
            }
        }

        return keccak256(lowerBytes);
    }
}

