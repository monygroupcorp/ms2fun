// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import {
    InitModuleFailed,
    InitTierBandsFailed,
    InvalidBand,
    BandIdOverflow
} from "../../src/factories/erc404/ERC404BondingStorage.sol";
import { LaunchManager } from "../../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../src/gating/IGatingModule.sol";
import { ComponentRegistry } from "../../src/registry/ComponentRegistry.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { MetadataResolverRouter } from "../../src/metadata/MetadataResolverRouter.sol";
import { MetadataOverlayModule } from "../../src/metadata/MetadataOverlayModule.sol";
import { TokenTierBandResolver } from "../../src/metadata/TokenTierBandResolver.sol";
import { MockHostileResolver } from "../mocks/MockHostileResolver.sol";
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
    TokenTierBandResolver tier;

    address protocolAdmin = address(0x9);
    address creator = address(0x2);
    address unapproved = address(0xDEAD); // never approved in the component registry

    uint256 constant PRESET_ID = 1;
    /// @dev unitPerNFT 1 (one whole token per NFT). Only used by the uint32-derivation test: an id
    ///      ceiling above `type(uint32).max` needs a small unit, or DN404's own `TotalSupplyOverflow`
    ///      (totalSupply is uint96) fires first and the create never reaches the derivation.
    uint256 constant PRESET_TINY_UNIT = 2;
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
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "Curve");
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
        launchMgr.setPreset(
            PRESET_TINY_UNIT,
            LaunchManager.Preset({
                targetETH: 15 ether,
                unitPerNFT: 1,
                liquidityReserveBps: 2000,
                curveComputer: address(curveComp),
                active: true
            })
        );

        // A REAL Ops target, not `address(0)`: `initModule` is a delegatecall trampoline (noesis-149), and
        // a delegatecall to a code-less address SUCCEEDS while writing nothing — the module slot would
        // silently stay unwired and every assertion below would read `address(0)`.
        ERC404BondingInstance instImpl = new ERC404BondingInstance(address(new ERC404BondingOps()));
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
        tier = new TokenTierBandResolver(address(registry));
        componentRegistry.approveComponent(address(router), keccak256("resolver"), "Router");
        componentRegistry.approveComponent(address(overlay), keccak256("overlay"), "Overlay");
        componentRegistry.approveComponent(address(tier), keccak256("tier"), "Tier");
        // R2: the router self-validates its children against the ComponentRegistry via
        // masterRegistry.componentRegistry(), so the mock must return the real registry (else the
        // stacked-router seal reverts on a call to address(0)).
        registry.setComponentRegistry(address(componentRegistry));

        vm.stopPrank();
    }

    function _createStacked() internal returns (ERC404BondingInstance b, DN404Mirror mirror) {
        // Ladder: one tier at weight 2. On this suite's `nftCount: 10` the factory derives
        // `maxSize = 10 / 2 = 5`, so the band is ids 11-15, each serving "rare-<id>" unconditionally.
        // Band ids sit above the mintable ceiling by construction now, and the precedence assertions
        // below still go through the REAL ERC721 entrypoint (the mirror's `tokenURI`, which requires
        // the id to exist) because a band id becomes ownable via `mintUp` — see `_mintUpTwice`.
        ERC404Factory.TierSpec[] memory tiers = new ERC404Factory.TierSpec[](1);
        tiers[0] = ERC404Factory.TierSpec({ weight: 2, count: 0, baseURI: "rare-" });

        address[] memory children = new address[](2);
        children[0] = address(overlay); // explicit pins/events win over...
        children[1] = address(tier); // ...static band art

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

        vm.prank(creator);
        address inst = factory.createInstance(
            params,
            "ipfs://collection",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
        b = ERC404BondingInstance(payable(inst));
        mirror = DN404Mirror(payable(b.mirrorERC721()));
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
        _nonce++;
        vm.prank(creator);
        return factory.createInstance(
            _params(name, bytes32(_nonce)),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
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

    /// @dev Open the curve, buy 5 whole units, and convert two of the resulting ordinary ids into the
    ///      first two band ids (11, 12) through the real tier path. `weight: 2` escrows one unit per
    ///      `mintUp`, and DN404 reconciles that debit by burning the caller's NFTs LIFO off the tail —
    ///      so the ids passed in are the caller's LOWEST-index ones (1 then 2), which the tail burn
    ///      reaches last. After both ops the creator holds band ids 11 and 12 plus one ordinary id.
    function _openAndMintUpTwo(ERC404BondingInstance b) internal {
        vm.prank(creator);
        b.setBondingOpenTime(block.timestamp + 1 hours);
        vm.prank(creator);
        b.setBondingActive(true);
        _buy(b, 5 * UNIT);
        assertEq(b.balanceOf(creator), 5 * UNIT, "5 whole units bought");

        vm.prank(creator);
        b.mintUp(1, 1); // ordinary id 1 → band id 11, one unit escrowed
        vm.prank(creator);
        b.mintUp(1, 2); // ordinary id 2 → band id 12, one more unit escrowed
    }

    function test_tokenURI_resolvesOverlayThenTierThenBase() public {
        (ERC404BondingInstance b, DN404Mirror mirror) = _createStacked();

        // Wiring sealed: instance points at the router, router orders [overlay, tier].
        assertEq(b.modules(keccak256("metadata.resolver")), address(router));
        assertEq(router.resolverCount(address(b)), 2);
        assertTrue(tier.sealed_(address(b)));
        // The ladder is sealed on the SAME derived range the art table got: 11-15 for weight 2.
        (uint32 bandStart, uint32 bandEnd, uint32 bandWeight) = b.tierBands(0);
        assertEq(bandStart, 11, "band starts one above the 10-id ceiling");
        assertEq(bandEnd, 15, "band is 10 / 2 = 5 ids wide");
        assertEq(bandWeight, 2, "weight as supplied");

        // ── Pre-mint: band art already resolves for in-band ids; base for everything else ──
        assertEq(_uri(b, 11), "rare-11"); // overlay "" → band art, holder is address(0) and it does not matter
        assertEq(_uri(b, 5), "base/5"); // overlay "" → band "" → collection base

        // ── Mint: creator buys 5 whole units, then mints up twice → owns band ids 11,12 ──
        _openAndMintUpTwo(b);
        assertEq(b.ownerOf(11), creator, "band id 11 is genuinely owned");
        assertEq(b.ownerOf(12), creator, "band id 12 is genuinely owned");
        // Two units of the five are escrowed against the two band NFTs ((w - 1) * unit each).
        assertEq(b.balanceOf(creator), 3 * UNIT);
        assertEq(b.totalTierEscrow(), 2 * UNIT);

        // Band art is UNCHANGED by the mint — the same URI before and after ownership moved. The
        // owned band id goes through the REAL ERC721 entrypoint (the mirror's tokenURI) to prove the
        // seam end-to-end.
        assertEq(mirror.tokenURI(11), "rare-11"); // overlay "" → band art, via the mirror
        assertEq(_uri(b, 12), "rare-12");

        // ── Overlay event wins over tier when the holder pins it ──
        vm.prank(creator);
        uint256 w = overlay.publishWave(
            address(b), "evt-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        vm.prank(creator);
        overlay.select(address(b), 11, w + 3); // pin the wave on band id 11
        assertEq(mirror.tokenURI(11), "evt-11"); // overlay precedence over band art

        // ── Paid commission wins over tier too ──
        vm.prank(creator);
        overlay.setCommission(
            address(b),
            12,
            "comm-12",
            MetadataOverlayModule.CommCond.PAY,
            0.5 ether,
            MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(creator, 0.5 ether);
        vm.prank(creator);
        overlay.unlock{ value: 0.5 ether }(address(b), 12);
        assertEq(mirror.tokenURI(12), "comm-12"); // overlay commission over band art "rare-12"

        // id 5 is still pure base — the stack is fully transparent where no module claims it.
        assertEq(_uri(b, 5), "base/5");
    }

    /// @dev A reverting/again-misbehaving resolver can never brick tokenURI — it degrades to base.
    function test_tokenURI_defensiveFallbackToBase() public {
        (ERC404BondingInstance b,) = _createStacked();
        // id 9 is outside the band range and has no overlay content → base.
        assertEq(_uri(b, 9), "base/9");
    }

    /// @dev The seam is sealed: only the factory may wire a module slot, and only once.
    function test_initModule_onlyFactory() public {
        (ERC404BondingInstance b,) = _createStacked();
        vm.prank(address(0xBAD));
        // noesis-149: `initModule` now runs in `ERC404BondingOps` behind the discard-returndata
        // trampoline, so its `OnlyFactory()` reaches the caller as the entry point's generic error.
        // The gate itself is unchanged — the call is still REJECTED, which is what this asserts.
        vm.expectRevert(InitModuleFailed.selector);
        b.initModule(keccak256("metadata.resolver"), address(0x1234));
    }

    function test_initModule_alreadySet_reverts() public {
        (ERC404BondingInstance b,) = _createStacked();
        // The factory already wired METADATA_RESOLVER during create → a second wire is rejected.
        vm.prank(address(factory));
        // noesis-149: `ModuleAlreadySet()` collapses into the trampoline's generic error (see above).
        vm.expectRevert(InitModuleFailed.selector);
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

    // ── noesis-038: tag-scoped resolver family (§3.1) ──────────────────────────
    // The resolver slot and its child resolvers accept the RESOLVER/OVERLAY/TIER family only.
    // A module that IS approved but under a foreign tag (e.g. GATING) must still be rejected —
    // that is the cross-slot hole tag-scoping closes. (A never-approved address is already covered
    // by the *unapproved* tests above; these prove tag, not mere approval, is what gates.)

    function test_tagScope_resolverSlot_rejectsForeignTag() public {
        address gatingTagged = address(new MockVault());
        vm.prank(protocolAdmin);
        componentRegistry.approveComponent(gatingTagged, keccak256("gating"), "GatingTaggedMod");

        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = gatingTagged; // approved, but GATING — outside the resolver family
        vm.expectRevert(ERC404Factory.UnapprovedResolver.selector);
        _create("gatingAsResolver", meta);
    }

    function test_tagScope_childResolver_rejectsForeignTag() public {
        address gatingTagged = address(new MockVault());
        vm.prank(protocolAdmin);
        componentRegistry.approveComponent(gatingTagged, keccak256("gating"), "GatingTaggedMod");

        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.childResolvers = _children(address(overlay), gatingTagged); // second child GATING-tagged
        vm.expectRevert(ERC404Factory.UnapprovedResolver.selector);
        _create("gatingAsChild", meta);
    }

    /// @dev Positive control: [overlay, tier] are both resolver-family → the family check permits them,
    ///      TIER children included. Asserted ON THE TIERED PATH (`cfg.tier` + a one-rung ladder), which
    ///      is the only shape a TIER module may be wired in under: noesis-162 refuses a TIER-tagged
    ///      resolver or child with `cfg.tier` unset, because on that path neither `initTierBands` nor
    ///      `initBands` runs and the instance is sealed as permanently untiered. The family admission
    ///      being proved here is unchanged — only its untiered variant is now illegal.
    function test_tagScope_childResolver_acceptsOverlayTierFamily() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.childResolvers = _children(address(overlay), address(tier));
        meta.tier = address(tier);
        meta.tiers = _oneTier(2, 0); // nftCount 10 → band ids 11-15
        address inst = _create("familyChildren", meta);
        assertEq(router.resolverCount(inst), 2, "overlay+tier children should seal under family check");
    }

    // ── noesis-141 T1 / noesis-160: the factory DERIVES the ranges and seals both tables ────────
    // There is no minBalance any more (the old zero-threshold guard went with it — static art has no
    // threshold to defeat), and the creator no longer supplies id ranges at all: the factory packs
    // them from the ladder, so an overlapping or inverted range is unrepresentable rather than
    // merely rejected. What the create path must still enforce is that a bad LADDER is refused AT
    // CREATE, on the money path — which is what the reverts below assert.

    /// @dev One tier list in, two sealed tables out, on the same derived ranges. `nftCount` is 10, so
    ///      weight 2 derives 11-15 (5 ids) and weight 5 derives 16-17 (2 ids).
    function _oneTier(uint32 weight, uint32 count) internal pure returns (ERC404Factory.TierSpec[] memory ts) {
        ts = new ERC404Factory.TierSpec[](1);
        ts[0] = ERC404Factory.TierSpec({ weight: weight, count: count, baseURI: "tier-" });
    }

    function test_wireMetadata_bandSeals() public {
        ERC404Factory.TierSpec[] memory tiers = new ERC404Factory.TierSpec[](2);
        tiers[0] = ERC404Factory.TierSpec({ weight: 2, count: 0, baseURI: "tier2-" });
        tiers[1] = ERC404Factory.TierSpec({ weight: 5, count: 0, baseURI: "tier5-" });

        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.tier = address(tier);
        meta.tiers = tiers;
        address inst = _create("bandSeal", meta);
        assertTrue(tier.sealed_(inst), "band table seals at create");
        assertEq(tier.bandCount(inst), 2);

        // Both tables describe the SAME ids — that is what the single tier list buys.
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        (uint32 s0, uint32 e0,) = b.tierBands(0);
        (uint32 s1, uint32 e1,) = b.tierBands(1);
        (uint256 as0, uint256 ae0,) = tier.bands(inst, 0);
        (uint256 as1, uint256 ae1,) = tier.bands(inst, 1);
        assertEq(as0, s0, "tier 1 art start == ladder start");
        assertEq(ae0, e0, "tier 1 art end == ladder end");
        assertEq(as1, s1, "tier 2 art start == ladder start");
        assertEq(ae1, e1, "tier 2 art end == ladder end");
        assertEq(s0, 11, "packed from idLimit + 1");
        assertEq(e0, 15, "10 / 2 = 5 ids");
        assertEq(s1, 16, "contiguous with the tier below");
        assertEq(e1, 17, "10 / 5 = 2 ids");
    }

    /// @dev A tier module wired with no ladder is the silent-no-op instance (empty `tierBands` reads
    ///      as "opted out of tiers"), and the seal is create-only, so it could never be repaired.
    ///      Refused at create.
    function test_wireMetadata_emptyLadder_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.tier = address(tier);
        // meta.tiers left empty
        vm.expectRevert(InvalidBand.selector);
        _create("emptyLadder", meta);
    }

    /// @dev A weight larger than the id ceiling derives a zero-width band. Rejected by the factory
    ///      rather than sealed as a dead tier.
    function test_wireMetadata_zeroSizedBand_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.tier = address(tier);
        meta.tiers = _oneTier(11, 0); // nftCount 10 → 10 / 11 == 0 ids
        vm.expectRevert(InvalidBand.selector);
        _create("zeroSizedBand", meta);
    }

    /// @dev `weight == 0` must revert cleanly rather than panic (0x12) on the `idLimit / weight`
    ///      division the derivation performs before the seal can raise anything.
    function test_wireMetadata_zeroWeight_revertsCleanly() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.tier = address(tier);
        meta.tiers = _oneTier(0, 0);
        vm.expectRevert(InvalidBand.selector);
        _create("zeroWeight", meta);
    }

    /// @dev The ladder's own rules (`weight >= 2`, strictly increasing) stay owned by the instance's
    ///      seal, which the trampoline surfaces as its generic error — the create still reverts.
    function test_wireMetadata_nonIncreasingWeight_reverts() public {
        ERC404Factory.TierSpec[] memory tiers = new ERC404Factory.TierSpec[](2);
        tiers[0] = ERC404Factory.TierSpec({ weight: 5, count: 0, baseURI: "a-" });
        tiers[1] = ERC404Factory.TierSpec({ weight: 5, count: 0, baseURI: "b-" }); // not increasing

        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.tier = address(tier);
        meta.tiers = tiers;
        vm.expectRevert(InitTierBandsFailed.selector);
        _create("flatLadder", meta);
    }

    /// @dev `nftCount` is bounded only by DN404's own id ceiling (`idLimit <= 0xfffffffe`), and a band
    ///      is packed ABOVE that ceiling — so a derived `idEnd` genuinely exceeds `uint32` on a large
    ///      supply, and must REVERT rather than narrow. A truncating `uint32` cast here would wrap the
    ///      band back down INTO the ordinary id space, handing auto-mintable ids to the tier path. This
    ///      is the only live uint32 rejection in the system (at the seal the `TierBand.idEnd` field
    ///      width makes the bound structural), so it is asserted here or nowhere.
    function test_wireMetadata_derivedIdAboveUint32_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(router);
        meta.tier = address(tier);
        meta.tiers = _oneTier(2, 0); // full width: idLimit / 2 ids, packed from idLimit + 1

        _nonce++;
        ERC404Factory.CreateParams memory params = _params("hugeSupply", bytes32(_nonce));
        // A preset whose unit is one whole token, so the largest id ceiling DN404 permits is reachable
        // without tripping its uint96 total-supply bound first.
        params.presetId = uint8(PRESET_TINY_UNIT);
        params.nftCount = uint256(type(uint32).max) - 1; // DN404's maximum idLimit (0xfffffffe)
        vm.prank(creator);
        vm.expectRevert(BandIdOverflow.selector);
        factory.createInstance(
            params,
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
    }

    // ── noesis-104 §4.5: a hostile resolver can't brick a DN404 transfer ─────────
    // The `_tokenURI` seam is the ONLY place the instance calls a wired resolver, behind a defensive
    // guard (now `SafeResolverLib.tryResolve`, noesis-107) — the DN404 TRANSFER path never touches it. So
    // a maximally hostile resolver (revert / gas-bomb / malformed return) wired as the instance's sole
    // resolver must never block a transfer. That is the load-bearing invariant, and it HOLDS for all three
    // variants. The metadata READ now degrades to base for ALL THREE variants: noesis-107 replaced the
    // naive try/returns/catch (which let a successful-but-ABI-undecodable return ESCAPE the catch and
    // revert the read) with a low-level staticcall + guarded decode, closing that former KNOWN-GAP.

    /// @dev Create an instance whose sole metadata resolver is `resolver` (single module, no router).
    function _createWithSoleResolver(string memory name, address resolver) internal returns (ERC404BondingInstance b) {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = resolver; // slot points straight at it; no router children, no overlay/tier
        b = ERC404BondingInstance(payable(_create(name, meta)));
    }

    /// @dev Wire `hostile` as the instance's sole resolver, mint, and drive a whole-unit DN404 transfer;
    ///      assert the transfer LANDS (the invariant common to all three modes). Reads NO metadata, so it
    ///      is safe for the malformed variant. Returns the instance for mode-specific read assertions.
    function _wireHostileAndAssertTransferLands(MockHostileResolver.Mode mode, string memory name)
        internal
        returns (ERC404BondingInstance b)
    {
        MockHostileResolver hostile = new MockHostileResolver(mode);
        vm.prank(protocolAdmin);
        // Approved under the RESOLVER tag so the factory's family check wires it into the slot.
        componentRegistry.approveComponent(address(hostile), keccak256("resolver"), "Hostile");

        b = _createWithSoleResolver(name, address(hostile));
        assertEq(b.modules(keccak256("metadata.resolver")), address(hostile));

        // Mint: creator buys 2 whole units.
        vm.prank(creator);
        b.setBondingOpenTime(block.timestamp + 1 hours);
        vm.prank(creator);
        b.setBondingActive(true);
        _buy(b, 2 * UNIT);
        assertEq(b.balanceOf(creator), 2 * UNIT);

        // Drive a DN404 token transfer of a whole unit (moves an NFT) with the hostile resolver wired
        // in — it must LAND. If a hostile resolver could genuinely brick this, that is a real bug.
        address to = address(0xB0B0);
        vm.prank(creator);
        b.transfer(to, UNIT);
        assertEq(b.balanceOf(to), UNIT, "transfer landed: recipient credited");
        assertEq(b.balanceOf(creator), UNIT, "transfer landed: sender debited");
    }

    function test_hostileResolver_reverting_cannotBrickTransfer() public {
        ERC404BondingInstance b = _wireHostileAndAssertTransferLands(MockHostileResolver.Mode.REVERT, "hostileRevert");
        // Revert variant: the metadata read degrades gracefully to base — `_tokenURI`'s try/catch
        // swallows the resolver's revert and falls back to base for every id.
        assertEq(_uri(b, 5), "base/5", "revert-resolver read must degrade to base");
        assertEq(_uri(b, 1), "base/1", "post-transfer read still degrades to base");
    }

    function test_hostileResolver_gasBomb_cannotBrickTransfer() public {
        ERC404BondingInstance b =
            _wireHostileAndAssertTransferLands(MockHostileResolver.Mode.GAS_BOMB, "hostileGasBomb");
        // Gas-bomb variant: the read degrades to base — the child OOGs, the caller survives on the 1/64
        // gas EIP-150 retains and the catch falls back to base.
        assertEq(_uri(b, 5), "base/5", "gas-bomb-resolver read must degrade to base");
    }

    function test_hostileResolver_malformedReturn_cannotBrickTransfer() public {
        // noesis-107: the former KNOWN-GAP is CLOSED. A successful-but-ABI-undecodable resolver return
        // used to escape `_tokenURI`'s `try … returns (string){} catch {}` and revert the metadata READ;
        // `SafeResolverLib.tryResolve` now guards the return framing before decoding, so the malformed
        // success degrades to base identically to a revert/gas-bomb. Assert BOTH invariants: the transfer
        // lands (as before) AND the read no longer reverts — it degrades to base for every id.
        ERC404BondingInstance b =
            _wireHostileAndAssertTransferLands(MockHostileResolver.Mode.MALFORMED, "hostileMalformed");
        assertEq(_uri(b, 5), "base/5", "malformed-resolver read must degrade to base (noesis-107)");
        assertEq(_uri(b, 1), "base/1", "post-transfer malformed read still degrades to base");
    }
}
