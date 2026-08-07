// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import { ERC404BondingStorage, NothingToClaim } from "src/factories/erc404/ERC404BondingStorage.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "src/interfaces/ILiquidityDeployerModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @dev Minimal graduation sink.
contract BurnSafetyLiquidityDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }

    function setMetadataURI(string calldata) external override { }
}

/**
 * @dev Cross-boundary reentrancy probe (noesis-091's shape). Holds a band NFT, sells to the curve —
 *      which burns the band NFT and fires the release hook — and then, from the ETH-refund callback
 *      that `SmartTransferLib.smartTransferETH` hands it (all remaining gas forwarded), tries to
 *      re-enter both the PULL leg (`claimReleasedEscrow`) and the tier op (`mintUp`).
 *      `receive()` must never revert: `smartTransferETH` would fall back to WETH and mask the test.
 *      So every re-entry is a low-level call whose success is RECORDED, not propagated.
 */
contract BurnReenterer {
    ERC404BondingInstance public token;
    bool public armed;
    bool public attempted;
    bool public claimReenteredOk;
    bool public mintUpReenteredOk;
    uint256 public reentrantPendingSeen;
    uint256 public reentryTargetId;

    constructor(ERC404BondingInstance t) {
        token = t;
    }

    receive() external payable {
        if (!armed || attempted) return;
        attempted = true;
        reentrantPendingSeen = token.pendingEscrowRelease(address(this));
        // slither-disable-next-line low-level-calls
        (claimReenteredOk,) = address(token).call(abi.encodeWithSignature("claimReleasedEscrow()"));
        // slither-disable-next-line low-level-calls
        (mintUpReenteredOk,) =
            address(token).call(abi.encodeWithSignature("mintUp(uint8,uint256)", uint8(1), reentryTargetId));
    }

    function buy(uint256 amount) external payable {
        token.buyBonding{ value: msg.value }(amount, type(uint256).max, true, bytes(""), bytes(""), 0);
    }

    function mintUp(uint8 tierN, uint256 tierZeroId) external {
        token.mintUp(tierN, tierZeroId);
    }

    function sell(uint256 amount, uint256 targetId) external {
        armed = true;
        reentryTargetId = targetId;
        token.sellBonding(amount, 0, bytes32(0), bytes(""), 0);
        armed = false;
    }

    function claim() external {
        token.claimReleasedEscrow();
    }
}

/**
 * @title TierBurnSafety
 * @notice Token Tiers T3 (noesis-143): the `_afterNFTTransfers` burn-safety hook.
 * @dev MONEY-CODE, HOT PATH. DN404 reconciles NFTs to balance on every debit — `numNFTBurns =
 *      _zeroFloorSub(ownedLength, balance / unit)` ids burned LIFO off the tail of `owned[holder]` —
 *      and that loop knows nothing about bands. Without the hook a band NFT burned by an ordinary
 *      debit strands its `(w_N - 1) * unit` of escrow inside the instance forever: the coin is there,
 *      the id that entitled anyone to it is gone.
 *
 *      The suite's spine is one invariant, asserted after every state change in the fuzz test:
 *
 *          Σ holders (coinBalanceOf + pendingEscrowRelease)
 *              + (instance balance - totalTierEscrow - totalPendingEscrowRelease)
 *          == totalSupply
 *
 *      That is the invariant that would have caught the orphan: a burned band id whose escrow was NOT
 *      credited leaves `totalTierEscrow` claiming coin no holder can reach, and the sum falls short.
 *
 *      NOTE on triggering a burn at all: DN404's `_useDirectTransfersIfPossible` means an ordinary
 *      ERC20 transfer to an NFT-taking recipient RE-HOMES the band id instead of burning it (that is
 *      the T2 finding, pinned by `test_directTransferMovesBandCreditsNobody`). The burn path only
 *      opens when the recipient takes no NFTs — a curve sell, or a holder who set `skipNFT`.
 */
contract TierBurnSafetyTest is Test {
    ERC404BondingInstance token;
    ERC404BondingInstance impl;
    ERC404BondingOps ops;
    BurnSafetyLiquidityDeployer liquidityDeployer;

    address owner = address(0x5);
    address user1 = address(0x10);
    address user2 = address(0x20);
    address user3 = address(0x30);
    address sink = address(0x40); // skipNFT holder: the recipient that makes a burn happen
    address treasury = address(0xFEE);

    uint256 constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 constant UNIT = 1_000_000 ether; // 1M tokens = 1 NFT  =>  ID_LIMIT = 1000
    uint256 constant ID_LIMIT = MAX_SUPPLY / UNIT;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;

    // Same 10-to-1 ladder as the T2 suite. Bands sit ABOVE ID_LIMIT, sized S / w.
    uint32 constant T1_START = 1001;
    uint32 constant T1_END = 1100; // 1000 / 10  = 100 ids, weight 10
    uint32 constant T2_START = 1101;
    uint32 constant T2_END = 1110; // 1000 / 100 =  10 ids, weight 100

    event EscrowReleased(address indexed holder, uint256 indexed bandId, uint256 amount);

    function setUp() public {
        liquidityDeployer = new BurnSafetyLiquidityDeployer();
        ops = new ERC404BondingOps();
        impl = new ERC404BondingInstance(address(ops));
        token = _newInstance();

        vm.prank(sink);
        token.setSkipNFT(true);

        vm.deal(user1, 1000 ether);
        vm.deal(user2, 1000 ether);
        vm.deal(user3, 1000 ether);
    }

    // ── harness ──────────────────────────────────────────────────────────────────────────────────

    /// @dev A fresh, fully initialized instance. `factory == address(this)`, so this test seals the
    ///      ladder exactly as `ERC404Factory` does in the create path.
    function _newInstance() internal returns (ERC404BondingInstance t) {
        BondingCurveMath.Params memory curveParams = BondingCurveMath.Params({
            initialPrice: 0.0001 ether, quarticCoeff: 1, cubicCoeff: 1, quadraticCoeff: 1, normalizationFactor: 1e18
        });

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

    /// @dev Move `nftCount` NFTs' worth of coin from the instance to `who`. NFTs auto-mint because this
    ///      instance overrides `_skipNFTDefault` to false. Never touches curve counters.
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

    /// @dev Ids owned by `who`, ordinary space first then bands. Test-only scan (ID_LIMIT = 1000).
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

    /// @dev The band id `who` holds after a successful `mintUp`. Usually an id that was unoccupied
    ///      before — but NOT always: `mintUp`'s escrow leg can itself burn a band NFT `who` already
    ///      held (the hook credits it and returns the id to the free list) and the LIFO pop can hand
    ///      that very id straight back, leaving occupancy unchanged. That is the self-heal case pinned
    ///      by `test_mintUpEscrowLegBurningTheCallersOwnBandSelfHeals`, so fall back to any band id
    ///      `who` owns rather than mistaking it for "no id was issued".
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

    /// @dev Mint up on the first owned id that survives the escrow leg (see T2: the escrow transfer
    ///      burns the caller's NFTs LIFO off the tail, and an id caught by that burn reverts by design).
    function _mintUpAny(address who, uint8 tierN) internal returns (bool ok, uint256 bandId) {
        bool[] memory occupancyBefore = _bandOccupancy();
        uint256[] memory ids = _ownedIdsOf(who);
        for (uint256 i; i < ids.length; i++) {
            if (ids[i] > ID_LIMIT) continue; // band ids are not tier-0 material
            vm.prank(who);
            // slither-disable-next-line low-level-calls
            (ok,) = address(token).call(abi.encodeWithSignature("mintUp(uint8,uint256)", tierN, ids[i]));
            if (ok) return (true, _bandIdAfterMintUp(who, occupancyBefore));
        }
        return (false, 0);
    }

    /// @dev Put `who` in the canonical pre-burn state: EXACTLY one NFT, and it is a tier-1 band id.
    ///      10 units in, `mintUp` escrows 9 of them, DN404 burns the 9 now-unbacked NFTs off the tail,
    ///      and the single survivor (owned index 0) is swapped for the band id. One more unit of debit
    ///      from here and DN404 burns the band itself — which is the whole subject of this suite.
    function _holderWithOneBandNFT(address who, uint8 tierN) internal returns (uint256 bandId) {
        uint256 weight = tierN == 1 ? 10 : 100;
        _fund(token, who, weight);
        (bool ok, uint256 id) = _mintUpAny(who, tierN);
        assertTrue(ok, "setup: mintUp");
        assertEq(token.balanceOf(who), UNIT, "setup: one unit of liquid balance left");
        uint256[] memory ids = _ownedIdsOf(who);
        assertEq(ids.length, 1, "setup: exactly one NFT");
        assertEq(ids[0], id, "setup: and it is the band id");
        return id;
    }

    function _activateBonding() internal {
        vm.startPrank(owner);
        token.setBondingOpenTime(block.timestamp + 1);
        token.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 2);
    }

    /// @dev THE invariant. Every unit of coin is either liquid in someone's balance, escrowed behind a
    ///      band NFT someone owns (`coinBalanceOf` folds that in), owed to someone whose band NFT was
    ///      burned, or sitting unencumbered in the instance.
    function _assertConserved() internal view {
        uint256 instanceUnowed =
            token.balanceOf(address(token)) - token.totalTierEscrow() - token.totalPendingEscrowRelease();
        uint256 sum = instanceUnowed + token.balanceOf(address(liquidityDeployer));
        address[4] memory holders = [user1, user2, user3, sink];
        for (uint256 i; i < holders.length; i++) {
            sum += token.coinBalanceOf(holders[i]) + token.pendingEscrowRelease(holders[i]);
        }
        assertEq(sum, token.totalSupply(), "coin conservation broken");
    }

    // ┌──────────────────────────────────────────────────────────┐
    // │  The core case: a LIFO-burned band NFT releases escrow    │
    // └──────────────────────────────────────────────────────────┘

    function test_burnedBandReleasesEscrowAndFreesTheId() public {
        _seal();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);

        assertEq(token.totalTierEscrow(), 9 * UNIT, "escrow charged by mintUp");
        assertEq(token.bandOutstanding(1), 1, "one band id outstanding");
        _assertConserved();

        // The debit that burns it. `sink` skips NFTs, so DN404 cannot re-home the id by direct
        // transfer — `numNFTMints == 0`, `numNFTBurns == 1`, and the band NFT is destroyed.
        vm.expectEmit(true, true, true, true, address(token));
        emit EscrowReleased(user1, bandId, 9 * UNIT);
        vm.prank(user1);
        token.transfer(sink, UNIT);

        assertEq(_ownerOrZero(bandId), address(0), "the band NFT is gone");
        assertEq(token.balanceOf(user1), 0, "liquid balance spent");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "exactly (w - 1) * unit credited");
        assertEq(token.totalPendingEscrowRelease(), 9 * UNIT, "aggregate credit");
        assertEq(token.totalTierEscrow(), 0, "escrow moved out of the tier counter, not duplicated");
        assertEq(token.bandOutstanding(1), 0, "the id is back on the free list");
        _assertConserved();

        // The freed id is immediately re-mintable by SOMEONE ELSE (LIFO pop, before the high-water
        // cursor) — proof it was returned to the band, not merely abandoned.
        _fund(token, user3, 10);
        (bool ok, uint256 reissued) = _mintUpAny(user3, 1);
        assertTrue(ok, "another holder mints up");
        assertEq(reissued, bandId, "the freed id is handed out again");
        assertEq(_ownerOrZero(bandId), user3, "and it is genuinely owned");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "the new holder's escrow, not the old one's");
        _assertConserved();

        // ...and the original holder is still made whole, while that new escrow is live.
        vm.prank(user1);
        token.claimReleasedEscrow();

        assertEq(token.balanceOf(user1), 9 * UNIT, "holder made whole: 10 in, 1 spent, 9 back");
        assertEq(_ownedIdsOf(user1).length, 9, "the claim re-materializes ordinary NFTs");
        assertEq(token.pendingEscrowRelease(user1), 0, "credit zeroed");
        assertEq(token.totalPendingEscrowRelease(), 0, "aggregate cleared");
        _assertConserved();
    }

    function test_claimRevertsWithNothingToClaim() public {
        _seal();
        vm.expectRevert(NothingToClaim.selector);
        vm.prank(user1);
        token.claimReleasedEscrow();
    }

    function test_claimIsNotRepeatable() public {
        _seal();
        _holderWithOneBandNFT(user1, 1);
        vm.prank(user1);
        token.transfer(sink, UNIT);

        vm.prank(user1);
        token.claimReleasedEscrow();
        vm.expectRevert(NothingToClaim.selector);
        vm.prank(user1);
        token.claimReleasedEscrow();
    }

    /// @notice A curve SELL is the realistic trigger: the instance itself skips NFTs, so every sold
    ///         unit's NFT is burned rather than re-homed.
    function test_sellingToTheCurveReleasesEscrow() public {
        _seal();
        _activateBonding();

        vm.prank(user1);
        token.buyBonding{ value: 500 ether }(10 * UNIT, type(uint256).max, true, bytes(""), bytes(""), 0);
        (bool ok, uint256 bandId) = _mintUpAny(user1, 1);
        assertTrue(ok, "mintUp");
        assertEq(token.balanceOf(user1), UNIT, "one liquid unit left");

        uint256 reserveBefore = token.reserve();
        vm.prank(user1);
        token.sellBonding(UNIT, 0, bytes32(0), bytes(""), 0);

        assertEq(_ownerOrZero(bandId), address(0), "the band NFT was burned by the sell");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "escrow released to the seller");
        assertEq(token.totalTierEscrow(), 0, "tier escrow cleared");
        assertLt(token.reserve(), reserveBefore, "the sell really went through the curve");

        // The released escrow is NOT curve supply: claiming it must not move the curve counters.
        uint256 bondingSupply = token.totalBondingSupply();
        uint256 reserveAfterSell = token.reserve();
        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.totalBondingSupply(), bondingSupply, "claim moved totalBondingSupply");
        assertEq(token.reserve(), reserveAfterSell, "claim moved reserve");
        assertEq(token.balanceOf(user1), 9 * UNIT, "seller holds the escrow that was theirs");
    }

    // ┌──────────────────────────────────────────────────────────┐
    // │  Multi-burn: several ids, two bands, one transfer         │
    // └──────────────────────────────────────────────────────────┘

    function test_oneTransferBurningTwoBandsFromDifferentTiers() public {
        _seal();
        _fund(token, user1, 200);

        (bool ok1, uint256 band1) = _mintUpAny(user1, 1); // weight 10  -> escrows 9 units
        assertTrue(ok1, "tier 1 mintUp");
        (bool ok2, uint256 band2) = _mintUpAny(user1, 2); // weight 100 -> escrows 99 units
        assertTrue(ok2, "tier 2 mintUp");

        assertEq(token.totalTierEscrow(), 108 * UNIT, "9 + 99 units escrowed");
        uint256 liquid = token.balanceOf(user1);
        uint256[] memory owned = _ownedIdsOf(user1);
        assertEq(owned.length, liquid / UNIT, "DN404's ownedLength == balance / unit invariant");

        // Dump EVERYTHING on a skipNFT recipient: one transfer, `owned.length` burns, two of them bands.
        vm.prank(user1);
        token.transfer(sink, liquid);

        assertEq(_ownerOrZero(band1), address(0), "tier-1 band burned");
        assertEq(_ownerOrZero(band2), address(0), "tier-2 band burned");
        assertEq(token.pendingEscrowRelease(user1), 108 * UNIT, "both releases credited, in one hook call");
        assertEq(token.totalTierEscrow(), 0, "both bands left the escrow counter");
        assertEq(token.bandOutstanding(1), 0, "tier-1 id returned");
        assertEq(token.bandOutstanding(2), 0, "tier-2 id returned");
        _assertConserved();

        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.balanceOf(user1), 108 * UNIT, "one claim pays both releases");
        _assertConserved();
    }

    // ┌──────────────────────────────────────────────────────────┐
    // │  Decision 4: a MOVED band id is not a release             │
    // └──────────────────────────────────────────────────────────┘

    /// @notice ERC721 transfer of a band id via the mirror. Escrow follows the id — nobody is credited.
    function test_erc721TransferOfBandCreditsNobody() public {
        _seal();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);
        uint256 escrowBefore = token.totalTierEscrow();

        DN404Mirror mirror = DN404Mirror(payable(token.mirrorERC721()));
        vm.prank(user1);
        mirror.transferFrom(user1, user2, bandId);

        assertEq(_ownerOrZero(bandId), user2, "the id moved");
        assertEq(token.pendingEscrowRelease(user1), 0, "sender credited nothing");
        assertEq(token.pendingEscrowRelease(user2), 0, "receiver credited nothing");
        assertEq(token.totalTierEscrow(), escrowBefore, "escrow untouched: it follows the id");
        assertEq(token.totalPendingEscrowRelease(), 0, "no release recorded");
        assertEq(token.bandOutstanding(1), 1, "still outstanding");
        _assertConserved();

        // And the new owner can redeem it, which is what "escrow follows the id" has to mean.
        vm.prank(user2);
        token.mintDown(bandId);
        assertEq(token.balanceOf(user2), 10 * UNIT, "the new owner got the full denomination");
        _assertConserved();
    }

    /// @notice The T2 finding, pinned: an ERC20 transfer of ONE unit to an NFT-taking recipient
    ///         RE-HOMES the band id (DN404's `_useDirectTransfersIfPossible`) instead of burning it.
    ///         That is a transfer, not a release — the hook must stay silent, and the escrow rides along.
    function test_directTransferMovesBandCreditsNobody() public {
        _seal();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);
        uint256 escrowBefore = token.totalTierEscrow();

        vm.prank(user1);
        token.transfer(user2, UNIT); // user2 takes NFTs => direct transfer, no burn

        assertEq(_ownerOrZero(bandId), user2, "the band id was re-homed, not burned");
        assertEq(token.pendingEscrowRelease(user1), 0, "no credit on a re-home");
        assertEq(token.pendingEscrowRelease(user2), 0, "no credit on a re-home");
        assertEq(token.totalTierEscrow(), escrowBefore, "escrow untouched");
        assertEq(token.bandOutstanding(1), 1, "still outstanding");
        _assertConserved();
    }

    /// @notice Mints are not releases either: `from == address(0)` at the hook, and the hook keys on
    ///         `to == address(0)`. Funding a holder must credit nobody.
    function test_mintCreditsNobody() public {
        _seal();
        _fund(token, user1, 25);
        assertEq(token.pendingEscrowRelease(user1), 0, "a mint is not a burn");
        assertEq(token.totalPendingEscrowRelease(), 0, "a mint is not a burn");
        _assertConserved();
    }

    /// @notice A burn of ORDINARY ids only must not touch the tier counters at all.
    function test_ordinaryBurnReleasesNothing() public {
        _seal();
        _fund(token, user1, 20);
        (bool ok,) = _mintUpAny(user1, 1);
        assertTrue(ok, "mintUp");

        uint256 escrowBefore = token.totalTierEscrow();
        vm.prank(user1);
        token.transfer(sink, 3 * UNIT); // burns 3 ordinary ids off the tail

        assertEq(token.pendingEscrowRelease(user1), 0, "ordinary ids carry no escrow");
        assertEq(token.totalTierEscrow(), escrowBefore, "escrow untouched");
        assertEq(token.bandOutstanding(1), 1, "band still outstanding");
        _assertConserved();
    }

    /// @notice The sharpest interaction between T2 and T3: `mintUp`'s OWN escrow leg is a debit, so it
    ///         can burn a band NFT the caller already holds — the hook then credits it and returns the
    ///         id to the free list, and `_popBandId`'s LIFO can hand that very id straight back within
    ///         the same call. Under T2 alone that was a silent orphan. Here it must self-heal: escrow
    ///         charged once, escrow released once, no coin lost, the id still owned.
    ///
    ///         Constructed deterministically. 20 units in (ids 1..20 at owned indices 0..19); the first
    ///         `mintUp` uses id 5 (index 4), so the band lands at index 4 and survives that call's
    ///         9-NFT tail burn. The second `mintUp` uses id 1 (index 0) and burns indices 10..2 —
    ///         which includes index 4, the band.
    function test_mintUpEscrowLegBurningTheCallersOwnBandSelfHeals() public {
        _seal();
        _fund(token, user1, 20);

        vm.prank(user1);
        token.mintUp(1, 5);
        uint256 firstBand = T1_START;
        assertEq(_ownerOrZero(firstBand), user1, "band landed at owned index 4");
        assertEq(token.balanceOf(user1), 11 * UNIT, "20 units in, 9 escrowed");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "charged once");
        _assertConserved();

        // This mintUp's escrow leg burns owned indices 10..2, band included.
        vm.expectEmit(true, true, true, true, address(token));
        emit EscrowReleased(user1, firstBand, 9 * UNIT);
        vm.prank(user1);
        token.mintUp(1, 1);

        assertEq(_ownerOrZero(firstBand), user1, "the freed id was popped straight back");
        assertEq(token.bandOutstanding(1), 1, "exactly one band id outstanding");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "escrow charged once for the live band");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "the burned band's escrow became a claim");
        _assertConserved();

        vm.prank(user1);
        token.claimReleasedEscrow();
        // 20 units in: 1 unit of balance + 9 escrowed behind the live band + 9 reclaimed + 1 liquid.
        assertEq(token.coinBalanceOf(user1) + token.pendingEscrowRelease(user1), 20 * UNIT, "nothing lost");
        _assertConserved();
    }

    // ┌──────────────────────────────────────────────────────────┐
    // │  Reentrancy                                               │
    // └──────────────────────────────────────────────────────────┘

    /// @notice A receiver callback that fires DURING the very transfer that burns the band NFT cannot
    ///         double-credit. The credit is already recorded when the callback runs (the hook completed
    ///         inside `_transfer`), so the only danger is claiming it twice or racing a second tier op
    ///         while DN404's accounting is mid-flight. Both re-entries must be refused by the shared
    ///         ReentrancyGuard — the instance's guard for `claimReleasedEscrow`, and Ops's guard,
    ///         engaged across the delegatecall boundary on the same fixed slot, for `mintUp`.
    function test_reentrancyDuringABurningSellCannotDoubleCredit() public {
        _seal();
        _activateBonding();

        BurnReenterer attacker = new BurnReenterer(token);
        vm.deal(address(attacker), 1000 ether);
        attacker.buy{ value: 500 ether }(10 * UNIT);
        assertEq(token.balanceOf(address(attacker)), 10 * UNIT, "attacker funded from the curve");

        uint256[] memory ids = _ownedIdsOf(address(attacker));
        attacker.mintUp(1, ids[0]);
        uint256 bandId = _ownedIdsOf(address(attacker))[0];
        assertGe(bandId, T1_START, "attacker holds a band NFT");
        assertEq(token.balanceOf(address(attacker)), UNIT, "one liquid unit left");

        // Selling that last unit burns the band NFT; the ETH refund then calls back in.
        attacker.sell(UNIT, bandId);

        assertTrue(attacker.attempted(), "the callback actually fired: otherwise this test proves nothing");
        assertEq(attacker.reentrantPendingSeen(), 9 * UNIT, "the credit was already recorded when it re-entered");
        assertFalse(attacker.claimReenteredOk(), "claimReleasedEscrow re-entered successfully");
        assertFalse(attacker.mintUpReenteredOk(), "mintUp re-entered successfully");

        assertEq(token.pendingEscrowRelease(address(attacker)), 9 * UNIT, "credited exactly once");
        assertEq(token.totalPendingEscrowRelease(), 9 * UNIT, "aggregate credited exactly once");
        assertEq(token.totalTierEscrow(), 0, "escrow debited exactly once");

        uint256 balanceBefore = token.balanceOf(address(attacker));
        attacker.claim();
        assertEq(token.balanceOf(address(attacker)) - balanceBefore, 9 * UNIT, "paid out exactly once");
        assertEq(token.pendingEscrowRelease(address(attacker)), 0, "nothing left to claim");
    }

    // ┌──────────────────────────────────────────────────────────┐
    // │  Conservation under fuzz                                  │
    // └──────────────────────────────────────────────────────────┘

    /// @notice THE invariant, across any sequence of buys, sells, transfers, mintUps, mintDowns and
    ///         claims: no coin is created, destroyed or stranded. This is the assertion that would have
    ///         caught the orphan T3 exists to close — an uncredited burn makes the sum fall short by
    ///         exactly `(w_N - 1) * unit`.
    /// forge-config: default.fuzz.runs = 24
    function test_fuzz_coinIsConservedAcrossBurnsTransfersAndClaims(uint16 opBits) public {
        _seal();
        _activateBonding();

        vm.prank(user1);
        token.buyBonding{ value: 500 ether }(40 * UNIT, type(uint256).max, true, bytes(""), bytes(""), 0);
        vm.prank(user2);
        token.buyBonding{ value: 500 ether }(40 * UNIT, type(uint256).max, true, bytes(""), bytes(""), 0);
        _assertConserved();

        uint256[] memory live = new uint256[](8);
        uint256 liveCount;

        for (uint256 i; i < 8; i++) {
            address who = ((opBits >> (i + 8)) & 1) == 1 ? user1 : user2;
            uint256 op = (opBits >> (i * 2)) & 3;

            if (op == 0 || liveCount == 0) {
                (bool ok, uint256 bandId) = _mintUpAny(who, 1);
                if (ok) live[liveCount++] = bandId;
            } else if (op == 1) {
                // Debit to a skipNFT holder — the path that can burn a band NFT out from under `who`.
                uint256 amount = token.balanceOf(who);
                if (amount != 0) {
                    vm.prank(who);
                    token.transfer(sink, amount);
                    // Any band id `who` still held is now burned; drop the stale handles.
                    liveCount = _pruneDeadBands(live, liveCount);
                }
            } else if (op == 2) {
                uint256 id = live[liveCount - 1];
                address holder = _ownerOrZero(id);
                if (holder != address(0)) {
                    vm.prank(holder);
                    token.mintDown(id);
                    liveCount--;
                } else {
                    liveCount--;
                }
            } else {
                if (token.pendingEscrowRelease(who) != 0) {
                    vm.prank(who);
                    token.claimReleasedEscrow();
                }
            }

            _assertConserved();
        }

        // Drain every outstanding credit and re-assert: nothing is stranded at the end either.
        if (token.pendingEscrowRelease(user1) != 0) {
            vm.prank(user1);
            token.claimReleasedEscrow();
        }
        if (token.pendingEscrowRelease(user2) != 0) {
            vm.prank(user2);
            token.claimReleasedEscrow();
        }
        assertEq(token.totalPendingEscrowRelease(), 0, "all credits settled");
        _assertConserved();
    }

    function _pruneDeadBands(uint256[] memory live, uint256 liveCount) internal view returns (uint256 n) {
        for (uint256 i; i < liveCount; i++) {
            if (_ownerOrZero(live[i]) != address(0)) live[n++] = live[i];
        }
    }

    /// @notice `totalTierEscrow` must always equal the escrow derivable from the ids still outstanding,
    ///         even after burns put ids back on the free lists.
    function test_escrowCounterTracksOutstandingBandsThroughBurns() public {
        _seal();
        _fund(token, user1, 200);

        (bool a,) = _mintUpAny(user1, 1);
        (bool b,) = _mintUpAny(user1, 2);
        assertTrue(a && b, "two mintUps");
        assertEq(
            token.totalTierEscrow(),
            token.bandOutstanding(1) * 9 * UNIT + token.bandOutstanding(2) * 99 * UNIT,
            "counter vs derived, before the burn"
        );

        // Hoisted deliberately: `balanceOf` is an external call and would consume the prank.
        uint256 liquid = token.balanceOf(user1);
        vm.prank(user1);
        token.transfer(sink, liquid);
        assertEq(
            token.totalTierEscrow(),
            token.bandOutstanding(1) * 9 * UNIT + token.bandOutstanding(2) * 99 * UNIT,
            "counter vs derived, after the burn"
        );
        assertEq(token.totalTierEscrow(), 0, "everything was burned, so nothing is outstanding");
    }

    // ┌──────────────────────────────────────────────────────────┐
    // │  Hot path: the early-out                                  │
    // └──────────────────────────────────────────────────────────┘

    /// @notice The hook fires on EVERY NFT transfer in the collection, forever. Decision 2's early-out
    ///         is what keeps that affordable: one `tierBands.length` SLOAD short-circuits an instance
    ///         with no ladder, and for a sealed one a single `id < firstBandStart` comparison per id
    ///         dismisses the entire ordinary id space without walking any band.
    ///
    ///         This measures the SAME ordinary transfer on a sealed instance and on an unsealed one,
    ///         with `vm.cool` applied to BOTH first so neither gets a warm-storage discount the other
    ///         does not. The difference is what a tiers-enabled collection pays on the hot path: two
    ///         cold SLOADs (`tierBands.length`, `tierBands[0]`) plus one word comparison per id.
    function test_hotPathGasEarlyOutIsCheap() public {
        ERC404BondingInstance plain = _newInstance(); // no ladder: `tierBands.length == 0`
        _seal(); // `token` has the 2-rung ladder

        _fund(plain, user1, 20);
        _fund(token, user1, 20);

        vm.cool(address(plain));
        vm.prank(user1);
        uint256 g0 = gasleft();
        plain.transfer(user2, 3 * UNIT);
        uint256 gasUnsealed = g0 - gasleft();

        vm.cool(address(token));
        vm.prank(user1);
        uint256 g1 = gasleft();
        token.transfer(user3, 3 * UNIT);
        uint256 gasSealed = g1 - gasleft();

        emit log_named_uint("ordinary 3-NFT transfer, no ladder sealed", gasUnsealed);
        emit log_named_uint("ordinary 3-NFT transfer, 2-rung ladder   ", gasSealed);
        emit log_named_uint("hot-path delta                          ", gasSealed - gasUnsealed);

        // Two cold SLOADs (~4200) plus three word comparisons. A per-id band WALK, or anything that
        // read `totalSupply`/`unit` to recompute `idLimit` per id, would land far above this.
        assertLt(gasSealed - gasUnsealed, 6000, "the per-id early-out is not early enough");
    }

    /// @notice An instance that never seals a ladder pays only the `tierBands.length` SLOAD: no band
    ///         bookkeeping can happen, and no id can ever be mistaken for a band id.
    function test_unsealedInstanceNeverReleasesAnything() public {
        // `token` deliberately NOT sealed here.
        _fund(token, user1, 20);
        vm.prank(user1);
        token.transfer(sink, 20 * UNIT); // burns all 20 ids

        assertEq(token.pendingEscrowRelease(user1), 0, "no ladder, no release");
        assertEq(token.totalPendingEscrowRelease(), 0, "no ladder, no release");
        assertEq(token.totalTierEscrow(), 0, "no ladder, no escrow");
    }
}
