// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { UniTitheHookFactory } from "../../../../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { UniAlignmentV4Hook } from "../../../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { HookAddressMiner } from "../../../../src/factories/erc404/hooks/HookAddressMiner.sol";
import { IAlignmentVault } from "../../../../src/interfaces/IAlignmentVault.sol";

/// @dev External wrapper so a mine can be measured and its revert matched. Library internal functions
///      are inlined into the caller, so a failing mine would otherwise unwind the test itself.
contract MinerHarness {
    function mineFrom(address deployer, bytes32 initCodeHash, uint160 required, uint160 forbidden, uint256 startOffset)
        external
        pure
        returns (bytes32 salt, address predicted)
    {
        return HookAddressMiner.mineSalt(deployer, initCodeHash, required, forbidden, startOffset);
    }
}

/**
 * @title HookMineScanStartTest
 * @notice The hook-address mine scans a bounded window that starts at a caller-supplied offset, and the
 *         factory derives that offset from block entropy. Two properties depend on it:
 *         a mine that does not fit in one block is RETRYABLE (a later block scans different salts), and
 *         its failure is a named revert rather than an out-of-gas.
 * @dev These are the regression gates for that behaviour. Each one is written so it fails if the
 *      mechanism it covers is removed — see the individual docstrings.
 */
contract HookMineScanStartTest is Test {
    UniTitheHookFactory internal factory;
    MinerHarness internal harness;

    IPoolManager internal constant DUMMY_PM = IPoolManager(address(0xBEEF));
    address internal constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address internal constant HOOK_OWNER = address(0xB055);

    IAlignmentVault internal constant VAULT = IAlignmentVault(payable(address(0xA17)));
    address internal constant BENEFACTOR = address(0x7777777777777777777777777777777777777777);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000; // 0.3%

    /// @dev `deployedHook` is the factory's first (and only) storage variable: immutables and constants
    ///      occupy no slots, so the mapping's base slot is 0. `_clearAdoption` asserts the slot really
    ///      holds the entry before wiping it, so a future storage layout change fails here loudly rather
    ///      than turning the tests below into no-ops.
    uint256 internal constant DEPLOYED_HOOK_SLOT = 0;

    uint160 internal constant REQUIRED = HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS;
    uint160 internal constant FORBIDDEN = HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS;

    event AlignmentHookAdopted(
        address indexed hook, address indexed vault, address indexed benefactor, uint256 hookFeeBips, uint24 lpFeeRate
    );

    function setUp() public {
        factory = new UniTitheHookFactory(DUMMY_PM, WETH, HOOK_OWNER);
        harness = new MinerHarness();
    }

    // --- library: the offset is honoured, and the window is bounded ------------------------------

    /// @dev A nonzero offset must still produce an address carrying EXACTLY the required bits. If the
    ///      offset were applied to the salt but not to the flag test — or if it perturbed the preimage
    ///      layout — this is what would catch it.
    function test_nonzero_offsets_still_yield_exactly_valid_addresses() public view {
        bytes32 initCodeHash = keccak256("initcode");
        uint256[5] memory offsets =
            [uint256(1), 7_919, 1_000_000, type(uint128).max, uint256(keccak256("some block entropy"))];

        for (uint256 i = 0; i < offsets.length; i++) {
            (bytes32 salt, address predicted) =
                harness.mineFrom(address(factory), initCodeHash, REQUIRED, FORBIDDEN, offsets[i]);
            assertGe(uint256(salt), offsets[i], "mine returned a salt below its start offset");
            assertLt(uint256(salt), offsets[i] + HookAddressMiner.SCAN_WINDOW, "mine ran past its window");
            assertEq(
                predicted,
                HookAddressMiner.computeAddress(address(factory), salt, initCodeHash),
                "mined address is not the derivation of the mined salt"
            );
            assertTrue(
                HookAddressMiner.hasExactFlags(predicted, REQUIRED, FORBIDDEN),
                "mined address does not carry exactly the required flags"
            );
        }
    }

    /// @dev Different offsets must find DIFFERENT salts for the same (deployer, initCodeHash). This is
    ///      the property that makes a retry a new search rather than a replay of the failed one, so
    ///      inequality is asserted, not merely validity. The offsets are spaced much further apart than
    ///      `SCAN_WINDOW`, so an implementation that honoured the offset cannot coincidentally collide,
    ///      and one that ignored it would return the same salt three times and fail here.
    function test_different_offsets_produce_different_salts() public view {
        bytes32 initCodeHash = keccak256("initcode");
        (bytes32 saltA, address addrA) = harness.mineFrom(address(factory), initCodeHash, REQUIRED, FORBIDDEN, 1);
        (bytes32 saltB, address addrB) =
            harness.mineFrom(address(factory), initCodeHash, REQUIRED, FORBIDDEN, 1_000_000);
        (bytes32 saltC, address addrC) =
            harness.mineFrom(address(factory), initCodeHash, REQUIRED, FORBIDDEN, type(uint128).max);

        assertTrue(saltA != saltB, "offsets A and B found the same salt");
        assertTrue(saltB != saltC, "offsets B and C found the same salt");
        assertTrue(saltA != saltC, "offsets A and C found the same salt");
        assertTrue(addrA != addrB && addrB != addrC && addrA != addrC, "distinct salts must give distinct addresses");
    }

    /// @dev The window is the operating bound; MAX_ITERATIONS is the runaway bound. The first must fit
    ///      inside the second, or the offset-less overload would be the tighter of the two.
    function test_scan_window_fits_within_the_runaway_bound() public pure {
        assertLe(HookAddressMiner.SCAN_WINDOW, HookAddressMiner.MAX_ITERATIONS, "window exceeds the runaway bound");
    }

    /// @dev An unsatisfiable constraint (a bit both required and forbidden can never hold for any
    ///      address) drives the scan to the end of its window. The window exists so that ending is a
    ///      cheap named revert inside a block, not an out-of-gas that consumes the whole limit: the error
    ///      is matched exactly, and the gas consumed is asserted to be under a 30M block.
    function test_exhausted_window_reverts_named_and_within_a_block() public {
        bytes32 initCodeHash = keccak256("initcode");
        uint160 contradictory = uint160(0x80); // beforeSwap bit, marked BOTH required and forbidden

        uint256 gasBefore = gasleft();
        try harness.mineFrom(address(factory), initCodeHash, contradictory, contradictory, 12_345) {
            fail();
        } catch (bytes memory err) {
            uint256 used = gasBefore - gasleft();
            assertEq(
                err,
                abi.encodeWithSelector(
                    HookAddressMiner.NoValidSaltFound.selector, HookAddressMiner.SCAN_WINDOW, contradictory
                ),
                "an exhausted window must revert NoValidSaltFound with the scanned length"
            );
            assertLt(used, 30_000_000, "an exhausted window must fit inside a block");
        }
    }

    // --- factory: the offset varies per block, and adoption survives it --------------------------

    /// @dev The factory must not scan from a fixed point. Deploy once, wipe the adoption entry so the
    ///      next call actually mines, roll `prevrandao` and `number`, and the mine must land somewhere
    ///      else. This is the test that fails if the entropy is ever "simplified" to a constant.
    function test_factory_offset_varies_with_the_block() public {
        address first = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        _clearAdoption(BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE, first);

        vm.roll(block.number + 1);
        vm.prevrandao(bytes32(uint256(0xF00DBEEF)));

        address second = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        assertTrue(second != first, "a later block must scan a different window and mine a different address");
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(second), "second hook must carry exactly 0xCC");
        assertGt(second.code.length, 0, "second hook must be deployed");
    }

    /// @dev Adoption must survive the varying offset. Two `deployHook` calls for the same parameters,
    ///      across a roll of `prevrandao` and `number`, must return the SAME hook, emit
    ///      `AlignmentHookAdopted`, and deploy nothing new.
    ///
    ///      This is precisely the regression the identity mapping exists to catch: with adoption keyed on
    ///      the mined address alone, the second call would mine a different address, find no code there,
    ///      and deploy a duplicate hook — so removing the mapping and leaving only the
    ///      `predicted.code.length` check makes this test fail.
    function test_adoption_survives_a_changed_block() public {
        address first = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        uint256 codeSizeBefore = first.code.length;

        vm.roll(block.number + 1);
        vm.prevrandao(bytes32(uint256(0xF00DBEEF)));

        vm.expectEmit(true, true, true, true, address(factory));
        emit AlignmentHookAdopted(first, address(VAULT), BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        address second = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);

        assertEq(second, first, "a later block must adopt the existing hook, not mine a duplicate");
        assertEq(second.code.length, codeSizeBefore, "adoption must not deploy anything");
        assertEq(factory.deployedHook(_initCodeHash(BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE)), first, "mapping entry");
    }

    /// @dev An adoption reads the mapping BEFORE mining, so it must be far cheaper than the deploy that
    ///      preceded it — the mine is not paid twice.
    function test_adoption_pays_no_mining_gas() public {
        factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);

        vm.roll(block.number + 1);
        uint256 gasBefore = gasleft();
        factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        uint256 used = gasBefore - gasleft();

        // A mine of even a single expected run is ~3M gas at ~2^14 iterations; an adoption is a mapping
        // read, an event and a return.
        assertLt(used, 100_000, "adoption must not run the mine");
    }

    /// @dev Distinct parameterizations keep distinct mapping entries, so adopting one never shadows
    ///      another.
    function test_distinct_parameterizations_get_distinct_entries() public {
        address a = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        address b = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS + 1, LP_FEE_RATE);
        assertTrue(a != b, "distinct parameterizations must yield distinct hooks");
        assertEq(factory.deployedHook(_initCodeHash(BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE)), a, "entry a");
        assertEq(factory.deployedHook(_initCodeHash(BENEFACTOR, HOOK_FEE_BIPS + 1, LP_FEE_RATE)), b, "entry b");
    }

    // --- helpers --------------------------------------------------------------------------------

    function _initCodeHash(address benefactor, uint256 hookFeeBips, uint24 lpFeeRate) internal pure returns (bytes32) {
        return HookAddressMiner.computeInitCodeHash(
            type(UniAlignmentV4Hook).creationCode,
            address(DUMMY_PM),
            address(VAULT),
            WETH,
            HOOK_OWNER,
            benefactor,
            hookFeeBips,
            lpFeeRate
        );
    }

    /// @dev Wipe the factory's adoption entry so the next `deployHook` for these parameters mines again.
    ///      Asserts the slot held the expected hook first, so the wipe is never silently a no-op.
    function _clearAdoption(address benefactor, uint256 hookFeeBips, uint24 lpFeeRate, address expected) internal {
        bytes32 slot = keccak256(abi.encode(_initCodeHash(benefactor, hookFeeBips, lpFeeRate), DEPLOYED_HOOK_SLOT));
        assertEq(
            address(uint160(uint256(vm.load(address(factory), slot)))),
            expected,
            "adoption entry is not at the assumed storage slot"
        );
        vm.store(address(factory), slot, bytes32(0));
    }
}
