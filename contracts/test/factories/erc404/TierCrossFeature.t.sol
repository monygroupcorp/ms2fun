// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance, ExceedsBonding } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import {
    ERC404BondingStorage,
    TierOpFailed,
    InvalidBand,
    InitTierBandsFailed,
    FreeMintFailed,
    UnstakeFailed
} from "src/factories/erc404/ERC404BondingStorage.sol";
import { ERC404StakingModule } from "src/factories/erc404/ERC404StakingModule.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "src/interfaces/ILiquidityDeployerModule.sol";
import { GatingScope } from "src/gating/IGatingModule.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @dev Minimal graduation sink.
contract CrossFeatureLiquidityDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }

    function setMetadataURI(string calldata) external override { }
}

/**
 * @title TierCrossFeature
 * @notice Token Tiers, run against the REST of the instance rather than in isolation (noesis-153).
 * @dev MONEY-CODE (test-only: this suite changes no behaviour, it measures it).
 *
 *      THE FRAME. A band NFT is one DN404 unit of balance plus `(w_N - 1) * unit` of the holder's own
 *      coin escrowed in the instance, and DN404 reconciles `ownedLength == balance / unit` on every
 *      debit by moving or burning ids off the tail of `owned[holder]`. So a band NFT is at risk on
 *      EVERY path that reduces a holder's balance, and each such path must land in exactly one of two
 *      states — never a third:
 *
 *        CARRIED             — a deliberate ERC721 transfer of the id: the band id moves and the escrow
 *                              claim moves with it (conserved, redeemable by the new owner);
 *        BURNED-AND-CREDITED — any coin-path debit: DN404 burns the band and the `_afterNFTTransfers`
 *                              hook converts `totalTierEscrow` into `pendingEscrowRelease[holder]`,
 *                              claimable via `claimReleasedEscrow()`.
 *
 *      The third state, ORPHANED (escrow still counted, no longer redeemable by anyone), is what this
 *      suite exists to rule out on the paths the tier suites had never touched: `rerollSelectedNFTs`,
 *      `stake`/`unstake`, `claimFreeMint`, and the ERC20/ERC721 faces driven by an approved THIRD PARTY
 *      rather than by the holder. Every test therefore ends in `_assertEscrowCounterMatchesOutstanding`
 *      (the orphan detector: `totalTierEscrow` must equal the escrow derivable from the ids still
 *      outstanding) plus `_assertConserved` and `_assertEscrowSolvent`.
 *
 *      TRANSFER SEMANTICS ARE SETTLED, and this suite pins them. The rule: any coin-path debit burns
 *      the holder's band NFT and credits them its escrow; only a deliberate ERC721 transfer moves the
 *      NFT itself. Which of the two states a path lands in is therefore decided by WHICH FACE was
 *      used, never by the recipient's balance or by who `msg.sender` is — a sealed ladder overrides
 *      `_useDirectTransfersIfPossible` to false, closing the carry path for every ERC20 route.
 */
contract TierCrossFeatureTest is Test {
    ERC404BondingInstance token;
    ERC404BondingInstance impl;
    ERC404BondingOps ops;
    CrossFeatureLiquidityDeployer liquidityDeployer;
    ERC404StakingModule module;
    MockMasterRegistry registry;

    address owner = address(0x5);
    address user1 = address(0x10);
    address user2 = address(0x20);
    address user3 = address(0x30);
    address sink = address(0x40); // skipNFT holder: the recipient that makes a burn happen
    address spender = address(0x50); // third-party mover: allowance / ERC721 operator
    address agent = address(0x60); // platform-vetted agent (registry-flagged)
    address treasury = address(0xFEE);

    uint256 constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 constant UNIT = 1_000_000 ether; // 1M tokens = 1 NFT  =>  ID_LIMIT = 1000
    uint256 constant ID_LIMIT = MAX_SUPPLY / UNIT;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;
    uint256 constant FREE_MINT_ALLOCATION = 3; // NFT count reserved for free claims

    // The same 10-to-1 ladder as the T2/T3 suites. Bands sit ABOVE ID_LIMIT, sized S / w.
    uint32 constant T1_START = 1001;
    uint32 constant T1_END = 1100; // 1000 / 10  = 100 ids, weight 10
    uint32 constant T2_START = 1101;
    uint32 constant T2_END = 1110; // 1000 / 100 =  10 ids, weight 100

    event EscrowReleased(address indexed holder, uint256 indexed bandId, uint256 amount);

    function setUp() public {
        liquidityDeployer = new CrossFeatureLiquidityDeployer();
        registry = new MockMasterRegistry();
        module = new ERC404StakingModule(address(registry));
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

    /// @dev A fresh, fully initialized instance. `factory == address(this)`, so this test contract can
    ///      drive the factory-only entry points (`initTierBands`, `initializeFreeMint`,
    ///      `initializeStaking`) exactly as `ERC404Factory` does in the create path.
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
                masterRegistry: address(registry),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        t.initializeMetadata("TierToken", "TIER", "", "", "");
        t.initializeFreeMint(FREE_MINT_ALLOCATION, GatingScope.BOTH);
    }

    function _defaultBands() internal pure returns (ERC404BondingStorage.TierBand[] memory bands) {
        bands = new ERC404BondingStorage.TierBand[](2);
        bands[0] = ERC404BondingStorage.TierBand({ idStart: T1_START, idEnd: T1_END, weight: 10 });
        bands[1] = ERC404BondingStorage.TierBand({ idStart: T2_START, idEnd: T2_END, weight: 100 });
    }

    function _seal() internal {
        token.initTierBands(_defaultBands());
    }

    /// @dev Wire and switch on staking. `initializeStaking` is factory-only (this contract IS the
    ///      factory here); `activateStaking` is owner-or-agent.
    function _activateStaking() internal {
        token.initializeStaking(address(module));
        vm.prank(owner);
        token.activateStaking();
    }

    /// @dev Move `nftCount` NFTs' worth of coin from the instance to `who`. NFTs auto-mint because this
    ///      instance overrides `_skipNFTDefault` to false. Never touches curve counters.
    function _fund(address who, uint256 nftCount) internal {
        vm.prank(address(token));
        token.transfer(who, nftCount * UNIT);
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

    /// @dev The band id `who` holds after a successful `mintUp` — usually one that was unoccupied
    ///      before, but `mintUp`'s own escrow leg can burn a band `who` already held and the LIFO pop
    ///      can hand that same id straight back (the T3 self-heal case), so fall back to any band id
    ///      `who` owns rather than mistaking that for "no id was issued".
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

    /// @dev Mint up on the first owned id that survives the escrow leg (the escrow transfer burns the
    ///      caller's NFTs LIFO off the tail, and an id caught by that burn reverts by design).
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

    /// @dev Put `who` in the canonical pre-burn state: EXACTLY one NFT, and it is a band id. `weight`
    ///      units in, `mintUp` escrows `weight - 1` of them, DN404 burns the now-unbacked NFTs off the
    ///      tail, and the single survivor is swapped for the band id.
    function _holderWithOneBandNFT(address who, uint8 tierN) internal returns (uint256 bandId) {
        uint256 weight = tierN == 1 ? 10 : 100;
        _fund(who, weight);
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

    // ── the three invariants every test below ends on ────────────────────────────────────────────

    /// @dev THE ORPHAN DETECTOR. `totalTierEscrow` must always equal the escrow derivable from the band
    ///      ids still outstanding. An ORPHANED band — escrow still counted, the id no longer owned by
    ///      anyone and not returned to its free list — makes this fail by exactly `(w_N - 1) * unit`.
    function _assertEscrowCounterMatchesOutstanding() internal view {
        assertEq(
            token.totalTierEscrow(),
            token.bandOutstanding(1) * 9 * UNIT + token.bandOutstanding(2) * 99 * UNIT,
            "escrow counter vs outstanding band ids"
        );
    }

    /// @dev SOLVENCY. Every unit the instance owes a band holder — escrowed behind a live band, or
    ///      credited to a holder whose band was burned — is actually sitting in the instance's own
    ///      balance, alongside (never instead of) the coin custodied for stakers.
    function _assertEscrowSolvent() internal view {
        assertGe(
            token.balanceOf(address(token)),
            token.totalTierEscrow() + token.totalPendingEscrowRelease() + module.totalStaked(address(token)),
            "instance balance covers escrow + pending release + custodied stake"
        );
    }

    /// @dev CONSERVATION. Every unit of coin is either liquid in someone's balance, escrowed behind a
    ///      band NFT someone owns (`coinBalanceOf` folds that in), owed to someone whose band NFT was
    ///      burned, or sitting in the instance (which is also where staked coin is custodied).
    function _assertConserved() internal view {
        uint256 instanceUnowed =
            token.balanceOf(address(token)) - token.totalTierEscrow() - token.totalPendingEscrowRelease();
        uint256 sum = instanceUnowed + token.balanceOf(address(liquidityDeployer));
        address[6] memory holders = [user1, user2, user3, sink, spender, agent];
        for (uint256 i; i < holders.length; i++) {
            sum += token.coinBalanceOf(holders[i]) + token.pendingEscrowRelease(holders[i]);
        }
        assertEq(sum, token.totalSupply(), "coin conservation broken");
    }

    function _assertAllThree() internal view {
        _assertEscrowCounterMatchesOutstanding();
        _assertEscrowSolvent();
        _assertConserved();
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  Why seven of the thirteen internal debit sites are not-applicable               │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @notice The structural fact that classifies every INSTANCE-side debit (`buyBonding`,
    ///         `mintDown`'s release, `claimFreeMint`, `unstake`, `claimReleasedEscrow`, reroll's return
    ///         leg, `deployLiquidity`) as not-applicable for band burning: the instance holds NO NFTs,
    ///         so DN404's `ownedLength == balance / unit` reconciliation has nothing to burn when its
    ///         balance falls. `_initializeDN404` sets the initial supply owner's `skipNFT`, and the
    ///         initial supply owner IS the instance.
    /// @dev The one exception is transient and by construction: reroll moves an EXEMPTED id to the
    ///      instance and back within a single call — see
    ///      `test_rerollExemptingABandIdKeepsTheIdAndItsEscrow`, which asserts the instance owns
    ///      nothing again by the time the call returns.
    function test_instanceHoldsNoNftsSoItsOwnDebitsCannotBurnABand() public {
        _seal();
        assertTrue(token.getSkipNFT(address(token)), "the instance must skip NFTs");

        _fund(user1, 20);
        (bool ok,) = _mintUpAny(user1, 1);
        assertTrue(ok, "mintUp");

        assertGt(token.balanceOf(address(token)), 0, "the instance does hold coin (escrow + unsold supply)");
        assertEq(_ownedIdsOf(address(token)).length, 0, "...and not one NFT of it");
        _assertAllThree();
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  ERC20 face, driven by a THIRD PARTY (allowance) — the sibling of the pinned      │
    // │  holder-initiated case in TokenTierOps                                            │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @notice AN ERC20 ALLOWANCE IS AN ALLOWANCE OVER `balanceOf`, NOT OVER THE DENOMINATION. An
    ///         approved spender pulling ONE unit to ITSELF — the recipient that takes NFTs, which is
    ///         what used to trigger DN404's re-home — burns the band NFT and credits the escrow back to
    ///         the HOLDER. The spender receives the unit it was approved for and nothing else. A
    ///         sealed ladder turns off `_useDirectTransfersIfPossible`, so `msg.sender` being a router,
    ///         aggregator or bridge cannot drain a denomination through an allowance the holder granted
    ///         for coin.
    function test_approvedSpenderCannotTakeTheDenomination() public {
        _seal();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);

        vm.prank(user1);
        token.approve(spender, UNIT);

        vm.expectEmit(true, true, true, true, address(token));
        emit EscrowReleased(user1, bandId, 9 * UNIT);
        vm.prank(spender);
        token.transferFrom(user1, spender, UNIT);

        assertEq(_ownerOrZero(bandId), address(0), "the band burned rather than following the unit");
        assertEq(token.coinBalanceOf(spender), UNIT, "the spender got only the unit it was approved for");
        assertEq(token.pendingEscrowRelease(spender), 0, "the spender is credited nothing");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "the escrow returns to the HOLDER");
        assertEq(token.totalTierEscrow(), 0, "escrow left the tier counter");
        assertEq(token.bandOutstanding(1), 0, "no longer outstanding");
        _assertAllThree();

        // The holder — not the spender, not the recipient — is the one who can claim it.
        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.balanceOf(user1), 9 * UNIT, "the holder is made whole");
        _assertAllThree();
    }

    /// @notice BURNED-AND-CREDITED, and credited to the RIGHT party. When the spender pulls to a
    ///         recipient that takes no NFTs, DN404 burns the band instead of re-homing it — and the
    ///         hook keys the credit on `from[i]`, so the escrow returns to the HOLDER whose band it
    ///         was, not to the spender who moved it and not to the recipient who received the unit.
    function test_approvedSpenderPullingToASkipNftRecipientCreditsTheHolder() public {
        _seal();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);

        vm.prank(user1);
        token.approve(spender, UNIT);

        vm.expectEmit(true, true, true, true, address(token));
        emit EscrowReleased(user1, bandId, 9 * UNIT);
        vm.prank(spender);
        token.transferFrom(user1, sink, UNIT);

        assertEq(_ownerOrZero(bandId), address(0), "the band was burned by DN404 reconciliation");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "credited to the holder");
        assertEq(token.pendingEscrowRelease(spender), 0, "not to the spender");
        assertEq(token.pendingEscrowRelease(sink), 0, "not to the recipient");
        assertEq(token.totalTierEscrow(), 0, "escrow left the tier counter");
        _assertAllThree();

        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.balanceOf(user1), 9 * UNIT, "the holder is made whole");
        _assertAllThree();
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  ERC721 face, driven by an OPERATOR                                               │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @notice CARRIED. `safeTransferFrom` by an `setApprovalForAll` operator moves the band id and its
    ///         escrow, credits nobody, and leaves the counter intact — the operator-driven sibling of
    ///         the owner-driven `transferFrom` case pinned in `TierBurnSafety`.
    function test_erc721OperatorSafeTransferMovesTheBandAndItsEscrow() public {
        _seal();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);
        uint256 escrowBefore = token.totalTierEscrow();

        DN404Mirror mirror = DN404Mirror(payable(token.mirrorERC721()));
        vm.prank(user1);
        mirror.setApprovalForAll(spender, true);
        vm.prank(spender);
        mirror.safeTransferFrom(user1, user2, bandId);

        assertEq(_ownerOrZero(bandId), user2, "the id moved");
        assertEq(token.totalTierEscrow(), escrowBefore, "escrow untouched: it follows the id");
        assertEq(token.pendingEscrowRelease(user1), 0, "no credit on a move");
        assertEq(token.pendingEscrowRelease(user2), 0, "no credit on a move");
        assertEq(token.coinBalanceOf(user2), 10 * UNIT, "the new owner holds the whole denomination");
        _assertAllThree();

        vm.prank(user2);
        token.mintDown(bandId);
        assertEq(token.balanceOf(user2), 10 * UNIT, "and can redeem it");
        _assertAllThree();
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  rerollSelectedNFTs x bands — no tier coverage before this suite                   │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @dev 12 units in, `mintUp(1, 1)`: the escrow leg burns the tail nine (ids 12..4), the survivors
    ///      are ids 1,2,3 at owned indices 0,1,2, and id 1 is swapped in place for band `T1_START`.
    ///      So the holder ends with `owned == [T1_START, 2, 3]` and 3 units of liquid balance — a band
    ///      AND rerollable ordinary ids, which is what a reroll interaction needs.
    function _holderWithABandAndTwoOrdinaryIds(address who) internal returns (uint256 bandId) {
        _fund(who, 12);
        vm.prank(who);
        token.mintUp(1, 1);
        bandId = T1_START;
        assertEq(_ownerOrZero(bandId), who, "setup: band issued");
        assertEq(token.balanceOf(who), 3 * UNIT, "setup: 12 units in, 9 escrowed");
        assertEq(_ownedIdsOf(who).length, 3, "setup: band + two ordinary ids");
    }

    /// @notice CARRIED. A reroll that EXEMPTS a band id keeps that exact id: the exemption legs move it
    ///         to the instance and back with `_transferFromNFT`, which re-homes an id rather than
    ///         destroying it, so nothing is credited and the escrow never moves. A reroll can therefore
    ///         never re-point a band id into the ordinary space — the only ids the reroll's coin leg
    ///         re-issues come out of DN404's own mint loop, which is bounded by `idLimit`.
    function test_rerollExemptingABandIdKeepsTheIdAndItsEscrow() public {
        _seal();
        uint256 bandId = _holderWithABandAndTwoOrdinaryIds(user1);
        uint256 escrowBefore = token.totalTierEscrow();

        uint256[] memory exempted = new uint256[](1);
        exempted[0] = bandId;
        vm.prank(user1);
        token.rerollSelectedNFTs(3 * UNIT, exempted); // 1 unit of exemption + 2 units rerolled

        assertEq(_ownerOrZero(bandId), user1, "the exempted band id survived, same id");
        assertEq(token.totalTierEscrow(), escrowBefore, "escrow untouched");
        assertEq(token.pendingEscrowRelease(user1), 0, "nothing was released");
        assertEq(token.coinBalanceOf(user1), 12 * UNIT, "the holder's denomination is intact");
        assertEq(token.balanceOf(user1), 3 * UNIT, "and the reroll's balance check held");
        assertEq(_ownedIdsOf(address(token)).length, 0, "the instance holds the id only transiently");

        uint256[] memory after_ = _ownedIdsOf(user1);
        assertEq(after_.length, 3, "band + two freshly rolled ordinary ids");
        uint256 bandsHeld;
        for (uint256 i; i < after_.length; i++) {
            if (after_[i] > ID_LIMIT) bandsHeld++;
        }
        assertEq(bandsHeld, 1, "exactly one band id, and no reroll ever emitted another");
        _assertAllThree();

        vm.prank(user1);
        token.mintDown(bandId);
        assertEq(token.balanceOf(user1), 12 * UNIT, "still fully redeemable after a reroll");
        _assertAllThree();
    }

    /// @notice BURNED-AND-CREDITED. Reroll's coin round-trip (`_transfer` out to the instance, then
    ///         back) is a debit like any other, so a band id sitting in the burned range of the outward
    ///         leg is destroyed — and because the return leg restores the balance exactly, the reroll's
    ///         `BalanceMismatchAfterReroll` check still passes and the call SUCCEEDS. The T3 hook is
    ///         what makes that safe: the denomination becomes a `pendingEscrowRelease` claim rather than
    ///         orphaned coin. Net effect for a holder who rerolls their whole position: the band is
    ///         gone, the coin is not.
    function test_rerollCoinRoundTripBurningABandCreditsTheHolder() public {
        _seal();
        uint256 bandId = _holderWithABandAndTwoOrdinaryIds(user1);

        vm.expectEmit(true, true, true, true, address(token));
        emit EscrowReleased(user1, bandId, 9 * UNIT);
        vm.prank(user1);
        token.rerollSelectedNFTs(3 * UNIT, new uint256[](0)); // no exemption: the band is in the burn range

        assertEq(_ownerOrZero(bandId), address(0), "the band was burned by the outward leg");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "its denomination became a claim");
        assertEq(token.totalTierEscrow(), 0, "escrow left the tier counter");
        assertEq(token.bandOutstanding(1), 0, "the id is back on its band's free list");
        assertEq(token.balanceOf(user1), 3 * UNIT, "the reroll's balance check held");

        uint256[] memory after_ = _ownedIdsOf(user1);
        assertEq(after_.length, 3, "three freshly rolled ids");
        for (uint256 i; i < after_.length; i++) {
            assertLe(after_[i], ID_LIMIT, "a rerolled id escaped into a band");
        }
        _assertAllThree();

        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.balanceOf(user1), 12 * UNIT, "nothing lost: 12 units in, 12 units held");
        _assertAllThree();
    }

    /// @notice A reroll can never EMIT a band id, at any scale: DN404's `_wrapNFTId` bounds the mint
    ///         queue to `[1..idLimit]` and band ids live strictly above it. Rolled here with a live band
    ///         outstanding the whole time (exempted, so it is neither burned nor re-issued) and 90 ids
    ///         re-minted in one call.
    function test_rerollNeverEmitsABandId() public {
        _seal();
        _fund(user1, 100);
        vm.prank(user1);
        token.mintUp(1, 1); // escrows 9 units; band lands at owned index 0
        uint256 bandId = T1_START;
        assertEq(token.balanceOf(user1), 91 * UNIT, "100 units in, 9 escrowed");

        uint256[] memory exempted = new uint256[](1);
        exempted[0] = bandId;
        vm.prank(user1);
        token.rerollSelectedNFTs(91 * UNIT, exempted); // 1 unit exempt + 90 units rerolled

        uint256[] memory after_ = _ownedIdsOf(user1);
        assertEq(after_.length, 91, "91 NFTs: the exempted band plus 90 rerolled ordinary ids");
        uint256 bandsHeld;
        for (uint256 i; i < after_.length; i++) {
            if (after_[i] > ID_LIMIT) bandsHeld++;
        }
        assertEq(bandsHeld, 1, "a rerolled id escaped into a band");
        assertEq(_ownerOrZero(bandId), user1, "and the one band held is the exempted one");

        // No band id anywhere else was touched either.
        for (uint256 id = T1_START; id <= T2_END; id++) {
            if (id == bandId) continue;
            assertEq(_ownerOrZero(id), address(0), "an unissued band id became owned");
        }
        assertEq(token.bandNextFree(0), T1_START + 1, "the band cursor did not advance during a reroll");
        _assertAllThree();
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  stake / unstake x bands — no tier coverage before this suite                      │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @notice BURNED-AND-CREDITED. `stake` is a debit to a recipient that takes no NFTs (the instance
    ///         itself), so staking the last liquid unit of a band position burns the band. The
    ///         denomination becomes a claim, the staked principal is untouched by that, and both are
    ///         recoverable independently.
    function test_stakingWhileHoldingABandBurnsItAndCreditsTheHolder() public {
        _seal();
        _activateStaking();
        uint256 bandId = _holderWithOneBandNFT(user1, 1);

        vm.expectEmit(true, true, true, true, address(token));
        emit EscrowReleased(user1, bandId, 9 * UNIT);
        vm.prank(user1);
        token.stake(UNIT);

        assertEq(_ownerOrZero(bandId), address(0), "the instance takes no NFTs, so the band burned");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "the denomination became a claim");
        assertEq(token.totalTierEscrow(), 0, "escrow left the tier counter");
        assertEq(module.stakedBalance(address(token), user1), UNIT, "and the unit is genuinely staked");
        assertEq(token.stakingReserve(), 0, "stakingReserve is ETH: a coin stake never credits it");
        _assertAllThree();

        // The two liabilities settle independently: the escrow claim...
        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.balanceOf(user1), 9 * UNIT, "escrow reclaimed");
        _assertAllThree();

        // ...and the staked principal.
        vm.prank(user1);
        token.unstake(UNIT);
        assertEq(token.balanceOf(user1), 10 * UNIT, "principal returned in full: 10 units in, 10 out");
        assertEq(module.stakedBalance(address(token), user1), 0, "nothing left staked");
        _assertAllThree();
    }

    /// @notice A different holder's stake/unstake cycle cannot touch a band holder's escrow, even
    ///         though `stake` custodies COIN in the very balance the escrow sits in while
    ///         `stakingReserve` tracks ETH only. The escrow counters, the outstanding band and the
    ///         solvency floor all survive the round trip, and the band stays redeemable.
    function test_anotherHoldersStakeCycleLeavesEscrowIntactAndSolvent() public {
        _seal();
        _activateStaking();
        _fund(user1, 20);
        (bool ok, uint256 bandId) = _mintUpAny(user1, 1);
        assertTrue(ok, "mintUp");
        uint256 escrowBefore = token.totalTierEscrow();
        assertEq(escrowBefore, 9 * UNIT, "escrow outstanding");

        _fund(user2, 10);
        vm.prank(user2);
        token.stake(5 * UNIT);
        assertEq(module.totalStaked(address(token)), 5 * UNIT, "coin custodied by the instance");
        assertEq(token.totalTierEscrow(), escrowBefore, "a stake does not touch tier escrow");
        assertEq(token.stakingReserve(), 0, "no ETH liability was created by a coin stake");
        _assertAllThree();

        vm.prank(user2);
        token.unstake(5 * UNIT);
        assertEq(token.balanceOf(user2), 10 * UNIT, "principal returned exactly");
        assertEq(token.totalTierEscrow(), escrowBefore, "an unstake does not touch tier escrow");
        assertEq(token.bandOutstanding(1), 1, "the other holder's band is still outstanding");
        _assertAllThree();

        vm.prank(user1);
        token.mintDown(bandId);
        assertEq(token.totalTierEscrow(), 0, "and it was still redeemable at full denomination");
        _assertAllThree();
    }

    /// @notice `unstake` can never be paid out of escrowed coin. The payout is bounded by the staker's
    ///         recorded principal, not by what the instance happens to hold — so although the instance's
    ///         balance here is far larger than the requested payout BECAUSE of escrow, an over-unstake
    ///         is refused and the legitimate unstake pays back exactly what was staked.
    function test_unstakeIsBoundedByPrincipalNotByTheEscrowBearingBalance() public {
        _seal();
        _activateStaking();
        _fund(user1, 100);
        (bool ok,) = _mintUpAny(user1, 2); // weight 100 => 99 units escrowed in the instance
        assertTrue(ok, "mintUp");
        assertEq(token.totalTierEscrow(), 99 * UNIT, "escrow outstanding");

        _fund(user2, 2);
        vm.prank(user2);
        token.stake(UNIT);

        uint256 instanceBalBefore = token.balanceOf(address(token));
        assertGe(instanceBalBefore, 10 * UNIT, "the instance's balance would COVER a 10-unit payout");

        vm.prank(user2);
        vm.expectRevert(UnstakeFailed.selector); // module: InsufficientStakedBalance
        token.unstake(10 * UNIT);

        assertEq(token.balanceOf(address(token)), instanceBalBefore, "no coin left the instance");
        assertEq(token.totalTierEscrow(), 99 * UNIT, "escrow untouched by the refused unstake");
        _assertAllThree();

        // The legitimate exit pays principal and not one unit more.
        uint256 before = token.balanceOf(user2);
        vm.prank(user2);
        token.unstake(UNIT);
        assertEq(token.balanceOf(user2) - before, UNIT, "paid exactly the staked principal");
        assertEq(module.totalStaked(address(token)), 0, "nothing left staked");
        _assertAllThree();
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  claimFreeMint x bands — no tier coverage before this suite                        │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @notice The free-mint tranche is counter-based, so it cannot dip into escrow: every legitimate
    ///         claim succeeds with bands outstanding, the solvency floor holds at every step, and the
    ///         claim past the allocation is refused BY THE COUNTER — the instance is still holding
    ///         orders of magnitude more coin than the one unit a claim moves, so a balance shortfall is
    ///         not what stopped it.
    function test_freeMintClaimsWithOutstandingBandsCannotDipIntoEscrow() public {
        _seal();
        _activateBonding();
        _fund(user1, 200);
        (bool ok,) = _mintUpAny(user1, 2);
        assertTrue(ok, "mintUp");
        uint256 escrowBefore = token.totalTierEscrow();
        assertEq(escrowBefore, 99 * UNIT, "escrow outstanding");

        address[3] memory claimants = [user2, user3, spender];
        for (uint256 i; i < claimants.length; i++) {
            vm.prank(claimants[i]);
            token.claimFreeMint("");
            assertEq(token.balanceOf(claimants[i]), UNIT, "each claim pays exactly one unit");
            assertEq(token.totalTierEscrow(), escrowBefore, "a free-mint claim never touches escrow");
            _assertAllThree();
        }
        assertEq(token.freeMintsClaimed(), FREE_MINT_ALLOCATION, "the allocation is exhausted");

        assertGt(token.balanceOf(address(token)), 100 * UNIT, "the instance is nowhere near short of a unit");
        vm.prank(agent);
        vm.expectRevert(FreeMintFailed.selector); // Ops: FreeMintExhausted, on the counter
        token.claimFreeMint("");
        assertEq(token.balanceOf(agent), 0, "the refused claim paid nothing");
        _assertAllThree();
    }

    /// @notice Escrow sitting in the instance's own balance cannot inflate the buyable pool: the buy cap
    ///         is counter-based (`totalBondingSupply`), computed from `maxSupply`, `liquidityReserve`
    ///         and the free-mint allocation, and is blind to how much coin the instance is holding for
    ///         band holders.
    function test_escrowCannotInflateTheBuyableCurveSupply() public {
        _seal();
        _activateBonding();
        _fund(user1, 200);
        (bool ok,) = _mintUpAny(user1, 2);
        assertTrue(ok, "mintUp");
        assertEq(token.totalTierEscrow(), 99 * UNIT, "99 units of escrow now sit in the instance's balance");

        uint256 cap = MAX_SUPPLY - token.liquidityReserve() - (FREE_MINT_ALLOCATION * UNIT);
        assertEq(token.totalBondingSupply(), 0, "nothing bought yet");

        vm.prank(user2);
        vm.expectRevert(ExceedsBonding.selector);
        token.buyBonding(cap + 1, type(uint256).max, true, bytes(""), bytes(""), 0);
        _assertAllThree();
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  Agent delegation x tier ops                                                      │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @notice `mintUp` / `mintDown` are `msg.sender`-scoped and carry no owner-or-agent gate, so a
    ///         platform-vetted agent with delegation enabled has no authority over anyone else's ids —
    ///         it can only mint up its OWN. Asserted with the agent FULLY FUNDED, so the refusal is the
    ///         ownership re-read and not an escrow-leg shortfall, and with the agent's own successful
    ///         `mintUp` as the positive control that the entry point itself is not gated.
    function test_agentCannotDriveTierOpsOnAnotherHoldersIds() public {
        _seal();
        registry.setAgent(agent, true);
        vm.prank(owner);
        token.setAgentDelegation(true);
        assertTrue(token.agentDelegationEnabled(), "delegation is on");

        _fund(user1, 10);
        uint256 holderId = _ownedIdsOf(user1)[0];
        _fund(agent, 10); // enough to fund the escrow leg on its own

        vm.prank(agent);
        vm.expectRevert(TierOpFailed.selector); // Ops: NotTierZeroId, re-read after the escrow leg
        token.mintUp(1, holderId);

        assertEq(_ownerOrZero(holderId), user1, "the holder's id did not move");
        assertEq(token.balanceOf(agent), 10 * UNIT, "and the agent's escrow leg was rolled back");
        assertEq(token.totalTierEscrow(), 0, "no escrow was charged");
        _assertAllThree();

        // Positive control: the agent CAN mint up an id it owns — nothing about the call was gated.
        (bool ok, uint256 agentBand) = _mintUpAny(agent, 1);
        assertTrue(ok, "the agent mints up its own id");
        assertEq(_ownerOrZero(agentBand), agent, "the agent's own band");
        _assertAllThree();

        // Nor can it mint DOWN a band belonging to someone else.
        _fund(user2, 10);
        (bool ok2, uint256 userBand) = _mintUpAny(user2, 1);
        assertTrue(ok2, "the holder mints up");
        vm.prank(agent);
        vm.expectRevert(TierOpFailed.selector); // Ops: NotBandId (not the caller's)
        token.mintDown(userBand);
        assertEq(_ownerOrZero(userBand), user2, "the holder's band is still theirs");
        _assertAllThree();
    }

    /// @notice The ladder seal stays FACTORY-only: agent delegation does not reach it. A ladder an agent
    ///         could seal would let a vetted third party price every future band NFT on the instance.
    function test_agentCannotSealTheLadder() public {
        registry.setAgent(agent, true);
        vm.prank(owner);
        token.setAgentDelegation(true);

        vm.prank(agent);
        vm.expectRevert(InitTierBandsFailed.selector); // Ops: OnlyFactory
        token.initTierBands(_defaultBands());

        // Falsifiable: nothing was written — tier 1 is still out of range for `bandOutstanding`.
        vm.expectRevert(InvalidBand.selector);
        token.bandOutstanding(1);

        // Control: the factory can, and the same ladder seals cleanly.
        _seal();
        assertEq(token.bandOutstanding(1), 0, "sealed by the factory");
        (uint32 s0,, uint32 w0) = token.tierBands(0);
        assertEq(s0, T1_START, "tier1 start");
        assertEq(w0, 10, "tier1 weight");
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────┐
    // │  Conservation under fuzz, across the newly covered features                        │
    // └──────────────────────────────────────────────────────────────────────────────────┘

    /// @notice THE invariant, across any interleaving of tier ops with reroll, staking, free mints and
    ///         burning transfers: no coin is created, destroyed or stranded, `totalTierEscrow` never
    ///         diverges from the ids actually outstanding, and the instance stays solvent for escrow +
    ///         pending release + custodied stake at every single step.
    /// forge-config: default.fuzz.runs = 12
    function test_fuzz_conservationAcrossRerollStakingAndFreeMints(uint16 opBits) public {
        _seal();
        _activateStaking();
        _activateBonding();
        _fund(user1, 40);
        _fund(user2, 40);
        _assertAllThree();

        for (uint256 i; i < 8; i++) {
            address who = ((opBits >> (i + 8)) & 1) == 1 ? user1 : user2;
            uint256 op = (opBits >> (i * 2)) & 3;

            if (op == 0) {
                _mintUpAny(who, 1);
            } else if (op == 1) {
                // Reroll everything liquid: the coin round-trip that can burn a band off the tail.
                uint256 whole = (token.balanceOf(who) / UNIT) * UNIT;
                if (whole != 0) {
                    vm.prank(who);
                    token.rerollSelectedNFTs(whole, new uint256[](0));
                }
            } else if (op == 2) {
                // Stake half, or exit whatever is staked — both cross the escrow-bearing balance.
                uint256 staked = module.stakedBalance(address(token), who);
                if (staked != 0) {
                    vm.prank(who);
                    token.unstake(staked);
                } else {
                    uint256 half = ((token.balanceOf(who) / UNIT) / 2) * UNIT;
                    if (half != 0) {
                        vm.prank(who);
                        token.stake(half);
                    }
                }
            } else {
                // Settle any credit, or dump the rest on a skipNFT holder (the burning debit).
                if (token.pendingEscrowRelease(who) != 0) {
                    vm.prank(who);
                    token.claimReleasedEscrow();
                } else {
                    uint256 amount = token.balanceOf(who);
                    if (amount != 0) {
                        vm.prank(who);
                        token.transfer(sink, amount);
                    }
                }
            }

            _assertAllThree();
        }

        // Free mints, on top of whatever state the sequence left behind.
        vm.prank(user3);
        token.claimFreeMint("");
        _assertAllThree();

        // Drain every outstanding credit: nothing is stranded at the end either.
        address[3] memory settlers = [user1, user2, user3];
        for (uint256 i; i < settlers.length; i++) {
            if (token.pendingEscrowRelease(settlers[i]) != 0) {
                vm.prank(settlers[i]);
                token.claimReleasedEscrow();
            }
        }
        assertEq(token.totalPendingEscrowRelease(), 0, "all credits settled");
        _assertAllThree();
    }
}
