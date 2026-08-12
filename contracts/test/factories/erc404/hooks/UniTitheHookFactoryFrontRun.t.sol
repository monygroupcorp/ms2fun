// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { UniTitheHookFactory } from "../../../../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { UniAlignmentV4Hook } from "../../../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { HookAddressMiner } from "../../../../src/factories/erc404/hooks/HookAddressMiner.sol";
import { IAlignmentVault } from "../../../../src/interfaces/IAlignmentVault.sol";

/**
 * @title UniTitheHookFactoryFrontRunTest
 * @notice `deployHook` is permissionless and its arguments are derivable from public state, so the hook
 *         for a pending graduation can be deployed before that graduation runs. These tests hold the line
 *         that such a pre-deploy does not stop the graduation: the second call adopts the hook already at
 *         the deterministic address and returns it, rather than reverting on the CREATE2 collision.
 * @dev No real PoolManager is needed: the hook constructor's `validateHookPermissions()` inspects the
 *      hook's own address bits, and nothing here calls into the manager.
 */
contract UniTitheHookFactoryFrontRunTest is Test {
    UniTitheHookFactory internal factory;

    IPoolManager internal constant DUMMY_PM = IPoolManager(address(0xBEEF));
    address internal constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address internal constant HOOK_OWNER = address(0xB055);

    IAlignmentVault internal constant VAULT = IAlignmentVault(payable(address(0xA17)));
    address internal constant BENEFACTOR = address(0x7777777777777777777777777777777777777777);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000; // 0.3%

    address internal constant OUTSIDER = address(0xDEAD01);
    address internal constant GRADUATION_CALLER = address(0x6A4D);

    event AlignmentHookAdopted(
        address indexed hook, address indexed vault, address indexed benefactor, uint256 hookFeeBips, uint24 lpFeeRate
    );

    function setUp() public {
        factory = new UniTitheHookFactory(DUMMY_PM, WETH, HOOK_OWNER);
    }

    /// @dev The graduation path: a hook pre-deployed by an unrelated caller is adopted, not collided with.
    function test_hook_predeployed_by_another_caller_is_adopted() public {
        vm.prank(OUTSIDER);
        address first = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);

        vm.expectEmit(true, true, true, true, address(factory));
        emit AlignmentHookAdopted(first, address(VAULT), BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        vm.prank(GRADUATION_CALLER);
        address second = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);

        assertEq(second, first, "graduation must receive the hook at the deterministic address");
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(second), "adopted hook must carry exactly 0xCC");
    }

    /// @dev The adopted hook is the hook the graduation asked for: same code, same parameterization. The
    ///      address commits to the init code hash, so nothing else can occupy it.
    function test_adopted_hook_carries_the_requested_parameters() public {
        vm.prank(OUTSIDER);
        address first = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        vm.prank(GRADUATION_CALLER);
        address second = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        assertEq(second, first, "same deterministic address");

        UniAlignmentV4Hook hook = UniAlignmentV4Hook(payable(second));
        assertEq(address(hook.poolManager()), address(DUMMY_PM), "poolManager");
        assertEq(address(hook.vault()), address(VAULT), "vault");
        assertEq(hook.benefactor(), BENEFACTOR, "benefactor");
        assertEq(hook.hookFeeBips(), HOOK_FEE_BIPS, "hookFeeBips");
        assertEq(hook.lpFeeRate(), LP_FEE_RATE, "lpFeeRate");
        assertEq(hook.owner(), HOOK_OWNER, "owner");

        assertGt(second.code.length, 0, "adopted address must hold hook code");
    }

    /// @dev A parameter change re-derives the address, and that fresh address deploys normally — an
    ///      adoption of one parameter set does not block another.
    function test_parameter_change_deploys_a_fresh_hook() public {
        vm.prank(OUTSIDER);
        address first = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);

        address other = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS + 1, LP_FEE_RATE);
        assertTrue(other != first, "a different parameter set must mine a different address");
        assertEq(UniAlignmentV4Hook(payable(other)).hookFeeBips(), HOOK_FEE_BIPS + 1, "fresh hook parameterized");
    }

    /// @dev The deploy lands exactly on the independently derived CREATE2 address. This is the property
    ///      that made the removed `hook != predicted` runtime branch unreachable, and it is what would
    ///      break if the init-code-hash helper and the constructor arguments ever diverged.
    function test_deployed_hook_lands_on_the_independently_derived_address() public {
        bytes32 initCodeHash = HookAddressMiner.computeInitCodeHash(
            type(UniAlignmentV4Hook).creationCode,
            address(DUMMY_PM),
            address(VAULT),
            WETH,
            HOOK_OWNER,
            BENEFACTOR,
            HOOK_FEE_BIPS,
            LP_FEE_RATE
        );
        (bytes32 salt, address predicted) = HookAddressMiner.mineSalt(
            address(factory),
            initCodeHash,
            HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS,
            HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS
        );
        assertEq(
            predicted,
            HookAddressMiner.computeAddress(address(factory), salt, initCodeHash),
            "mine and derivation disagree"
        );

        address deployed = factory.deployHook(VAULT, BENEFACTOR, HOOK_FEE_BIPS, LP_FEE_RATE);
        assertEq(deployed, predicted, "deployed hook must land on the derived address");
    }
}
