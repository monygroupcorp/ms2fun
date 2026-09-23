// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { DeploySepolia } from "../../script/DeploySepolia.s.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { UniTitheHookFactory } from "../../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { IComponentRegistry } from "../../src/registry/interfaces/IComponentRegistry.sol";
import { FeatureUtils } from "../../src/master/libraries/FeatureUtils.sol";

/// @notice The Sepolia deployment's perpetual swap tithe, read back off the configuration that is
///         actually deployed rather than off a hand-wired fixture.
///
///         WHAT THIS IS FOR. The tithe is one owner call away from being on, and every part of that
///         call fails silently:
///
///           - `hookFeeBips` left at its zero default mints hooks that take nothing, immutably and
///             forever, on every pool that graduates after the switch. Nothing reverts and nothing
///             logs a warning; the pool simply is not taxed.
///           - `setAlignmentHookFactory` accepts any address, including one the component registry
///             does not approve under the alignment-hook tag and one bound to a different
///             PoolManager. Both produce graduations that revert, long after the call.
///           - the call is `onlyOwner`, and `MigrateOwnership` moves that owner to the governance
///             Timelock. Made after the handover from the deployer key it reverts `Unauthorized()`,
///             which is the ordering constraint the runbook's step order exists to satisfy.
///
///         `test/hooks/UniAlignmentV4Hook_RealSettlement.t.sol` proves the mechanism: a graduation
///         through a hooked pool tithes the ETH side of a real swap to the vault. It builds its
///         module and its factory by hand, which is right for a mechanism proof and is exactly what
///         leaves the deployed configuration unexamined. This file is the other half — the rate the
///         Sepolia script carries, the factory `DeployCore` registers, and the owner who can throw
///         the switch — and it asserts nothing about swap mechanics.
contract SepoliaAlignmentTitheTest is Test {
    address constant STUB = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    DeployCore internal s;
    LiquidityDeployerModule internal module;
    IComponentRegistry internal registry;

    /// @dev The deployer is the script contract here (no broadcast), so it is also the module owner.
    address internal deployer;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STUB, RETURN_TRUE);

        s = new DeployCore();
        deployer = address(s);
        s.deploy(deployer, _config());

        module = LiquidityDeployerModule(payable(s.moduleUniV4Deployer()));
        registry = IComponentRegistry(address(s.componentRegistry()));
    }

    // ── The rate the Sepolia script carries ──────────────────────────────────

    /// @dev The one assertion that would have caught the original gap from the other side: the switch
    ///      can be thrown over a zero rate, and a zero rate is what `NetworkConfig` defaults to. Read
    ///      from the script's own config rather than from the runbook's table.
    function test_theSepoliaConfigCarriesALiveTitheRate() public {
        DeployCore.NetworkConfig memory cfg = new SepoliaConfigHarness().config();
        assertGt(cfg.hookFeeBips, 0, "cfg.hookFeeBips zero: enabling the tithe would mint hooks that take nothing");
        assertLe(cfg.hookFeeBips, 10_000, "cfg.hookFeeBips above 100% is rejected by the module's own setter");
        assertGt(cfg.lpFeeRate, 0, "cfg.lpFeeRate zero: the hooked pool is dynamic-fee and would charge no LP fee");
    }

    /// @dev The hooked pool trades on the same tier an untaxed graduation would. Stated as a test
    ///      because the two values are set ten lines apart and a change to one silently reprices every
    ///      pool graduated after the switch relative to every pool graduated before it.
    function test_theHookedPoolTradesOnTheSameTierAsAnUntaxedGraduation() public {
        DeployCore.NetworkConfig memory cfg = new SepoliaConfigHarness().config();
        assertEq(
            uint256(cfg.lpFeeRate), uint256(cfg.zrouterFee), "the hook's LP-fee override must match the static tier"
        );
    }

    // ── What the deploy leaves behind: registered, and OFF ───────────────────

    function test_theDeployShipsTheTitheOff() public view {
        assertEq(
            module.alignmentHookFactory(),
            address(0),
            "the module must ship OFF - turning the tithe on is a call somebody makes, not a deploy-time write"
        );
    }

    function test_theDeploySeedsTheRateOntoTheModule() public {
        DeployCore.NetworkConfig memory cfg = _config();
        assertEq(module.hookFeeBips(), cfg.hookFeeBips, "the module's rate is the config's");
        assertEq(uint256(module.lpFeeRate()), uint256(cfg.lpFeeRate), "the module's LP-fee override is the config's");
    }

    /// @dev The factory has to be findable without being written down anywhere: it is not in the
    ///      deployment JSON, so the component registry's tag is the only record of which address the
    ///      switch should point at. `EnableAlignmentTithe` resolves it exactly this way.
    function test_theHookFactoryIsRegisteredUnderTheAlignmentHookTag() public view {
        address factory = s.uniTitheHookFactory();
        assertTrue(factory != address(0), "the deploy must stand up a tithe hook factory");
        assertTrue(
            registry.isApprovedForTag(factory, FeatureUtils.ALIGNMENT_HOOK), "factory registered under ALIGNMENT_HOOK"
        );

        address[] memory approved = registry.getApprovedComponentsByTag(FeatureUtils.ALIGNMENT_HOOK);
        assertEq(approved.length, 1, "exactly one alignment-hook factory, so the switch has one answer");
        assertEq(approved[0], factory, "and it is the one the deploy stood up");
    }

    /// @dev A registry-approved factory bound to a different PoolManager or WETH mints hooks this
    ///      module's pools cannot use, and nothing between the registration and the first graduation
    ///      would say so.
    function test_theRegisteredFactoryBindsTheModulesOwnVenue() public view {
        UniTitheHookFactory factory = UniTitheHookFactory(s.uniTitheHookFactory());
        assertEq(address(factory.poolManager()), address(module.v4PoolManager()), "same PoolManager as the module");
        assertEq(factory.weth(), module.weth(), "same WETH as the module");
        assertEq(factory.masterRegistry(), address(s.masterRegistry()), "the registry the hook reads retirements from");
    }

    // ── The switch, and who may throw it ─────────────────────────────────────

    function test_theGovernedCallTurnsTheTitheOn() public {
        address factory = registry.getApprovedComponentsByTag(FeatureUtils.ALIGNMENT_HOOK)[0];

        vm.prank(deployer);
        module.setAlignmentHookFactory(factory);

        assertEq(module.alignmentHookFactory(), factory, "the switch is on and points at the registered factory");
    }

    /// @dev ORDERING. This is the whole reason the enable step is placed where it is: once
    ///      `MigrateOwnership` has moved the module, no key on earth can make this call, and a runbook
    ///      that enables after the handover without going through governance is a step that reverts.
    function test_afterTheHandoverOnlyTheTimelockMayThrowTheSwitch() public {
        address timelock = address(0x71E10C);
        address factory = registry.getApprovedComponentsByTag(FeatureUtils.ALIGNMENT_HOOK)[0];

        vm.prank(deployer);
        module.transferOwnership(timelock);

        vm.prank(deployer);
        vm.expectRevert(Ownable.Unauthorized.selector);
        module.setAlignmentHookFactory(factory);

        vm.prank(timelock);
        module.setAlignmentHookFactory(factory);
        assertEq(module.alignmentHookFactory(), factory, "the governed call lands from the new owner");
    }

    /// @dev Turning it back off is the same call with a zero, and it is the only lever there is: pools
    ///      that already graduated keep their hooks. Asserted so the runbook's "how to stop it" line
    ///      describes something that works.
    function test_theSwitchTurnsBackOff() public {
        address factory = registry.getApprovedComponentsByTag(FeatureUtils.ALIGNMENT_HOOK)[0];

        vm.prank(deployer);
        module.setAlignmentHookFactory(factory);
        vm.prank(deployer);
        module.setAlignmentHookFactory(address(0));

        assertEq(module.alignmentHookFactory(), address(0), "back to the untaxed static-fee graduation");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// @dev Sepolia's tithe parameters over a locally-deployable network shape. The addresses cannot
    ///      be Sepolia's (nothing holds code here and the salt set is guarded to one broadcaster), so
    ///      what is carried across is the pair under test, read from the script itself.
    function _config() internal returns (DeployCore.NetworkConfig memory cfg) {
        DeployCore.NetworkConfig memory sepolia = new SepoliaConfigHarness().config();

        cfg.chainId = 1337;
        cfg.weth = STUB;
        cfg.v4PoolManager = address(1); // non-zero: DeployCore reads a zero as "no Uni rail here"
        cfg.safe = address(0);
        cfg.saltMasterRegistry = bytes32(uint256(1));
        cfg.saltTreasury = bytes32(uint256(2));
        cfg.saltQueueManager = bytes32(uint256(3));
        cfg.saltGlobalMsgReg = bytes32(uint256(4));
        cfg.saltAlignmentReg = bytes32(uint256(5));
        cfg.saltComponentReg = bytes32(uint256(6));
        cfg.priceDeviationBps = sepolia.priceDeviationBps;
        cfg.twapSeconds = sepolia.twapSeconds;
        cfg.zrouterFee = sepolia.zrouterFee;
        cfg.zrouterTickSpacing = sepolia.zrouterTickSpacing;
        cfg.hookFeeBips = sepolia.hookFeeBips;
        cfg.lpFeeRate = sepolia.lpFeeRate;
        cfg.alignmentTargets = new DeployCore.AlignmentTargetConfig[](0);
        cfg.jsonOutputPath = "";
    }
}

/// @dev `_sepoliaConfig()` is `internal` — it is the script's statement of the network, not an API.
///      Inheriting is how a test reads it without widening that. Same shape as `MainnetConfigHarness`.
contract SepoliaConfigHarness is DeploySepolia {
    function config() external pure returns (NetworkConfig memory) {
        return _sepoliaConfig();
    }
}
