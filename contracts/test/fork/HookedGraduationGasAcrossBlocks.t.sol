// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { ForkTestBase } from "./helpers/ForkTestBase.sol";
import { MinerHarness } from "../factories/erc404/hooks/HookMineScanStart.t.sol";
import { UniTitheHookFactory } from "../../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { UniAlignmentV4Hook } from "../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { HookAddressMiner } from "../../src/factories/erc404/hooks/HookAddressMiner.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { MockVault } from "../mocks/MockVault.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";

/**
 * @title HookedGraduationGasAcrossBlocks
 * @notice noesis/hooked-graduation-gas-holds-across-blocks — proves the app's fixed graduation gas
 *         limit (`app/src/lib/graduationGas.ts`'s `GRADUATION_GAS_LIMIT`) covers `UniTitheHookFactory
 *         .deployHook`'s CREATE2 salt mine regardless of which block a graduation lands in, against a
 *         real mainnet fork rather than a synthetic PoolManager/WETH.
 * @dev Fork-gated: `ForkTestBase.loadAddresses()` skips when WETH has no code (no `--fork-url`), as
 *      every other test under `test/fork/`.
 *      Run: forge test --fork-url "$ETHEREUM_RPC_URL" \
 *             --match-path test/fork/HookedGraduationGasAcrossBlocks.t.sol -vvv
 */
contract HookedGraduationGasAcrossBlocksTest is ForkTestBase {
    /// @dev Mirrors `GRADUATION_GAS_LIMIT` in `app/src/lib/graduationGas.ts`. Kept as its own constant
    ///      (not imported — there is no cross-language import) so a change to either side without the
    ///      other shows up as this test's assertions moving out of sync with the app's.
    uint256 internal constant GRADUATION_GAS_LIMIT = 25_000_000;

    address internal constant HOOK_OWNER = address(0xB055);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1% — the mainnet launch tithe.
    uint24 internal constant LP_FEE_RATE = 3000; // 0.3%, matching the pool's static fee.
    address internal constant POOL_TOKEN = address(0xC011);
    int24 internal constant POOL_TICK_SPACING = 60;

    uint160 internal constant REQUIRED = HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS;
    uint160 internal constant FORBIDDEN = HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS;

    UniTitheHookFactory internal factory;
    MinerHarness internal harness;
    MockVault internal vault;

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork
        factory = new UniTitheHookFactory(
            IPoolManager(UNISWAP_V4_POOL_MANAGER), WETH, HOOK_OWNER, address(new MockMasterRegistry())
        );
        harness = new MinerHarness();
        vault = new MockVault();
    }

    /// @notice 20 consecutive graduations, each landing in a different block (fresh `prevrandao` and
    ///         `block.number`, so each draws a different mine window), each sent with exactly the app's
    ///         fixed gas limit instead of a per-block estimate. All 20 must succeed.
    /// @dev Each iteration mines a genuinely fresh hook: `benefactor` varies, so `initCodeHash` — and
    ///      with it the mined window — differs every time, rather than hitting the factory's
    ///      adoption shortcut.
    function test_20_consecutive_hooked_graduations_succeed_at_the_app_gas_limit_across_blocks() public {
        for (uint256 i = 0; i < 20; i++) {
            vm.roll(block.number + 1);
            vm.prevrandao(keccak256(abi.encode("hooked-graduation-fork-rehearsal", i)));
            address benefactor = address(uint160(uint256(keccak256(abi.encode("benefactor", i)))));

            uint256 gasBefore = gasleft();
            address hook = factory.deployHook{ gas: GRADUATION_GAS_LIMIT }(
                IAlignmentVault(payable(address(vault))),
                benefactor,
                HOOK_FEE_BIPS,
                LP_FEE_RATE,
                POOL_TOKEN,
                POOL_TICK_SPACING
            );
            uint256 used = gasBefore - gasleft();

            assertTrue(hook != address(0), "graduation did not deploy a hook");
            assertGt(hook.code.length, 0, "mined address holds no code");
            assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(hook), "mined hook does not carry exactly 0xCC");
            assertLt(used, GRADUATION_GAS_LIMIT, "graduation consumed its entire gas stipend");
        }
    }

    /// @notice The scenario the goal's clause 2 observed on the fork rehearsal: a graduation whose
    ///         block draws a mine that runs deep into `SCAN_WINDOW` before it matches, rather than the
    ///         ~2^14-iteration expectation. Reproduced deterministically — not hoped for by chance —
    ///         by searching `prevrandao` candidates (off-meter) for one whose derived start offset
    ///         mines past a threshold, then replaying that exact block for the real, gas-metered call.
    function test_deep_in_window_salt_match_still_succeeds_within_the_app_gas_limit() public {
        address benefactor = address(uint160(uint256(keccak256("deep-window-benefactor"))));
        uint256 blockNumber = block.number + 1;
        bytes32 initCodeHash = _initCodeHashFor(benefactor);

        uint256 found = type(uint256).max;
        bytes32 foundPrevrandao;
        vm.pauseGasMetering();
        for (uint256 j = 0; j < 4000 && found == type(uint256).max; j++) {
            bytes32 candidatePrevrandao = keccak256(abi.encode("deep-window-search", j));
            uint256 startOffset = uint256(keccak256(abi.encode(candidatePrevrandao, blockNumber, initCodeHash)));
            try harness.mineFrom(address(factory), initCodeHash, REQUIRED, FORBIDDEN, startOffset) returns (
                bytes32 salt, address
            ) {
                uint256 depth = uint256(salt) - startOffset;
                if (depth >= 70_000) {
                    found = depth;
                    foundPrevrandao = candidatePrevrandao;
                }
            } catch {
                // Window exhausted for this candidate block — try the next one.
            }
        }
        vm.resumeGasMetering();
        require(found != type(uint256).max, "no deep-window candidate found within the search budget");

        vm.roll(blockNumber);
        vm.prevrandao(foundPrevrandao);

        uint256 gasBefore = gasleft();
        address hook = factory.deployHook{ gas: GRADUATION_GAS_LIMIT }(
            IAlignmentVault(payable(address(vault))),
            benefactor,
            HOOK_FEE_BIPS,
            LP_FEE_RATE,
            POOL_TOKEN,
            POOL_TICK_SPACING
        );
        uint256 used = gasBefore - gasleft();

        assertTrue(hook != address(0), "deep-window graduation did not deploy a hook");
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(hook), "mined hook does not carry exactly 0xCC");
        assertLt(used, GRADUATION_GAS_LIMIT, "a mine that ran deep into the window still exhausted the stipend");
    }

    /// @dev Mirrors exactly what `UniTitheHookFactory.deployHook` hashes, so the offset this computes
    ///      off-chain for a candidate block is the same one the real call derives on-chain.
    function _initCodeHashFor(address benefactor) internal view returns (bytes32) {
        return HookAddressMiner.computeInitCodeHash(
            type(UniAlignmentV4Hook).creationCode,
            address(UNISWAP_V4_POOL_MANAGER),
            address(vault),
            WETH,
            HOOK_OWNER,
            benefactor,
            HOOK_FEE_BIPS,
            LP_FEE_RATE,
            address(factory.masterRegistry()),
            POOL_TOKEN,
            POOL_TICK_SPACING
        );
    }
}
