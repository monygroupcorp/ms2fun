// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ERC404Factory } from "../../../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance, MetadataAlreadySet } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import {
    WithdrawDustFailed,
    ClaimFeesFailed,
    SetMetadataURIFailed,
    SetContractURIFailed,
    SetBondingOpenTimeFailed,
    SetBondingMaturityTimeFailed,
    SetBondingActiveFailed,
    SetStyleFailed,
    ActivateStakingFailed,
    SetAgentDelegationFailed,
    SetAgentDelegationFromFactoryFailed,
    InitProtocolFailed,
    InitStakingFailed,
    InitFreeMintFailed
} from "../../../src/factories/erc404/ERC404BondingStorage.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { IERC404StakingModule } from "../../../src/interfaces/IERC404StakingModule.sol";
import { LaunchManager } from "../../../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

/**
 * @title ERC404AgentDelegationTest
 * @notice Real integration of the agent-creates-on-behalf-of path for the ERC404 factory — the
 *         pre-testnet confirmation that a registered agent can spin up a collection FOR a person.
 *
 * Uses the real ERC404Factory + ERC404BondingInstance (only the master registry is mocked, to
 * authorize the agent). Mirrors the ERC1155/ERC721 agent-delegation suites.
 *
 * Config-only boundary (asserted below, noesis-096): when `agentDelegationEnabled` is true the agent may
 * run every NON-CUSTODIAL config/lifecycle fn (setMetadataURI, setBondingOpenTime, setBondingMaturityTime,
 * setBondingActive, setStyle, activateStaking, deployLiquidity) via `_requireOwnerOrAgent`, but the
 * value-extracting fns (withdrawDust, claimAllFees, migrateVault) stay bare `onlyOwner`. Delegation off,
 * a non-agent, or a revoked agent (live re-check) all revert `Unauthorized` on the config fns.
 */
contract MockVault {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

/// @dev Minimal staking module so `activateStaking()` can actually SUCCEED for an authorized caller.
///      Without a wired module it reverts `StakingModuleNotSet` for EVERY caller, which would make the
///      authorization assertions on that entry point unfalsifiable (noesis-148's `_assertCannotSweepSurplus`
///      lesson: a rejection that would also happen with the gate deleted proves nothing).
contract MockStakingModule is IERC404StakingModule {
    bool public enabled;

    function enableStaking() external override {
        enabled = true;
    }

    function recordStake(address, uint256) external override { }

    function recordUnstake(address, uint256) external override returns (uint256) {
        return 0;
    }
    function recordFeesReceived(uint256) external override { }

    function computeClaim(address) external override returns (uint256) {
        return 0;
    }
}

contract MockLiquidityDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

contract ERC404AgentDelegationTest is Test {
    ERC404Factory public factory;
    LaunchManager public launchMgr;
    CurveParamsComputer public curveComp;
    ComponentRegistry public componentRegistry;
    MockMasterRegistry public mockRegistry;
    MockVault public mockVault;
    MockLiquidityDeployer public mockDeployer;
    MockStakingModule public mockStaking;

    address public protocolAdmin = address(0x9);
    address public agent = address(0x10);
    address public person = address(0x5); // the collector the agent creates a collection FOR
    address public nobody = address(0x99);
    address public mockGMR = address(0x5555555555555555555555555555555555555555);

    uint256 constant PRESET_ID = 1;
    uint256 constant NFT_COUNT = 10;
    uint256 internal _saltCounter;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocolAdmin);

        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVault();
        launchMgr = new LaunchManager(protocolAdmin);
        curveComp = new CurveParamsComputer(protocolAdmin);
        mockDeployer = new MockLiquidityDeployer();
        mockStaking = new MockStakingModule();

        ComponentRegistry compRegImpl = new ComponentRegistry();
        componentRegistry = ComponentRegistry(LibClone.deployERC1967(address(compRegImpl)));
        componentRegistry.initialize(protocolAdmin);
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "StandardCurve");
        componentRegistry.approveComponent(address(mockDeployer), keccak256("liquidity"), "MockDeployer");
        componentRegistry.approveComponent(address(mockStaking), keccak256("staking"), "MockStaking");

        launchMgr.setPreset(
            PRESET_ID,
            LaunchManager.Preset({
                targetETH: 15 ether,
                unitPerNFT: 1e6,
                liquidityReserveBps: 2000,
                curveComputer: address(curveComp),
                active: true
            })
        );

        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        factory = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(impl),
                masterRegistry: address(mockRegistry),
                protocol: protocolAdmin,
                weth: address(0xBEEF)
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: mockGMR,
                launchManager: address(launchMgr),
                componentRegistry: address(componentRegistry)
            })
        );

        // Authorize the agent globally.
        mockRegistry.setAgent(agent, true);

        vm.stopPrank();
    }

    function _params(string memory name_, address owner_) internal returns (ERC404Factory.CreateParams memory) {
        return ERC404Factory.CreateParams({
            salt: _nextSalt(),
            owner: owner_,
            nftCount: NFT_COUNT,
            presetId: uint8(PRESET_ID),
            vault: address(mockVault),
            name: name_,
            symbol: "SYM",
            styleUri: "",
            tokenBaseURI: "",
            stakingModule: address(mockStaking),
            declaredMaxAllowanceBps: 0
        });
    }

    function _create(address caller, string memory name_, address owner_) internal returns (address) {
        vm.deal(caller, 1 ether);
        vm.prank(caller);
        return factory.createInstance(
            _params(name_, owner_),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        );
    }

    // ── Creation on behalf of a person ──────────────────────────────────────────

    function test_agent_creates_collection_for_person() public {
        address instance = _create(agent, "Agent For Person", person);

        ERC404BondingInstance inst = ERC404BondingInstance(payable(instance));
        assertEq(inst.owner(), person, "the collection is owned by the person, not the agent");
        assertTrue(inst.agentDelegationEnabled(), "agent-created instance flags delegation");
    }

    function test_self_created_has_delegation_disabled() public {
        address instance = _create(person, "Self Created", person);
        assertFalse(
            ERC404BondingInstance(payable(instance)).agentDelegationEnabled(),
            "a self-created instance does not enable delegation"
        );
    }

    function test_non_agent_cannot_create_on_behalf() public {
        vm.deal(nobody, 1 ether);
        vm.prank(nobody);
        // msg.sender != owner and not a registered agent → NotAuthorizedAgent.
        vm.expectRevert(ERC404Factory.NotAuthorizedAgent.selector);
        factory.createInstance(
            _params("Should Fail", person),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        );
    }

    // ── Config-only delegation boundary (noesis-096) ─────────────────────────────

    /// Calldata for every NON-CUSTODIAL config/lifecycle fn now gated by `_requireOwnerOrAgent`.
    function _delegableCalls() internal view returns (bytes[] memory calls) {
        calls = new bytes[](8);
        calls[0] = abi.encodeWithSelector(ERC404BondingInstance.setMetadataURI.selector, "ipfs://x");
        calls[1] = abi.encodeWithSelector(ERC404BondingInstance.setBondingOpenTime.selector, block.timestamp + 1 days);
        calls[2] =
            abi.encodeWithSelector(ERC404BondingInstance.setBondingMaturityTime.selector, block.timestamp + 2 days);
        calls[3] = abi.encodeWithSelector(ERC404BondingInstance.setBondingActive.selector, true);
        calls[4] = abi.encodeWithSelector(ERC404BondingInstance.setStyle.selector, "ipfs://style");
        calls[5] = abi.encodeWithSelector(ERC404BondingInstance.activateStaking.selector);
        calls[6] = abi.encodeWithSelector(ERC404BondingInstance.deployLiquidity.selector, uint256(0));
        // noesis-085: the ERC-7572 collection-URI setter rides the same trampoline + the same gate.
        calls[7] = abi.encodeWithSelector(ERC404BondingInstance.setContractURI.selector, "ipfs://hijacked-collection");
    }

    /// Calldata for the value-extracting fns that MUST stay owner-only.
    function _bytes4(bytes memory b) internal pure returns (bytes4 s) {
        if (b.length >= 4) s = bytes4(b);
    }

    /// Assert the call reverted with EXACTLY `expected`. Used for the value paths whose bodies moved
    /// to `ERC404BondingOps` (noesis-148): the owner gate lives on the Ops side and its `Unauthorized`
    /// is collapsed by the instance trampoline into that entry point's generic error.
    function _assertRejectedWith(address inst, address caller, bytes memory data, bytes4 expected) internal {
        vm.prank(caller);
        (bool ok, bytes memory ret) = inst.call(data);
        assertFalse(ok, "expected revert");
        assertEq(_bytes4(ret), expected, "expected the owner gate's rejection");
    }

    /// Assert the call was rejected with `Unauthorized` VERBATIM. Only for bodies that stayed in the
    /// instance (`migrateVault`, `deployLiquidity`) — everything externalized collapses to a generic error.
    function _assertUnauthorized(address inst, address caller, bytes memory data) internal {
        vm.prank(caller);
        (bool ok, bytes memory ret) = inst.call(data);
        assertFalse(ok, "expected revert");
        assertEq(_bytes4(ret), Ownable.Unauthorized.selector, "expected Unauthorized (auth gate)");
    }

    /// Expected rejection selector for each entry of `_delegableCalls()`, in the same order.
    /// @dev noesis-149 externalized six of the seven config fns into `ERC404BondingOps`. The
    ///      `_requireOwnerOrAgent` gate moved WITH them and still resolves against the same caller and
    ///      the same Ownable slot (`msg.sender` is preserved under `delegatecall`) — but the instance's
    ///      discard-returndata trampoline collapses `Unauthorized` into that entry point's generic
    ///      error. So the assertion is per-selector rather than blanket-`Unauthorized`. `deployLiquidity`
    ///      KEPT its body (and its inline `_requireOwnerOrAgent`) in the instance, so it still surfaces
    ///      `Unauthorized` verbatim — the CONTROL proving the collapse is a trampoline artifact and not
    ///      a weakened gate, exactly the role `migrateVault` plays for the value paths.
    function _delegableRejections() internal pure returns (bytes4[] memory sels) {
        sels = new bytes4[](8);
        sels[0] = SetMetadataURIFailed.selector;
        sels[1] = SetBondingOpenTimeFailed.selector;
        sels[2] = SetBondingMaturityTimeFailed.selector;
        sels[3] = SetBondingActiveFailed.selector;
        sels[4] = SetStyleFailed.selector;
        sels[5] = ActivateStakingFailed.selector;
        sels[6] = Ownable.Unauthorized.selector; // body stayed in the instance
        sels[7] = SetContractURIFailed.selector;
    }

    /// Assert every config fn REJECTS `caller` **and changed nothing**.
    /// @dev Falsifiability (noesis-148's `_assertCannotSweepSurplus` lesson): a bare "it reverted"
    ///      assertion would also pass with `_requireOwnerOrAgent` DELETED, because each of these fns
    ///      still has domain preconditions that can revert on their own. So this drives the instance to
    ///      a state where an UNGATED call would visibly SUCCEED — `setBondingOpenTime` with a future
    ///      timestamp, `setBondingActive(true)` after the open time is set, `activateStaking` with a
    ///      module wired — and then asserts the observable state is untouched afterwards.
    ///      `test_owner_can_call_all_config_fns` is the positive control on the same states: the owner
    ///      running the identical calldata DOES change all of it.
    /// @dev SEEDING THE CLOCK IS LOAD-BEARING. With `bondingOpenTime == 0`, calls[2]
    ///      (`setBondingMaturityTime`) reverts `OpenTimeMustBeSetFirst` and calls[3]
    ///      (`setBondingActive`) reverts `OpenTimeNotSet` for EVERY caller — both collapse through the
    ///      trampoline into the exact generic selectors asserted below, so those two legs would pass
    ///      with `_requireOwnerOrAgent` DELETED and prove nothing. The owner seeds the open time first
    ///      so both preconditions are satisfied and an ungated caller would visibly move
    ///      `bondingMaturityTime` and `bondingActive`. The seed is `+12 hours`: distinct from calls[1]'s
    ///      `+1 days` (so that leg stays observable) and BELOW calls[2]'s `+2 days` (so maturity clears
    ///      `MaturityMustBeAfterOpenTime` rather than swapping one unfalsifiable precondition for another).
    function _assertAllConfigFnsRejected(address inst, address caller) internal {
        ERC404BondingInstance i = ERC404BondingInstance(payable(inst));
        bytes[] memory calls = _delegableCalls();
        bytes4[] memory sels = _delegableRejections();

        uint256 seededOpenAt = block.timestamp + 12 hours;
        vm.prank(i.owner());
        i.setBondingOpenTime(seededOpenAt);

        // Pre-state: everything an ungated call would move is at a value the calls below would CHANGE.
        assertEq(i.metadataURI(), "", "pre: metadataURI");
        // Non-empty at create (noesis-085 threads the create call's collection URI in), and DIFFERENT from
        // what calls[7] would write — so an ungated `setContractURI` would visibly move it.
        assertEq(i.contractURI(), "ipfs://metadata", "pre: contractURI is the create-time collection URI");
        assertEq(i.styleUri(), "", "pre: styleUri");
        assertEq(i.bondingOpenTime(), seededOpenAt, "pre: bondingOpenTime seeded (calls[1] would move it)");
        assertEq(i.bondingMaturityTime(), 0, "pre: bondingMaturityTime unset");
        assertFalse(i.bondingActive(), "pre: bonding inactive");
        assertFalse(i.stakingActive(), "pre: staking inactive");
        assertTrue(address(i.stakingModule()) != address(0), "pre: a staking module IS wired");
        assertFalse(mockStaking.enabled(), "pre: module not enabled");

        for (uint256 k = 0; k < calls.length; k++) {
            _assertRejectedWith(inst, caller, calls[k], sels[k]);
        }

        // Post-state: identical. An ungated caller would have moved every one of these.
        assertEq(i.metadataURI(), "", "post: metadataURI untouched");
        assertEq(i.contractURI(), "ipfs://metadata", "post: contractURI untouched");
        assertEq(i.styleUri(), "", "post: styleUri untouched");
        assertEq(i.bondingOpenTime(), seededOpenAt, "post: bondingOpenTime untouched");
        assertEq(i.bondingMaturityTime(), 0, "post: bondingMaturityTime untouched");
        assertFalse(i.bondingActive(), "post: bonding still inactive");
        assertFalse(i.stakingActive(), "post: staking still inactive");
        assertFalse(mockStaking.enabled(), "post: module never enabled");
    }

    /// Assert every config fn TAKES EFFECT for `caller` — the positive leg of the A/B above.
    /// @dev Run in dependency order (open time before maturity/active). `deployLiquidity` is excluded:
    ///      it needs a full graduation setup and its own suites cover it; the negative leg above still
    ///      exercises its gate, and `_assertPassesAuth` covers its authorized side.
    function _assertAllConfigFnsTakeEffect(address inst, address caller) internal {
        ERC404BondingInstance i = ERC404BondingInstance(payable(inst));
        uint256 openAt = block.timestamp + 1 days;
        uint256 matureAt = block.timestamp + 2 days;

        vm.prank(caller);
        i.setMetadataURI("ipfs://moved");
        assertEq(i.metadataURI(), "ipfs://moved", "setMetadataURI took effect through the trampoline");

        // noesis-085: the collection URI is its OWN slot behind its OWN entry point. Both directions are
        // asserted, because the failure mode worth catching is the two setters writing the same string.
        vm.prank(caller);
        i.setContractURI("ipfs://collection-moved");
        assertEq(i.contractURI(), "ipfs://collection-moved", "setContractURI took effect through the trampoline");
        assertEq(i.metadataURI(), "ipfs://moved", "setContractURI must not touch the per-token base URI");

        vm.prank(caller);
        i.setStyle("ipfs://styled");
        assertEq(i.styleUri(), "ipfs://styled", "setStyle took effect");

        vm.prank(caller);
        i.setBondingOpenTime(openAt);
        assertEq(i.bondingOpenTime(), openAt, "setBondingOpenTime took effect");

        vm.prank(caller);
        i.setBondingMaturityTime(matureAt);
        assertEq(i.bondingMaturityTime(), matureAt, "setBondingMaturityTime took effect");

        vm.prank(caller);
        i.setBondingActive(true);
        assertTrue(i.bondingActive(), "setBondingActive took effect");

        vm.prank(caller);
        i.activateStaking();
        assertTrue(i.stakingActive(), "activateStaking took effect");
        assertTrue(mockStaking.enabled(), "the module's enableStaking() ran from the instance's context");

        // The authorized caller clears deployLiquidity's gate too (it may still fail a precondition).
        _assertPassesAuth(
            inst, caller, abi.encodeWithSelector(ERC404BondingInstance.deployLiquidity.selector, uint256(0))
        );
    }

    /// Assert `caller` cannot sweep REAL surplus ETH out of `inst` through the `withdrawDust` trampoline.
    /// @dev Load-bearing: with a zero balance `withdrawDust` reverts `NothingToWithdraw` for EVERY caller
    ///      (owner included), so a bare rejection assertion on a fresh instance passes even with
    ///      `onlyOwner` deleted from `ERC404BondingOps.withdrawDust`. Funding the instance first makes the
    ///      assertion falsifiable: an ungated sweep would SUCCEED here. The owner sweep at the end is the
    ///      positive control, so this is a full A/B across the noesis-148 delegatecall seam.
    function _assertCannotSweepSurplus(address inst, address caller) internal {
        ERC404BondingInstance i = ERC404BondingInstance(payable(inst));
        assertEq(inst.balance, 0, "fresh instance holds no ETH");
        assertEq(i.reserve() + i.stakingReserve(), 0, "no locked liability: the full 1 ether is sweepable");
        vm.deal(inst, 1 ether);

        _assertRejectedWith(
            inst,
            caller,
            abi.encodeWithSelector(ERC404BondingInstance.withdrawDust.selector),
            WithdrawDustFailed.selector
        );
        assertEq(inst.balance, 1 ether, "a rejected sweep must move nothing");

        address owner_ = i.owner();
        uint256 ownerBefore = owner_.balance;
        vm.prank(owner_);
        i.withdrawDust();
        assertEq(inst.balance, 0, "the owner CAN sweep the same surplus");
        assertEq(owner_.balance - ownerBefore, 1 ether, "surplus lands with the owner");
    }

    /// Assert the call CLEARED the auth gate: it either succeeds or reverts with a domain precondition
    /// error — never `Unauthorized`. Proves the caller is authorized without driving heavy preconditions.
    function _assertPassesAuth(address inst, address caller, bytes memory data) internal {
        vm.prank(caller);
        (bool ok, bytes memory ret) = inst.call(data);
        if (!ok) {
            assertTrue(_bytes4(ret) != Ownable.Unauthorized.selector, "cleared gate but got Unauthorized");
        }
    }

    function test_owner_can_call_all_config_fns() public {
        address instance = _create(agent, "Owner Cfg", person);
        _assertAllConfigFnsTakeEffect(instance, person);
    }

    function test_delegated_agent_can_call_all_config_fns() public {
        address instance = _create(agent, "Agent Cfg", person);
        assertTrue(ERC404BondingInstance(payable(instance)).agentDelegationEnabled());
        _assertAllConfigFnsTakeEffect(instance, agent);
    }

    function test_agent_blocked_on_config_fns_when_delegation_off() public {
        address instance = _create(agent, "Deleg Off", person);
        vm.prank(person);
        ERC404BondingInstance(payable(instance)).setAgentDelegation(false);
        assertFalse(ERC404BondingInstance(payable(instance)).agentDelegationEnabled(), "delegation is off");
        _assertAllConfigFnsRejected(instance, agent);
    }

    function test_non_agent_non_owner_always_blocked_on_config_fns() public {
        address instance = _create(agent, "Nobody", person);
        _assertAllConfigFnsRejected(instance, nobody);
    }

    /// Revocation is live: a revoked agent is blocked immediately even with the bool still `true`.
    function test_revoked_agent_blocked_immediately_despite_stale_bool() public {
        address instance = _create(agent, "Revoked", person);
        assertTrue(ERC404BondingInstance(payable(instance)).agentDelegationEnabled(), "bool stays true");
        vm.prank(protocolAdmin);
        mockRegistry.setAgent(agent, false);
        _assertAllConfigFnsRejected(instance, agent);
    }

    /// `setAgentDelegation` is OWNER-ONLY (not `_requireOwnerOrAgent`): a delegated agent must not be
    /// able to keep its own delegation alive, or revocation-by-owner would be unenforceable.
    /// @dev Falsifiable: the owner leg proves the same calldata DOES flip the flag.
    function test_setAgentDelegation_is_owner_only_across_the_trampoline() public {
        address instance = _create(agent, "Deleg Gate", person);
        ERC404BondingInstance i = ERC404BondingInstance(payable(instance));
        assertTrue(i.agentDelegationEnabled(), "starts enabled");

        bytes memory data = abi.encodeWithSelector(ERC404BondingInstance.setAgentDelegation.selector, false);
        _assertRejectedWith(instance, agent, data, SetAgentDelegationFailed.selector);
        _assertRejectedWith(instance, nobody, data, SetAgentDelegationFailed.selector);
        assertTrue(i.agentDelegationEnabled(), "a rejected toggle must change nothing");

        vm.prank(person);
        i.setAgentDelegation(false);
        assertFalse(i.agentDelegationEnabled(), "the OWNER can flip it with the identical calldata");
    }

    /// The factory-only config entry points stay factory-only across the delegatecall seam.
    /// @dev Falsifiable on both legs: the owner AND a delegated agent are rejected, while the factory
    ///      itself succeeds on the same selector and the write is observable.
    function test_factory_only_config_fns_stay_factory_only() public {
        address instance = _create(agent, "Factory Only", person);
        ERC404BondingInstance i = ERC404BondingInstance(payable(instance));

        bytes memory data = abi.encodeWithSelector(ERC404BondingInstance.setAgentDelegationFromFactory.selector);
        _assertRejectedWith(instance, person, data, SetAgentDelegationFromFactoryFailed.selector);
        _assertRejectedWith(instance, agent, data, SetAgentDelegationFromFactoryFailed.selector);
        _assertRejectedWith(instance, nobody, data, SetAgentDelegationFromFactoryFailed.selector);

        // Positive control on the same selector: `msg.sender` survives the delegatecall, so the
        // factory's own call still clears `msg.sender != factory` and writes.
        vm.prank(person);
        i.setAgentDelegation(false);
        assertFalse(i.agentDelegationEnabled(), "cleared, so the factory call below is observable");
        vm.prank(address(factory));
        i.setAgentDelegationFromFactory();
        assertTrue(i.agentDelegationEnabled(), "the FACTORY can still set it");
    }

    /// A create through the real `ERC404Factory` still succeeds end-to-end: it drives five of the
    /// thirteen externalized config fns (`initializeProtocol`, `initializeFreeMint`, `initModule` via
    /// `_wireMetadata`, `initializeStaking`, `setAgentDelegationFromFactory`) through the trampoline,
    /// and each generic error would identify which step broke.
    function test_factory_create_drives_the_config_trampolines_end_to_end() public {
        address instance = _create(agent, "Create Path", person);
        ERC404BondingInstance i = ERC404BondingInstance(payable(instance));

        assertEq(address(i.masterRegistry()), address(mockRegistry), "initializeProtocol wrote masterRegistry");
        assertEq(i.protocolTreasury(), factory.protocolTreasury(), "initializeProtocol wrote protocolTreasury");
        assertEq(i.weth(), address(0xBEEF), "initializeProtocol wrote weth");
        assertEq(address(i.globalMessageRegistry()), mockGMR, "initializeProtocol wrote globalMessageRegistry");
        assertEq(address(i.stakingModule()), address(mockStaking), "initializeStaking wrote the module");
        assertTrue(i.agentDelegationEnabled(), "setAgentDelegationFromFactory ran");
        assertEq(i.symbol(), "SYM", "initializeMetadata (still in-instance) ran");
        assertEq(i.freeMintAllocation(), 0, "initializeFreeMint ran (allocation 0 = disabled)");
    }

    /// noesis-085: the create path hands the instance the SAME collection URI it registers, so the
    /// registry copy is no longer the only one. `_create` passes "ipfs://metadata" as the create call's
    /// collection URI and leaves `params.tokenBaseURI` empty — which is what makes this falsifiable: if
    /// the factory wired `params.tokenBaseURI` into the new slot instead, `contractURI()` would be "".
    function test_create_populates_the_erc7572_contract_uri_from_the_registered_collection_uri() public {
        address instance = _create(agent, "Collection URI", person);
        ERC404BondingInstance i = ERC404BondingInstance(payable(instance));

        assertEq(i.contractURI(), "ipfs://metadata", "contractURI is the create call's collection URI");
        assertEq(i.metadataURI(), "", "the per-token base URI stays params.tokenBaseURI (empty here)");
    }

    /// noesis-085: the set-once guard still holds now that `initializeMetadata` also writes the collection
    /// URI — a second call cannot re-point `contractURI` at another document, even from the factory.
    /// @dev Falsifiable: the rejected calldata carries a DIFFERENT value for every field it would write,
    ///      so a dropped guard would visibly land.
    function test_initializeMetadata_stays_set_once_including_the_contract_uri() public {
        address instance = _create(agent, "Set Once", person);
        ERC404BondingInstance i = ERC404BondingInstance(payable(instance));

        vm.prank(address(factory));
        vm.expectRevert(MetadataAlreadySet.selector);
        i.initializeMetadata("Renamed", "RN", "ipfs://style2", "ipfs://base2", "ipfs://hijacked-collection");

        assertEq(i.contractURI(), "ipfs://metadata", "a rejected re-init leaves the collection URI alone");
        assertEq(i.name(), "Set Once", "name untouched");
        assertEq(i.symbol(), "SYM", "symbol untouched");
        assertEq(i.metadataURI(), "", "per-token base URI untouched");
    }

    // ── The three factory-only INIT entry points, negatively (noesis-149 gauntlet) ───────────────
    //
    // `initializeProtocol`, `initializeStaking` and `initializeFreeMint` are the only three of the
    // thirteen whose `if (msg.sender != factory) revert OnlyFactory()` gate had NO negative assertion
    // anywhere in the tree: every existing use is positive (the create path, or a harness pranking as
    // the factory). Post-D2 that gate is evaluated on the far side of a new delegatecall seam, so it
    // gets a regression test. Today the exposure is not a live hole — both calls are reachable only
    // through `createInstance` (`ERC404Factory.sol:310,464`) — but `initializeProtocol` has no
    // set-once guard (only `if (!_initialized)`, already true post-create), so a future seam edit that
    // silently dropped the gate would let ANY caller rewrite `masterRegistry`, `protocolTreasury` and
    // `bondingFeeBps`. That is what these three assert cannot happen.
    //
    // Each is falsifiable in the same A/B shape as the rest of this suite: the rejected calldata is
    // driven at a state where an UNGATED call would visibly land, the observable target is asserted
    // unchanged after all three rejections, and the factory then runs the IDENTICAL calldata and the
    // write is observed. Without that control a bare "it reverted" would also pass with the gate
    // deleted (`_assertCannotSweepSurplus`'s lesson from noesis-148).

    /// A clone that is `initialize`d but whose free-mint slot is still UNSEALED, with THIS test
    /// contract as its factory (`initialize` records `factory = msg.sender`).
    /// @dev LOAD-BEARING for `test_initializeFreeMint_stays_factory_only_across_the_trampoline`.
    ///      `initializeFreeMint` is set-once (`_freeMintInitialized`) and `createInstance` ALWAYS seals
    ///      it (`ERC404Factory.sol:475`), so on a factory-created instance an ungated call would revert
    ///      `AlreadyInitialized` anyway — collapsing through the trampoline into the very same
    ///      `InitFreeMintFailed` the gate produces. Rejection legs there would prove nothing. On this
    ///      clone the slot is virgin, so an ungated call WOULD land. Built exactly as
    ///      `TokenTierOps.t.sol` builds its instance. Otherwise a faithful stand-in: the real
    ///      `mockRegistry` is wired and `person` (the owner) turns delegation ON, so the `agent` leg
    ///      below is a genuinely live-checked delegated agent, not a stranger.
    function _unsealedFreeMintInstance() internal returns (ERC404BondingInstance i) {
        i = ERC404BondingInstance(payable(LibClone.clone(factory.implementation())));
        i.initialize(
            person,
            address(mockVault),
            ERC404BondingInstance.BondingParams({
                maxSupply: 1000e18,
                unit: 1e18,
                liquidityReserveBps: 1000,
                declaredMaxAllowanceBps: 0,
                curve: BondingCurveMath.Params({
                    initialPrice: 0.0001 ether,
                    quarticCoeff: 1,
                    cubicCoeff: 1,
                    quadraticCoeff: 1,
                    normalizationFactor: 1e18
                })
            }),
            address(mockDeployer),
            address(0),
            address(new DN404Mirror(address(this)))
        );
        i.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGMR,
                protocolTreasury: factory.protocolTreasury(),
                masterRegistry: address(mockRegistry),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        vm.prank(person);
        i.setAgentDelegation(true);
        assertTrue(i.agentDelegationEnabled(), "the agent leg below must face a LIVE delegated agent");
    }

    /// `initializeProtocol` is FACTORY-ONLY across the trampoline — owner and delegated agent included.
    /// @dev The highest-stakes of the three: it is re-callable (no set-once), so a dropped gate is a
    ///      standing rewrite of the protocol's own wiring on a live instance.
    function test_initializeProtocol_stays_factory_only_across_the_trampoline() public {
        address instance = _create(agent, "Init Protocol Gate", person);
        ERC404BondingInstance i = ERC404BondingInstance(payable(instance));
        assertTrue(i.agentDelegationEnabled(), "the agent IS delegated: delegation must not reach a factory-only init");

        address treasuryBefore = i.protocolTreasury();
        uint256 feeBefore = i.bondingFeeBps();
        address registryBefore = address(i.masterRegistry());
        assertEq(treasuryBefore, factory.protocolTreasury(), "pre: the factory-written treasury");
        assertEq(registryBefore, address(mockRegistry), "pre: the factory-written registry");

        ERC404BondingInstance.ProtocolParams memory hijack = ERC404BondingInstance.ProtocolParams({
            globalMessageRegistry: address(0xBAD1),
            protocolTreasury: address(0xBAD2),
            masterRegistry: address(0xBAD3),
            bondingFeeBps: 777,
            weth: address(0xBAD4)
        });
        // Every hijack field genuinely differs, so "unchanged" below is a real assertion.
        assertTrue(treasuryBefore != hijack.protocolTreasury, "pre: treasury would visibly move");
        assertTrue(feeBefore != hijack.bondingFeeBps, "pre: fee would visibly move");
        assertTrue(registryBefore != hijack.masterRegistry, "pre: registry would visibly move");

        bytes memory data = abi.encodeWithSelector(ERC404BondingInstance.initializeProtocol.selector, hijack);
        _assertRejectedWith(instance, person, data, InitProtocolFailed.selector);
        _assertRejectedWith(instance, agent, data, InitProtocolFailed.selector);
        _assertRejectedWith(instance, nobody, data, InitProtocolFailed.selector);

        assertEq(i.protocolTreasury(), treasuryBefore, "a rejected initializeProtocol must not move the treasury");
        assertEq(i.bondingFeeBps(), feeBefore, "...nor the bonding fee");
        assertEq(address(i.masterRegistry()), registryBefore, "...nor the master registry");

        // Positive control on the IDENTICAL calldata: `msg.sender` survives the delegatecall, so the
        // factory still clears `msg.sender != factory` and the write lands. The three rejections above
        // are therefore the gate — not `_initialized`, not a domain precondition.
        vm.prank(address(factory));
        i.initializeProtocol(hijack);
        assertEq(i.protocolTreasury(), hijack.protocolTreasury, "the FACTORY can rewrite the treasury");
        assertEq(i.bondingFeeBps(), hijack.bondingFeeBps, "the FACTORY can rewrite the fee");
        assertEq(address(i.masterRegistry()), hijack.masterRegistry, "the FACTORY can rewrite the registry");
    }

    /// `initializeStaking` is FACTORY-ONLY across the trampoline.
    /// @dev Re-callable, so it needs no extra setup: the same calldata that three callers are rejected
    ///      on is then run by the factory and observed to land.
    function test_initializeStaking_stays_factory_only_across_the_trampoline() public {
        address instance = _create(agent, "Init Staking Gate", person);
        ERC404BondingInstance i = ERC404BondingInstance(payable(instance));
        assertTrue(i.agentDelegationEnabled(), "the agent IS delegated");
        assertEq(address(i.stakingModule()), address(mockStaking), "pre: the factory-written module");

        address hijack = address(0xBAD5);
        bytes memory data = abi.encodeWithSelector(ERC404BondingInstance.initializeStaking.selector, hijack);
        _assertRejectedWith(instance, person, data, InitStakingFailed.selector);
        _assertRejectedWith(instance, agent, data, InitStakingFailed.selector);
        _assertRejectedWith(instance, nobody, data, InitStakingFailed.selector);

        assertEq(address(i.stakingModule()), address(mockStaking), "a rejected initializeStaking must not repoint it");

        vm.prank(address(factory));
        i.initializeStaking(hijack);
        assertEq(address(i.stakingModule()), hijack, "the FACTORY can repoint it with the identical calldata");
    }

    /// `initializeFreeMint` is FACTORY-ONLY across the trampoline.
    /// @dev Runs on `_unsealedFreeMintInstance()` — see that helper for why a factory-created instance
    ///      cannot host this assertion falsifiably. Here THIS contract is the clone's factory, so the
    ///      positive control is a direct call rather than a prank.
    function test_initializeFreeMint_stays_factory_only_across_the_trampoline() public {
        ERC404BondingInstance i = _unsealedFreeMintInstance();
        address instance = address(i);
        assertEq(i.freeMintAllocation(), 0, "pre: allocation unset");
        assertTrue(i.gatingScope() == GatingScope.BOTH, "pre: scope at its default");

        uint256 allocation = 7;
        bytes memory data = abi.encodeWithSelector(
            ERC404BondingInstance.initializeFreeMint.selector, allocation, GatingScope.PAID_ONLY
        );
        _assertRejectedWith(instance, person, data, InitFreeMintFailed.selector);
        _assertRejectedWith(instance, agent, data, InitFreeMintFailed.selector);
        _assertRejectedWith(instance, nobody, data, InitFreeMintFailed.selector);

        assertEq(i.freeMintAllocation(), 0, "a rejected initializeFreeMint must not reserve an allocation");
        assertTrue(i.gatingScope() == GatingScope.BOTH, "...nor move the gating scope");

        // Positive control: the clone's factory (this contract) runs the identical arguments and the
        // set-once slot visibly seals — so the three rejections above are the gate, not the seal.
        i.initializeFreeMint(allocation, GatingScope.PAID_ONLY);
        assertEq(i.freeMintAllocation(), allocation, "the FACTORY can seal the allocation");
        assertTrue(i.gatingScope() == GatingScope.PAID_ONLY, "the FACTORY can set the scope");
    }

    /// Config-only boundary: value-extracting fns stay owner-only — a delegated agent STILL reverts.
    /// @dev noesis-148 moved `withdrawDust` / `claimAllFees` into `ERC404BondingOps`. The `onlyOwner`
    ///      gate moved WITH them and still resolves against the same caller and the same Ownable slot
    ///      (`msg.sender` is preserved under `delegatecall`) — but the instance's discard-returndata
    ///      trampoline collapses Ownable's `Unauthorized` into that entry point's generic error. So the
    ///      assertion is per-selector rather than blanket-`Unauthorized`: what matters is that the
    ///      delegated agent is REJECTED on every value path, which is asserted exactly here.
    ///      `migrateVault` kept its body (and its bare `onlyOwner`) in the instance, so it still
    ///      surfaces `Unauthorized` verbatim — proof the collapse is a trampoline artifact, not a
    ///      weakened gate.
    function test_delegated_agent_cannot_call_value_fns() public {
        address instance = _create(agent, "No Value", person);
        assertTrue(ERC404BondingInstance(payable(instance)).agentDelegationEnabled());

        _assertCannotSweepSurplus(instance, agent);
        _assertRejectedWith(
            instance,
            agent,
            abi.encodeWithSelector(ERC404BondingInstance.claimAllFees.selector),
            ClaimFeesFailed.selector
        );
        _assertUnauthorized(
            instance, agent, abi.encodeWithSelector(ERC404BondingInstance.migrateVault.selector, address(0xCAFE))
        );
    }

    /// @notice Same boundary for a caller with no relationship to the instance at all.
    function test_random_caller_cannot_call_value_fns() public {
        address instance = _create(agent, "No Value Nobody", person);

        _assertCannotSweepSurplus(instance, nobody);
        _assertRejectedWith(
            instance,
            nobody,
            abi.encodeWithSelector(ERC404BondingInstance.claimAllFees.selector),
            ClaimFeesFailed.selector
        );
        _assertUnauthorized(
            instance, nobody, abi.encodeWithSelector(ERC404BondingInstance.migrateVault.selector, address(0xCAFE))
        );
    }

    // ── EIP-170 size gate: the ERC404 instance must stay under the 24,576B ceiling ──

    function test_erc404_instance_under_eip170_ceiling() public {
        bytes memory runtime = vm.getDeployedCode("ERC404BondingInstance.sol:ERC404BondingInstance");
        assertLt(runtime.length, 24_576, "ERC404BondingInstance runtime exceeds EIP-170 ceiling");
    }
}
