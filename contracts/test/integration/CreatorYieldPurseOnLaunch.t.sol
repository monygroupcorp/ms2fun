// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";

import { MockV4PoolManager } from "../factories/erc404/ERC404GraduationSkipNFT.t.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { MockWETH, MockStataToken, MockAmbassadorRegistry } from "../vaults/aave/AlignmentEndowmentVault.t.sol";

/**
 * @title  CreatorYieldPurseOnLaunch
 * @notice THE CREATOR'S SHARE OF THE ALIGNMENT TITHE IS A NUMBER THEY CAN BE PAID, NOT A DESIGN.
 *
 *         A launch routes 19% of its raise to the alignment vault at graduation. In the endowment
 *         family that 19% is not spent — it is corpus, supplied to Aave, and what it earns is split
 *         1% protocol / 19% community / 80% back to the creator, held per-benefactor in `yieldPurse`
 *         and pulled by `claimYieldPurse`. Every leg of that had its own unit test and none of them
 *         met end to end: the vault suite credits a `MockOwnable` benefactor by calling
 *         `receiveContribution` directly, and the graduation suites deliver the cut to a `MockVault`
 *         that does nothing with it. Between them sat the question this file answers — whether a real
 *         collection, graduated through the real deployer module into a real endowment vault, ever
 *         pays its creator anything at all.
 *
 *         What is real here: the instance, the curve, the buy path, `deployLiquidity`, the split, the
 *         vault, the accumulator and the claim. What is mocked is Uniswap v4 (the module's pool
 *         counterparty, which this says nothing about) and Aave's stata token, whose yield is injected
 *         rather than earned — there is no other way to make time pass in a lending market in a unit
 *         test, and the amount injected is an input to the assertions, never read back from the vault.
 *
 *         VACUITY ([[vacuity-check]]): the pay-out assertions are equalities against figures derived
 *         from the raise and the injected yield alone. `assertGt(paid, 0)` on its own would pass on a
 *         vault that paid a wei; the split is pinned at 80% of the yield earned by exactly the 19% the
 *         graduation delivered, and the benefactor is asserted to be the collection rather than
 *         whoever happened to call.
 */
contract CreatorYieldPurseOnLaunchTest is Test {
    /// @dev Mirrors `LiquidityDeployerModule.GraduationVaultContribution` so the tithe can be read off
    ///      the logs rather than inferred from a balance.
    event GraduationVaultContribution(address indexed vault, uint256 amount);

    address internal creator = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal successor = address(0x5ECC5);
    /// @dev Two treasuries, deliberately apart. Graduation pays 1% of the RAISE to the instance's
    ///      protocol treasury; the vault pays 1% of the YIELD to its own. Pointing both at one address
    ///      would let a test assert the yield leg against a balance the raise had already moved.
    address internal instanceTreasury = address(0x7EA1);
    address internal vaultTreasury = address(0x7EA2);
    address internal community = address(0xC0FFEE);
    address internal vaultOwner = address(0x7A017);

    uint256 internal constant NFT_COUNT = 1000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant TARGET_ETH = 10 ether;
    uint256 internal constant RESERVE_BPS = 1000; // the shipping preset
    uint256 internal constant TARGET_ID = 42;

    /// @dev The vault's own split of harvested yield, mirrored for the expectations below.
    uint256 internal constant PROTOCOL_BPS = 100; // 1%
    uint256 internal constant TARGET_BPS = 1_900; // 19%
    uint256 internal constant BPS = 10_000;

    /// @dev The creator leg does not arrive as a transfer; it arrives through `accCreatorYieldPerShare`,
    ///      which is floor-divided by the share count at 1e18 precision on the way in and multiplied back
    ///      out at claim. That loses at most a wei or two on the corpus sizes here (measured: 2 wei on the
    ///      full raise, 1 on the partial). Nine orders of magnitude below the gap between the 80% leg and
    ///      either of its siblings, so a leg swapped for another still fails these assertions outright.
    uint256 internal constant ACC_DUST = 1e3;

    ERC404BondingInstance internal instance;
    LiquidityDeployerModule internal deployer;
    CurveParamsComputer internal curveComputer;
    MockV4PoolManager internal pool;
    MockMasterRegistry internal registry;
    MockAmbassadorRegistry internal alignmentRegistry;
    AlignmentEndowmentVault internal vault;
    MockWETH internal weth;
    MockStataToken internal stata;

    uint256 internal maxBondingSupply;

    function setUp() public {
        vm.warp(365 days);

        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        registry = new MockMasterRegistry();
        alignmentRegistry = new MockAmbassadorRegistry();
        registry.setAlignmentRegistry(address(alignmentRegistry));
        alignmentRegistry.setCommunityPayout(TARGET_ID, community);

        vault = AlignmentEndowmentVault(payable(LibClone.clone(address(new AlignmentEndowmentVault()))));
        vault.initialize(
            vaultOwner,
            address(weth),
            address(stata),
            vaultTreasury,
            address(registry),
            address(0xA11167), // alignmentToken: satisfies the registry's shape check, unread here
            TARGET_ID
        );

        pool = new MockV4PoolManager();
        deployer = new LiquidityDeployerModule(address(pool), address(0xBEEF), 3000, 60, address(registry));
        curveComputer = new CurveParamsComputer(address(this));

        BondingCurveMath.Params memory curve = curveComputer.computeCurveParams(NFT_COUNT, TARGET_ETH, 1, RESERVE_BPS);

        vm.startPrank(creator);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        DN404Mirror mirror = new DN404Mirror(creator);

        instance.initialize(
            creator,
            address(vault),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: curve
            }),
            address(deployer),
            address(0),
            address(mirror)
        );
        instance.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: instanceTreasury,
                masterRegistry: address(registry),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        instance.initializeMetadata("Purse", "PURSE", "", "", "");
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        vm.stopPrank();

        vm.warp(block.timestamp + 1);
        maxBondingSupply = MAX_SUPPLY - instance.liquidityReserve();
    }

    // ── Rig helpers ───────────────────────────────────────────────────────────

    /// @dev Buy `pct` of the curve's sellable supply. NFT-skipping: these are thousands of ids' worth of
    ///      coin and the id side is not what is under test.
    function _buyPercent(uint256 pct) internal {
        uint256 amount = (maxBondingSupply * pct) / 100;
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(amount, type(uint256).max, false, bytes(""), bytes(""), 0);
        vm.stopPrank();
    }

    /// @dev Graduate and return the tithe the module reported delivering to the vault.
    function _graduate() internal returns (uint256 vaultCut) {
        vm.recordLogs();
        vm.prank(creator);
        instance.deployLiquidity(0);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(deployer) && logs[i].topics[0] == GraduationVaultContribution.selector) {
                vaultCut = abi.decode(logs[i].data, (uint256));
                seen = true;
            }
        }
        assertTrue(seen, "graduation never reported a vault contribution");
    }

    /// @dev Inject Aave yield onto the vault's position: WETH minted straight into the stata token,
    ///      raising value-per-share without minting shares. The vault's own basis is untouched, which is
    ///      exactly what it reads as harvestable yield.
    function _accrueAaveYield(uint256 extra) internal {
        vm.deal(address(weth), address(weth).balance + extra);
        weth.mint(address(this), extra);
        weth.approve(address(stata), extra);
        stata.simulateYield(extra);
    }

    // ── The question ──────────────────────────────────────────────────────────

    /// THE CLAUSE. A collection is launched, bought, and graduated; the 19% lands in the endowment as
    /// corpus keyed to the collection; Aave pays on it; the creator claims and is paid a nonzero number.
    /// Every figure below comes from the raise and the injected yield, so a vault that paid dust, paid
    /// the wrong leg, or paid the wrong party fails rather than passing on `> 0`.
    function test_creatorYieldPurse_paysTheCreatorOnALaunchedCollection() public {
        _buyPercent(100);
        uint256 vaultCut = _graduate();

        assertGt(vaultCut, 0, "state precondition: the graduation tithe is real");
        assertEq(
            vault.principalOf(address(instance)),
            vaultCut,
            "the whole tithe is corpus held for the collection, not spent"
        );

        // Aave pays. 1 ETH on a ~1.9 ETH corpus is not a realistic rate; it is a number large enough
        // that the 1%/19%/80% legs are separated by far more than any rounding in the split.
        uint256 yieldPaid = 1 ether;
        _accrueAaveYield(yieldPaid);
        vault.harvest();

        uint256 expectedProtocol = (yieldPaid * PROTOCOL_BPS) / BPS;
        uint256 expectedTarget = (yieldPaid * TARGET_BPS) / BPS;
        uint256 expectedCreator = yieldPaid - expectedProtocol - expectedTarget; // 80%, dust included

        assertApproxEqAbs(
            vault.pendingYieldOf(address(instance)),
            expectedCreator,
            ACC_DUST,
            "the creator's leg of the harvest is 80% of what the tithe earned"
        );

        uint256 creatorBefore = creator.balance;
        vm.prank(creator);
        uint256 paid = vault.claimYieldPurse(address(instance));

        assertGt(paid, 0, "the creator's yield purse paid nothing on a launched collection");
        assertApproxEqAbs(paid, expectedCreator, ACC_DUST, "the purse paid something other than the creator's 80% leg");
        assertEq(creator.balance - creatorBefore, paid, "the ETH did not reach the creator");
        assertEq(vault.yieldPurse(address(instance)), 0, "the purse was not zeroed by the claim");

        // The two sibling legs landed where they belong, so the 80% above is a share of a real split
        // and not the whole of the yield under another name.
        assertEq(community.balance, expectedTarget, "the community's 19% leg did not arrive");
        assertEq(vaultTreasury.balance, expectedProtocol, "the protocol's 1% leg did not arrive");
    }

    /// The purse is keyed to the COLLECTION, and the claim pays the collection's owner. Nobody else can
    /// pull it, and the creator's own address is not what the vault credits — which is what makes the
    /// number above survive an ownership transfer rather than being a snapshot of who launched it.
    function test_creatorYieldPurse_isKeyedToTheCollectionAndPaidToItsOwner() public {
        _buyPercent(100);
        _graduate();
        _accrueAaveYield(1 ether);
        vault.harvest();

        assertEq(vault.principalOf(creator), 0, "the creator address itself holds no corpus");
        assertGt(vault.pendingYieldOf(address(instance)), 0, "state precondition: the collection has earned");

        vm.prank(buyer);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.claimYieldPurse(address(instance));

        // The collection changes hands; the accrued purse follows the collection, and the NEW owner is
        // who the vault pays. The purse is the collection's, never an address the launch remembered.
        vm.prank(creator);
        instance.transferOwnership(successor);

        uint256 expected = vault.pendingYieldOf(address(instance));
        vm.prank(successor);
        uint256 paid = vault.claimYieldPurse(address(instance));

        assertEq(paid, expected, "the claim paid something other than what had accrued");
        assertEq(successor.balance, paid, "the purse did not follow the collection to its new owner");
        assertEq(creator.balance, 0, "the purse paid an owner the collection no longer has");
    }

    /// A partial raise pays too: the purse is a share of whatever tithe the launch actually produced,
    /// not a fixed number that only appears on a sold-out curve. `deployLiquidity` does not require the
    /// curve to sell out, so a collection that graduates at 40% must still earn for its creator.
    function test_creatorYieldPurse_paysOnAPartialRaise() public {
        _buyPercent(40);
        uint256 vaultCut = _graduate();

        assertGt(vaultCut, 0, "a partial raise still owes the alignment tithe");
        assertEq(vault.principalOf(address(instance)), vaultCut, "the partial tithe is corpus all the same");

        uint256 yieldPaid = 0.25 ether;
        _accrueAaveYield(yieldPaid);
        vault.harvest();

        vm.prank(creator);
        uint256 paid = vault.claimYieldPurse(address(instance));
        assertGt(paid, 0, "a partially-raised collection earned its creator nothing");
        assertApproxEqAbs(
            paid,
            yieldPaid - (yieldPaid * PROTOCOL_BPS) / BPS - (yieldPaid * TARGET_BPS) / BPS,
            ACC_DUST,
            "a partially-raised collection earned its creator something other than the 80% leg"
        );
    }
}
