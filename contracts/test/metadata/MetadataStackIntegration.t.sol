// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { LaunchManager } from "../../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../src/gating/IGatingModule.sol";
import { TierConfig } from "../../src/gating/IPasswordTierGatingModule.sol";
import { ComponentRegistry } from "../../src/registry/ComponentRegistry.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { MetadataResolverRouter } from "../../src/metadata/MetadataResolverRouter.sol";
import { MetadataOverlayModule } from "../../src/metadata/MetadataOverlayModule.sol";
import { TierRevealModule } from "../../src/metadata/TierRevealModule.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

/// @dev The base DN404's `tokenURINFT(uint256)` resolves `_tokenURI` WITHOUT the mirror's existence
///      guard — so it reads the seam's resolution for any id (minted or not), which is what the
///      resolver path itself sees.
interface ITokenURINFT {
    function tokenURINFT(uint256 id) external view returns (string memory);
}

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

/// @notice End-to-end proof of the metadata-resolution seam: a real ERC404 instance wired through a
///         MetadataResolverRouter → [overlay, tier], asserting tokenURI(id) composes overlay → tier →
///         base precedence on-chain (the contract-level proof that replaces the UI walk for M1).
contract MetadataStackIntegrationTest is Test {
    ERC404Factory factory;
    LaunchManager launchMgr;
    CurveParamsComputer curveComp;
    MockMasterRegistry registry;
    MockVault vault;
    ComponentRegistry componentRegistry;
    MockLiquidityDeployer deployer;

    MetadataResolverRouter router;
    MetadataOverlayModule overlay;
    TierRevealModule tier;

    address protocolAdmin = address(0x9);
    address creator = address(0x2);
    address unapproved = address(0xDEAD); // never approved in the component registry

    uint256 constant PRESET_ID = 1;
    uint256 constant UNIT = 1e24; // unitPerNFT 1e6 * 1e18
    uint256 internal _nonce;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocolAdmin);

        registry = new MockMasterRegistry();
        vault = new MockVault();
        launchMgr = new LaunchManager(protocolAdmin);
        curveComp = new CurveParamsComputer(protocolAdmin);
        deployer = new MockLiquidityDeployer();

        ComponentRegistry impl = new ComponentRegistry();
        componentRegistry = ComponentRegistry(LibClone.deployERC1967(address(impl)));
        componentRegistry.initialize(protocolAdmin);
        componentRegistry.approveComponent(address(curveComp), keccak256("curve"), "Curve");
        componentRegistry.approveComponent(address(deployer), keccak256("liquidity"), "Deployer");

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

        ERC404BondingInstance instImpl = new ERC404BondingInstance();
        factory = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(instImpl),
                masterRegistry: address(registry),
                protocol: protocolAdmin,
                weth: address(0xBEEF)
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: address(0x5555),
                launchManager: address(launchMgr),
                componentRegistry: address(componentRegistry)
            })
        );

        // Metadata stack (modules read isFactoryRegistered off the mock registry → factory may seal).
        router = new MetadataResolverRouter(address(registry));
        overlay = new MetadataOverlayModule(address(registry));
        tier = new TierRevealModule(address(registry));
        componentRegistry.approveComponent(address(router), keccak256("resolver"), "Router");
        componentRegistry.approveComponent(address(overlay), keccak256("overlay"), "Overlay");
        componentRegistry.approveComponent(address(tier), keccak256("tier"), "Tier");

        vm.stopPrank();
    }

    function _createStacked() internal returns (ERC404BondingInstance b, DN404Mirror mirror) {
        // Tier: ids 1-2 reveal "rare-" once the holder clears 1 unit; teaser "locked-" otherwise.
        TierRevealModule.Tier[] memory tiers = new TierRevealModule.Tier[](1);
        tiers[0] =
            TierRevealModule.Tier({ idStart: 1, idEnd: 2, minBalance: UNIT, baseURI: "rare-", lockedURI: "locked-" });

        address[] memory children = new address[](2);
        children[0] = address(overlay); // explicit pins/events win over...
        children[1] = address(tier); // ...ambient rarity

        ERC404Factory.MetadataConfig memory meta = ERC404Factory.MetadataConfig({
            resolver: address(router),
            childResolvers: children,
            overlay: address(overlay),
            tier: address(tier),
            tiers: tiers,
            autoLatest: false,
            defaultPayout: MetadataOverlayModule.Payout.ARTIST
        });

        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: bytes32(uint256(1)),
            owner: creator,
            nftCount: 10,
            presetId: uint8(PRESET_ID),
            vault: address(vault),
            name: "prism",
            symbol: "PRISM",
            styleUri: "",
            tokenBaseURI: "base/",
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });

        TierConfig memory noGating;
        vm.prank(creator);
        address inst = factory.createInstance(
            params,
            "ipfs://collection",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            noGating,
            meta
        );
        b = ERC404BondingInstance(payable(inst));
        // The instance deploys its DN404Mirror as its first (and only) CREATE during initialize → nonce 1.
        mirror = DN404Mirror(payable(vm.computeCreateAddress(inst, 1)));
    }

    function _uri(ERC404BondingInstance b, uint256 id) internal view returns (string memory) {
        return ITokenURINFT(address(b)).tokenURINFT(id);
    }

    function _params(string memory name, bytes32 salt) internal view returns (ERC404Factory.CreateParams memory) {
        return ERC404Factory.CreateParams({
            salt: salt,
            owner: creator,
            nftCount: 10,
            presetId: uint8(PRESET_ID),
            vault: address(vault),
            name: name,
            symbol: "SYM",
            styleUri: "",
            tokenBaseURI: "base/",
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });
    }

    /// @dev Create through the metadata overload with an arbitrary MetadataConfig (unique name+salt).
    function _create(string memory name, ERC404Factory.MetadataConfig memory meta) internal returns (address) {
        TierConfig memory noGating;
        _nonce++;
        vm.prank(creator);
        return factory.createInstance(
            _params(name, bytes32(_nonce)),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            noGating,
            meta
        );
    }

    function _children(address a, address b) internal pure returns (address[] memory rs) {
        rs = new address[](2);
        rs[0] = a;
        rs[1] = b;
    }

    function _buy(ERC404BondingInstance b, uint256 amount) internal {
        (uint256 ip, uint256 q4, uint256 c3, uint256 q2, uint256 nf) = b.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params({
            initialPrice: ip, quarticCoeff: q4, cubicCoeff: c3, quadraticCoeff: q2, normalizationFactor: nf
        });
        uint256 cost = BondingCurveMath.calculateCost(p, b.totalBondingSupply(), amount);
        uint256 fee = (cost * b.bondingFeeBps()) / 10000;
        uint256 total = cost + fee;
        vm.deal(creator, total);
        vm.prank(creator);
        b.buyBonding{ value: total }(amount, total, true, bytes(""), "", 0); // mintNFT = true
    }

    function test_tokenURI_resolvesOverlayThenTierThenBase() public {
        (ERC404BondingInstance b, DN404Mirror mirror) = _createStacked();

        // Wiring sealed: instance points at the router, router orders [overlay, tier].
        assertEq(b.modules(keccak256("metadata.resolver")), address(router));
        assertEq(router.resolverCount(address(b)), 2);
        assertTrue(tier.sealed_(address(b)));

        // ── Pre-mint: tier teaser for in-range unsold ids; base for everything else ──
        assertEq(_uri(b, 1), "locked-"); // overlay "" → tier teaser
        assertEq(_uri(b, 5), "base/5"); // overlay "" → tier "" → collection base

        // ── Mint: creator buys 2 whole units → owns ids 1,2, balance clears the tier threshold ──
        vm.prank(creator);
        b.setBondingOpenTime(block.timestamp + 1 hours);
        vm.prank(creator);
        b.setBondingActive(true);
        _buy(b, 2 * UNIT);
        assertEq(b.ownerOf(1), creator);
        assertEq(b.balanceOf(creator), 2 * UNIT);

        // Tier now reveals the rare ids the holder backs. The minted id goes through the REAL ERC721
        // entrypoint (the mirror's tokenURI) to prove the seam end-to-end.
        assertEq(mirror.tokenURI(1), "rare-1"); // overlay "" → tier reveal, via the mirror
        assertEq(_uri(b, 2), "rare-2");

        // ── Overlay event wins over tier when the holder pins it ──
        vm.prank(creator);
        uint256 w = overlay.publishWave(
            address(b), "evt-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        vm.prank(creator);
        overlay.select(address(b), 1, w + 3); // pin the wave on id 1
        assertEq(mirror.tokenURI(1), "evt-1"); // overlay precedence over tier reveal

        // ── Paid commission wins over tier too ──
        vm.prank(creator);
        overlay.setCommission(
            address(b), 2, "comm-2", MetadataOverlayModule.CommCond.PAY, 0.5 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(creator, 0.5 ether);
        vm.prank(creator);
        overlay.unlock{ value: 0.5 ether }(address(b), 2);
        assertEq(mirror.tokenURI(2), "comm-2"); // overlay commission over tier "rare-2"

        // id 5 is still pure base — the stack is fully transparent where no module claims it.
        assertEq(_uri(b, 5), "base/5");
    }

    /// @dev A reverting/again-misbehaving resolver can never brick tokenURI — it degrades to base.
    function test_tokenURI_defensiveFallbackToBase() public {
        (ERC404BondingInstance b,) = _createStacked();
        // id 9 is outside the tier range and has no overlay content → base.
        assertEq(_uri(b, 9), "base/9");
    }

    /// @dev The seam is sealed: only the factory may wire a module slot, and only once.
    function test_initModule_onlyFactory() public {
        (ERC404BondingInstance b,) = _createStacked();
        vm.prank(address(0xBAD));
        vm.expectRevert(bytes4(keccak256("OnlyFactory()")));
        b.initModule(keccak256("metadata.resolver"), address(0x1234));
    }

    function test_initModule_alreadySet_reverts() public {
        (ERC404BondingInstance b,) = _createStacked();
        // The factory already wired METADATA_RESOLVER during create → a second wire is rejected.
        vm.prank(address(factory));
        vm.expectRevert(bytes4(keccak256("ModuleAlreadySet()")));
        b.initModule(keccak256("metadata.resolver"), address(0x1234));
    }

    function test_ownerOf_revertsOnUnmintedId() public {
        (ERC404BondingInstance b,) = _createStacked();
        vm.expectRevert(); // DN404 TokenDoesNotExist — holder-write auth can't target a nonexistent token
        b.ownerOf(999);
    }

    // ── Factory _wireMetadata: validation + config shapes ───────────────────────

    /// @dev Empty config (resolver == address(0)) wires nothing — feature off, pure base metadata.
    function test_wireMetadata_featureOff_whenResolverZero() public {
        ERC404Factory.MetadataConfig memory empty; // all zero / empty arrays
        address inst = _create("plain", empty);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        assertEq(b.modules(keccak256("metadata.resolver")), address(0));
        assertEq(_uri(b, 1), "base/1"); // no resolver → straight to base
    }

    function test_wireMetadata_unapprovedResolver_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = unapproved;
        vm.expectRevert(ERC404Factory.UnapprovedResolver.selector);
        _create("badresolver", meta);
    }

    function test_wireMetadata_unapprovedChild_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.childResolvers = _children(address(overlay), unapproved); // second child not approved
        vm.expectRevert(ERC404Factory.UnapprovedResolver.selector);
        _create("badchild", meta);
    }

    function test_wireMetadata_unapprovedTier_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.tier = unapproved;
        vm.expectRevert(ERC404Factory.UnapprovedResolver.selector);
        _create("badtier", meta);
    }

    function test_wireMetadata_unapprovedOverlay_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.overlay = unapproved;
        vm.expectRevert(ERC404Factory.UnapprovedResolver.selector);
        _create("badoverlay", meta);
    }

    /// @dev A collection wanting one module points the slot straight at it (no router); the router
    ///      wiring is skipped (empty childResolvers) and the single module resolves directly.
    function test_wireMetadata_singleModuleNoRouter() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(overlay); // instance points directly at overlay
        meta.overlay = address(overlay); // seal its config
        meta.autoLatest = true;
        address inst = _create("solo", meta);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        assertEq(b.modules(keccak256("metadata.resolver")), address(overlay));
        assertTrue(overlay.configured(inst));
        assertEq(router.resolverCount(inst), 0); // router untouched — no children sealed

        // Overlay resolves directly: an open AUTO wave shows with no router in the path.
        vm.prank(creator);
        overlay.publishWave(
            inst, "solo-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        assertEq(_uri(b, 7), "solo-7");
    }
}
