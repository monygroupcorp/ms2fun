// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { ERC404Factory } from "../../../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LaunchManager } from "../../../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { RevenueSplitLib } from "../../../src/shared/libraries/RevenueSplitLib.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract CarveVault {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

/// @dev Accepts the graduation and holds the ETH. The split itself is the deployer module's own suite;
///      what this file measures is the carve figure the instance resolves BEFORE handing it over.
contract CarveDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title ERC404CarveAuthorityTest
 * @notice Who may move the creator's graduation carve, and against which terms it is measured.
 *
 *         Two defects, one economic surface, and they are adjacent because both let a party who is not
 *         the creator decide what the creator's carve is worth after the creator's own ceiling was
 *         already immutable:
 *
 *         1. AN AGENT COULD FORFEIT THE WHOLE CARVE. `deployLiquidity` takes the request as a caller
 *            argument and graduation is one-shot, so a delegated agent calling `deployLiquidity(0)`
 *            put the creator's entire carve into the pool with no way back. The request is now floored
 *            at `declaredMaxAllowanceBps` for any caller that is not the owner.
 *
 *            Note what the fix is NOT: rejecting a zero from an agent. That shape is defeated by
 *            requesting one bps, which forfeits 99.99% of the carve just as permanently, and
 *            `test_agent_cannot_shave_the_carve_with_a_single_bps` is the case that separates them.
 *
 *         2. THE TERMS WERE LIVE, NOT SEALED. `minPoolEth` and the carve brackets were read from the
 *            factory AT GRADUATION, so one `setMinPoolEth` call moved the economics of every collection
 *            already deployed — creators whose `declaredMaxAllowanceBps` was written once at create and
 *            has no setter. Each create now seals the terms it was made under, and the setters bound
 *            what may be offered to the NEXT create.
 *
 *         Non-vacuity runs through the pairs rather than through a perturbation comment. For (1), the
 *         agent's zero must land on the same figure as the OWNER's full request while the owner's own
 *         zero still lands on nothing: delete the floor and the first assertion collapses onto the
 *         third. For (2), a collection created BEFORE the raise must be unmoved by it while one created
 *         AFTER must feel it: ignore the seal and the first fails, freeze everything and the second does.
 */
contract ERC404CarveAuthorityTest is Test {
    ERC404Factory internal factory;
    LaunchManager internal launchMgr;
    CurveParamsComputer internal curveComp;
    ComponentRegistry internal componentRegistry;
    MockMasterRegistry internal registry;
    CarveVault internal vault;
    CarveDeployer internal deployer;

    address internal protocolAdmin = address(0x9);
    address internal agent = address(0x10);
    address internal creator = address(0x5);
    address internal buyer = address(0xB0B);
    address internal mockGMR = address(0x5555555555555555555555555555555555555555);

    uint256 internal constant PRESET_ID = 1;
    uint256 internal constant NFT_COUNT = 10;

    /// @dev A deliberately SMALL target. The pool floor only bites where the LP's 80% share is near it,
    ///      so a 15 ETH raise would clear even the ceiling floor with room to spare and the seal would
    ///      have nothing to demonstrate. At ~5 ETH the LP share is ~4 ETH, which is exactly
    ///      `MAX_MIN_POOL_ETH` — so the ceiling floor leaves ~no headroom and the default floor leaves
    ///      plenty.
    uint256 internal constant TARGET_ETH = 5 ether;

    uint16 internal constant DECLARED_MAX_BPS = 10_000;

    uint256 internal _saltCounter;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocolAdmin);

        registry = new MockMasterRegistry();
        vault = new CarveVault();
        launchMgr = new LaunchManager(protocolAdmin);
        curveComp = new CurveParamsComputer(protocolAdmin);
        deployer = new CarveDeployer();

        ComponentRegistry compRegImpl = new ComponentRegistry();
        componentRegistry = ComponentRegistry(LibClone.deployERC1967(address(compRegImpl)));
        componentRegistry.initialize(protocolAdmin);
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "StandardCurve");
        componentRegistry.approveComponent(address(deployer), keccak256("liquidity"), "CarveDeployer");

        launchMgr.setPreset(
            PRESET_ID,
            LaunchManager.Preset({
                targetETH: TARGET_ETH,
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
                masterRegistry: address(registry),
                protocol: protocolAdmin,
                weth: address(0xBEEF)
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: mockGMR,
                launchManager: address(launchMgr),
                componentRegistry: address(componentRegistry)
            })
        );

        registry.setAgent(agent, true);
        vm.stopPrank();
    }

    // ── Rig ───────────────────────────────────────────────────────────────────────────────────────

    function _create(address caller, string memory name_) internal returns (ERC404BondingInstance) {
        vm.deal(caller, 1 ether);
        vm.prank(caller);
        address instance = factory.createInstance(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator,
                nftCount: NFT_COUNT,
                presetId: uint8(PRESET_ID),
                vault: address(vault),
                name: name_,
                symbol: "SYM",
                styleUri: "",
                tokenBaseURI: "",
                stakingModule: address(0),
                declaredMaxAllowanceBps: DECLARED_MAX_BPS
            }),
            "ipfs://metadata",
            address(deployer),
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        );
        return ERC404BondingInstance(payable(instance));
    }

    /// @dev Open the curve and buy the whole sellable supply, so every collection in this file reaches
    ///      the same raise and the only thing differing between them is the terms they were sealed on.
    function _openAndFill(ERC404BondingInstance instance) internal {
        vm.startPrank(creator);
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);

        uint256 sellable = instance.maxSupply() - instance.liquidityReserve();
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(sellable, type(uint256).max, false, bytes(""), bytes(""), 0);
        vm.stopPrank();
    }

    /// @dev The carve leg of `GraduationEthDiverted(ethForPool, excessEth, creatorCarveEth)`.
    function _carvePaid(Vm.Log[] memory logs, address instance) internal pure returns (uint256) {
        bytes32 sig = keccak256("GraduationEthDiverted(uint256,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == instance && logs[i].topics[0] == sig) {
                (,, uint256 carveEth) = abi.decode(logs[i].data, (uint256, uint256, uint256));
                return carveEth;
            }
        }
        revert("no GraduationEthDiverted");
    }

    function _graduate(ERC404BondingInstance instance, address caller, uint256 requestBps)
        internal
        returns (uint256 carvePaid)
    {
        vm.recordLogs();
        vm.prank(caller);
        instance.deployLiquidity(requestBps);
        return _carvePaid(vm.getRecordedLogs(), address(instance));
    }

    // ── 1. An agent cannot choose the amount ──────────────────────────────────────────────────────

    function test_agent_graduating_at_zero_still_pays_the_full_declared_carve() public {
        ERC404BondingInstance instance = _create(agent, "Agent Zero");
        assertTrue(instance.agentDelegationEnabled(), "agent-created instance has delegation on");
        _openAndFill(instance);

        uint256 full = instance.previewCarve(DECLARED_MAX_BPS);
        assertGt(full, 0, "the scenario must have a carve to forfeit, or nothing below is falsifiable");

        assertEq(_graduate(instance, agent, 0), full, "an agent's zero must resolve to the full declared carve");
    }

    /// The case that rules out rejecting a zero instead of flooring it: one bps is not zero, passes any
    /// zero-check, and still forfeits all but a ten-thousandth of the carve.
    function test_agent_cannot_shave_the_carve_with_a_single_bps() public {
        ERC404BondingInstance instance = _create(agent, "Agent One Bps");
        _openAndFill(instance);

        uint256 full = instance.previewCarve(DECLARED_MAX_BPS);
        uint256 shaved = instance.previewCarve(1);
        assertLt(shaved, full / 100, "one bps must be a real shave, or this test proves nothing");

        assertEq(_graduate(instance, agent, 1), full, "an agent's one bps must resolve to the full declared carve");
    }

    /// The other side of the floor: the party whose money it is may still give it away.
    function test_owner_graduating_at_zero_waives_the_carve() public {
        ERC404BondingInstance instance = _create(creator, "Owner Zero");
        _openAndFill(instance);

        assertEq(_graduate(instance, creator, 0), 0, "the owner's own waiver must survive");
    }

    /// And the owner's partial request is untouched — the floor is agent-only, not a new global minimum.
    function test_owner_partial_request_is_unchanged() public {
        ERC404BondingInstance instance = _create(creator, "Owner Partial");
        _openAndFill(instance);

        uint256 full = instance.previewCarve(DECLARED_MAX_BPS);
        uint256 half = instance.previewCarve(5000);
        assertGt(half, 0, "a half request must be nonzero here");
        assertLt(half, full, "a half request must be strictly less than the full one");

        assertEq(_graduate(instance, creator, 5000), half, "the owner's partial request must pass through");
    }

    // ── 2. The setters are bounded ────────────────────────────────────────────────────────────────

    function test_setMinPoolEth_refuses_above_the_ceiling() public {
        uint256 ceiling = factory.MAX_MIN_POOL_ETH();
        vm.prank(protocolAdmin);
        vm.expectRevert(ERC404Factory.MinPoolEthTooHigh.selector);
        factory.setMinPoolEth(ceiling + 1);
    }

    function test_setMinPoolEth_accepts_the_ceiling_itself() public {
        uint256 ceiling = factory.MAX_MIN_POOL_ETH();
        vm.prank(protocolAdmin);
        factory.setMinPoolEth(ceiling);
        assertEq(factory.minPoolEth(), ceiling, "the ceiling is inclusive");
    }

    function test_setCarveBrackets_refuses_an_all_zero_ladder() public {
        vm.prank(protocolAdmin);
        vm.expectRevert(ERC404Factory.InvalidBracketParams.selector);
        factory.setCarveBrackets(RevenueSplitLib.BracketParams({ b1: 4 ether, b2: 20 ether, r1: 0, r2: 0, r3: 0 }));
    }

    /// A ladder that tapers to nothing on the largest raises is an ordinary regime and must stay legal —
    /// the rejection above is about switching the carve off, not about a zero appearing anywhere.
    function test_setCarveBrackets_still_accepts_a_taper_to_zero() public {
        vm.prank(protocolAdmin);
        factory.setCarveBrackets(
            RevenueSplitLib.BracketParams({ b1: 4 ether, b2: 20 ether, r1: 5000, r2: 1000, r3: 0 })
        );
        assertEq(factory.carveBracketParams().r3, 0, "a zero top rate is allowed");
    }

    // ── 3. The terms are sealed at create ─────────────────────────────────────────────────────────

    function test_raising_the_pool_floor_does_not_move_an_existing_collections_carve() public {
        ERC404BondingInstance before_ = _create(creator, "Sealed Before");
        _openAndFill(before_);
        uint256 sealedCarve = before_.previewCarve(DECLARED_MAX_BPS);
        assertGt(sealedCarve, 0, "the pre-raise carve must be nonzero");

        uint256 ceiling = factory.MAX_MIN_POOL_ETH();
        vm.prank(protocolAdmin);
        factory.setMinPoolEth(ceiling);

        assertEq(
            before_.previewCarve(DECLARED_MAX_BPS), sealedCarve, "a deployed collection keeps the terms it was made on"
        );

        // …and the raise is not being ignored: the very next create is made under it.
        ERC404BondingInstance after_ = _create(creator, "Sealed After");
        _openAndFill(after_);
        assertLt(
            after_.previewCarve(DECLARED_MAX_BPS), sealedCarve, "a collection created after the raise feels the raise"
        );
    }

    function test_changing_the_brackets_does_not_move_an_existing_collections_carve() public {
        ERC404BondingInstance before_ = _create(creator, "Brackets Before");
        _openAndFill(before_);
        uint256 sealedCarve = before_.previewCarve(DECLARED_MAX_BPS);
        assertGt(sealedCarve, 0, "the pre-change carve must be nonzero");

        vm.prank(protocolAdmin);
        factory.setCarveBrackets(RevenueSplitLib.BracketParams({ b1: 4 ether, b2: 20 ether, r1: 1, r2: 1, r3: 1 }));

        assertEq(before_.previewCarve(DECLARED_MAX_BPS), sealedCarve, "a deployed collection keeps its own brackets");

        ERC404BondingInstance after_ = _create(creator, "Brackets After");
        _openAndFill(after_);
        assertLt(after_.previewCarve(DECLARED_MAX_BPS), sealedCarve, "a collection created after feels the new ladder");
    }

    /// The load-bearing one: not the preview, the money. A floor raised between create and graduation
    /// must not change what the creator is actually paid.
    function test_the_carve_paid_at_graduation_is_the_one_sealed_at_create() public {
        ERC404BondingInstance instance = _create(creator, "Sealed Through Graduation");
        _openAndFill(instance);
        uint256 sealedCarve = instance.previewCarve(DECLARED_MAX_BPS);
        assertGt(sealedCarve, 0, "the sealed carve must be nonzero");

        uint256 ceiling = factory.MAX_MIN_POOL_ETH();
        vm.prank(protocolAdmin);
        factory.setMinPoolEth(ceiling);
        vm.prank(protocolAdmin);
        factory.setCarveBrackets(RevenueSplitLib.BracketParams({ b1: 4 ether, b2: 20 ether, r1: 1, r2: 1, r3: 1 }));

        assertEq(
            _graduate(instance, creator, DECLARED_MAX_BPS),
            sealedCarve,
            "graduation pays the terms sealed at create, not the ones standing at graduation"
        );
    }

    function test_carveTermsOf_reports_the_seal_for_an_instance_and_the_current_terms_otherwise() public {
        ERC404BondingInstance instance = _create(creator, "Terms Readback");

        (uint256 sealedFloor, RevenueSplitLib.BracketParams memory sealedBrackets) =
            factory.carveTermsOf(address(instance));
        assertEq(sealedFloor, 1 ether, "sealed on the shipped default floor");
        assertEq(sealedBrackets.r1, 5000, "sealed on the shipped default ladder");

        vm.prank(protocolAdmin);
        factory.setMinPoolEth(2 ether);

        (uint256 stillSealed,) = factory.carveTermsOf(address(instance));
        assertEq(stillSealed, 1 ether, "the seal does not follow the setter");

        // An address this factory never created has no seal, which is the pre-create case the wizard
        // previews: it reads the terms the next create would be made under.
        (uint256 liveFloor,) = factory.carveTermsOf(address(0xDEAD));
        assertEq(liveFloor, 2 ether, "an unsealed address reads the current terms");
    }
}
