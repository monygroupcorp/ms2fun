// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
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
 *      NOTE on triggering a burn: on a SEALED instance every coin-path debit burns, because the
 *      shared base overrides `_useDirectTransfersIfPossible` to false once a ladder exists — so the
 *      hook fires whatever the recipient does with NFTs (pinned by
 *      `test_directTransferBurnsBandAndCreditsTheSender`). The band id moves only through a deliberate
 *      ERC721 transfer, which is a different function and keeps carrying the id and its escrow.
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

    /// @dev `mintUp` on the DEEPEST owned id that survives the escrow leg — walk the caller's ordinary
    ///      ids downward and catch the revert, because the leg burns LIFO off the tail and an id caught
    ///      by that burn reverts by design (a naive "take the highest id" pick just reverts). For a
    ///      holder funded in one go, owned order IS id order, so the id this finds sits at the deepest
    ///      mintable owned index — the worst case for a tier NFT's survival, and the case this item is
    ///      about. Reverts rather than returning a flag: a silent "none found" would make its callers
    ///      pass vacuously.
    function _mintUpDeepestSurvivingId(address who, uint8 tierN) internal returns (uint256 chosenId, uint256 bandId) {
        bool[] memory occupancyBefore = _bandOccupancy();
        uint256[] memory ids = _ownedIdsOf(who);
        for (uint256 i = ids.length; i > 0; i--) {
            uint256 id = ids[i - 1];
            if (id > ID_LIMIT) continue; // band ids are not tier-0 material
            vm.prank(who);
            // slither-disable-next-line low-level-calls
            (bool ok,) = address(token).call(abi.encodeWithSignature("mintUp(uint8,uint256)", tierN, id));
            if (ok) return (id, _bandIdAfterMintUp(who, occupancyBefore));
        }
        revert("setup: no ordinary id survived the escrow leg");
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

        // The debit that burns it. A sealed ladder closes the direct-transfer path outright, and
        // `sink` skips NFTs besides — `numNFTBurns == 1`, and the band NFT is destroyed.
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

    /// @notice THE TRANSFER RULE, pinned on the burn-safety side: an ERC20 transfer of ONE unit to an
    ///         NFT-taking recipient BURNS the band id and credits its escrow to the SENDER. A sealed
    ///         ladder turns off DN404's `_useDirectTransfersIfPossible`, so the re-home path is closed
    ///         and the hook fires here — which is the point, since the hook is what makes the holder
    ///         whole. Escrow must never ride along to the recipient on a coin-path debit.
    function test_directTransferBurnsBandAndCreditsTheSender() public {
        _seal();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);
        uint256 escrowBefore = token.totalTierEscrow();

        vm.expectEmit(true, true, false, true);
        emit EscrowReleased(user1, bandId, 9 * UNIT);
        vm.prank(user1);
        token.transfer(user2, UNIT); // recipient takes NFTs, but the band burns anyway

        assertEq(_ownerOrZero(bandId), address(0), "the band id was burned, not re-homed");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "the SENDER is credited");
        assertEq(token.pendingEscrowRelease(user2), 0, "the recipient is credited nothing");
        assertEq(token.totalTierEscrow(), escrowBefore - 9 * UNIT, "escrow left the tier counter");
        assertEq(token.bandOutstanding(1), 0, "no longer outstanding");
        _assertConserved();

        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.balanceOf(user1), 9 * UNIT, "the sender is made whole");
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
    ///         Constructed deterministically for a MULTI-BAND holder, which is what it takes now that
    ///         `mintUp` parks each new band at owned index 0. One band on its own sits at the front,
    ///         where no escrow leg can reach it: the leg burns 9 ids off the tail, and the tier-0 id
    ///         being minted up has to survive that same burn, so the burn can never bite deeper than
    ///         that id's index. A SECOND `mintUp` from a deep tier-0 id displaces the first band down
    ///         into that deep slot, and a THIRD `mintUp`'s tail burn reaches it there.
    ///
    ///         40 units in (ids 1..40 at owned indices 0..39), tier-1 weight 10, so every escrow leg
    ///         burns exactly 9 ids off the tail:
    ///           1. `mintUp(1, 11)` — burns indices 31..39; band A takes index 10, then moves to 0.
    ///           2. `mintUp(1, 22)` — burns indices 22..30; band B takes index 21, the deepest index
    ///              that survives, then moves to 0 and DISPLACES band A down into index 21.
    ///           3. `mintUp(1, 2)`  — burns indices 13..21, which now includes band A.
    ///
    ///         Which band the leg catches is read out of the logs rather than hard-coded, so the test
    ///         pins the PATH — one of the caller's own bands burned, credited, and popped straight back
    ///         inside a single call — instead of a particular owned index. The assertions are exact:
    ///         one release, for the full `(w - 1) * unit`, on a band the caller held going in.
    function test_mintUpEscrowLegBurningTheCallersOwnBandSelfHeals() public {
        _seal();
        _fund(token, user1, 40);

        vm.prank(user1);
        token.mintUp(1, 11);
        uint256 bandA = T1_START;
        assertEq(_ownerOrZero(bandA), user1, "band A issued");

        vm.prank(user1);
        token.mintUp(1, 22);
        uint256 bandB = T1_START + 1;
        assertEq(_ownerOrZero(bandB), user1, "band B issued");
        assertEq(token.balanceOf(user1), 22 * UNIT, "40 units in, 18 escrowed");
        assertEq(token.totalTierEscrow(), 18 * UNIT, "charged once per band");
        assertEq(token.bandOutstanding(1), 2, "two band ids outstanding");
        assertEq(token.pendingEscrowRelease(user1), 0, "neither leg has burned a band yet");
        _assertConserved();

        // This mintUp's escrow leg burns owned indices 13..21 — one of the caller's own bands is in it.
        vm.recordLogs();
        vm.prank(user1);
        token.mintUp(1, 2);

        bytes32 releaseSig = keccak256("EscrowReleased(address,uint256,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 releaseCount;
        uint256 releasedId;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(token) || logs[i].topics.length != 3) continue;
            if (logs[i].topics[0] != releaseSig) continue;
            releaseCount++;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), user1, "credited to the caller");
            releasedId = uint256(logs[i].topics[2]);
            assertEq(abi.decode(logs[i].data, (uint256)), 9 * UNIT, "released exactly (w - 1) * unit");
        }
        assertEq(releaseCount, 1, "the escrow leg burned exactly one of the caller's own bands");
        assertTrue(releasedId == bandA || releasedId == bandB, "and it was a band the caller already held");

        assertEq(_ownerOrZero(releasedId), user1, "the freed id was popped straight back");
        assertEq(_ownerOrZero(bandA), user1, "band A owned");
        assertEq(_ownerOrZero(bandB), user1, "band B owned");
        assertEq(token.bandOutstanding(1), 2, "exactly two band ids outstanding");
        assertEq(token.totalTierEscrow(), 18 * UNIT, "escrow charged once for each live band");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "the burned band's escrow became a claim");
        _assertConserved();

        vm.prank(user1);
        token.claimReleasedEscrow();
        // 40 units in: 13 units of balance + 18 escrowed behind the two live bands + 9 reclaimed.
        assertEq(token.coinBalanceOf(user1) + token.pendingEscrowRelease(user1), 40 * UNIT, "nothing lost");
        _assertConserved();
    }

    // ┌──────────────────────────────────────────────────────────┐
    // │  Owned-index placement of the tier NFT                    │
    // └──────────────────────────────────────────────────────────┘

    /// @notice A tier NFT minted up from a DEEP owned index survives a partial spend. DN404 reconciles
    ///         `ownedLength == balance / unit` by burning ids LIFO off the TAIL of the owned array, so
    ///         an id's index decides how much of a debit it can absorb — and the tier-0 id a holder
    ///         picks is whichever one they happened to hold, nothing about it signals that the choice
    ///         matters. `mintUp` parks the band at index 0, the last position that burn loop reaches,
    ///         so a holder with spare liquid coin keeps their tier NFT and has nothing to claim.
    function test_bandMintedFromADeepIndexSurvivesAPartialSpend() public {
        _seal();
        _fund(token, user1, 20);

        uint256[] memory before_ = _ownedIdsOf(user1);
        (uint256 chosenId, uint256 bandId) = _mintUpDeepestSurvivingId(user1, 1);
        // Otherwise the holder minted up from the front of their own array and the test proves nothing.
        assertGt(chosenId, before_[0], "setup: the id minted up is NOT the holder's front id");

        uint256 coinBefore = token.coinBalanceOf(user1);
        assertEq(coinBefore, 20 * UNIT, "mintUp moves no value: 11 liquid + 9 escrowed");
        _assertConserved();

        // A partial spend, with liquid coin to spare. Two ids burn off the tail; the band is at index 0.
        vm.prank(user1);
        token.transfer(sink, 2 * UNIT);

        assertEq(_ownerOrZero(bandId), user1, "the tier NFT survived the partial spend");
        assertEq(token.bandOutstanding(1), 1, "still outstanding");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "escrow still sits behind the live band");
        assertEq(token.pendingEscrowRelease(user1), 0, "nothing destroyed, so nothing to claim");
        assertEq(token.coinBalanceOf(user1), coinBefore - 2 * UNIT, "down exactly what they spent, no more");
        assertGt(token.balanceOf(user1), UNIT, "and there was spare liquid coin throughout");
        _assertConserved();
    }

    /// @notice Index 0 is not immortality. It changes WHICH id the burn loop reaches last, never whether
    ///         one must burn: a holder who spends their ENTIRE liquid balance still loses the tier NFT,
    ///         and the escrow hook makes them whole through the claim. That 1-unit floor is the design,
    ///         and this item must not be read as a guarantee it does not make.
    function test_bandAtIndexZeroStillBurnsOnAFullSpend() public {
        _seal();
        _fund(token, user1, 20);
        (, uint256 bandId) = _mintUpDeepestSurvivingId(user1, 1);
        assertEq(_ownerOrZero(bandId), user1, "setup: the band is owned");

        // Every last unit: `balance / unit` hits 0, so DN404 must burn every id the holder has.
        uint256 wholeBalance = token.balanceOf(user1);
        vm.expectEmit(true, true, true, true, address(token));
        emit EscrowReleased(user1, bandId, 9 * UNIT);
        vm.prank(user1);
        token.transfer(sink, wholeBalance);

        assertEq(_ownerOrZero(bandId), address(0), "index 0 is reached LAST, not never");
        assertEq(token.balanceOf(user1), 0, "the whole liquid balance is gone");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "the holder is made whole by the claim");
        assertEq(token.totalTierEscrow(), 0, "escrow moved to the claim, not stranded");
        assertEq(token.bandOutstanding(1), 0, "the id is back on the free list");
        _assertConserved();
    }

    /// @notice `oo` / `owned` consistency across the move, which is the whole risk in reordering: the
    ///         move-to-front swap rewrites the owned index of the DISPLACED id as well as the moved one.
    ///         Updating only the moved id would leave the displaced band's `oo` entry pointing at index
    ///         0 — a slot it no longer occupies — and DN404 trusts `oo` absolutely, so the next
    ///         `mintDown` on that band would write its replacement id over whatever really sits at index
    ///         0, orphaning one id and duplicating another. `mintDown` is the sharpest probe for that
    ///         because it resolves the band's slot straight out of `oo`; a full round trip back to
    ///         ordinary ids then has to reconcile exactly.
    function test_displacedBandKeepsAConsistentOwnedIndex() public {
        _seal();
        _fund(token, user1, 30);

        vm.prank(user1);
        token.mintUp(1, 21); // burns indices 21..29; band A takes index 20, then moves to 0
        uint256 bandA = T1_START;
        vm.prank(user1);
        token.mintUp(1, 12); // burns indices 12..20; band B takes index 11, moves to 0, displacing A
        uint256 bandB = T1_START + 1;

        assertEq(_ownerOrZero(bandA), user1, "band A owned");
        assertEq(_ownerOrZero(bandB), user1, "band B owned");
        assertEq(token.bandOutstanding(1), 2, "two distinct band ids, neither lost nor duplicated");
        _assertOwnershipAgreesWithBalance(user1, "after two mintUps");
        assertEq(token.coinBalanceOf(user1), 30 * UNIT, "no value moved by the reorder");
        _assertConserved();

        // The displaced band comes back out through the slot `oo` claims it occupies.
        vm.prank(user1);
        token.mintDown(bandA);
        assertEq(_ownerOrZero(bandA), address(0), "band A redeemed");
        assertEq(_ownerOrZero(bandB), user1, "band B untouched by A's redemption");
        assertEq(token.bandOutstanding(1), 1, "exactly one band left outstanding");
        _assertOwnershipAgreesWithBalance(user1, "after redeeming the displaced band");
        assertEq(token.coinBalanceOf(user1), 30 * UNIT, "the round trip is value-neutral");
        _assertConserved();

        vm.prank(user1);
        token.mintDown(bandB);
        assertEq(_ownerOrZero(bandB), address(0), "band B redeemed");
        assertEq(token.bandOutstanding(1), 0, "no bands outstanding");
        assertEq(token.totalTierEscrow(), 0, "all escrow returned");
        assertEq(token.balanceOf(user1), 30 * UNIT, "back to a fully liquid 30 units");
        _assertOwnershipAgreesWithBalance(user1, "after the full round trip");
        _assertConserved();
    }

    /// @dev The two halves of DN404 ownership must agree. `_ownedIdsOf` counts ids by scanning the
    ///      OWNERSHIP alias half of `oo`; `balanceOf / unit` is what the OWNED-ARRAY half is reconciled
    ///      to on every transfer. A half-updated index swap desynchronises them — a duplicated entry
    ///      makes the scan come up short, an orphan makes it come up long.
    function _assertOwnershipAgreesWithBalance(address who, string memory why) internal view {
        assertEq(_ownedIdsOf(who).length * UNIT, token.balanceOf(who), why);
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

    /// @notice WHAT THIS NUMBER MEANS — read before touching the budget. This gate used to assert that
    ///         a sealed ladder costs nearly nothing extra than an unsealed one, on the strength of the
    ///         hook's early-out. That premise is now FALSE BY DESIGN: sealing a ladder also turns off
    ///         DN404's direct-transfer path, so a sealed instance BURNS AND RE-MINTS ids where an
    ///         unsealed one moves them in place. The delta below is therefore no longer "the per-id
    ///         early-out"; it is the price of the always-burn transfer rule, and it is meant to be paid.
    ///
    ///         Decomposition of the ~39.3k measured on a 3-NFT transfer: roughly 12.7k per NFT for
    ///         burn + re-mint (~38.2k of it), plus the early-out's own cost — one `tierBands.length`
    ///         SLOAD, one `tierBands[0]` SLOAD, and a word comparison per id. Untiered instances keep
    ///         the direct-transfer path entirely and are unaffected.
    ///
    ///         The gate still has teeth: it is scaled to burn+mint of THREE ids and nothing more. A
    ///         per-id band WALK, or anything recomputing `idLimit` from `totalSupply`/`unit` per id,
    ///         would push well past the budget. What it can no longer catch is the burn+mint cost
    ///         itself — that is the rule, not a regression.
    ///
    ///         Measures the SAME ordinary transfer on a sealed instance and on an unsealed one, with
    ///         `vm.cool` applied to BOTH first so neither gets a warm-storage discount the other does not.
    function test_hotPathCostOfTheAlwaysBurnRule() public {
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

        // Budget: measured 39,335 (3 ids burned + re-minted, plus the early-out), rounded up to 45,000
        // for ~14% of margin against compiler and opcode-price drift. This is a CEILING on the
        // always-burn rule for three ids — NOT a licence to grow. If a change pushes past it, the
        // question to answer is which per-id work was added, not what the number should be raised to.
        assertLt(gasSealed - gasUnsealed, 45_000, "the always-burn rule costs more per id than it should");
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
