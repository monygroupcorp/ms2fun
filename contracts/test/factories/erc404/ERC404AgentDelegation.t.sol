// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ERC404Factory } from "../../../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { WithdrawDustFailed, ClaimFeesFailed } from "../../../src/factories/erc404/ERC404BondingStorage.sol";
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

        ComponentRegistry compRegImpl = new ComponentRegistry();
        componentRegistry = ComponentRegistry(LibClone.deployERC1967(address(compRegImpl)));
        componentRegistry.initialize(protocolAdmin);
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "StandardCurve");
        componentRegistry.approveComponent(address(mockDeployer), keccak256("liquidity"), "MockDeployer");

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
            stakingModule: address(0),
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
        calls = new bytes[](7);
        calls[0] = abi.encodeWithSelector(ERC404BondingInstance.setMetadataURI.selector, "ipfs://x");
        calls[1] = abi.encodeWithSelector(ERC404BondingInstance.setBondingOpenTime.selector, block.timestamp + 1 days);
        calls[2] =
            abi.encodeWithSelector(ERC404BondingInstance.setBondingMaturityTime.selector, block.timestamp + 2 days);
        calls[3] = abi.encodeWithSelector(ERC404BondingInstance.setBondingActive.selector, true);
        calls[4] = abi.encodeWithSelector(ERC404BondingInstance.setStyle.selector, "ipfs://style");
        calls[5] = abi.encodeWithSelector(ERC404BondingInstance.activateStaking.selector);
        calls[6] = abi.encodeWithSelector(ERC404BondingInstance.deployLiquidity.selector, uint256(0));
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

    /// Assert the call was rejected by the auth gate (Unauthorized), regardless of any later precondition.
    function _assertUnauthorized(address inst, address caller, bytes memory data) internal {
        vm.prank(caller);
        (bool ok, bytes memory ret) = inst.call(data);
        assertFalse(ok, "expected revert");
        assertEq(_bytes4(ret), Ownable.Unauthorized.selector, "expected Unauthorized (auth gate)");
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
        bytes[] memory calls = _delegableCalls();
        for (uint256 i = 0; i < calls.length; i++) {
            _assertPassesAuth(instance, person, calls[i]);
        }
    }

    function test_delegated_agent_can_call_all_config_fns() public {
        address instance = _create(agent, "Agent Cfg", person);
        assertTrue(ERC404BondingInstance(payable(instance)).agentDelegationEnabled());
        bytes[] memory calls = _delegableCalls();
        for (uint256 i = 0; i < calls.length; i++) {
            _assertPassesAuth(instance, agent, calls[i]);
        }
    }

    function test_agent_blocked_on_config_fns_when_delegation_off() public {
        address instance = _create(agent, "Deleg Off", person);
        vm.prank(person);
        ERC404BondingInstance(payable(instance)).setAgentDelegation(false);
        bytes[] memory calls = _delegableCalls();
        for (uint256 i = 0; i < calls.length; i++) {
            _assertUnauthorized(instance, agent, calls[i]);
        }
    }

    function test_non_agent_non_owner_always_blocked_on_config_fns() public {
        address instance = _create(agent, "Nobody", person);
        bytes[] memory calls = _delegableCalls();
        for (uint256 i = 0; i < calls.length; i++) {
            _assertUnauthorized(instance, nobody, calls[i]);
        }
    }

    /// Revocation is live: a revoked agent is blocked immediately even with the bool still `true`.
    function test_revoked_agent_blocked_immediately_despite_stale_bool() public {
        address instance = _create(agent, "Revoked", person);
        assertTrue(ERC404BondingInstance(payable(instance)).agentDelegationEnabled(), "bool stays true");
        vm.prank(protocolAdmin);
        mockRegistry.setAgent(agent, false);
        bytes[] memory calls = _delegableCalls();
        for (uint256 i = 0; i < calls.length; i++) {
            _assertUnauthorized(instance, agent, calls[i]);
        }
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

        _assertRejectedWith(
            instance,
            agent,
            abi.encodeWithSelector(ERC404BondingInstance.withdrawDust.selector),
            WithdrawDustFailed.selector
        );
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
        _assertRejectedWith(
            instance,
            nobody,
            abi.encodeWithSelector(ERC404BondingInstance.withdrawDust.selector),
            WithdrawDustFailed.selector
        );
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
