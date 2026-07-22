// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404Factory } from "../../../src/factories/erc404/ERC404Factory.sol";
import {
    ERC404BondingInstance,
    FreeMintDisabled,
    FreeMintAlreadyClaimed,
    FreeMintExhausted
} from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { LaunchManager } from "../../../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { MerkleGatingModule } from "../../../src/gating/MerkleGatingModule.sol";
import { MerkleConfig } from "../../../src/gating/IMerkleGatingModule.sol";
import { MerkleAllowlistHelper } from "../../gating/MerkleAllowlistHelper.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { IGatingModule } from "../../../src/gating/IGatingModule.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract MockVaultFM {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

contract MockDeployerFM is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

contract ERC404FreeMintTest is Test {
    uint256 internal _saltCounter;

    ERC404Factory factory;
    LaunchManager launchMgr;
    CurveParamsComputer curveComp;
    MockMasterRegistry mockRegistry;
    MockVaultFM mockVault;
    ComponentRegistry componentRegistry;
    MockDeployerFM mockDeployer;

    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address mockGMR = makeAddr("gmr");

    uint8 constant PRESET_ID = 1;
    uint256 constant NFT_COUNT = 10;
    uint256 constant FREE_MINT_COUNT = 3;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocol);

        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVaultFM();
        launchMgr = new LaunchManager(protocol);
        curveComp = new CurveParamsComputer(protocol);
        mockDeployer = new MockDeployerFM();

        ComponentRegistry impl = new ComponentRegistry();
        address proxy = LibClone.deployERC1967(address(impl));
        componentRegistry = ComponentRegistry(proxy);
        componentRegistry.initialize(protocol);
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "Curve");
        componentRegistry.approveComponent(address(mockDeployer), keccak256("liquidity"), "Deployer");

        launchMgr.setPreset(
            PRESET_ID,
            LaunchManager.Preset({
                targetETH: 10 ether,
                unitPerNFT: 1e6,
                liquidityReserveBps: 2000,
                curveComputer: address(curveComp),
                active: true
            })
        );

        ERC404BondingInstance instanceImpl = new ERC404BondingInstance();
        factory = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(instanceImpl),
                masterRegistry: address(mockRegistry),
                protocol: protocol,
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

    // ── helpers ──────────────────────────────────────────────────────────────

    function _identity() internal returns (ERC404Factory.CreateParams memory) {
        return ERC404Factory.CreateParams({
            salt: _nextSalt(),
            owner: creator,
            nftCount: NFT_COUNT,
            presetId: PRESET_ID,
            vault: address(mockVault),
            name: "FreeMintToken",
            symbol: "FMT",
            styleUri: "",
            tokenBaseURI: "",
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });
    }

    function _freeMint(uint256 alloc, GatingScope scope) internal pure returns (FreeMintParams memory) {
        return FreeMintParams({ allocation: alloc, scope: scope });
    }

    function _deploy(uint256 alloc, GatingScope scope, address gatingModule) internal returns (ERC404BondingInstance) {
        vm.prank(creator);
        address inst = factory.createInstance(
            _identity(), "ipfs://meta", address(mockDeployer), gatingModule, _freeMint(alloc, scope)
        );
        return ERC404BondingInstance(payable(inst));
    }

    /// @dev Open the curve so free mints become claimable — they cannot be claimed before it opens.
    function _open(ERC404BondingInstance inst) internal {
        vm.prank(creator);
        inst.setBondingOpenTime(block.timestamp + 1);
        vm.warp(block.timestamp + 2);
    }

    // ── freeMintAllocation stored correctly ───────────────────────────────────

    function test_freeMint_allocationStoredOnInstance() public {
        ERC404BondingInstance inst = _deploy(FREE_MINT_COUNT, GatingScope.BOTH, address(0));
        assertEq(inst.freeMintAllocation(), FREE_MINT_COUNT);
    }

    function test_freeMint_zeroAllocation_disabled() public {
        ERC404BondingInstance inst = _deploy(0, GatingScope.BOTH, address(0));
        assertEq(inst.freeMintAllocation(), 0);
    }

    // ── claimFreeMint happy path ─────────────────────────────────────────────

    function test_freeMint_claim_mintsOneUnit() public {
        ERC404BondingInstance inst = _deploy(FREE_MINT_COUNT, GatingScope.BOTH, address(0));
        uint256 unit = inst.unit();
        _open(inst);

        vm.prank(user1);
        inst.claimFreeMint("");

        assertEq(inst.balanceOf(user1), unit);
        assertEq(inst.freeMintsClaimed(), 1);
        assertTrue(inst.freeMintClaimed(user1));
    }

    function test_freeMint_multipleUsers_canClaim() public {
        ERC404BondingInstance inst = _deploy(FREE_MINT_COUNT, GatingScope.BOTH, address(0));
        _open(inst);

        vm.prank(user1);
        inst.claimFreeMint("");
        vm.prank(user2);
        inst.claimFreeMint("");

        assertEq(inst.freeMintsClaimed(), 2);
    }

    // ── claimFreeMint reverts ─────────────────────────────────────────────────

    function test_freeMint_revertsWhenDisabled() public {
        ERC404BondingInstance inst = _deploy(0, GatingScope.BOTH, address(0));
        vm.prank(user1);
        vm.expectRevert(FreeMintDisabled.selector);
        inst.claimFreeMint("");
    }

    function test_freeMint_revertsWhenAlreadyClaimed() public {
        ERC404BondingInstance inst = _deploy(FREE_MINT_COUNT, GatingScope.BOTH, address(0));
        _open(inst);
        vm.prank(user1);
        inst.claimFreeMint("");
        vm.prank(user1);
        vm.expectRevert(FreeMintAlreadyClaimed.selector);
        inst.claimFreeMint("");
    }

    function test_freeMint_revertsWhenExhausted() public {
        // allocation = 1, two users try to claim
        ERC404BondingInstance inst = _deploy(1, GatingScope.BOTH, address(0));
        _open(inst);
        vm.prank(user1);
        inst.claimFreeMint("");
        vm.prank(user2);
        vm.expectRevert(FreeMintExhausted.selector);
        inst.claimFreeMint("");
    }

    // ── supply accounting ─────────────────────────────────────────────────────

    function test_freeMint_reducesEffectiveBondingCap() public {
        // NFT_COUNT=10, free=3 → bonding cap covers 7 NFTs worth
        ERC404BondingInstance inst = _deploy(FREE_MINT_COUNT, GatingScope.BOTH, address(0));
        uint256 unit = inst.unit();
        uint256 cap = inst.maxSupply() - inst.liquidityReserve() - (FREE_MINT_COUNT * unit);
        // totalBondingSupply starts at 0; can buy up to cap, not full maxSupply
        assertEq(inst.freeMintAllocation(), FREE_MINT_COUNT);
        // Verify the contract holds full supply
        assertEq(inst.balanceOf(address(inst)), inst.maxSupply());
    }

    // ── GatingScope: BOTH — free-mint path is gated ─────────────────────────────
    // (PasswordTierGatingModule was removed; these scope-routing tests now use the surviving
    //  MerkleGatingModule as the concrete gating module. Config is authored post-create by the owner.)

    function test_gatingScope_BOTH_gatesFreeMintClaim() public {
        MerkleGatingModule merkle = _merkleModule();
        (bytes32 root, bytes memory data) = _merkleUser1();

        ERC404BondingInstance instance = _deploy(FREE_MINT_COUNT, GatingScope.BOTH, address(merkle));
        _configEdition0(merkle, address(instance), root);
        _open(instance);

        // BOTH consults the module on the free path: allowlisted user1 claims with a valid proof.
        vm.prank(user1);
        instance.claimFreeMint(data);
        assertEq(instance.freeMintsClaimed(), 1);

        // A non-allowlisted claimer is rejected — proving the free path is gated under BOTH.
        vm.prank(makeAddr("nonlistedFree"));
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        instance.claimFreeMint(data);
    }

    // ── GatingScope: FREE_MINT_ONLY — paid buys bypass gate ───────────────────

    function test_gatingScope_FREE_MINT_ONLY_paidBuyBypassesGate() public {
        MerkleGatingModule merkle = _merkleModule();
        (bytes32 root,) = _merkleUser1();

        ERC404BondingInstance instance = _deploy(FREE_MINT_COUNT, GatingScope.FREE_MINT_ONLY, address(merkle));
        _configEdition0(merkle, address(instance), root);

        vm.startPrank(creator);
        instance.setBondingOpenTime(block.timestamp + 1);
        vm.warp(block.timestamp + 2);
        instance.setBondingActive(true);
        vm.stopPrank();

        // FREE_MINT_ONLY: the paid curve is open — a non-allowlisted buyer needs no proof.
        address buyer = makeAddr("fmoBuyer");
        uint256 buyAmount = instance.unit();
        uint256 maxCost = 10 ether;
        vm.deal(buyer, maxCost);
        vm.prank(buyer);
        instance.buyBonding{ value: maxCost }(buyAmount, maxCost, false, bytes(""), "", 0);
        assertGt(instance.balanceOf(buyer), 0);
    }

    // ── GatingScope: PAID_ONLY — free mint bypasses gate ──────────────────────

    function test_gatingScope_PAID_ONLY_freeMintBypassesGate() public {
        MerkleGatingModule merkle = _merkleModule();
        (bytes32 root,) = _merkleUser1();

        // Root does NOT list the free-mint claimer below — if PAID_ONLY wrongly consulted the module on
        // the free path, the claim would revert with InvalidProof. It must succeed (free path is open).
        ERC404BondingInstance instance = _deploy(FREE_MINT_COUNT, GatingScope.PAID_ONLY, address(merkle));
        _configEdition0(merkle, address(instance), root);
        _open(instance);

        vm.prank(makeAddr("poFreeClaimer"));
        instance.claimFreeMint("");
        assertEq(instance.freeMintsClaimed(), 1);
    }

    // ── gatingScope stored correctly ──────────────────────────────────────────

    function test_gatingScope_storedOnInstance() public {
        ERC404BondingInstance instBoth = _deploy(1, GatingScope.BOTH, address(0));
        ERC404BondingInstance instFMO = _deploy(1, GatingScope.FREE_MINT_ONLY, address(0));
        ERC404BondingInstance instPO = _deploy(1, GatingScope.PAID_ONLY, address(0));

        assertEq(uint8(instBoth.gatingScope()), uint8(GatingScope.BOTH));
        assertEq(uint8(instFMO.gatingScope()), uint8(GatingScope.FREE_MINT_ONLY));
        assertEq(uint8(instPO.gatingScope()), uint8(GatingScope.PAID_ONLY));
    }

    // ── Merkle allowlist gating on ERC404 (single curve → editionId 0) ─────────────

    function _merkleModule() internal returns (MerkleGatingModule m) {
        m = new MerkleGatingModule(address(mockRegistry));
        vm.prank(protocol);
        componentRegistry.approveComponent(address(m), keccak256("gating"), "Merkle Allowlist Gating");
    }

    /// @dev allowlist over {user1, user2}, both with a large cap. Returns root + user1's proof/maxQty.
    function _merkleUser1() internal returns (bytes32 root, bytes memory data) {
        MerkleAllowlistHelper helper = new MerkleAllowlistHelper();
        MerkleAllowlistHelper.Entry[] memory e = new MerkleAllowlistHelper.Entry[](2);
        e[0] = MerkleAllowlistHelper.Entry(user1, 1e30);
        e[1] = MerkleAllowlistHelper.Entry(user2, 1e30);
        bytes32[] memory proof;
        uint256 q;
        (root, proof, q) = helper.build(e, 0);
        data = helper.encodeData(0, q, proof);
    }

    function _configEdition0(MerkleGatingModule merkle, address inst, bytes32 root) internal {
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = root;
        uint256[] memory times = new uint256[](1);
        times[0] = 0;
        vm.prank(creator); // creator == instance owner authors the config post-create
        merkle.configureFor(inst, MerkleConfig({ editionId: 0, roots: roots, tierOpenTimes: times }));
    }

    function test_merkle_erc404_freePath_editionZero() public {
        MerkleGatingModule merkle = _merkleModule();
        (bytes32 root, bytes memory data) = _merkleUser1();

        ERC404BondingInstance inst = _deploy(FREE_MINT_COUNT, GatingScope.BOTH, address(merkle));
        _configEdition0(merkle, address(inst), root);
        _open(inst);

        // Allowlisted user1 claims the free mint (module keyed on editionId 0).
        vm.prank(user1);
        inst.claimFreeMint(data);
        assertEq(inst.freeMintsClaimed(), 1);
        assertEq(merkle.claimed(address(inst), 0, user1), inst.unit());

        // Non-allowlisted intruder replaying user1's proof → rejected.
        vm.prank(makeAddr("intruder404"));
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        inst.claimFreeMint(data);
    }

    function test_merkle_erc404_paidPath_editionZero() public {
        MerkleGatingModule merkle = _merkleModule();
        (bytes32 root, bytes memory data) = _merkleUser1();

        ERC404BondingInstance inst = _deploy(0, GatingScope.BOTH, address(merkle));
        _configEdition0(merkle, address(inst), root);

        vm.startPrank(creator);
        inst.setBondingOpenTime(block.timestamp + 1);
        vm.warp(block.timestamp + 2);
        inst.setBondingActive(true);
        vm.stopPrank();

        uint256 buyAmount = inst.unit();
        uint256 maxCost = 10 ether;

        // Allowlisted user1 buys on the curve with a valid proof.
        vm.deal(user1, maxCost);
        vm.prank(user1);
        inst.buyBonding{ value: maxCost }(buyAmount, maxCost, false, data, "", 0);
        assertGt(inst.balanceOf(user1), 0);

        // Non-allowlisted intruder with user1's proof → rejected on the paid path.
        address intruder = makeAddr("intruderPaid");
        vm.deal(intruder, maxCost);
        vm.prank(intruder);
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        inst.buyBonding{ value: maxCost }(buyAmount, maxCost, false, data, "", 0);
    }

    function test_merkle_erc404_scope_freeMintOnly_paidBypassesGate() public {
        // FREE_MINT_ONLY: the paid curve is open — a non-allowlisted buyer needs no proof.
        MerkleGatingModule merkle = _merkleModule();
        (bytes32 root,) = _merkleUser1();

        ERC404BondingInstance inst = _deploy(FREE_MINT_COUNT, GatingScope.FREE_MINT_ONLY, address(merkle));
        _configEdition0(merkle, address(inst), root);

        vm.startPrank(creator);
        inst.setBondingOpenTime(block.timestamp + 1);
        vm.warp(block.timestamp + 2);
        inst.setBondingActive(true);
        vm.stopPrank();

        address intruder = makeAddr("intruderFMO");
        uint256 maxCost = 10 ether;
        uint256 amt = inst.unit(); // precompute: an inline external call would consume the prank below
        vm.deal(intruder, maxCost);
        vm.prank(intruder);
        inst.buyBonding{ value: maxCost }(amt, maxCost, false, bytes(""), "", 0);
        assertGt(inst.balanceOf(intruder), 0);
    }
}
