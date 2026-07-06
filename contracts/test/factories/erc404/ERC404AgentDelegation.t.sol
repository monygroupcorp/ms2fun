// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {ERC404Factory} from "../../../src/factories/erc404/ERC404Factory.sol";
import {ERC404BondingInstance} from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import {LaunchManager} from "../../../src/factories/erc404/LaunchManager.sol";
import {CurveParamsComputer} from "../../../src/factories/erc404/CurveParamsComputer.sol";
import {ComponentRegistry} from "../../../src/registry/ComponentRegistry.sol";
import {MockMasterRegistry} from "../../mocks/MockMasterRegistry.sol";
import {ILiquidityDeployerModule} from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import {FreeMintParams} from "../../../src/interfaces/IFactoryTypes.sol";
import {GatingScope} from "../../../src/gating/IGatingModule.sol";
import {CREATEX} from "../../../src/shared/CreateXConstants.sol";
import {CREATEX_BYTECODE} from "createx-forge/script/CreateX.d.sol";

/**
 * @title ERC404AgentDelegationTest
 * @notice Real integration of the agent-creates-on-behalf-of path for the ERC404 factory — the
 *         pre-testnet confirmation that a registered agent can spin up a collection FOR a person.
 *
 * Uses the real ERC404Factory + ERC404BondingInstance (only the master registry is mocked, to
 * authorize the agent). Mirrors the ERC1155/ERC721 agent-delegation suites.
 *
 * ERC404-specific boundary (asserted below): unlike ERC1155/ERC721 — where the agent keeps managing
 * the instance (addEdition / queuePiece) after creation — the ERC404 instance gates every owner action
 * with bare `onlyOwner` and never reads `agentDelegationEnabled`. So on ERC404 the agent's power is
 * scoped to CREATION: it hands a fully-owned collection to the person, and the person alone manages it.
 */
contract MockVault {
    function supportsCapability(bytes32) external pure returns (bool) { return true; }
    receive() external payable {}
}

contract MockLiquidityDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override {}
    function metadataURI() external view override returns (string memory) { return ""; }
    function setMetadataURI(string calldata) external override {}
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
        componentRegistry.approveComponent(address(curveComp), keccak256("curve"), "StandardCurve");
        componentRegistry.approveComponent(address(mockDeployer), keccak256("liquidity"), "MockDeployer");

        launchMgr.setPreset(PRESET_ID, LaunchManager.Preset({
            targetETH: 15 ether,
            unitPerNFT: 1e6,
            liquidityReserveBps: 2000,
            curveComputer: address(curveComp),
            active: true
        }));

        ERC404BondingInstance impl = new ERC404BondingInstance();
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

    function _params(string memory name_, address owner_)
        internal
        returns (ERC404Factory.CreateParams memory)
    {
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
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
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
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
    }

    // ── ERC404 boundary: management stays with the person (owner-only) ───────────

    function test_erc404_management_stays_owner_only_after_agent_create() public {
        address instance = _create(agent, "Owner Only", person);
        ERC404BondingInstance inst = ERC404BondingInstance(payable(instance));

        // The agent that created it cannot manage it — ERC404 instance actions are bare onlyOwner
        // (agentDelegationEnabled is a creation flag; the instance never reads it for management).
        vm.prank(agent);
        vm.expectRevert(Ownable.Unauthorized.selector);
        inst.setMetadataURI("ipfs://hijack");

        // The person (owner) can.
        vm.prank(person);
        inst.setMetadataURI("ipfs://by-owner");
        assertEq(inst.metadataURI(), "ipfs://by-owner");
    }
}
