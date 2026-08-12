// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console2 } from "forge-std/Test.sol";
import { HookAddressMiner } from "../../../../src/factories/erc404/hooks/HookAddressMiner.sol";

/// @dev The `abi.encodePacked` CREATE2 derivation the miner used before the constant-memory rewrite.
///      Kept in the test tree only, as the reference side of the differential and the quadratic side of
///      the cost comparison.
library AllocatingMiner {
    function computeAddress(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }

    /// @dev The earlier `mineSalt` body, bounded to `n` iterations and run to completion so the cost of a
    ///      mine of exactly that length can be measured.
    function mineLoop(address deployer, bytes32 initCodeHash, uint160 required, uint160 forbidden, uint256 n)
        internal
        pure
        returns (bool hit)
    {
        for (uint256 i = 0; i < n; i++) {
            address a = computeAddress(deployer, bytes32(i), initCodeHash);
            if (HookAddressMiner.hasExactFlags(a, required, forbidden)) hit = true;
        }
    }
}

/// @notice Cost and correctness gates for `HookAddressMiner`'s CREATE2 derivation.
/// @dev Two properties are gated here:
///      1. The constant-memory derivation is byte-identical to the allocating one (differential).
///      2. The per-iteration cost of the mine is constant, so `mineSalt` is O(n) in its iteration count.
///         Restoring a per-iteration allocation makes the mine quadratic and fails `test_mineSalt_*`.
contract HookAddressMinerGasTest is Test {
    /// @dev A (deployer, initCodeHash) pair whose 0xCC mine is deliberately long: 84,719 iterations,
    ///      past the longest mine observed in sampling (55,611). Both values are arbitrary constants
    ///      chosen for that iteration count; nothing depends on them beyond the length of the search.
    address internal constant SLOW_DEPLOYER = address(0x2A);
    bytes32 internal constant SLOW_INIT_CODE_HASH = keccak256("initcode");
    uint256 internal constant SLOW_ITERATIONS = 84_719;

    /// @dev Ceiling for the 84,719-iteration mine. The constant-memory derivation lands far under it;
    ///      the allocating derivation costs hundreds of millions of gas at this length.
    uint256 internal constant MINE_GAS_CEILING = 30_000_000;

    /// @dev The same bounded mine over the constant-memory derivation, for the cost comparison.
    function _constantMemoryMineLoop(uint256 n) internal pure returns (bool hit) {
        for (uint256 i = 0; i < n; i++) {
            address a = HookAddressMiner.computeAddress(SLOW_DEPLOYER, bytes32(i), SLOW_INIT_CODE_HASH);
            if (HookAddressMiner.hasExactFlags(
                    a, HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS, HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS
                )) hit = true;
        }
    }

    function _allocatingMineLoop(uint256 n) internal pure returns (bool) {
        return AllocatingMiner.mineLoop(
            SLOW_DEPLOYER,
            SLOW_INIT_CODE_HASH,
            HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS,
            HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS,
            n
        );
    }

    // --- differential: the constant-memory derivation is byte-identical --------------------------

    function test_computeAddress_matches_allocating_derivation_at_edges() public pure {
        address[3] memory deployers = [address(0), address(type(uint160).max), address(0xBEEF)];
        bytes32[3] memory salts = [bytes32(0), bytes32(type(uint256).max), keccak256("salt")];
        bytes32[3] memory hashes = [bytes32(0), bytes32(type(uint256).max), keccak256("initcode")];

        for (uint256 a = 0; a < deployers.length; a++) {
            for (uint256 b = 0; b < salts.length; b++) {
                for (uint256 c = 0; c < hashes.length; c++) {
                    assertEq(
                        HookAddressMiner.computeAddress(deployers[a], salts[b], hashes[c]),
                        AllocatingMiner.computeAddress(deployers[a], salts[b], hashes[c]),
                        "edge-case derivation diverged"
                    );
                }
            }
        }
    }

    function test_computeAddress_matches_allocating_derivation_over_sample() public pure {
        for (uint256 i = 0; i < 2_000; i++) {
            address deployer = address(uint160(uint256(keccak256(abi.encode("deployer", i)))));
            bytes32 salt = keccak256(abi.encode("salt", i));
            bytes32 initCodeHash = keccak256(abi.encode("initCodeHash", i));
            assertEq(
                HookAddressMiner.computeAddress(deployer, salt, initCodeHash),
                AllocatingMiner.computeAddress(deployer, salt, initCodeHash),
                "sampled derivation diverged"
            );
        }
    }

    function testFuzz_computeAddress_matches_allocating_derivation(address deployer, bytes32 salt, bytes32 ich)
        public
        pure
    {
        assertEq(
            HookAddressMiner.computeAddress(deployer, salt, ich),
            AllocatingMiner.computeAddress(deployer, salt, ich),
            "fuzzed derivation diverged"
        );
    }

    /// @dev The derivation must not move the free-memory pointer: that is the property that makes the
    ///      mine linear, and it is what a reintroduced `abi.encodePacked` would break.
    function test_computeAddress_does_not_allocate() public pure {
        uint256 before_;
        assembly {
            before_ := mload(0x40)
        }
        HookAddressMiner.computeAddress(address(0xBEEF), bytes32(uint256(7)), keccak256("initcode"));
        uint256 after_;
        assembly {
            after_ := mload(0x40)
        }
        assertEq(after_, before_, "derivation allocated memory");
    }

    /// @dev `mineSalt` scans the same sequence as the straightforward form and returns its FIRST hit:
    ///      the returned salt matches, every index below it does not, and the returned address is the
    ///      one `computeAddress` derives for that salt.
    function test_mineSalt_returns_the_first_matching_salt() public pure {
        (bytes32 salt, address predicted) = HookAddressMiner.mineSalt(
            SLOW_DEPLOYER,
            SLOW_INIT_CODE_HASH,
            HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS,
            HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS
        );
        assertEq(
            predicted,
            HookAddressMiner.computeAddress(SLOW_DEPLOYER, salt, SLOW_INIT_CODE_HASH),
            "mined address is not the derivation of the mined salt"
        );
        assertTrue(
            HookAddressMiner.hasExactFlags(
                predicted, HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS, HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS
            ),
            "mined address does not carry exactly the required flags"
        );
        for (uint256 i = 0; i < uint256(salt); i++) {
            address a = HookAddressMiner.computeAddress(SLOW_DEPLOYER, bytes32(i), SLOW_INIT_CODE_HASH);
            assertFalse(
                HookAddressMiner.hasExactFlags(
                    a, HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS, HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS
                ),
                "mine skipped an earlier matching salt"
            );
        }
    }

    // --- cost: the mine is linear in its iteration count -----------------------------------------

    function test_mineSalt_cost_is_linear_in_iterations() public view {
        uint256 g1 = _loopGas(16_384);
        uint256 g2 = _loopGas(32_768);
        // A constant per-iteration cost doubles when the iteration count doubles; quadratic cost
        // quadruples. 2.2x leaves room for the fixed call overhead in the smaller sample.
        assertLt(g2 * 100, g1 * 220, "per-iteration cost is not constant");
    }

    function test_mineSalt_stays_under_gas_ceiling_at_a_long_mine() public {
        uint256 gasBefore = gasleft();
        (bytes32 salt,) = HookAddressMiner.mineSalt(
            SLOW_DEPLOYER,
            SLOW_INIT_CODE_HASH,
            HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS,
            HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS
        );
        uint256 used = gasBefore - gasleft();
        assertEq(uint256(salt), SLOW_ITERATIONS, "fixture no longer mines the expected iteration count");
        console2.log("mineSalt gas at", SLOW_ITERATIONS, "iterations:", used);
        assertLt(used, MINE_GAS_CEILING, "mine exceeded its gas ceiling");
    }

    function test_report_mine_gas_at_reference_iteration_counts() public view {
        uint256[2] memory ns = [uint256(16_384), 55_611];
        for (uint256 i = 0; i < ns.length; i++) {
            uint256 n = ns[i];
            uint256 gasBefore = gasleft();
            _allocatingMineLoop(n);
            uint256 allocating = gasBefore - gasleft();
            console2.log("iterations", n, "allocating gas", allocating);
            console2.log("iterations", n, "constant-memory gas", _loopGas(n));
        }
    }

    function _loopGas(uint256 n) internal view returns (uint256) {
        uint256 gasBefore = gasleft();
        _constantMemoryMineLoop(n);
        return gasBefore - gasleft();
    }
}
