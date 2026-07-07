// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ERC404Factory} from "../../../src/factories/erc404/ERC404Factory.sol";
import {DeployBondEscrow} from "../../../src/factories/erc404/DeployBondEscrow.sol";
import {ERC404BondingInstance} from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import {LaunchManager} from "../../../src/factories/erc404/LaunchManager.sol";
import {CurveParamsComputer} from "../../../src/factories/erc404/CurveParamsComputer.sol";
import {MockMasterRegistry} from "../../mocks/MockMasterRegistry.sol";
import {BondingCurveMath} from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import {FreeMintParams} from "../../../src/interfaces/IFactoryTypes.sol";
import {GatingScope} from "../../../src/gating/IGatingModule.sol";
import {ComponentRegistry} from "../../../src/registry/ComponentRegistry.sol";
import {PasswordTierGatingModule} from "../../../src/gating/PasswordTierGatingModule.sol";
import {ILiquidityDeployerModule} from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {ICreateX, CREATEX} from "../../../src/shared/CreateXConstants.sol";
import {CREATEX_BYTECODE} from "createx-forge/script/CreateX.d.sol";
import {RevenueSplitLib} from "../../../src/shared/libraries/RevenueSplitLib.sol";

contract MockVault {
    function supportsCapability(bytes32) external pure returns (bool) { return true; }
    receive() external payable {}
}

/// @dev Plain vault with no hook() function
contract PlainVault {
    function supportsCapability(bytes32) external pure returns (bool) { return true; }
    receive() external payable {}
}

/// @dev Minimal mock liquidity deployer — accepts the call and records the params it received.
contract MockLiquidityDeployer is ILiquidityDeployerModule {
    bool public called;
    ILiquidityDeployerModule.DeployParams public lastParams;
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata p) external payable override {
        called = true;
        lastParams = p;
    }
    function metadataURI() external view override returns (string memory) { return ""; }
    function setMetadataURI(string calldata) external override {}
}

contract ERC404FactoryTest is Test {
    ERC404Factory public factory;
    LaunchManager public launchMgr;
    CurveParamsComputer public curveComp;
    MockMasterRegistry public mockRegistry;
    MockVault public mockVault;
    ComponentRegistry public componentRegistry;
    MockLiquidityDeployer public mockDeployer;

    uint256 internal _saltCounter;

    address public protocolAdmin = address(0x9);
    address public creator1 = address(0x2);
    address public creator2 = address(0x3);
    address public nonOwner = address(0x5);

    address public mockGMR = address(0x5555555555555555555555555555555555555555);

    uint256 constant INSTANCE_CREATION_FEE = 0.01 ether;
    uint256 constant DEFAULT_NFT_COUNT = 10;
    uint256 constant DEFAULT_PRESET_ID = 1;

    event InstanceCreated(
        address indexed instance,
        address indexed creator,
        string name,
        string symbol,
        address indexed vault
    );

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
        address compRegProxy = LibClone.deployERC1967(address(compRegImpl));
        componentRegistry = ComponentRegistry(compRegProxy);
        componentRegistry.initialize(protocolAdmin);

        // Approve the curve computer and default deployer
        componentRegistry.approveComponent(address(curveComp), keccak256("curve"), "StandardCurve");
        componentRegistry.approveComponent(address(mockDeployer), keccak256("liquidity"), "MockDeployer");

        // Set up default preset
        launchMgr.setPreset(DEFAULT_PRESET_ID, LaunchManager.Preset({
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

        vm.stopPrank();
    }

    // ========================
    // Helper: build default IdentityParams
    // ========================

    function _identity(
        string memory name_,
        string memory symbol_,
        address owner_
    ) internal returns (ERC404Factory.CreateParams memory) {
        return ERC404Factory.CreateParams({
            salt: _nextSalt(),
            owner: owner_,
            nftCount: DEFAULT_NFT_COUNT,
            presetId: uint8(DEFAULT_PRESET_ID),
            vault: address(mockVault),
            name: name_,
            symbol: symbol_,
            styleUri: "",
            tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
        });
    }

    // ========================
    // Instance Creation Tests
    // ========================

    function test_createInstance_successfulCreation() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("TestToken", "TEST", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance != address(0), "Instance should be created");
        vm.stopPrank();
    }

    function test_createInstance_withVault() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("TestToken", "TEST", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance != address(0));
        vm.stopPrank();
    }

    function test_createInstance_vaultRequired() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectRevert(ERC404Factory.VaultRequired.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator1,
                nftCount: DEFAULT_NFT_COUNT,
                presetId: uint8(DEFAULT_PRESET_ID),
                vault: address(0),
                name: "TestToken",
                symbol: "TEST",
                styleUri: "",
                tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    function test_createInstance_invalidName() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectRevert(ERC404Factory.InvalidName.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("", "TEST", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    function test_createInstance_invalidSymbol() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectRevert(ERC404Factory.InvalidSymbol.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("TestToken", "", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    function test_createInstance_invalidNftCount() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectRevert(ERC404Factory.InvalidNftCount.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator1,
                nftCount: 0,
                presetId: uint8(DEFAULT_PRESET_ID),
                vault: address(mockVault),
                name: "TestToken",
                symbol: "TEST",
                styleUri: "",
                tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    function test_createInstance_invalidCreator() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectRevert(ERC404Factory.InvalidOwner.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: address(0),
                nftCount: DEFAULT_NFT_COUNT,
                presetId: uint8(DEFAULT_PRESET_ID),
                vault: address(mockVault),
                name: "TestToken",
                symbol: "TEST",
                styleUri: "",
                tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    // ========================
    // Infrastructure Tests
    // ========================

    function test_masterRegistry_initialization() public view {
        assertEq(address(factory.masterRegistry()), address(mockRegistry));
    }

    function test_features() public view {
        bytes32[] memory factoryFeatures = factory.features();
        assertTrue(factoryFeatures.length > 0, "Factory should have features");
    }

    // ========================
    // Multiple Instances Tests
    // ========================

    function test_createInstance_multipleSequential() public {
        vm.deal(creator1, 1 ether);
        vm.deal(creator2, 1 ether);

        vm.startPrank(creator1);
        address instance1 = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("Token1", "TK1", creator1),
            "ipfs://metadata1",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();

        vm.startPrank(creator2);
        address instance2 = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("Token2", "TK2", creator2),
            "ipfs://metadata2",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();

        assertTrue(instance1 != address(0));
        assertTrue(instance2 != address(0));
        assertTrue(instance1 != instance2);
    }

    function test_createInstance_eventEmission() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectEmit(false, true, true, false);
        emit InstanceCreated(address(0), creator1, "EventToken", "EVT", address(mockVault));
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("EventToken", "EVT", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    // ========================
    // Reentrancy Tests
    // ========================

    function test_createInstance_nonReentrant() public {
        vm.deal(creator1, 2 ether);
        vm.startPrank(creator1);

        address instance1 = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("Token1", "TK1", creator1),
            "ipfs://metadata1",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance1 != address(0));

        address instance2 = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("Token2", "TK2", creator1),
            "ipfs://metadata2",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance2 != address(0));
        vm.stopPrank();
    }

    function test_createInstance_differentCreator() public {
        vm.deal(creator1, 1 ether);
        // creator1 must be a registered agent to create on behalf of creator2
        mockRegistry.setAgent(creator1, true);
        vm.startPrank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("TestToken", "TEST", creator2),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance != address(0));
        // Agent-created instance should have delegation enabled
        assertTrue(ERC404BondingInstance(payable(instance)).agentDelegationEnabled());
        vm.stopPrank();
    }

    // ========================
    // Protocol Treasury Tests
    // ========================

    function test_SetProtocolTreasury() public {
        vm.startPrank(protocolAdmin);
        factory.setProtocolTreasury(address(0xBEEF));
        assertEq(factory.protocolTreasury(), address(0xBEEF));
        vm.stopPrank();
    }

    function test_SetProtocolTreasury_RevertNonOwner() public {
        vm.startPrank(nonOwner);
        vm.expectRevert();
        factory.setProtocolTreasury(address(0xBEEF));
        vm.stopPrank();
    }

    function test_SetProtocolTreasury_RevertZeroAddress() public {
        vm.startPrank(protocolAdmin);
        vm.expectRevert(ERC404Factory.InvalidAddress.selector);
        factory.setProtocolTreasury(address(0));
        vm.stopPrank();
    }

    function test_CreateInstance_FeeGoesDirectlyToTreasury() public {
        address treasury = address(0xBEEF);
        vm.startPrank(protocolAdmin);
        factory.setProtocolTreasury(treasury);
        vm.stopPrank();

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("FeeToken", "FEE", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );

        assertEq(treasury.balance, INSTANCE_CREATION_FEE);
        assertEq(address(factory).balance, 0);
    }

    // ========================
    // Bonding Fee BPS Tests
    // ========================

    function test_SetBondingFeeBps() public {
        vm.startPrank(protocolAdmin);
        factory.setBondingFeeBps(200);
        assertEq(factory.bondingFeeBps(), 200);
        vm.stopPrank();
    }

    function test_SetBondingFeeBps_RevertExceedsCap() public {
        vm.startPrank(protocolAdmin);
        vm.expectRevert(ERC404Factory.MaxBondingFeeExceeded.selector);
        factory.setBondingFeeBps(301);
        vm.stopPrank();
    }

    function test_SetBondingFeeBps_RevertNonOwner() public {
        vm.startPrank(nonOwner);
        vm.expectRevert();
        factory.setBondingFeeBps(200);
        vm.stopPrank();
    }

    function test_BondingFeeBps_DefaultValue() public view {
        assertEq(factory.bondingFeeBps(), 100);
    }

    // ========================
    // Role-Based Access Tests
    // ========================

    function test_protocolRole_canSetBondingFee() public {
        vm.startPrank(protocolAdmin);
        factory.setBondingFeeBps(200);
        assertEq(factory.bondingFeeBps(), 200);
        vm.stopPrank();
    }

    // ========================
    // Curve Params Tests (on CurveParamsComputer)
    // ========================

    function test_computeCurveParams_standardProfile() public view {
        uint256 nftCount = 100;
        BondingCurveMath.Params memory params = curveComp.computeCurveParams(nftCount, 15 ether, 1e6, 2000);
        uint256 totalSupply = nftCount * 1e6 * 1e18;
        uint256 maxBondingSupply = totalSupply - (totalSupply * 2000) / 10000;
        uint256 totalCost = BondingCurveMath.calculateCost(params, 0, maxBondingSupply);
        assertApproxEqRel(totalCost, 15 ether, 0.01e18);
    }

    function test_computeCurveParams_nicheProfile() public view {
        uint256 nftCount = 50;
        BondingCurveMath.Params memory params = curveComp.computeCurveParams(nftCount, 5 ether, 1e9, 2000);
        uint256 totalSupply = nftCount * 1e9 * 1e18;
        uint256 maxBondingSupply = totalSupply - (totalSupply * 2000) / 10000;
        uint256 totalCost = BondingCurveMath.calculateCost(params, 0, maxBondingSupply);
        assertApproxEqRel(totalCost, 5 ether, 0.01e18);
    }

    function test_computeCurveParams_ambitiousProfile() public view {
        uint256 nftCount = 500;
        BondingCurveMath.Params memory params = curveComp.computeCurveParams(nftCount, 30 ether, 1e3, 2000);
        uint256 totalSupply = nftCount * 1e3 * 1e18;
        uint256 maxBondingSupply = totalSupply - (totalSupply * 2000) / 10000;
        uint256 totalCost = BondingCurveMath.calculateCost(params, 0, maxBondingSupply);
        assertApproxEqRel(totalCost, 30 ether, 0.01e18);
    }

    // ========================
    // createInstance with preset Tests
    // ========================

    function test_createInstance_withPreset() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator1,
                nftCount: 100,
                presetId: uint8(DEFAULT_PRESET_ID),
                vault: address(mockVault),
                name: "TestToken",
                symbol: "TEST",
                styleUri: "",
                tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance != address(0));
        ERC404BondingInstance inst = ERC404BondingInstance(payable(instance));
        assertEq(inst.maxSupply(), 100 * 1e6 * 1e18);
        assertEq(inst.unit(), 1e6 * 1e18);
        vm.stopPrank();
    }

    function test_createInstance_inactivePresetReverts() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectRevert(abi.encodeWithSignature("PresetNotActive()"));
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator1,
                nftCount: 100,
                presetId: uint8(5), // inactive preset
                vault: address(mockVault),
                name: "TestToken",
                symbol: "TEST",
                styleUri: "",
                tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    function test_createInstance_zeroNftCountReverts() public {
        vm.deal(creator1, 1 ether);
        vm.startPrank(creator1);
        vm.expectRevert(ERC404Factory.InvalidNftCount.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator1,
                nftCount: 0,
                presetId: uint8(DEFAULT_PRESET_ID),
                vault: address(mockVault),
                name: "TestToken",
                symbol: "TEST",
                styleUri: "",
                tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopPrank();
    }

    // ── ComponentRegistry validation ──────────────────────────────────────────

    function test_createInstance_validatesLiquidityDeployer() public {
        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        vm.expectRevert(ERC404Factory.UnapprovedLiquidityDeployer.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("Token", "TKN", creator1),
            "ipfs://",
            address(0xDEAD),  // unapproved deployer
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
    }

    function test_createInstance_withApprovedDeployer_succeeds() public {
        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("Token", "TKN", creator1),
            "ipfs://",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance != address(0));
        assertEq(
            address(ERC404BondingInstance(payable(instance)).liquidityDeployer()),
            address(mockDeployer)
        );
    }

    function test_createInstanceWithGating_revertsOnUnapprovedModule() public {
        address unapprovedModule = address(0xBAD6A7);

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        vm.expectRevert(ERC404Factory.UnapprovedGatingModule.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("TestToken", "TEST", creator1),
            "ipfs://Qmtest",
            address(mockDeployer),
            unapprovedModule,
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
    }

    function test_createInstanceWithGating_succeedsWithApprovedModule() public {
        address gatingModule = address(new PasswordTierGatingModule(address(mockRegistry)));
        vm.prank(protocolAdmin);
        componentRegistry.approveComponent(gatingModule, keccak256("gating"), "PasswordTierGating");

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("GatedToken", "GATE", creator1),
            "ipfs://Qmtest",
            address(mockDeployer),
            gatingModule,
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );

        assertTrue(instance != address(0));
    }

    function test_createInstanceWithGating_zeroAddressSkipsValidation() public {
        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("OpenToken", "OPEN", creator1),
            "ipfs://Qmtest",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );

        assertTrue(instance != address(0));
    }

    function test_createInstance_withGating_storesModule() public {
        address gatingModule = address(new PasswordTierGatingModule(address(mockRegistry)));
        vm.prank(protocolAdmin);
        componentRegistry.approveComponent(gatingModule, keccak256("gating"), "PasswordTierGating2");

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("GatedToken2", "GATE2", creator1),
            "ipfs://Qmtest",
            address(mockDeployer),
            gatingModule,
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );

        assertEq(
            address(ERC404BondingInstance(payable(instance)).gatingModule()),
            gatingModule
        );
        assertTrue(ERC404BondingInstance(payable(instance)).gatingActive());
    }

    function test_createInstance_noGating_gatingActiveFalse() public {
        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("OpenToken2", "OPEN2", creator1),
            "ipfs://Qmtest",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertFalse(ERC404BondingInstance(payable(instance)).gatingActive());
    }

    /// @dev A plain vault with no hook() function must be accepted.
    function test_createInstance_noHookRequired() public {
        address plainVault = address(new PlainVault());

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator1,
                nftCount: DEFAULT_NFT_COUNT,
                presetId: uint8(DEFAULT_PRESET_ID),
                vault: plainVault,
                name: "PlainVaultToken",
                symbol: "PVT",
                styleUri: "",
                tokenBaseURI: "",
            stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        assertTrue(instance != address(0));
    }

    // ════════════════════════════════════════════════════════════════════════
    // Creator carve (graduation carve-out)
    // ════════════════════════════════════════════════════════════════════════

    function _identityWithCarve(
        string memory name_,
        address owner_,
        uint16 declaredBps
    ) internal returns (ERC404Factory.CreateParams memory p) {
        p = _identity(name_, "CRV", owner_);
        p.declaredMaxAllowanceBps = declaredBps;
    }

    /// @dev Create a carve-declaring instance via the REAL factory (so deployLiquidity reads the
    ///      factory's live effectiveCarveEth), open bonding, and warp past open.
    function _createCarveInstance(string memory name_, uint16 declaredBps)
        internal
        returns (ERC404BondingInstance inst)
    {
        vm.deal(creator1, 50 ether);
        vm.startPrank(creator1);
        address a = factory.createInstance(
            _identityWithCarve(name_, creator1, declaredBps),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        inst = ERC404BondingInstance(payable(a));
        inst.setBondingOpenTime(block.timestamp + 1);
        inst.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 2);
    }

    function _buyExact(ERC404BondingInstance inst, uint256 amount) internal {
        (uint256 ip, uint256 qc, uint256 cc, uint256 qd, uint256 nf) = inst.curveParams();
        uint256 cost = curveComp.calculateCost(
            BondingCurveMath.Params(ip, qc, cc, qd, nf), inst.totalBondingSupply(), amount
        );
        vm.prank(creator1);
        inst.buyBonding{value: cost}(amount, cost, false, bytes32(0), "", 0);
    }

    function _lastCarve() internal view returns (address creatorArg, uint256 carveArg) {
        (,,,,,, creatorArg, carveArg) = mockDeployer.lastParams();
    }

    function test_createInstance_declaredMaxOver10000Reverts() public {
        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        vm.expectRevert(ERC404Factory.InvalidDeclaredMaxAllowance.selector);
        factory.createInstance(
            _identityWithCarve("BadDeclared", creator1, 10001),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
    }

    function test_declaredMax_storedImmutablyOnInstance() public {
        ERC404BondingInstance inst = _createCarveInstance("DeclaredStored", 7500);
        assertEq(inst.declaredMaxAllowanceBps(), 7500, "declared max must be stored + readable");
    }

    function test_setMinPoolEth_protocolRoleOnly() public {
        assertEq(factory.minPoolEth(), 1 ether, "default pool floor is 1 ETH");

        vm.prank(nonOwner);
        vm.expectRevert();
        factory.setMinPoolEth(2 ether);

        vm.prank(protocolAdmin);
        vm.expectEmit(false, false, false, true);
        emit ERC404Factory.MinPoolEthUpdated(2 ether);
        factory.setMinPoolEth(2 ether);
        assertEq(factory.minPoolEth(), 2 ether);
    }

    function test_setCarveBrackets_validatesAndStores() public {
        // Defaults: 50% of first 4 ETH / 25% of next 16 / 10% beyond 20.
        RevenueSplitLib.BracketParams memory def = factory.carveBracketParams();
        assertEq(def.b1, 4 ether);
        assertEq(def.b2, 20 ether);
        assertEq(def.r1, 5000);
        assertEq(def.r2, 2500);
        assertEq(def.r3, 1000);

        RevenueSplitLib.BracketParams memory bad =
            RevenueSplitLib.BracketParams({b1: 5 ether, b2: 4 ether, r1: 100, r2: 100, r3: 100});
        vm.prank(protocolAdmin);
        vm.expectRevert(ERC404Factory.InvalidBracketParams.selector);
        factory.setCarveBrackets(bad);

        RevenueSplitLib.BracketParams memory good =
            RevenueSplitLib.BracketParams({b1: 2 ether, b2: 10 ether, r1: 4000, r2: 2000, r3: 500});
        vm.prank(nonOwner);
        vm.expectRevert();
        factory.setCarveBrackets(good);

        vm.prank(protocolAdmin);
        vm.expectEmit(false, false, false, true);
        emit ERC404Factory.CarveBracketsUpdated(2 ether, 10 ether, 4000, 2000, 500);
        factory.setCarveBrackets(good);

        RevenueSplitLib.BracketParams memory got = factory.carveBracketParams();
        assertEq(got.b1, 2 ether);
        assertEq(got.r3, 500);
    }

    function test_effectiveCarveEth_workedPoints() public view {
        // R=4, full declared, full request: allowance 2.0, LP80 3.2, headroom 2.2 -> 2.0.
        assertEq(factory.effectiveCarveEth(4 ether, 10000, 10000), 2 ether);
        // R=2: allowance 1.0, headroom 0.6 -> floor clamps to 0.6.
        assertEq(factory.effectiveCarveEth(2 ether, 10000, 10000), 0.6 ether);
        // R=1: LP80 0.8 under the floor -> 0 (clamp, not a revert).
        assertEq(factory.effectiveCarveEth(1 ether, 10000, 10000), 0);
        // Declared max halves the allowance axis: R=4, declared 5000 -> 1.0.
        assertEq(factory.effectiveCarveEth(4 ether, 5000, 10000), 1 ether);
        // Request below declared wins: R=4, declared 10000, request 2500 -> 0.5.
        assertEq(factory.effectiveCarveEth(4 ether, 10000, 2500), 0.5 ether);
        // Zeroes short-circuit.
        assertEq(factory.effectiveCarveEth(0, 10000, 10000), 0);
        assertEq(factory.effectiveCarveEth(4 ether, 0, 10000), 0);
        assertEq(factory.effectiveCarveEth(4 ether, 10000, 0), 0);
    }

    /// @notice Full-declared instance graduating with a full request: the module receives
    ///         creator = owner() and carveEth = the factory's live effective carve.
    function test_deployLiquidity_withCarve_passesCreatorAndCarveEth() public {
        ERC404BondingInstance inst = _createCarveInstance("CarveFull", 10000);
        _buyExact(inst, 5e24); // deep buy -> multi-ETH reserve

        uint256 raise = inst.reserve();
        assertGt(raise, 1.25 ether, "test needs enough raise for carve headroom");
        uint256 expected = factory.effectiveCarveEth(raise, 10000, 10000);
        assertGt(expected, 0, "expected carve must be nonzero");
        assertEq(inst.previewCarve(10000), expected, "previewCarve must match the factory math");

        vm.prank(creator1);
        inst.deployLiquidity(10000);

        (address creatorArg, uint256 carveArg) = _lastCarve();
        assertEq(creatorArg, creator1, "creator = instance owner");
        assertEq(carveArg, expected, "module receives the resolved effective carve");
        assertTrue(inst.graduated());
    }

    /// @notice Passing 0 reproduces the historic no-carve graduation exactly.
    function test_deployLiquidity_zeroRequest_zeroCarve() public {
        ERC404BondingInstance inst = _createCarveInstance("CarveZeroReq", 10000);
        _buyExact(inst, 5e24);

        vm.prank(creator1);
        inst.deployLiquidity(0);

        (, uint256 carveArg) = _lastCarve();
        assertEq(carveArg, 0, "request 0 -> carve 0");
        assertTrue(inst.graduated());
    }

    /// @notice declaredMax = 0 (no carve rights): even a full request carves nothing.
    function test_deployLiquidity_declaredZero_requestIgnored() public {
        ERC404BondingInstance inst = _createCarveInstance("CarveDeclZero", 0);
        _buyExact(inst, 5e24);

        vm.prank(creator1);
        inst.deployLiquidity(10000);

        (, uint256 carveArg) = _lastCarve();
        assertEq(carveArg, 0, "declaredMax 0 -> carve always 0");
        assertTrue(inst.graduated());
    }

    /// @notice The declared max caps the request on the allowance axis.
    function test_deployLiquidity_declaredMaxCapsRequest() public {
        ERC404BondingInstance inst = _createCarveInstance("CarveCapped", 2500);
        _buyExact(inst, 5e24);

        uint256 raise = inst.reserve();
        uint256 expected = factory.effectiveCarveEth(raise, 2500, 10000);
        uint256 uncapped = factory.effectiveCarveEth(raise, 10000, 10000);
        assertLt(expected, uncapped, "declared 2500 must bind below the full allowance");

        vm.prank(creator1);
        inst.deployLiquidity(10000);

        (, uint256 carveArg) = _lastCarve();
        assertEq(carveArg, expected, "carve capped by declaredMax");
    }

    /// @notice The pool floor CLAMPS the carve (to zero here) but never gates graduation.
    function test_deployLiquidity_floorClampsCarve_neverGates() public {
        ERC404BondingInstance inst = _createCarveInstance("CarveFloored", 10000);
        _buyExact(inst, 5e24);

        // Raise the floor above any possible LP share: headroom -> 0, carve -> 0.
        vm.prank(protocolAdmin);
        factory.setMinPoolEth(1000 ether);
        assertEq(inst.previewCarve(10000), 0, "no headroom -> preview 0");

        vm.prank(creator1);
        inst.deployLiquidity(10000);

        (, uint256 carveArg) = _lastCarve();
        assertEq(carveArg, 0, "floor eats the whole carve");
        assertTrue(inst.graduated(), "floor must NEVER block graduation");
    }

    /// @notice Partial-reserve graduation (owner's call, small raise) still works with a carve
    ///         request: the thin raise yields carve 0 and graduates.
    function test_deployLiquidity_partialReserve_thinRaiseGraduates() public {
        ERC404BondingInstance inst = _createCarveInstance("CarveThin", 10000);
        _buyExact(inst, 1e23); // tiny buy -> raise well under the floor's reach

        uint256 raise = inst.reserve();
        assertLt(raise, 1 ether, "precondition: thin raise");

        vm.prank(creator1);
        inst.deployLiquidity(10000);

        (, uint256 carveArg) = _lastCarve();
        assertEq(carveArg, 0, "thin raise -> carve structurally 0");
        assertTrue(inst.graduated(), "minnows always graduate");
    }

    // ========================
    // Deploy-bond lever (N12)
    // ========================

    function _wireEscrow(address treasury, uint256 bondAmount) internal returns (DeployBondEscrow escrow) {
        vm.startPrank(protocolAdmin);
        factory.setProtocolTreasury(treasury);
        escrow = new DeployBondEscrow(protocolAdmin, address(factory), treasury);
        factory.setDeployBondEscrow(address(escrow));
        if (bondAmount > 0) escrow.setBondAmount(bondAmount);
        vm.stopPrank();
    }

    /// @dev Escrow wired but bondAmount 0 → create must behave exactly as today: full msg.value to
    ///      treasury, factory holds no ETH, no bond escrowed.
    function test_bondLeverOff_byteIdentical_fullFeeToTreasury() public {
        address treasury = address(0xBEEF);
        DeployBondEscrow escrow = _wireEscrow(treasury, 0);

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("LeverOff", "OFF", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );

        assertEq(treasury.balance, INSTANCE_CREATION_FEE, "full fee to treasury");
        assertEq(address(factory).balance, 0, "factory holds no ETH");
        assertEq(address(escrow).balance, 0, "nothing escrowed when lever off");
        (, uint256 amt, uint40 createdAt,) = escrow.bonds(instance);
        assertEq(amt, 0);
        assertEq(createdAt, 0, "no bond record when lever off");
    }

    function test_bondLeverOn_escrowsBond_forwardsExcess() public {
        address treasury = address(0xBEEF);
        uint256 bond = 0.006 ether;
        DeployBondEscrow escrow = _wireEscrow(treasury, bond);
        uint256 excess = INSTANCE_CREATION_FEE - bond;

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        address instance = factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("LeverOn", "ON", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );

        assertEq(address(escrow).balance, bond, "bond escrowed");
        assertEq(treasury.balance, excess, "excess to treasury");
        assertEq(address(factory).balance, 0, "factory holds no ETH");
        (address c, uint256 amt,, bool settled) = escrow.bonds(instance);
        assertEq(c, creator1, "creator recorded as owner");
        assertEq(amt, bond);
        assertFalse(settled);
    }

    function test_bondLeverOn_revertsOnInsufficientValue() public {
        address treasury = address(0xBEEF);
        uint256 bond = 0.02 ether; // > INSTANCE_CREATION_FEE
        _wireEscrow(treasury, bond);

        vm.deal(creator1, 1 ether);
        vm.prank(creator1);
        vm.expectRevert(ERC404Factory.InsufficientBond.selector);
        factory.createInstance{value: INSTANCE_CREATION_FEE}(
            _identity("TooLittle", "LOW", creator1),
            "ipfs://metadata",
            address(mockDeployer),
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
    }

    function test_setDeployBondEscrow_onlyProtocolRole() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        factory.setDeployBondEscrow(address(0xCAFE));

        vm.prank(protocolAdmin);
        factory.setDeployBondEscrow(address(0xCAFE));
        assertEq(factory.deployBondEscrow(), address(0xCAFE));
    }
}
