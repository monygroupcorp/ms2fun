// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { EnableAlignmentTithe } from "../../script/EnableAlignmentTithe.s.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { IComponentRegistry } from "../../src/registry/interfaces/IComponentRegistry.sol";
import { HookAddressMiner } from "../../src/factories/erc404/hooks/HookAddressMiner.sol";

/// @dev Test-only subclass exposing `EnableAlignmentTithe`'s env-driven resolution and the selector
///      its printed batch is built from, so both can be exercised as the real script code. The two
///      entry points a runbook actually calls — `printEnableBatch()` and `verify()` — are already
///      external on the script and are driven here as they ship.
contract EnableAlignmentTitheHarness is EnableAlignmentTithe {
    /// @dev `_resolve` on its own: the module, and the factory the switch should point at, after every
    ///      check the script makes before it will produce a call.
    function resolve() external view returns (address module, address factory) {
        (LiquidityDeployerModule m, address f) = _resolve();
        return (address(m), f);
    }

    /// @dev The selector `printEnableBatch` encodes its calldata with, so a test can execute the pair
    ///      the script would have printed rather than a hand-written re-spelling of it.
    function setterSelector() external pure returns (bytes4) {
        return SET_ALIGNMENT_HOOK_FACTORY;
    }
}

/// @notice The test for `script/EnableAlignmentTithe.s.sol` — the one script that performs the launch
///         step turning the perpetual post-graduation swap tithe ON.
///
///         WHY IT NEEDS ONE. The script is almost entirely refusals: `setAlignmentHookFactory` is a
///         bare setter that accepts any address and never looks at the rate the hooks will be minted
///         with, so everything standing between an operator and a pool that looks taxed and is not
///         lives in `_resolve` and `_verify`. A refusal nothing executes is a comment: before this
///         file, deleting every guard in that script left the whole suite green. Each test below is
///         written to red when one guard is removed, which is the only property that makes it worth
///         keeping.
///
///         THE FIXTURE is the deployed configuration rather than a hand-wired one: `DeployCore` stands
///         up the module, seeds the rate onto it, deploys the Uni-V4 tithe hook factory, registers it
///         under the `ALIGNMENT_HOOK` tag — and leaves the switch OFF, which is exactly the position
///         the script is pointed at. Every misconfiguration below is then made ON TOP of that, through
///         the module's own owner-only setters, the registry's own revocation call, or code etched at
///         the registered factory's address, so what each test refuses is a state a real operator
///         could reach.
///
///         ONE ENV VALUE FOR THE WHOLE RUN, AND WHY. `vm.setEnv` writes the process environment: it is
///         not EVM state, it is not rolled back between tests, and `setUp` runs once per suite rather
///         than once per test. Forge also runs a suite's test functions in parallel. So an
///         `ALIGNMENT_HOOK_FACTORY` that differs per test is a data race and not a fixture: whichever
///         test writes it last wins, and a test that never writes it reads what another test left
///         behind. The variable is written exactly once, to the factory `DeployCore` registered, and every
///         per-test difference is EVM state at that one address. The cost is stated where it lands:
///         `_resolve`'s registry-lookup branch (the `ALIGNMENT_HOOK_FACTORY`-unset path, and the two
///         `approved.length` refusals in it) is not reachable from this file.
///
///         The same reasoning covers the two variables this file shares with `MigrateOwnershipTest`:
///         both fixtures deploy from the same address with the same salts, so both write the SAME
///         module and registry addresses and the sharing is harmless. A fixture change that moved
///         either address in one file and not the other would make the two suites race.
contract EnableAlignmentTitheTest is Test {
    address constant STUB = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    /// @dev The rate the fixture deploys with. Any non-zero pair serves; this is the shape the live
    ///      networks carry (1% of the ETH swap leg, a 0.30% dynamic LP fee).
    uint256 constant HOOK_FEE_BIPS = 100;
    uint24 constant LP_FEE_RATE = 3000;

    DeployCore internal s;
    EnableAlignmentTitheHarness internal h;
    LiquidityDeployerModule internal module;
    IComponentRegistry internal registry;

    /// @dev The deploy runs with no broadcast, so the script contract is the deployer and therefore the
    ///      owner of both the module and the component registry.
    address internal deployer;

    /// @dev The factory `DeployCore` registered under `ALIGNMENT_HOOK`, and the address
    ///      `ALIGNMENT_HOOK_FACTORY` names for every test in this file.
    address internal registeredFactory;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STUB, RETURN_TRUE);

        s = new DeployCore();
        deployer = address(s);
        s.deploy(deployer, _config());

        module = LiquidityDeployerModule(payable(s.moduleUniV4Deployer()));
        registry = IComponentRegistry(address(s.componentRegistry()));
        registeredFactory = s.uniTitheHookFactory();
        h = new EnableAlignmentTitheHarness();

        // The env the script reads. Mirrors what the operator exports from the deployment JSON — and
        // is written here, once, for the reason given in the contract note above.
        vm.setEnv("MODULE_UNIV4_DEPLOYER", vm.toString(address(module)));
        vm.setEnv("COMPONENT_REGISTRY", vm.toString(address(registry)));
        vm.setEnv("ALIGNMENT_HOOK_FACTORY", vm.toString(registeredFactory));
    }

    // ── The happy path: the script resolves, prints a batch, and reads the result back ─────────────

    /// @dev The factory is in no deployment JSON, so the registry's tag is the only record of which
    ///      address the switch should point at, and producing it is the script's first job.
    function test_resolve_findsTheModuleAndTheRegisteredFactory() public view {
        (address resolvedModule, address factory) = h.resolve();
        assertEq(resolvedModule, address(module), "the module the env names");
        assertEq(factory, registeredFactory, "the factory the registry approves under ALIGNMENT_HOOK");
    }

    /// @notice The whole loop, over a correctly configured deployment: the script prints the batch, the
    ///         batch it printed is executable by the module's owner, and `verify()` — the script's own
    ///         read-back, the one a runbook ticks — returns against the result.
    ///
    /// @dev A suite of refusals alone passes just as well when the script never works, so the call is
    ///      not re-spelled here: the target and the calldata are the ones `printEnableBatch` emits,
    ///      built from the script's own resolution and its own selector, and executed as written.
    function test_theScriptPrintsABatchThatTurnsTheTitheOn() public {
        h.printEnableBatch();

        (address target, address factory) = h.resolve();
        bytes memory callData = abi.encodeWithSelector(h.setterSelector(), factory);

        vm.prank(deployer);
        (bool ok,) = target.call(callData);
        assertTrue(ok, "the printed batch must be executable by the module's owner");

        assertEq(
            module.alignmentHookFactory(), registeredFactory, "the switch is on, pointing at the registered factory"
        );
        assertEq(module.hookFeeBips(), HOOK_FEE_BIPS, "and the rate under it is the deploy's");

        // Returns rather than reverting — the assertion the runbook's read-back step makes.
        h.verify();
    }

    // ── `_resolve`: the two zero-rate refusals ────────────────────────────────────────────────────

    /// @dev A zero `hookFeeBips` is the misconfiguration with no symptom: the switch goes on,
    ///      graduations mint hooks, swaps route through them, and the vault is credited nothing —
    ///      immutably, because a hook's rate is fixed in its init code. The refusal has to happen
    ///      before the call exists, so it is asserted on the batch-printing path.
    function test_resolve_refusesToPrintABatchOverAZeroHookFeeBips() public {
        vm.prank(deployer);
        module.setHookFeeBips(0);

        vm.expectRevert(
            bytes(
                "EnableAlignmentTithe: hookFeeBips is zero - set the rate before the switch, or every hook minted takes nothing"
            )
        );
        h.printEnableBatch();
    }

    /// @dev A hooked pool is a dynamic-fee pool: the hook's `beforeSwap` overrides the fee with
    ///      `lpFeeRate`, so a zero there charges no LP fee at all on every pool graduated after the
    ///      switch.
    function test_resolve_refusesToPrintABatchOverAZeroLpFeeRate() public {
        vm.prank(deployer);
        module.setLpFeeRate(0);

        vm.expectRevert(
            bytes("EnableAlignmentTithe: lpFeeRate is zero - a hooked pool is dynamic-fee and would charge no LP fee")
        );
        h.printEnableBatch();
    }

    // ── `_resolve`: an operator-supplied factory is still checked against the registry ─────────────

    /// @dev `ALIGNMENT_HOOK_FACTORY` exists so a person can choose between hook types where more than
    ///      one is registered — not so a person can name an address the registry does not stand behind.
    ///      The address here is the real factory with every binding correct, revoked as governance
    ///      could revoke it, so the registry check is the only thing between it and a printed batch.
    function test_resolve_refusesAnOperatorSuppliedFactoryTheRegistryDoesNotApprove() public {
        vm.prank(deployer);
        registry.revokeComponent(registeredFactory);

        vm.expectRevert(
            bytes("EnableAlignmentTithe: ALIGNMENT_HOOK_FACTORY is not registered under the alignment-hook tag")
        );
        h.printEnableBatch();
    }

    // ── `_resolve`: the bindings are immutable, so they are checked before the switch, not after ───

    /// @dev A factory bound to another PoolManager is registry-approved and passes every other check,
    ///      and the hooks it mints cannot initialize a pool of this module. Nothing between the
    ///      registration and the first graduation after the switch would say so.
    function test_resolve_refusesAFactoryBoundToADifferentPoolManager() public {
        _rebindRegisteredFactory(address(0xDEAD), module.weth(), HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS);

        vm.expectRevert(bytes("EnableAlignmentTithe: the hook factory binds a different PoolManager than the module"));
        h.printEnableBatch();
    }

    /// @dev The same argument one field over: a hook bound to a different WETH misreads the ETH side of
    ///      every swap it tithes.
    function test_resolve_refusesAFactoryBoundToADifferentWeth() public {
        _rebindRegisteredFactory(
            address(module.v4PoolManager()), address(0xBEEF), HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS
        );

        vm.expectRevert(bytes("EnableAlignmentTithe: the hook factory binds a different WETH than the module"));
        h.printEnableBatch();
    }

    // ── `_resolve`: the hook type declares itself ─────────────────────────────────────────────────

    /// @dev A contract that answers `hookFlags()` with nothing set is not an alignment-hook factory,
    ///      whatever the registry says about it.
    function test_resolve_refusesAFactoryDeclaringNoRequiredPermissionBits() public {
        _rebindRegisteredFactory(address(module.v4PoolManager()), module.weth(), 0);

        vm.expectRevert(bytes("EnableAlignmentTithe: the hook factory declares no required permission bits"));
        h.printEnableBatch();
    }

    /// @notice The deliberate weakness, pinned as intent rather than tightened: the flags check is
    ///         `required != 0` and NOT `required == ULTRA_ALIGNMENT_HOOK_FLAGS`, because the switch has
    ///         to stay able to select a hook TYPE other than the one shipped today. A factory declaring
    ///         some other non-zero permission set resolves, and that is the design.
    ///
    /// @dev Stated here so that narrowing the check to today's flags fails a test that says why,
    ///      instead of looking like a strengthening nobody objected to.
    function test_resolve_acceptsAnotherHookTypesPermissionBits() public {
        uint160 otherTypeFlags = HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS >> 1;
        assertTrue(otherTypeFlags != 0, "the stand-in must declare something");
        assertTrue(otherTypeFlags != HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS, "and it must not be today's set");

        _rebindRegisteredFactory(address(module.v4PoolManager()), module.weth(), otherTypeFlags);

        (, address factory) = h.resolve();
        assertEq(factory, registeredFactory, "a second hook type must remain selectable");
    }

    // ── `_verify`: the read-back ──────────────────────────────────────────────────────────────────

    /// @notice The live trap: a deployment where the switch was never thrown and one where it was look
    ///         identical from every other read on the page. `DeployCore` ships the module OFF, so this
    ///         is the state the fixture is already in — and `verify()` must refuse it rather than
    ///         return.
    function test_verify_refusesASwitchThatWasNeverThrown() public {
        assertEq(module.alignmentHookFactory(), address(0), "the fixture must start OFF");

        vm.expectRevert(bytes("EnableAlignmentTithe: the tithe is still OFF (alignmentHookFactory is zero)"));
        h.verify();
    }

    /// @dev `setAlignmentHookFactory` accepts any address, so "the tithe is on" and "the tithe is on and
    ///      will work" are different facts. A module pointed at something the registry does not approve
    ///      reads ON from the chain and mints a hook at the first graduation that no pool of its own can
    ///      use, so the read-back compares the address against the resolution rather than against zero.
    function test_verify_refusesAModulePointedAtAFactoryTheRegistryDoesNotApprove() public {
        address stray = makeAddr("a factory nobody registered");
        vm.prank(deployer);
        module.setAlignmentHookFactory(stray);

        assertEq(module.alignmentHookFactory(), stray, "the bare setter takes it without complaint");

        vm.expectRevert(bytes("EnableAlignmentTithe: the module points at a factory the registry does not approve"));
        h.verify();
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    /// @dev Gives the registered factory's ADDRESS a different environment, by etching a stand-in that
    ///      answers the three getters `_resolve` reads off a candidate. The registry's approval is by
    ///      address and is untouched, so what each binding test presents is what governance would
    ///      actually face: an approved address whose immutables are not the module's. Etching rather
    ///      than deploying a second factory keeps `ALIGNMENT_HOOK_FACTORY` at one value for the whole
    ///      run — see the contract note.
    function _rebindRegisteredFactory(address poolManager_, address weth_, uint160 requiredFlags) internal {
        StubHookFactory stand = new StubHookFactory(poolManager_, weth_, requiredFlags);
        vm.etch(registeredFactory, address(stand).code);
    }

    /// @dev A locally-deployable network shape carrying a live tithe rate. The switch is what is under
    ///      test, so the rate is stated here rather than read from a network script: a network lowering
    ///      its rate must not quietly turn these refusals into vacuous passes.
    function _config() internal pure returns (DeployCore.NetworkConfig memory cfg) {
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
        cfg.priceDeviationBps = 1000;
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.hookFeeBips = HOOK_FEE_BIPS;
        cfg.lpFeeRate = LP_FEE_RATE;
        cfg.alignmentTargets = new DeployCore.AlignmentTargetConfig[](0);
        cfg.jsonOutputPath = "";
    }
}

/// @dev Stand-in for "a factory bound to somewhere else". It answers exactly the three getters
///      `_resolve` reads off a candidate — the two bindings and the type's permission bits — and
///      nothing else, because no test here mints a hook from it. Its values live in its runtime code,
///      which is what makes `vm.etch` of that code carry them.
contract StubHookFactory {
    address public immutable poolManager;
    address public immutable weth;
    uint160 internal immutable required;

    constructor(address poolManager_, address weth_, uint160 required_) {
        poolManager = poolManager_;
        weth = weth_;
        required = required_;
    }

    function hookFlags() external view returns (uint160, uint160) {
        return (required, 0);
    }
}
