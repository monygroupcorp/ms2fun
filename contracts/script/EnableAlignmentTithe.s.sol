// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { LiquidityDeployerModule } from "../src/factories/erc404/LiquidityDeployerModule.sol";
import { IComponentRegistry } from "../src/registry/interfaces/IComponentRegistry.sol";
import { IAlignmentHookFactory } from "../src/factories/erc404/hooks/IAlignmentHookFactory.sol";
import { FeatureUtils } from "../src/master/libraries/FeatureUtils.sol";

/// @title EnableAlignmentTithe
/// @notice Throws the one switch that turns the perpetual post-graduation swap tithe ON, and reads
///         the result back.
///
/// @dev WHAT THE SWITCH IS. `DeployCore` deploys the Uni-V4 tithe hook factory, registers it under
///      the `ALIGNMENT_HOOK` component tag, and copies the tithe rate onto the singleton
///      `LiquidityDeployerModule` — and then stops, leaving `alignmentHookFactory` at `address(0)`.
///      In that position a graduation opens a static-fee pool with no hook: the community receives
///      the one-time cut at graduation and nothing on the trading that follows. One owner call,
///      `setAlignmentHookFactory(factory)`, is the whole difference, and every graduation after it
///      mints that pool its own hook and starts taking `hookFeeBips` of the ETH side of every swap.
///
///      WHY IT IS A SCRIPT AND NOT A LINE IN THE DEPLOY. The switch is an owner call, and the owner
///      does not stay the same address: `MigrateOwnership` hands the module to the governance
///      Timelock. So the call has two shapes depending on when it is made, and the script carries
///      both rather than assuming one:
///
///        BEFORE the handover, the deployer still owns the module — `run()`, broadcast as the
///        deployer, is the whole operation.
///
///        AFTER the handover, no key can make this call: the owner is a contract. `printEnableBatch()`
///        emits the exact (target, calldata) pair for the Safe to propose and the Timelock to execute.
///
///      The testnet deployment takes the second path on purpose. The first is a deploy-time write by
///      an EOA; the second is the governed parameter change mainnet will actually perform, and a
///      testnet run that only ever exercises the EOA form rehearses a call mainnet cannot make.
///
///      WHAT IT REFUSES TO DO. `setAlignmentHookFactory` is a bare setter: it accepts any address and
///      does not look at the rate the hooks will be minted with. Two silent misconfigurations follow
///      from that, and both produce a pool that looks taxed and is not:
///
///        - a zero `hookFeeBips` mints hooks that take zero on every swap, forever, immutably;
///        - a factory that is not the registered one, or a factory bound to a different PoolManager
///          or WETH than the module's, mints hooks the module's own pools cannot use.
///
///      Neither reverts on its own and neither is repairable for a pool that has already graduated,
///      because a hook's rate and bindings are fixed in its init code. So this script checks both
///      before it will produce the call, in `_resolve`, and `verify()` checks them again afterwards
///      against the chain.
///
///      TURNING IT BACK OFF is the same call with `address(0)`, and it is not a rollback: pools that
///      graduated while the switch was on keep their hooks and keep tithing. It stops the NEXT
///      graduation from minting one.
contract EnableAlignmentTithe is Script {
    /// @dev The module whose graduations the switch governs — the singleton Uni-V4 liquidity deployer.
    ///      Same env name `MigrateOwnership` reads it under, so one export serves both.
    string internal constant ENV_MODULE = "MODULE_UNIV4_DEPLOYER";

    /// @dev The registry the hook factory is resolved from, rather than being named by hand. Same env
    ///      name `MigrateOwnership` reads it under.
    string internal constant ENV_COMPONENT_REGISTRY = "COMPONENT_REGISTRY";

    /// @dev Optional. Set it only where the registry carries more than one `ALIGNMENT_HOOK` factory
    ///      and the choice between them has to be made by a person; it must still be one the registry
    ///      approves under that tag, and `_resolve` checks that rather than trusting the variable.
    string internal constant ENV_HOOK_FACTORY = "ALIGNMENT_HOOK_FACTORY";

    /// @dev setAlignmentHookFactory(address) — the Timelock-side calldata `printEnableBatch` emits.
    bytes4 internal constant SET_ALIGNMENT_HOOK_FACTORY = LiquidityDeployerModule.setAlignmentHookFactory.selector;

    /// @notice Phase-1-equivalent helper (no broadcast). Emits the single call the Safe/Timelock must
    ///         execute to turn the tithe on, for a deployment whose ownership has already moved.
    /// @dev The checks in `_resolve` run first, so a batch is printed only for a configuration that
    ///      would actually tithe. A governance proposal is the most expensive place to discover that
    ///      the rate under it was zero.
    function printEnableBatch() external view {
        (LiquidityDeployerModule module, address factory) = _resolve();
        console.log("=== The Timelock must execute this call ===");
        console.log("  target:", address(module));
        console.log("  calldata:");
        console.logBytes(abi.encodeWithSelector(SET_ALIGNMENT_HOOK_FACTORY, factory));
        console.log("  (setAlignmentHookFactory, pointing the module at)", factory);
        console.log("After it executes, read the result back: forge script EnableAlignmentTithe --sig \"verify()\"");
    }

    /// @notice Throw the switch, as the module's CURRENT owner.
    /// @dev Only usable while that owner is a key — i.e. BEFORE `MigrateOwnership` has run. Once the
    ///      Timelock owns the module this reverts `Unauthorized()`, which is the correct outcome and
    ///      not a fault: use `printEnableBatch()` and govern the call. `_verify` runs inside the same
    ///      broadcast, so a switch that did not land fails in simulation rather than on chain.
    function run() external {
        (LiquidityDeployerModule module, address factory) = _resolve();
        vm.startBroadcast();
        module.setAlignmentHookFactory(factory);
        _verify();
        vm.stopBroadcast();
        console.log("alignment tithe ON: module", address(module), "-> hook factory", factory);
    }

    /// @notice Assert the switch is on and the configuration under it can actually tithe. Callable on
    ///         its own against a live deployment, so a runbook can tick it, and so "the tithe is on"
    ///         is something somebody read off the chain rather than something somebody remembers
    ///         proposing.
    function verify() external view {
        _verify();
    }

    /// @dev The assertions. Every message names what failed, so a half-thrown switch says which part.
    function _verify() internal view {
        LiquidityDeployerModule module = LiquidityDeployerModule(payable(vm.envAddress(ENV_MODULE)));
        (, address expected) = _resolve();

        address wired = module.alignmentHookFactory();
        require(wired != address(0), "EnableAlignmentTithe: the tithe is still OFF (alignmentHookFactory is zero)");
        require(wired == expected, "EnableAlignmentTithe: the module points at a factory the registry does not approve");
        // Re-read the rate from the chain rather than from `_resolve`'s copy: the pair is what the
        // hooks are minted with, and a rate set to zero after the switch was thrown turns every LATER
        // graduation into an untaxed pool while this reads on.
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
    ///      pair will actually produce a tithing pool. Shared by all three entry points so the batch
    ///      that is printed, the call that is broadcast and the state that is verified are checked
    ///      against one set of rules.
    function _resolve() internal view returns (LiquidityDeployerModule module, address factory) {
        module = LiquidityDeployerModule(payable(vm.envAddress(ENV_MODULE)));
        require(address(module).code.length != 0, "EnableAlignmentTithe: MODULE_UNIV4_DEPLOYER holds no code");

        // A zero rate is the misconfiguration with no symptom: the switch goes on, graduations mint
        // hooks, swaps route through them, and the vault is credited nothing. Refuse before the call
        // exists rather than after a pool has graduated under it.
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

        // The factory's environment is immutable and set when it was deployed. A factory bound to a
        // different PoolManager mints hooks that no pool of this module can initialize, and one bound
        // to a different WETH mints hooks that misread the ETH side. Both are registry-approved and
        // both pass every other check, so they are checked here.
        require(
            address(ITitheFactoryBindings(factory).poolManager()) == address(module.v4PoolManager()),
            "EnableAlignmentTithe: the hook factory binds a different PoolManager than the module"
        );
        require(
            ITitheFactoryBindings(factory).weth() == module.weth(),
            "EnableAlignmentTithe: the hook factory binds a different WETH than the module"
        );

        // A last look at the type itself: the flags a hook of this type must carry. A factory that
        // cannot answer is not an alignment-hook factory whatever the registry says about it.
        (uint160 required,) = IAlignmentHookFactory(factory).hookFlags();
        require(required != 0, "EnableAlignmentTithe: the hook factory declares no required permission bits");
    }
}

/// @dev The two immutables `IAlignmentHookFactory` does not carry, because they are configuration of a
///      particular factory rather than part of the type's surface. Declared here rather than widening
///      that interface for a check only the enable step makes.
interface ITitheFactoryBindings {
    function poolManager() external view returns (address);
    function weth() external view returns (address);
}
