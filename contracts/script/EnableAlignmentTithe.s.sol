// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { LiquidityDeployerModule } from "../src/factories/erc404/LiquidityDeployerModule.sol";
import { IComponentRegistry } from "../src/registry/interfaces/IComponentRegistry.sol";
import { IAlignmentHookFactory } from "../src/factories/erc404/hooks/IAlignmentHookFactory.sol";
import { FeatureUtils } from "../src/master/libraries/FeatureUtils.sol";

/// @title EnableAlignmentTithe
/// @notice Throws the one switch that turns the perpetual post-graduation swap tithe on, and reads
///         the result back.
///
/// @dev The switch. `DeployCore` deploys the Uni-V4 tithe hook factory, registers it under the
///      `ALIGNMENT_HOOK` component tag, and copies the tithe rate onto the singleton
///      `LiquidityDeployerModule`, leaving `alignmentHookFactory` at `address(0)`. In that position a
///      graduation opens a static-fee pool with no hook: the community receives the one-time cut at
///      graduation and nothing on the trading that follows. One owner call,
///      `setAlignmentHookFactory(factory)`, makes every later graduation mint its pool a hook that
///      takes `hookFeeBips` of the ETH side of every swap.
///
///      Why a script. The module's owner changes: `MigrateOwnership` hands it to the governance
///      Timelock. The script carries both shapes of the call:
///
///        Before the handover the deployer owns the module, and `run()`, broadcast as the deployer,
///        is the whole operation.
///
///        After the handover the owner is a contract, so no key can make the call.
///        `printEnableBatch()` emits the exact (target, calldata) pair for the Safe to propose and
///        the Timelock to execute. The testnet deployment takes this path, the governed change
///        mainnet performs.
///
///      What it refuses. `setAlignmentHookFactory` is a bare setter: it accepts any address and does
///      not look at the rate the hooks will be minted with. Two silent misconfigurations follow, and
///      both produce a pool that looks taxed and is not:
///
///        - a zero `hookFeeBips` mints hooks that take zero on every swap, immutably;
///        - a factory that is not the registered one, or one bound to a different PoolManager or WETH
///          than the module's, mints hooks the module's own pools cannot use.
///
///      Neither reverts on its own and neither is repairable for a pool that has already graduated,
///      because a hook's rate and bindings are fixed in its init code. `_resolve` checks both before
///      the call is produced, and `verify()` checks them again against the chain.
///
///      Turning it off is the same call with `address(0)`. Pools that graduated while the switch was
///      on keep their hooks and keep tithing; it stops the next graduation from minting one.
contract EnableAlignmentTithe is Script {
    /// @dev The module whose graduations the switch governs: the singleton Uni-V4 liquidity deployer.
    ///      `MigrateOwnership` reads it under the same env name.
    string internal constant ENV_MODULE = "MODULE_UNIV4_DEPLOYER";

    /// @dev The registry the hook factory is resolved from. `MigrateOwnership` reads it under the same env name.
    string internal constant ENV_COMPONENT_REGISTRY = "COMPONENT_REGISTRY";

    /// @dev Optional. Names the factory where the registry carries more than one `ALIGNMENT_HOOK`
    ///      factory; `_resolve` checks the registry approves it under that tag.
    string internal constant ENV_HOOK_FACTORY = "ALIGNMENT_HOOK_FACTORY";

    /// @dev setAlignmentHookFactory(address) — the Timelock-side calldata `printEnableBatch` emits.
    bytes4 internal constant SET_ALIGNMENT_HOOK_FACTORY = LiquidityDeployerModule.setAlignmentHookFactory.selector;

    /// @notice Emits, without broadcasting, the single call the Safe/Timelock must execute to turn the
    ///         tithe on for a deployment whose ownership has already moved.
    /// @dev The checks in `_resolve` run first, so a batch is printed only for a configuration that
    ///      would actually tithe.
    function printEnableBatch() external view {
        (LiquidityDeployerModule module, address factory) = _resolve();
        console.log("=== The Timelock must execute this call ===");
        console.log("  target:", address(module));
        console.log("  calldata:");
        console.logBytes(abi.encodeWithSelector(SET_ALIGNMENT_HOOK_FACTORY, factory));
        console.log("  (setAlignmentHookFactory, pointing the module at)", factory);
        console.log("After it executes, read the result back: forge script EnableAlignmentTithe --sig \"verify()\"");
    }

    /// @notice Throw the switch, as the module's current owner.
    /// @dev Usable only while that owner is a key, before `MigrateOwnership` has run. Once the
    ///      Timelock owns the module this reverts `Unauthorized()`; use `printEnableBatch()` and
    ///      govern the call. `_verify` runs inside the same broadcast, so a switch that did not land
    ///      fails in simulation.
    function run() external {
        (LiquidityDeployerModule module, address factory) = _resolve();
        vm.startBroadcast();
        module.setAlignmentHookFactory(factory);
        _verify();
        vm.stopBroadcast();
        console.log("alignment tithe ON: module", address(module), "-> hook factory", factory);
    }

    /// @notice Assert the switch is on and the configuration under it can actually tithe. Callable on
    ///         its own against a live deployment.
    function verify() external view {
        _verify();
    }

    /// @dev The assertions; each message names what failed.
    function _verify() internal view {
        LiquidityDeployerModule module = LiquidityDeployerModule(payable(vm.envAddress(ENV_MODULE)));
        (, address expected) = _resolve();

        address wired = module.alignmentHookFactory();
        require(wired != address(0), "EnableAlignmentTithe: the tithe is still OFF (alignmentHookFactory is zero)");
        require(wired == expected, "EnableAlignmentTithe: the module points at a factory the registry does not approve");
        // The rate is re-read from the chain: it is what hooks are minted with, and a rate set to
        // zero after the switch was thrown turns every later graduation into an untaxed pool.
        require(module.hookFeeBips() != 0, "EnableAlignmentTithe: hookFeeBips is zero - hooks would tithe nothing");
        require(
            module.lpFeeRate() != 0, "EnableAlignmentTithe: lpFeeRate is zero - the hooked pool would charge no LP fee"
        );

        console.log("alignment tithe is ON");
        console.log("  module:      ", address(module));
        console.log("  hook factory:", wired);
        console.log("  hookFeeBips: ", module.hookFeeBips());
        console.log("  lpFeeRate:   ", module.lpFeeRate());
    }

    /// @dev The module, and the hook factory the switch should point it at, with every check that the
    ///      pair will produce a tithing pool. All three entry points share it, so the printed batch,
    ///      the broadcast call and the verified state obey one set of rules.
    function _resolve() internal view returns (LiquidityDeployerModule module, address factory) {
        module = LiquidityDeployerModule(payable(vm.envAddress(ENV_MODULE)));
        require(address(module).code.length != 0, "EnableAlignmentTithe: MODULE_UNIV4_DEPLOYER holds no code");

        // A zero rate has no symptom: graduations mint hooks, swaps route through them, and the vault
        // is credited nothing. Refused before the call exists.
        require(
            module.hookFeeBips() != 0,
            "EnableAlignmentTithe: hookFeeBips is zero - set the rate before the switch, or every hook minted takes nothing"
        );
        require(
            module.lpFeeRate() != 0,
            "EnableAlignmentTithe: lpFeeRate is zero - a hooked pool is dynamic-fee and would charge no LP fee"
        );

        IComponentRegistry registry = IComponentRegistry(vm.envAddress(ENV_COMPONENT_REGISTRY));
        factory = vm.envOr(ENV_HOOK_FACTORY, address(0));
        if (factory == address(0)) {
            address[] memory approved = registry.getApprovedComponentsByTag(FeatureUtils.ALIGNMENT_HOOK);
            require(
                approved.length != 0, "EnableAlignmentTithe: no ALIGNMENT_HOOK factory is registered on this deployment"
            );
            require(
                approved.length == 1,
                "EnableAlignmentTithe: more than one ALIGNMENT_HOOK factory is registered - name the one to use in ALIGNMENT_HOOK_FACTORY"
            );
            factory = approved[0];
        } else {
            require(
                registry.isApprovedForTag(factory, FeatureUtils.ALIGNMENT_HOOK),
                "EnableAlignmentTithe: ALIGNMENT_HOOK_FACTORY is not registered under the alignment-hook tag"
            );
        }

        // The factory's bindings are immutable. A different PoolManager mints hooks that no pool of
        // this module can initialize, and a different WETH mints hooks that misread the ETH side;
        // both can be registry-approved and pass every other check.
        require(
            address(ITitheFactoryBindings(factory).poolManager()) == address(module.v4PoolManager()),
            "EnableAlignmentTithe: the hook factory binds a different PoolManager than the module"
        );
        require(
            ITitheFactoryBindings(factory).weth() == module.weth(),
            "EnableAlignmentTithe: the hook factory binds a different WETH than the module"
        );

        // A factory that cannot report its required hook flags is not an alignment-hook factory
        // whatever the registry says.
        (uint160 required,) = IAlignmentHookFactory(factory).hookFlags();
        require(required != 0, "EnableAlignmentTithe: the hook factory declares no required permission bits");
    }
}

/// @dev The two immutables `IAlignmentHookFactory` does not carry: they are configuration of a
///      particular factory, not part of the type's surface.
interface ITitheFactoryBindings {
    function poolManager() external view returns (address);
    function weth() external view returns (address);
}
