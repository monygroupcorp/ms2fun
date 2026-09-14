// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { QueryAggregator } from "../../src/query/QueryAggregator.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { ERC404BondingInstance } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import { ERC404BondingStorage } from "src/factories/erc404/ERC404BondingStorage.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "src/interfaces/ILiquidityDeployerModule.sol";

/// @dev Graduation sink the instance needs wired but this suite never fires.
contract EscrowCoinLiquidityDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }

    function setMetadataURI(string calldata) external override { }
}

/// @dev Answers the two registry reads the portfolio path makes. Every instance registered here is an
///      ERC404 whose `instanceType()` the aggregator reads off the instance itself.
contract EscrowCoinRegistry {
    mapping(address => string) public names;

    function register(address instance, string memory name_) external {
        names[instance] = name_;
    }

    function getInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = instance;
        info.name = names[instance];
    }
}

contract EscrowCoinFQM {
    function getFeaturedInstances(uint256, uint256) external pure returns (address[] memory a, uint256 t) {
        a = new address[](0);
        t = 0;
    }
}

/**
 * @title QueryAggregatorEscrowedCoin
 * @notice noesis-316 option A: the portfolio lens reports coin a holder owns but cannot transfer.
 * @dev The three cases the goal names, each against a REAL `ERC404BondingInstance` rather than a mock,
 *      so the lens is proved to agree with the escrow accounting itself and not with a second copy of
 *      it written here. The ladder, funding and burn mechanics are the ones `TierBurnSafety` pins.
 *
 *      Non-vacuity is structural in all three: `coinBalance` and `pendingEscrowRelease` are asserted
 *      against independently-derived amounts — `(weight - 1) * UNIT` from the band the test chose —
 *      and the untiered case asserts EQUALITY with `tokenBalance` while the tiered case asserts strict
 *      inequality, so a lens that simply aliased one field to the other fails the tiered case and a
 *      lens that hardcoded a band premium fails the untiered one.
 */
contract QueryAggregatorEscrowedCoinTest is Test {
    QueryAggregator internal agg;
    EscrowCoinRegistry internal registry;
    EscrowCoinFQM internal fqm;

    ERC404BondingInstance internal token;
    ERC404BondingInstance internal impl;
    ERC404BondingOps internal ops;
    EscrowCoinLiquidityDeployer internal liquidityDeployer;

    address internal owner = address(0x5);
    address internal user1 = address(0x10);
    address internal sink = address(0x40);
    address internal treasury = address(0xFEE);
    address internal aggOwner = makeAddr("aggOwner");

    uint256 constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 constant UNIT = 1_000_000 ether;
    uint256 constant ID_LIMIT = MAX_SUPPLY / UNIT;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;

    uint32 constant T1_START = 1001;
    uint32 constant T1_END = 1100; // weight 10
    uint32 constant T2_START = 1101;
    uint32 constant T2_END = 1110; // weight 100

    function setUp() public {
        registry = new EscrowCoinRegistry();
        fqm = new EscrowCoinFQM();
        agg = new QueryAggregator();
        agg.initialize(address(registry), address(fqm), address(0), aggOwner);

        liquidityDeployer = new EscrowCoinLiquidityDeployer();
        ops = new ERC404BondingOps();
        impl = new ERC404BondingInstance(address(ops));
        token = _newInstance();
        registry.register(address(token), "TierToken");

        vm.prank(sink);
        token.setSkipNFT(true);
    }

    // ── the lens call under test ─────────────────────────────────────────────────────────────────

    function _holdingOf(address who) internal view returns (QueryAggregator.ERC404Holding memory h, bool found) {
        address[] memory instances = new address[](1);
        instances[0] = address(token);
        address[] memory vaults = new address[](0);
        (QueryAggregator.ERC404Holding[] memory rows,,,,) = agg.getPortfolioData(who, instances, vaults);
        if (rows.length == 0) return (h, false);
        return (rows[0], true);
    }

    // ── case 1: untiered ─────────────────────────────────────────────────────────────────────────

    /// No ladder is ever sealed, so there is no band anywhere and coin is exactly the liquid balance.
    /// The EQUALITY is the assertion that matters: it is what fails if the lens ever starts adding a
    /// premium that is not there.
    function test_untiered_coinBalanceEqualsTokenBalance() public {
        _fund(token, user1, 3);

        (QueryAggregator.ERC404Holding memory h, bool found) = _holdingOf(user1);

        assertTrue(found, "the holder has a row");
        assertEq(h.tokenBalance, 3 * UNIT, "liquid balance as it has always been reported");
        assertEq(h.coinBalance, 3 * UNIT, "untiered: coin IS the balance");
        assertEq(h.coinBalance, h.tokenBalance, "and the two agree exactly");
        assertEq(h.pendingEscrowRelease, 0, "nothing has been released");
        assertEq(token.coinBalanceOf(user1), h.coinBalance, "lens agrees with the instance");
    }

    // ── case 2: tiered ───────────────────────────────────────────────────────────────────────────

    /// A holder of one weight-10 band NFT: 1 unit liquid, 9 units locked behind the band. The lens must
    /// report 10 units of coin while `tokenBalance` still reports 1 — the whole point of option A.
    function test_tiered_coinBalanceCountsTheBandDenomination() public {
        _seal();
        _holderWithOneBandNFT(user1, 1);

        (QueryAggregator.ERC404Holding memory h, bool found) = _holdingOf(user1);

        assertTrue(found, "the holder has a row");
        assertEq(h.tokenBalance, UNIT, "tokenBalance is UNCHANGED: the plain balanceOf, one unit");
        assertEq(h.coinBalance, 10 * UNIT, "coin folds in the band's (w - 1) * unit");
        assertGt(h.coinBalance, h.tokenBalance, "strictly more coin than transferable balance");
        assertEq(h.coinBalance - h.tokenBalance, 9 * UNIT, "and the gap IS the escrowed denomination");
        assertEq(h.pendingEscrowRelease, 0, "nothing burned yet");
        assertEq(token.coinBalanceOf(user1), h.coinBalance, "lens agrees with the instance");
    }

    // ── case 3: released escrow ──────────────────────────────────────────────────────────────────

    /// The case the old inclusion filter erased. Burning the band NFT drops `balanceOf` to zero and
    /// moves the 9 units into `pendingEscrowRelease`. Before noesis-316 this holder had NO ROW AT ALL:
    /// `tokenBalance > 0 || stakedBalance > 0` was false while the instance still owed them 9 units.
    function test_releasedEscrow_isReportedEvenWhenTheBalanceIsZero() public {
        _seal();
        _holderWithOneBandNFT(user1, 1);

        // The debit that burns the band NFT and fires the release hook.
        vm.prank(user1);
        token.transfer(sink, UNIT);

        assertEq(token.balanceOf(user1), 0, "precondition: no liquid balance left");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "precondition: the claim exists");

        (QueryAggregator.ERC404Holding memory h, bool found) = _holdingOf(user1);

        assertTrue(found, "the row SURVIVES a zero balance because the claim is a holding");
        assertEq(h.tokenBalance, 0, "nothing liquid");
        assertEq(h.coinBalance, 0, "the band is gone, so it carries no coin any more");
        assertEq(h.pendingEscrowRelease, 9 * UNIT, "the claim is what the holder still owns");

        // Conservation across the pull: what was pending becomes liquid, and the lens follows.
        vm.prank(user1);
        token.claimReleasedEscrow();

        (QueryAggregator.ERC404Holding memory after_,) = _holdingOf(user1);
        assertEq(after_.pendingEscrowRelease, 0, "claim settled");
        assertEq(after_.tokenBalance, 9 * UNIT, "and it landed in the balance");
        assertEq(after_.coinBalance, 9 * UNIT, "coin follows it, never double-counted");
    }

    /// The two fields are never double-counting the same coin: across the burn, the sum of coin and
    /// pending claim is conserved. This is the lens-side reading of `TierBurnSafety`'s own invariant.
    function test_coinPlusPendingIsConservedAcrossTheBurn() public {
        _seal();
        _holderWithOneBandNFT(user1, 1);

        (QueryAggregator.ERC404Holding memory before_,) = _holdingOf(user1);
        uint256 totalBefore = before_.coinBalance + before_.pendingEscrowRelease;

        vm.prank(user1);
        token.transfer(sink, UNIT);

        (QueryAggregator.ERC404Holding memory after_,) = _holdingOf(user1);
        uint256 totalAfter = after_.coinBalance + after_.pendingEscrowRelease;

        // One unit genuinely left to `sink`; everything else is still the holder's, in one field or
        // the other. A lens that counted the band twice would show the total RISING here.
        assertEq(totalAfter, totalBefore - UNIT, "coin + claim falls by exactly what was spent");
    }

    /// An instance that answers neither new symbol must leave both fields zero rather than reverting
    /// the whole batch — the failure-tolerance doctrine every other read on this path follows.
    function test_instanceWithoutTheNewSymbols_leavesBothFieldsZeroAndKeepsTheBatch() public {
        NoEscrowSymbols legacy = new NoEscrowSymbols();
        registry.register(address(legacy), "Legacy");

        address[] memory instances = new address[](2);
        instances[0] = address(legacy);
        instances[1] = address(token);
        address[] memory vaults = new address[](0);

        _fund(token, user1, 2);

        (QueryAggregator.ERC404Holding[] memory rows,,,,) = agg.getPortfolioData(user1, instances, vaults);

        assertEq(rows.length, 2, "the batch survives the instance that cannot answer");
        assertEq(rows[0].instance, address(legacy), "legacy row first, in call order");
        assertEq(rows[0].tokenBalance, 5 ether, "its balance still read");
        assertEq(rows[0].coinBalance, 0, "unsupported: zero, not a revert");
        assertEq(rows[0].pendingEscrowRelease, 0, "unsupported: zero, not a revert");
        assertEq(rows[1].coinBalance, 2 * UNIT, "and the healthy sibling is unaffected");
    }

    // ── harness (mirrors TierBurnSafety) ─────────────────────────────────────────────────────────

    function _newInstance() internal returns (ERC404BondingInstance t) {
        BondingCurveMath.Params memory curveParams =
            BondingCurveMath.Params({ kCoeff: 0.0001 ether, poleWad: 1.0438e18, normalizationFactor: 1e18 });

        t = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        t.initialize(
            owner,
            address(0xBEEF),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: curveParams
            }),
            address(liquidityDeployer),
            address(0),
            address(new DN404Mirror(address(this)))
        );
        t.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: treasury,
                masterRegistry: address(0x400),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        t.initializeMetadata("TierToken", "TIER", "", "", "");
    }

    function _defaultBands() internal pure returns (ERC404BondingStorage.TierBand[] memory bands) {
        bands = new ERC404BondingStorage.TierBand[](2);
        bands[0] = ERC404BondingStorage.TierBand({ idStart: T1_START, idEnd: T1_END, weight: 10 });
        bands[1] = ERC404BondingStorage.TierBand({ idStart: T2_START, idEnd: T2_END, weight: 100 });
    }

    function _seal() internal {
        token.initTierBands(_defaultBands());
    }

    function _fund(ERC404BondingInstance t, address who, uint256 nftCount) internal {
        vm.prank(address(t));
        t.transfer(who, nftCount * UNIT);
    }

    function _ownerOrZero(uint256 id) internal view returns (address who) {
        try token.ownerOf(id) returns (address o) {
            who = o;
        } catch {
            who = address(0);
        }
    }

    function _ownedIdsOf(address who) internal view returns (uint256[] memory ids) {
        uint256[] memory buf = new uint256[](ID_LIMIT + (T2_END - T1_START + 1));
        uint256 n;
        for (uint256 id = 1; id <= ID_LIMIT; id++) {
            if (_ownerOrZero(id) == who) buf[n++] = id;
        }
        for (uint256 id = T1_START; id <= T2_END; id++) {
            if (_ownerOrZero(id) == who) buf[n++] = id;
        }
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) {
            ids[i] = buf[i];
        }
    }

    function _bandOccupancy() internal view returns (bool[] memory set) {
        set = new bool[](T2_END - T1_START + 1);
        for (uint256 id = T1_START; id <= T2_END; id++) {
            set[id - T1_START] = _ownerOrZero(id) != address(0);
        }
    }

    function _bandIdAfterMintUp(address who, bool[] memory before_) internal view returns (uint256) {
        uint256 reused;
        for (uint256 id = T1_START; id <= T2_END; id++) {
            if (_ownerOrZero(id) != who) continue;
            if (!before_[id - T1_START]) return id;
            reused = id;
        }
        if (reused != 0) return reused;
        revert("no band id was issued");
    }

    function _mintUpAny(address who, uint8 tierN) internal returns (bool ok, uint256 bandId) {
        bool[] memory occupancyBefore = _bandOccupancy();
        uint256[] memory ids = _ownedIdsOf(who);
        for (uint256 i; i < ids.length; i++) {
            if (ids[i] > ID_LIMIT) continue;
            vm.prank(who);
            // slither-disable-next-line low-level-calls
            (ok,) = address(token).call(abi.encodeWithSignature("mintUp(uint8,uint256)", tierN, ids[i]));
            if (ok) return (true, _bandIdAfterMintUp(who, occupancyBefore));
        }
        return (false, 0);
    }

    function _holderWithOneBandNFT(address who, uint8 tierN) internal returns (uint256 bandId) {
        uint256 weight = tierN == 1 ? 10 : 100;
        _fund(token, who, weight);
        (bool ok, uint256 id) = _mintUpAny(who, tierN);
        assertTrue(ok, "setup: mintUp");
        assertEq(token.balanceOf(who), UNIT, "setup: one unit of liquid balance left");
        return id;
    }
}

/// @dev An ERC404-typed instance predating noesis-316: it answers `balanceOf`/`unit` but neither
///      `coinBalanceOf` nor `pendingEscrowRelease`.
contract NoEscrowSymbols {
    function instanceType() external pure returns (bytes32) {
        return keccak256("erc404");
    }

    function balanceOf(address) external pure returns (uint256) {
        return 5 ether;
    }

    function unit() external pure returns (uint256) {
        return 1 ether;
    }
}
