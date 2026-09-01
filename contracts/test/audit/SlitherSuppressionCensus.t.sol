// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

/// @title SlitherSuppressionCensus
/// @notice Pins the `missing-zero-check` Slither suppression census over `contracts/src`, so a new
///         suppression in money code arrives as a decision rather than as a comment.
/// @dev Design notes, each of them load-bearing:
///
///      - **`src` is enumerated with `vm.readDir`, never from a hardcoded file list.** A suppression
///        added in a NEW file must be caught, so discovery is recursive and the discovered `.sol`
///        file count is itself asserted — a directory added below the current depth reds the guard
///        instead of being silently skipped.
///      - **Directives are counted, not substring hits.** A line counts only if, after stripping
///        leading whitespace and a leading `//` or `*`, the remainder begins with `slither-disable`.
///        That excludes NatSpec prose that merely names a rule (the tree already carries such
///        sentences) and admits both the `-next-line` and the `-start` block forms.
///      - **The rule list is split on `,`.** The comma form is common in this tree (up to four rules
///        on one line), so the tail is tokenised rather than matched whole.
///      - **Per-file counts are pinned, not just the total.** A bare total would let a suppression
///        move between files unnoticed.
///      - **No `vm.ffi`.** The census runs in-process off the `read` grant on `./src/` in
///        `foundry.toml`.
contract SlitherSuppressionCensusTest is Test {
    /// @dev The rule under census. Scoped to one rule deliberately: a live example proved this one
    ///      hides real defects. Generalising to a whole-tree suppression census is a separate call.
    string internal constant RULE = "missing-zero-check";

    /// @dev Root of the enumeration, relative to the foundry project root.
    string internal constant SRC = "src";

    /// @dev Recursion depth for `vm.readDir`. The deepest `.sol` in `src` today sits three directory
    ///      levels down (e.g. `src/factories/erc404/hooks/`); this leaves headroom, and
    ///      `EXPECTED_SOL_FILES` is what actually catches a directory added beyond it.
    uint64 internal constant READ_DEPTH = 8;

    /// @dev Number of `.sol` files discovered under `src`. Asserted so that a file — and therefore a
    ///      possible suppression — cannot be added or moved outside the census unnoticed.
    uint256 internal constant EXPECTED_SOL_FILES = 89;

    /// @dev Total `missing-zero-check` directives across `src`.
    uint256 internal constant EXPECTED_TOTAL = 20;

    function _expected() internal pure returns (string[] memory paths, uint256[] memory counts) {
        paths = new string[](9);
        counts = new uint256[](9);

        paths[0] = "src/factories/erc404/LiquidityDeployerModule.sol";
        counts[0] = 1;
        paths[1] = "src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
        counts[1] = 1;
        paths[2] = "src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
        counts[2] = 1;
        paths[3] = "src/peripherals/UniswapVaultPriceValidator.sol";
        counts[3] = 3;
        paths[4] = "src/promotion/PromotionBadges.sol";
        counts[4] = 1;
        paths[5] = "src/treasury/ProtocolTreasuryV1.sol";
        counts[5] = 1;
        paths[6] = "src/vaults/aave/AlignmentEndowmentVaultFactory.sol";
        counts[6] = 4;
        paths[7] = "src/vaults/cypher/CypherAlignmentVault.sol";
        counts[7] = 4;
        paths[8] = "src/vaults/uni/UniAlignmentVaultFactory.sol";
        counts[8] = 4;
    }

    // ── The census ────────────────────────────────────────────────────────

    function test_missingZeroCheckSuppressionCensusIsPinned() public view {
        (string[] memory expectedPaths, uint256[] memory expectedCounts) = _expected();
        bool[] memory seen = new bool[](expectedPaths.length);

        Vm.DirEntry[] memory entries = vm.readDir(SRC, READ_DEPTH);

        // `readDir` reports absolute paths; the pinned table is project-relative.
        string memory root = string.concat(vm.projectRoot(), "/");

        uint256 solFiles;
        uint256 total;

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].isDir) continue;
            string memory absPath = entries[i].path;
            if (!_endsWith(absPath, ".sol")) continue;
            solFiles++;

            assertTrue(_startsWith(absPath, root), string.concat("entry outside the project root: ", absPath));
            string memory path = _slice(bytes(absPath), bytes(root).length, bytes(absPath).length);

            uint256 count = _countDirectives(vm.readFile(absPath));
            if (count == 0) continue;

            (bool pinned, uint256 idx) = _indexOf(expectedPaths, path);
            assertTrue(
                pinned,
                string.concat(
                    "unlisted file carries a `", RULE, "` suppression: ", path, " - adjudicate it, then pin it here"
                )
            );
            assertEq(count, expectedCounts[idx], string.concat("suppression count changed in ", path));
            seen[idx] = true;
            total += count;
        }

        for (uint256 i = 0; i < seen.length; i++) {
            assertTrue(seen[i], string.concat("pinned file no longer carries its suppressions: ", expectedPaths[i]));
        }

        assertEq(solFiles, EXPECTED_SOL_FILES, "the set of .sol files under src changed");
        assertEq(total, EXPECTED_TOTAL, "total missing-zero-check directive count changed");
    }

    // ── Directive parsing ─────────────────────────────────────────────────

    /// @dev Counts `RULE` occurrences in real `slither-disable*` directives within `content`.
    function _countDirectives(string memory content) internal pure returns (uint256 count) {
        string[] memory lines = vm.split(content, "\n");
        for (uint256 i = 0; i < lines.length; i++) {
            count += _directiveHits(lines[i]);
        }
    }

    /// @dev A line contributes only if it is a comment whose first token is `slither-disable*`. The
    ///      tail after that token is the rule list; it is split on `,` and each token trimmed.
    function _directiveHits(string memory line) internal pure returns (uint256 hits) {
        bytes memory b = bytes(_trim(line));
        if (b.length == 0) return 0;

        uint256 start;
        if (b.length >= 2 && b[0] == "/" && b[1] == "/") {
            start = 2;
        } else if (b[0] == "*") {
            start = 1;
        } else {
            return 0; // a directive only ever lives in a comment
        }

        string memory body = _trim(_slice(b, start, b.length));
        if (!_startsWith(body, "slither-disable")) return 0;

        // Everything up to the first space is the directive keyword (`slither-disable-next-line`,
        // `slither-disable-start`, …); everything after it is the comma-separated rule list.
        bytes memory bb = bytes(body);
        uint256 sp = bb.length;
        for (uint256 i = 0; i < bb.length; i++) {
            if (bb[i] == 0x20 || bb[i] == 0x09) {
                sp = i;
                break;
            }
        }
        if (sp == bb.length) return 0; // directive with no rule list

        string[] memory rules = vm.split(_trim(_slice(bb, sp, bb.length)), ",");
        for (uint256 i = 0; i < rules.length; i++) {
            // Trim, then cut at the first whitespace so a trailing rationale on the same line
            // (`missing-zero-check // set once at deploy`) still counts the rule it names.
            bytes memory r = bytes(_trim(rules[i]));
            uint256 end = r.length;
            for (uint256 j = 0; j < r.length; j++) {
                if (r[j] == 0x20 || r[j] == 0x09) {
                    end = j;
                    break;
                }
            }
            if (_eq(_slice(r, 0, end), RULE)) hits++;
        }
    }

    // ── String helpers ────────────────────────────────────────────────────

    function _trim(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 lo;
        uint256 hi = b.length;
        while (lo < hi && _isSpace(b[lo])) lo++;
        while (hi > lo && _isSpace(b[hi - 1])) hi--;
        return _slice(b, lo, hi);
    }

    function _isSpace(bytes1 c) internal pure returns (bool) {
        return c == 0x20 || c == 0x09 || c == 0x0d || c == 0x0a;
    }

    function _slice(bytes memory b, uint256 lo, uint256 hi) internal pure returns (string memory) {
        bytes memory out = new bytes(hi - lo);
        for (uint256 i = lo; i < hi; i++) {
            out[i - lo] = b[i];
        }
        return string(out);
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(prefix);
        if (b.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (b[i] != p[i]) return false;
        }
        return true;
    }

    function _endsWith(string memory s, string memory suffix) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(suffix);
        if (b.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (b[b.length - p.length + i] != p[i]) return false;
        }
        return true;
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _indexOf(string[] memory haystack, string memory needle) internal pure returns (bool, uint256) {
        for (uint256 i = 0; i < haystack.length; i++) {
            if (_eq(haystack[i], needle)) return (true, i);
        }
        return (false, 0);
    }
}
