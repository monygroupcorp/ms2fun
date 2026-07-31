// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SafeResolverLib } from "../../src/metadata/SafeResolverLib.sol";
import { MockHostileResolver } from "../mocks/MockHostileResolver.sol";

/// @dev A resolver whose `resolve` returns a fixed, well-formed ABI string.
contract GoodResolver {
    string internal s;

    constructor(string memory _s) {
        s = _s;
    }

    function resolve(address, uint256, address) external view returns (string memory) {
        return s;
    }
}

/// @dev A resolver that returns ARBITRARY raw bytes as the call's returndata, so a test can craft any
///      ABI framing (well-formed, offset-wrong, length-overrun, truncated, empty) the decoder must survive.
contract RawResolver {
    bytes internal data;

    constructor(bytes memory d) {
        data = d;
    }

    function resolve(address, uint256, address) external view returns (string memory) {
        bytes memory d = data;
        assembly {
            return(add(d, 0x20), mload(d))
        }
    }
}

/// @title SafeResolverLib unit tests (noesis-107)
/// @notice Exercises the guarded staticcall+decode directly on every return shape: a valid string, a
///         decodable empty string (decline), a revert, an out-of-gas (gas-bomb), a wrong offset, a
///         length-overrun (the 2**256-1 malformed probe), a truncated payload, and empty returndata /
///         a code-less address. Every failure shape must degrade to `(false, "")` — never revert.
contract SafeResolverLibTest is Test {
    address constant INST = address(0x1111);
    address constant HOLDER = address(0xB0B);
    uint256 constant ID = 7;

    function _try(address r) internal view returns (bool ok, string memory aug) {
        return SafeResolverLib.tryResolve(r, INST, ID, HOLDER);
    }

    // ── Happy paths ──────────────────────────────────────────────────────────────

    function test_validString_decodes() public {
        GoodResolver r = new GoodResolver("augmented-uri");
        (bool ok, string memory aug) = _try(address(r));
        assertTrue(ok, "well-formed string must decode");
        assertEq(aug, "augmented-uri");
    }

    function test_decodableEmptyString_isDeclineNotBrick() public {
        // abi.encode(string("")) is well-framed (offset 0x20, length 0) → ok=true, aug="" (a valid decline).
        RawResolver r = new RawResolver(abi.encode(string("")));
        (bool ok, string memory aug) = _try(address(r));
        assertTrue(ok, "empty-but-framed string is a valid decodable decline");
        assertEq(bytes(aug).length, 0);
    }

    // ── Hostile / failure shapes — all must degrade to (false, "") ─────────────────

    function test_revertingResolver_degrades() public {
        MockHostileResolver r = new MockHostileResolver(MockHostileResolver.Mode.REVERT);
        (bool ok, string memory aug) = _try(address(r));
        assertFalse(ok, "a reverting resolver degrades");
        assertEq(bytes(aug).length, 0);
    }

    function test_gasBombResolver_degrades() public {
        MockHostileResolver r = new MockHostileResolver(MockHostileResolver.Mode.GAS_BOMB);
        (bool ok, string memory aug) = _try(address(r));
        assertFalse(ok, "an OOG resolver degrades (caller survives on the 1/64 EIP-150 gas)");
        assertEq(bytes(aug).length, 0);
    }

    function test_malformedLengthOverrun_degrades() public {
        // The classic probe: offset 0x20, length = 2**256-1 — the mock's MALFORMED mode.
        MockHostileResolver r = new MockHostileResolver(MockHostileResolver.Mode.MALFORMED);
        (bool ok, string memory aug) = _try(address(r));
        assertFalse(ok, "length-overrun return must degrade, not revert the read");
        assertEq(bytes(aug).length, 0);
    }

    function test_wrongOffset_degrades() public {
        // offset = 0x40 (non-canonical) → rejected before decode.
        RawResolver r = new RawResolver(abi.encodePacked(uint256(0x40), uint256(3), bytes32("abc")));
        (bool ok,) = _try(address(r));
        assertFalse(ok, "non-0x20 offset must degrade");
    }

    function test_truncatedPayload_degrades() public {
        // offset 0x20, claims length 100, but only ~10 payload bytes follow → overrun → degrade.
        RawResolver r = new RawResolver(abi.encodePacked(uint256(0x20), uint256(100), bytes10("abcdefghij")));
        (bool ok,) = _try(address(r));
        assertFalse(ok, "truncated payload (claimed len > returndata) must degrade");
    }

    function test_headOnlyNoLengthWord_degrades() public {
        // Only a single word of returndata (< 64 bytes) — not even a full offset+length head.
        RawResolver r = new RawResolver(abi.encodePacked(uint256(0x20)));
        (bool ok,) = _try(address(r));
        assertFalse(ok, "sub-64-byte returndata must degrade");
    }

    function test_emptyReturndata_degrades() public {
        RawResolver r = new RawResolver("");
        (bool ok,) = _try(address(r));
        assertFalse(ok, "empty returndata must degrade");
    }

    function test_codelessAddress_degrades() public {
        // A low-level staticcall to an address with no code succeeds with empty returndata → degrade.
        (bool ok, string memory aug) = _try(address(0xDEAD));
        assertFalse(ok, "code-less resolver must degrade (no explicit code.length guard needed)");
        assertEq(bytes(aug).length, 0);
    }
}
