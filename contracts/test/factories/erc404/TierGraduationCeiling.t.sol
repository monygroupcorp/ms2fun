// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404Factory } from "src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import { LaunchManager } from "src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { ComponentRegistry } from "src/registry/ComponentRegistry.sol";
import { TokenTierBandResolver } from "src/metadata/TokenTierBandResolver.sol";
import { ILiquidityDeployerModule } from "src/interfaces/ILiquidityDeployerModule.sol";
import { FreeMintParams } from "src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "src/gating/IGatingModule.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract CeilingVault {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

contract CeilingDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title TierGraduationCeiling
 * @notice noesis-397: the ordinary-id ceiling the tier paths enforce is SEALED at create against
 *         `maxSupply / unit`, not re-derived from live `totalSupply`. Graduation burns instance-held
 *         coin (`ERC404BondingOps._sizePoolAtCurvePrice`), which permanently lowers live `totalSupply`.
 *         `mintUp` / `mintDown` / `_effectiveExemptions` therefore must NOT read live supply for the
 *         ordinary/band boundary — an ordinary id the instance itself minted stays valid for the
 *         instance's whole life, and reading the shrunken live value would reject it as `NotTierZeroId`.
 * @dev    MONEY-CODE regression. The stranding needs two permissionless but atypical moves so the id an
 *         address holds decouples from the coin backing the outstanding supply: a high ordinary id is
 *         isolated onto a holder via an ordinary mirror `transferFrom`, and the remaining coin is parked
 *         on the instance via a plain ERC20 `transfer` (which inflates the graduation burn without
 *         touching `totalBondingSupply`). After graduation the live ceiling collapses well below that
 *         isolated id. Pre-fix `mintUp` on it reverts (`NotTierZeroId`, surfaced as `TierOpFailed`);
 *         with the sealed ceiling it round-trips through `mintUp` and back through `mintDown`.
 */
contract TierGraduationCeilingTest is Test {
    ERC404Factory factory;
    LaunchManager launchMgr;
    CurveParamsComputer curveComp;
    MockMasterRegistry registry;
    ComponentRegistry componentRegistry;
    CeilingVault vault;
    CeilingDeployer deployer;
    TokenTierBandResolver tier;

    address protocolAdmin = address(0x9);
    address creator = address(0x2);
    address whale = address(0x3);
    address stranded = address(0x4);

    /// @dev unitPerNFT 1e3 → unit 1e21, so `nftCount` is the instance's id ceiling (idLimit).
    uint256 constant PRESET_ID = 1;
    uint256 constant UNIT = 1e21;

    uint256 internal _nonce;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocolAdmin);

        registry = new MockMasterRegistry();
        vault = new CeilingVault();
        deployer = new CeilingDeployer();
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
        registry.setComponentRegistry(address(componentRegistry));

        vm.stopPrank();
    }

    // ── helpers: everything goes through the real factory (mirrors TierCreatePath) ────────────────

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

    /// @dev The HIGHEST ordinary id `who` owns, scanning the whole sealed ordinary space.
    function _highestOwnedId(ERC404BondingInstance b, address who) internal view returns (uint256 hi) {
        uint256 idLimit = b.maxSupply() / b.unit();
        for (uint256 id = 1; id <= idLimit; id++) {
            if (_ownerOrZero(b, id) == who) hi = id;
        }
        require(hi != 0, "no ordinary id owned");
    }

    /// @dev Drive an instance to a state where `stranded` holds a high ordinary id `strandedId` that
    ///      sits ABOVE the post-graduation live ceiling but at or below the sealed ceiling, with just
    ///      enough coin to fund one tier-`weight` escrow. Returns the instance and the isolated id.
    function _graduateWithStrandedHighId(uint32 weight, uint256 nftCount, uint256 buyUnits)
        internal
        returns (ERC404BondingInstance b, uint256 strandedId)
    {
        b = _create(_params("ceiling", nftCount), _meta(_tiers(weight, 10, "t1-")));
        _open(b);

        // The whale buys the ordinary ids ascending, so a HIGH id exists to isolate.
        _buy(b, whale, buyUnits);
        strandedId = _highestOwnedId(b, whale);

        DN404Mirror mirror = DN404Mirror(payable(b.mirrorERC721()));

        // (1) Isolate the high id onto `stranded` FIRST, so it sits at index 0 of the owned array and
        //     survives the LIFO escrow burn that `mintUp` runs off the tail.
        vm.prank(whale);
        mirror.transferFrom(whale, stranded, strandedId);

        // (2) Fund `stranded` with exactly the escrow a tier-`weight` mintUp needs: (weight - 1) more
        //     units, delivered as ordinary NFTs that append AFTER the isolated id.
        uint256 escrowUnits = uint256(weight) - 1;
        vm.prank(whale);
        b.transfer(stranded, escrowUnits * UNIT);

        // (3) Park all of the whale's remaining coin on the instance. A plain ERC20 transfer raises the
        //     instance balance (and so the graduation burn) without touching `totalBondingSupply`, which
        //     is what decouples the live ceiling from the ids still outstanding. The balance is read
        //     BEFORE the prank — a view call inside the argument would consume it and send from the test.
        uint256 rest = b.balanceOf(whale);
        vm.prank(whale);
        b.transfer(address(b), rest);

        // (4) Graduate: the burn destroys the parked + unsold coin, collapsing live totalSupply.
        vm.prank(creator);
        b.deployLiquidity(0);
    }

    // ┌───────────────────────────────────────────────────────────────────┐
    // │  The sealed ceiling survives graduation; the tier paths honor it  │
    // └───────────────────────────────────────────────────────────────────┘

    /// @notice An ordinary id above the collapsed live ceiling but within the sealed ceiling is still a
    ///         valid `mintUp` tierZeroId after graduation. This is the whole fix: the guard reads
    ///         `maxSupply / unit`, not `totalSupply / unit`.
    function test_mintUp_acceptsIdAboveLiveCeilingWithinSealedCeiling() public {
        (ERC404BondingInstance b, uint256 strandedId) = _graduateWithStrandedHighId(4, 200, 120);

        uint256 sealedCeiling = b.maxSupply() / b.unit();
        uint256 liveCeiling = b.totalSupply() / b.unit();

        // Precondition — the setup actually stranded the id (otherwise the test proves nothing).
        assertLt(liveCeiling, strandedId, "setup did not strand: live ceiling is not below the held id");
        assertLe(strandedId, sealedCeiling, "held id must be within the sealed ordinary space");
        assertEq(_ownerOrZero(b, strandedId), stranded, "the isolated id must still be held after the burn");

        // The fix: mintUp on the stranded high id succeeds. Pre-fix this reverts NotTierZeroId
        // (surfaced as TierOpFailed) because strandedId > totalSupply / unit.
        vm.prank(stranded);
        b.mintUp(1, strandedId);

        // The ordinary id was swapped for a band id above the sealed ceiling, and its escrow is held.
        assertEq(_ownerOrZero(b, strandedId), address(0), "the tierZeroId was consumed by the swap");
        (uint32 bandStart,,) = b.tierBands(0);
        assertGt(bandStart, sealedCeiling, "the band lives strictly above the sealed ceiling");
        assertEq(_ownerOrZero(b, bandStart), stranded, "the holder received the lowest free band id");
    }

    /// @notice The round trip closes: `mintDown` returns an ordinary id within the sealed ceiling and
    ///         releases the escrow, and its free-id search terminates against the sealed ceiling.
    function test_mintDown_afterGraduation_returnsOrdinaryIdWithinSealedCeiling() public {
        (ERC404BondingInstance b, uint256 strandedId) = _graduateWithStrandedHighId(4, 200, 120);
        uint256 sealedCeiling = b.maxSupply() / b.unit();

        vm.prank(stranded);
        b.mintUp(1, strandedId);
        (uint32 bandStart,,) = b.tierBands(0);
        assertEq(_ownerOrZero(b, bandStart), stranded, "precondition: holder owns a band id");

        vm.prank(stranded);
        b.mintDown(bandStart);

        // The band id is burned and the holder is back on an ordinary id within the sealed space.
        assertEq(_ownerOrZero(b, bandStart), address(0), "the band id was burned on mintDown");
        uint256 back = _highestOwnedId(b, stranded);
        assertLe(back, sealedCeiling, "mintDown returned an ordinary id within the sealed ceiling");
    }

    /// @notice Guardrail on the ceiling itself: an id STRICTLY ABOVE the sealed ceiling is never an
    ///         ordinary id (the bands are sealed there), so the sealed bound is the correct — not merely
    ///         a looser — upper bound. `maxSupply / unit` is the exact ordinary/band boundary.
    function test_sealedCeilingIsTheOrdinaryBandBoundary() public {
        ERC404BondingInstance b = _create(_params("boundary", 200), _meta(_tiers(4, 10, "t1-")));
        uint256 sealedCeiling = b.maxSupply() / b.unit();
        (uint32 bandStart,,) = b.tierBands(0);
        // The first band id is strictly above the sealed ceiling: nothing ordinary can equal or exceed it.
        assertEq(uint256(bandStart), sealedCeiling + 1, "bands begin one past the sealed ordinary ceiling");
    }
}
