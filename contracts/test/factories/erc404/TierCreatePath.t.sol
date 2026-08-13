// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404Factory } from "src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import {
    InvalidBand,
    BandIdOverflow,
    InitTierBandsFailed,
    TierOpFailed
} from "src/factories/erc404/ERC404BondingStorage.sol";
import { LaunchManager } from "src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { ComponentRegistry } from "src/registry/ComponentRegistry.sol";
import { TokenTierBandResolver } from "src/metadata/TokenTierBandResolver.sol";
import { MetadataResolverRouter } from "src/metadata/MetadataResolverRouter.sol";
import { MetadataOverlayModule } from "src/metadata/MetadataOverlayModule.sol";
import { ILiquidityDeployerModule } from "src/interfaces/ILiquidityDeployerModule.sol";
import { FreeMintParams } from "src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "src/gating/IGatingModule.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract TierCreateVault {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

contract TierCreateDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title TierCreatePath
 * @notice noesis-160: Token Tiers END TO END through the REAL `ERC404Factory` create path.
 * @dev MONEY-CODE. Every other tier suite seals its own ladder with `factory == address(this)`, which
 *      proves the seal's arithmetic but says nothing about whether a token a creator actually launches
 *      ever GETS a ladder. This suite only ever goes through `factory.createInstance(...)`: it asserts
 *      the factory derives the id ranges, seals BOTH tables from them, and that `mintUp`/`mintDown`,
 *      the escrow and the band art then work on the resulting instance.
 *
 *      The other half is the create-time refusals — an empty ladder, a zero-width band, a zero weight,
 *      and a derived id above `uint32`. That last one is the ONLY live uint32 defense in the system:
 *      the seal's own check is unreachable because `TierBand.idEnd` is a `uint32` field, so the bound
 *      is structural there and can only be violated where ranges are DERIVED in `uint256`.
 */
contract TierCreatePathTest is Test {
    ERC404Factory factory;
    LaunchManager launchMgr;
    CurveParamsComputer curveComp;
    MockMasterRegistry registry;
    ComponentRegistry componentRegistry;
    TierCreateVault vault;
    TierCreateDeployer deployer;
    TokenTierBandResolver tier;
    MetadataResolverRouter router;
    MetadataOverlayModule overlay;

    address protocolAdmin = address(0x9);
    address creator = address(0x2);
    address holder = address(0x3);

    /// @dev unitPerNFT 1e3 → unit 1e21, so `nftCount` is the instance's id ceiling (idLimit).
    uint256 constant PRESET_ID = 1;
    uint256 constant UNIT = 1e21;
    /// @dev unitPerNFT 1 → unit 1e18, the only way to reach DN404's maximum id ceiling without
    ///      tripping its uint96 total-supply bound first. Used by the uint32 case.
    uint256 constant PRESET_TINY_UNIT = 2;

    uint256 internal _nonce;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocolAdmin);

        registry = new MockMasterRegistry();
        vault = new TierCreateVault();
        deployer = new TierCreateDeployer();
        launchMgr = new LaunchManager(protocolAdmin);
        curveComp = new CurveParamsComputer(protocolAdmin);

        ComponentRegistry crImpl = new ComponentRegistry();
        componentRegistry = ComponentRegistry(LibClone.deployERC1967(address(crImpl)));
        componentRegistry.initialize(protocolAdmin);
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "Curve");
        componentRegistry.approveComponent(address(deployer), keccak256("liquidity"), "Deployer");

        launchMgr.setPreset(
            PRESET_ID,
            LaunchManager.Preset({
                targetETH: 15 ether,
                unitPerNFT: 1e3,
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

        tier = new TokenTierBandResolver(address(registry));
        componentRegistry.approveComponent(address(tier), keccak256("tier"), "Tier");
        // A RESOLVER-tagged router and an OVERLAY-tagged module, so the create-time wiring guards can be
        // exercised on the child path and against non-tier family members that must stay admitted.
        router = new MetadataResolverRouter(address(registry));
        componentRegistry.approveComponent(address(router), keccak256("resolver"), "Router");
        overlay = new MetadataOverlayModule(address(registry));
        componentRegistry.approveComponent(address(overlay), keccak256("overlay"), "Overlay");
        registry.setComponentRegistry(address(componentRegistry));

        vm.stopPrank();
    }

    // ── helpers: everything goes through the real factory ────────────────────────────────────────

    function _params(string memory name, uint256 nftCount) internal returns (ERC404Factory.CreateParams memory p) {
        _nonce++;
        p = ERC404Factory.CreateParams({
            salt: bytes32(_nonce),
            owner: creator,
            nftCount: nftCount,
            presetId: uint8(PRESET_ID),
            vault: address(vault),
            name: name,
            symbol: "TIER",
            styleUri: "",
            tokenBaseURI: "base/",
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });
    }

    /// @dev The tier module IS the resolver here (single module, no router) — the shortest real path
    ///      from a create call to a sealed ladder.
    function _meta(ERC404Factory.TierSpec[] memory tiers)
        internal
        view
        returns (ERC404Factory.MetadataConfig memory meta)
    {
        meta.resolver = address(tier);
        meta.tier = address(tier);
        meta.tiers = tiers;
    }

    function _create(ERC404Factory.CreateParams memory p, ERC404Factory.MetadataConfig memory meta)
        internal
        returns (ERC404BondingInstance b)
    {
        vm.prank(creator);
        address inst = factory.createInstance(
            p,
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
        b = ERC404BondingInstance(payable(inst));
    }

    function _tiers(uint32 w1, uint32 c1, string memory u1) internal pure returns (ERC404Factory.TierSpec[] memory ts) {
        ts = new ERC404Factory.TierSpec[](1);
        ts[0] = ERC404Factory.TierSpec({ weight: w1, count: c1, baseURI: u1 });
    }

    function _open(ERC404BondingInstance b) internal {
        uint256 openAt = block.timestamp + 1 hours;
        vm.prank(creator);
        b.setBondingOpenTime(openAt);
        vm.prank(creator);
        b.setBondingActive(true);
        // Arming precedes the announced open; the curve only takes ETH from `openAt` on.
        vm.warp(openAt);
    }

    /// @dev Buy `units` whole units on the live curve, with NFTs minted, for `who`.
    function _buy(ERC404BondingInstance b, address who, uint256 units) internal {
        (uint256 ip, uint256 q4, uint256 nf) = b.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params({ kCoeff: ip, poleWad: q4, normalizationFactor: nf });
        uint256 cost = BondingCurveMath.calculateCost(p, b.totalBondingSupply(), units * UNIT);
        uint256 total = cost + (cost * b.bondingFeeBps()) / 10000;
        vm.deal(who, total);
        vm.prank(who);
        b.buyBonding{ value: total }(units * UNIT, total, true, bytes(""), "", 0);
    }

    function _ownerOrZero(ERC404BondingInstance b, uint256 id) internal view returns (address who) {
        try b.ownerOf(id) returns (address o) {
            who = o;
        } catch {
            who = address(0);
        }
    }

    /// @dev The lowest ORDINARY id `who` owns. `mintUp`'s escrow leg reconciles by burning NFTs LIFO
    ///      off the TAIL of the owned array, and the buy path issues ids ascending, so the lowest id
    ///      is the one that survives the largest debit — passing it in keeps the op from self-burning.
    function _lowestOwnedId(ERC404BondingInstance b, address who) internal view returns (uint256) {
        uint256 idLimit = b.maxSupply() / b.unit();
        for (uint256 id = 1; id <= idLimit; id++) {
            if (_ownerOrZero(b, id) == who) return id;
        }
        revert("no ordinary id owned");
    }

    /// @dev Mint up on `who`'s lowest ordinary id. The lookup is resolved BEFORE the prank — a view
    ///      call inside the argument expression would consume it and send the op from the test.
    function _mintUpLowest(ERC404BondingInstance b, address who, uint8 tierN) internal returns (uint256 tierZeroId) {
        tierZeroId = _lowestOwnedId(b, who);
        vm.prank(who);
        b.mintUp(tierN, tierZeroId);
    }

    // ┌───────────────────────────────────────────────────────────────────┐
    // │  The gap: a factory-created instance actually HAS a ladder        │
    // └───────────────────────────────────────────────────────────────────┘

    /// @notice A two-tier ladder supplied at create is sealed on the instance, with both ranges packed
    ///         contiguously and strictly ABOVE the id ceiling. Before noesis-160 `tierBands` was empty
    ///         on every factory-created instance, which the gas short-circuit reads as "no tiers".
    function test_create_sealsLadderAboveIdLimit() public {
        ERC404Factory.TierSpec[] memory ts = new ERC404Factory.TierSpec[](2);
        ts[0] = ERC404Factory.TierSpec({ weight: 10, count: 0, baseURI: "t1-" });
        ts[1] = ERC404Factory.TierSpec({ weight: 100, count: 0, baseURI: "t2-" });

        ERC404BondingInstance b = _create(_params("ladder", 1000), _meta(ts));
        uint256 idLimit = b.maxSupply() / b.unit();
        assertEq(idLimit, 1000, "nftCount is the id ceiling");

        // Exactly two tiers are sealed: `bandOutstanding` resolves 1 and 2 and rejects 3. Reading it
        // at all is the falsifiable half — on an UNSEALED instance (the pre-160 state) tier 1 itself
        // is out of range, so this line would revert.
        assertEq(b.bandOutstanding(1), 0, "tier 1 exists and is empty at create");
        assertEq(b.bandOutstanding(2), 0, "tier 2 exists and is empty at create");
        vm.expectRevert(InvalidBand.selector);
        b.bandOutstanding(3);

        (uint32 s0, uint32 e0, uint32 w0) = b.tierBands(0);
        (uint32 s1, uint32 e1, uint32 w1) = b.tierBands(1);

        assertEq(s0, idLimit + 1, "tier 1 starts one above the ordinary id space");
        assertEq(e0, idLimit + 100, "tier 1 is 1000 / 10 = 100 ids");
        assertEq(w0, 10);
        assertEq(s1, e0 + 1, "tier 2 is contiguous with tier 1");
        assertEq(e1, uint256(s1) + 10 - 1, "tier 2 is 1000 / 100 = 10 ids");
        assertEq(w1, 100);
        assertGt(s0, idLimit, "every band id is unreachable by the auto-mint");

        // Cursors are live, and the art table describes exactly the same ids.
        assertEq(b.bandNextFree(0), s0);
        assertEq(b.bandNextFree(1), s1);
        (uint256 as0, uint256 ae0, string memory u0) = tier.bands(address(b), 0);
        assertEq(as0, s0, "art start == ladder start");
        assertEq(ae0, e0, "art end == ladder end");
        assertEq(u0, "t1-");
    }

    /// @notice The whole round trip on a factory-created instance: buy on the curve, mint up into
    ///         tier 1 (escrowing `(w - 1) * unit`), read the band art, then mint back down and get the
    ///         coin returned with the band id released for reuse.
    function test_create_mintUpAndDownRoundTrip() public {
        ERC404BondingInstance b = _create(_params("roundtrip", 1000), _meta(_tiers(10, 0, "t1-")));
        (uint32 s0,,) = b.tierBands(0);

        _open(b);
        _buy(b, holder, 12); // 12 whole units → 12 ordinary NFTs

        uint256 tierZeroId = _lowestOwnedId(b, holder);
        uint256 balBefore = b.balanceOf(holder);

        vm.prank(holder);
        b.mintUp(1, tierZeroId);

        assertEq(b.ownerOf(s0), holder, "holder received the band id");
        assertEq(b.balanceOf(holder), balBefore - 9 * UNIT, "(w - 1) * unit escrowed");
        assertEq(b.totalTierEscrow(), 9 * UNIT, "escrow is exactly (w - 1) * unit");
        assertEq(b.bandOutstanding(1), 1, "one band NFT outstanding");
        // `coinBalanceOf` sees through the escrow: the holder's economic position is unchanged.
        assertEq(b.coinBalanceOf(holder), balBefore, "mintUp moved no value, only its shape");
        assertEq(b.bandNextFree(0), uint256(s0) + 1, "cursor advanced");

        // Band art resolves for the band id through the wired resolver.
        DN404Mirror mirror = DN404Mirror(payable(b.mirrorERC721()));
        assertEq(mirror.tokenURI(s0), string.concat("t1-", vm.toString(uint256(s0))), "baseURI + id");

        vm.prank(holder);
        b.mintDown(s0);

        assertEq(b.balanceOf(holder), balBefore, "escrow returned in full");
        assertEq(b.totalTierEscrow(), 0, "no escrow left");
        assertEq(b.bandOutstanding(1), 0, "band NFT retired");

        // The id is reusable: the freed list hands the same id back on the next mint up.
        uint256 nextZeroId = _lowestOwnedId(b, holder);
        vm.prank(holder);
        b.mintUp(1, nextZeroId);
        assertEq(b.ownerOf(s0), holder, "the released band id is reissued");
    }

    // ┌───────────────────────────────────────────────────────────────────┐
    // │  Scarcity: a band capped below supply / weight                    │
    // └───────────────────────────────────────────────────────────────────┘

    /// @notice A `count` below the maximum makes the tier genuinely scarce: it exhausts while the
    ///         holder still has ample coin, and REOPENS when someone mints down. The exhaustion path
    ///         is reachable by design on a capped band — that is what the cap buys.
    function test_create_cappedBandExhaustsAndReopens() public {
        // idLimit 1000, weight 10 → max 100 ids; ask for 2.
        ERC404BondingInstance b = _create(_params("scarce", 1000), _meta(_tiers(10, 2, "t1-")));
        (uint32 s0, uint32 e0,) = b.tierBands(0);
        assertEq(uint256(e0) - s0 + 1, 2, "band capped at 2 of a possible 100");

        _open(b);
        _buy(b, holder, 60); // far more coin than the band can absorb

        _mintUpLowest(b, holder, 1);
        _mintUpLowest(b, holder, 1);
        assertEq(b.bandOutstanding(1), 2, "band full");

        // Coin is NOT the binding constraint — the cap is.
        assertGt(b.balanceOf(holder), 10 * UNIT, "holder still holds ample coin");
        uint256 thirdId = _lowestOwnedId(b, holder);
        vm.prank(holder);
        vm.expectRevert(TierOpFailed.selector); // BandExhausted, behind the trampoline
        b.mintUp(1, thirdId);

        // Mint one down and the tier reopens — the free list hands the id straight back.
        vm.prank(holder);
        b.mintDown(s0);
        assertEq(b.bandOutstanding(1), 1, "one slot freed");
        _mintUpLowest(b, holder, 1);
        assertEq(b.bandOutstanding(1), 2, "the sold-out tier reopened");
        assertEq(b.ownerOf(s0), holder, "and reissued the freed id");
    }

    /// @notice A `count` above the maximum is CLAMPED, not rejected — the ladder still cannot promise
    ///         more ids than the coin supply can back.
    function test_create_countAboveMaxIsClamped() public {
        ERC404BondingInstance b = _create(_params("clamped", 1000), _meta(_tiers(10, 5000, "t1-")));
        (uint32 s0, uint32 e0,) = b.tierBands(0);
        assertEq(uint256(e0) - s0 + 1, 100, "clamped to 1000 / 10, not 5000");
    }

    /// @notice FACTORY/SEAL PARITY. The factory derives each width and the seal independently
    ///         re-derives its own bound from the same `idLimit / weight`. Any disagreement would be a
    ///         create-time revert at best and a mis-sized band at worst, so exercise the cases where
    ///         they could plausibly diverge — in particular a weight that divides `idLimit` UNEVENLY,
    ///         where both sides must round DOWN identically. Every one of these creates successfully,
    ///         which is itself the parity assertion: the seal accepted exactly what the factory built.
    function test_create_factoryAndSealAgreeOnWidth() public {
        // idLimit 1000. w=3 → 333 (uneven), w=7 → 142 (uneven), w=8 → 125 (exact).
        ERC404Factory.TierSpec[] memory ts = new ERC404Factory.TierSpec[](3);
        ts[0] = ERC404Factory.TierSpec({ weight: 3, count: 0, baseURI: "a-" }); // count == 0 → max
        ts[1] = ERC404Factory.TierSpec({ weight: 7, count: 142, baseURI: "b-" }); // count == max exactly
        ts[2] = ERC404Factory.TierSpec({ weight: 8, count: 1, baseURI: "c-" }); // count == 1

        ERC404BondingInstance b = _create(_params("parity", 1000), _meta(ts));
        (uint32 s0, uint32 e0,) = b.tierBands(0);
        (uint32 s1, uint32 e1,) = b.tierBands(1);
        (uint32 s2, uint32 e2,) = b.tierBands(2);

        assertEq(s0, 1001, "packed from idLimit + 1");
        assertEq(uint256(e0) - s0 + 1, 333, "floor(1000 / 3): rounded down, not up");
        assertEq(s1, uint256(e0) + 1, "contiguous");
        assertEq(uint256(e1) - s1 + 1, 142, "floor(1000 / 7), asked for exactly the max");
        assertEq(s2, uint256(e1) + 1, "contiguous");
        assertEq(uint256(e2) - s2 + 1, 1, "a single-id tier");

        // The art table describes the same three ranges — one derivation, two consumers.
        for (uint256 i = 0; i < 3; i++) {
            (uint32 ls, uint32 le,) = b.tierBands(i);
            (uint256 as_, uint256 ae,) = tier.bands(address(b), i);
            assertEq(as_, ls, "art start == ladder start");
            assertEq(ae, le, "art end == ladder end");
        }
    }

    // ┌───────────────────────────────────────────────────────────────────┐
    // │  Create-time refusals                                             │
    // └───────────────────────────────────────────────────────────────────┘

    /// @notice A tier module wired with NO ladder is exactly the silent-no-op instance: `tierBands`
    ///         empty reads as "opted out of tiers", and the seal is create-only so it can never be
    ///         repaired. That state must not be constructible.
    function test_create_tierModuleWithEmptyLadder_reverts() public {
        ERC404Factory.MetadataConfig memory meta = _meta(new ERC404Factory.TierSpec[](0));
        vm.prank(creator);
        vm.expectRevert(InvalidBand.selector);
        factory.createInstance(
            _params("noLadder", 1000),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
    }

    /// @notice `weight == 0` reverts `InvalidBand` at the factory rather than panicking 0x12 on the
    ///         `idLimit / weight` division the derivation performs before the seal is ever reached.
    function test_create_zeroWeight_revertsInvalidBandNotPanic() public {
        ERC404Factory.MetadataConfig memory meta = _meta(_tiers(0, 0, "t1-"));
        vm.prank(creator);
        vm.expectRevert(InvalidBand.selector);
        factory.createInstance(
            _params("zeroWeight", 1000),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
    }

    /// @notice A weight above the id ceiling derives a zero-width band; refused rather than sealed as
    ///         a dead tier nobody can ever mint into.
    function test_create_zeroSizedBand_reverts() public {
        ERC404Factory.MetadataConfig memory meta = _meta(_tiers(1001, 0, "t1-"));
        vm.prank(creator);
        vm.expectRevert(InvalidBand.selector);
        factory.createInstance(
            _params("zeroSize", 1000),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
    }

    /// @notice The ladder's own rules stay owned by the seal — `weight >= 2` and strictly increasing
    ///         weights are not duplicated in the factory. The seal rejects, the trampoline discards
    ///         returndata, and the create still reverts.
    function test_create_weightBelowTwo_revertsFromTheSeal() public {
        ERC404Factory.MetadataConfig memory meta = _meta(_tiers(1, 0, "t1-"));
        vm.prank(creator);
        vm.expectRevert(InitTierBandsFailed.selector);
        factory.createInstance(
            _params("w1", 1000),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
    }

    function test_create_nonIncreasingWeight_revertsFromTheSeal() public {
        ERC404Factory.TierSpec[] memory ts = new ERC404Factory.TierSpec[](2);
        ts[0] = ERC404Factory.TierSpec({ weight: 10, count: 0, baseURI: "t1-" });
        ts[1] = ERC404Factory.TierSpec({ weight: 10, count: 0, baseURI: "t2-" });

        vm.prank(creator);
        vm.expectRevert(InitTierBandsFailed.selector);
        factory.createInstance(
            _params("flat", 1000),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            _meta(ts)
        );
    }

    /// @notice THE RELOCATED uint32 PROPERTY (was `TokenTierOps.test_seal_revertsOnUint32Overflow`).
    ///         Bands pack ABOVE DN404's id ceiling, which itself may be as high as `0xfffffffe`, so a
    ///         derived `idEnd` genuinely exceeds `uint32`. It must revert BEFORE any narrowing: a
    ///         truncating cast would wrap the band back DOWN into the ordinary id space and hand
    ///         auto-mintable ids to the tier path, sealing a band other than the one derived.
    ///         The seal cannot catch this — `TierBand.idEnd` is a `uint32` field, so the bound is
    ///         structural there. This is the only place the check can fire, and the only place it is
    ///         asserted.
    function test_create_derivedIdAboveUint32_reverts() public {
        ERC404Factory.CreateParams memory p = _params("huge", uint256(type(uint32).max) - 1);
        p.presetId = uint8(PRESET_TINY_UNIT); // unit 1e18, so idLimit == nftCount == 0xfffffffe

        vm.prank(creator);
        vm.expectRevert(BandIdOverflow.selector);
        factory.createInstance(
            p,
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            _meta(_tiers(2, 0, "t1-"))
        );
    }

    /// @notice Falsifiability control for the case above: the SAME oversized supply seals fine when
    ///         the band is capped small enough to stay inside `uint32`. So the rejection is about the
    ///         derived id exceeding the field, not about large supplies being refused outright.
    function test_create_hugeSupplySealsWhenBandStaysInUint32() public {
        ERC404Factory.CreateParams memory p = _params("hugeOk", uint256(type(uint32).max) - 1);
        p.presetId = uint8(PRESET_TINY_UNIT);

        ERC404BondingInstance b = _create(p, _meta(_tiers(2, 1, "t1-")));
        (uint32 s0, uint32 e0,) = b.tierBands(0);
        assertEq(s0, type(uint32).max, "the single band id is the last representable id");
        assertEq(e0, type(uint32).max);
    }

    // ┌───────────────────────────────────────────────────────────────────┐
    // │  noesis-162: the untiered mirror states are unconstructible       │
    // └───────────────────────────────────────────────────────────────────┘
    // The empty-ladder refusal above keys on `cfg.tier`, so it only sees configs that set it. Two mirror
    // states reach the same silent-no-op instance without ever setting `cfg.tier`: routing the TIER
    // module in through the resolver slot or a router child (it is resolver-family, so the family check
    // admits it), and supplying a ladder that no `cfg.tier` will ever consume. Both are direct-call
    // shapes — the wizard emits neither — and both are refused at create.

    /// @dev Config built directly: `_meta` always sets `cfg.tier`, which is the field under test here.
    function _untieredMeta(address resolver_, address[] memory children)
        internal
        pure
        returns (ERC404Factory.MetadataConfig memory meta)
    {
        meta.resolver = resolver_;
        meta.childResolvers = children;
    }

    function _expectCreateRevert(string memory name, bytes4 err, ERC404Factory.MetadataConfig memory meta) internal {
        vm.prank(creator);
        vm.expectRevert(err);
        factory.createInstance(
            _params(name, 1000),
            "ipfs://c",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );
    }

    /// @notice The TIER module in the resolver slot with `cfg.tier` unset: it lands in the metadata
    ///         chain, `initTierBands`/`initBands` never run, and the resulting instance reads as opted
    ///         out of tiers forever. Refused.
    function test_create_tierAsResolverWithoutTierConfig_reverts() public {
        _expectCreateRevert("tierSlotUntiered", InvalidBand.selector, _untieredMeta(address(tier), new address[](0)));
    }

    /// @notice Same state through a router child — the other way a TIER module reaches the chain.
    function test_create_tierAsChildWithoutTierConfig_reverts() public {
        address[] memory children = new address[](1);
        children[0] = address(tier);
        _expectCreateRevert("tierChildUntiered", InvalidBand.selector, _untieredMeta(address(router), children));
    }

    /// @notice The symmetric drop: a ladder supplied with no `cfg.tier` to consume it. Before this
    ///         refusal the create succeeded and the ladder went nowhere, unrecoverably — the seal is
    ///         create-only.
    function test_create_ladderWithoutTierModule_reverts() public {
        ERC404Factory.MetadataConfig memory meta = _untieredMeta(address(router), new address[](0));
        meta.tiers = _tiers(10, 0, "t1-");
        _expectCreateRevert("ladderNoTier", InvalidBand.selector, meta);
    }

    /// @notice And with the metadata feature off entirely (`resolver == address(0)`), which returns
    ///         before any per-module wiring — so the ladder must be rejected above that return.
    function test_create_ladderWithoutResolver_reverts() public {
        ERC404Factory.MetadataConfig memory meta;
        meta.tier = address(tier); // set, but unreachable behind the feature-off return
        meta.tiers = _tiers(10, 0, "t1-");
        _expectCreateRevert("ladderNoResolver", InvalidBand.selector, meta);
    }

    /// @notice NEGATIVE CONTROL for both guards: an untiered chain of non-tier family members is a
    ///         legitimate configuration and still creates. A guard that rejected this would cost every
    ///         collection that wants overlay art and no tiers.
    function test_create_untieredNonTierChain_stillCreates() public {
        address[] memory children = new address[](1);
        children[0] = address(overlay);
        ERC404BondingInstance b = _create(_params("untieredOk", 1000), _untieredMeta(address(router), children));
        assertEq(router.resolverCount(address(b)), 1, "an untiered router+overlay chain wires unchanged");
        assertEq(b.modules(keccak256("metadata.resolver")), address(router));
    }

    /// @notice NEGATIVE CONTROL for the TIER-tag guard specifically: the SAME TIER child, this time with
    ///         `cfg.tier` and a ladder set, is the ordinary tiered path and creates with the ladder
    ///         sealed. So the refusal is about the untiered wiring, not about TIER modules in the chain.
    function test_create_tierChildWithTierConfig_stillCreates() public {
        address[] memory children = new address[](2);
        children[0] = address(overlay);
        children[1] = address(tier);

        ERC404Factory.MetadataConfig memory meta = _untieredMeta(address(router), children);
        meta.tier = address(tier);
        meta.tiers = _tiers(10, 0, "t1-");

        ERC404BondingInstance b = _create(_params("tieredChildOk", 1000), meta);
        assertEq(router.resolverCount(address(b)), 2, "overlay + tier children seal under the family check");
        (uint32 s0, uint32 e0,) = b.tierBands(0);
        assertEq(s0, 1001, "the ladder sealed: packed from idLimit + 1");
        assertEq(uint256(e0) - s0 + 1, 100, "1000 / 10 ids");
    }
}
