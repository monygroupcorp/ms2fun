// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Test-only merkle builder that reproduces, on-chain, the exact leaf/hash scheme the
///         MerkleGatingModule verifies against — double-hashed (address, maxQty) leaves + Solady
///         commutative sorted-pair internal nodes. Mirrors app/src/lib/merkle.ts (extended to maxQty).
///         Lets a test compute a root and a caller's proof without any off-chain tooling.
contract MerkleAllowlistHelper {
    struct Entry {
        address user;
        uint256 maxQty;
    }

    /// @dev leaf = keccak256(bytes.concat(keccak256(abi.encode(user, maxQty)))) — byte-identical to the module.
    function leafOf(address user, uint256 maxQty) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))));
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Ascending insertion sort by uint256 value (== big-endian byte order == merkle.ts sort).
    function _sort(bytes32[] memory a) private pure returns (bytes32[] memory) {
        for (uint256 i = 1; i < a.length; i++) {
            bytes32 key = a[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > key) {
                a[j] = a[j - 1];
                j--;
            }
            a[j] = key;
        }
        return a;
    }

    function _push(bytes32[] memory arr, bytes32 v) private pure returns (bytes32[] memory out) {
        out = new bytes32[](arr.length + 1);
        for (uint256 i = 0; i < arr.length; i++) {
            out[i] = arr[i];
        }
        out[arr.length] = v;
    }

    /// @notice Build the root over `entries` and the merkle proof for `entries[targetIndex]`.
    /// @dev Entries need not be pre-sorted; leaves are sorted deterministically before building, exactly
    ///      like the off-chain builder. Requires distinct leaves (distinct (user, maxQty) pairs).
    function build(Entry[] memory entries, uint256 targetIndex)
        public
        pure
        returns (bytes32 root, bytes32[] memory proof, uint256 maxQty)
    {
        maxQty = entries[targetIndex].maxQty;
        bytes32 target = leafOf(entries[targetIndex].user, entries[targetIndex].maxQty);

        bytes32[] memory leaves = new bytes32[](entries.length);
        for (uint256 i = 0; i < entries.length; i++) {
            leaves[i] = leafOf(entries[i].user, entries[i].maxQty);
        }
        bytes32[] memory layer = _sort(leaves);

        // Locate target in the sorted layer.
        uint256 index = type(uint256).max;
        for (uint256 i = 0; i < layer.length; i++) {
            if (layer[i] == target) {
                index = i;
                break;
            }
        }
        require(index != type(uint256).max, "target not in set");

        proof = new bytes32[](0);
        while (layer.length > 1) {
            uint256 nextLen = (layer.length + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 i = 0; i < layer.length; i += 2) {
                bytes32 a = layer[i];
                bytes32 b = (i + 1 < layer.length) ? layer[i + 1] : layer[i];
                next[i / 2] = _hashPair(a, b);
                if (i == index) {
                    proof = _push(proof, b);
                } else if (i + 1 == index) {
                    proof = _push(proof, a);
                }
            }
            index = index / 2;
            layer = next;
        }
        root = layer[0];
    }

    /// @notice Convenience: root only.
    function rootOf(Entry[] memory entries) public pure returns (bytes32 root) {
        (root,,) = build(entries, 0);
    }

    /// @notice Encode canMint `data`: abi.encode(tierId, maxQty, proof).
    function encodeData(uint256 tierId, uint256 maxQty, bytes32[] memory proof) public pure returns (bytes memory) {
        return abi.encode(tierId, maxQty, proof);
    }
}
