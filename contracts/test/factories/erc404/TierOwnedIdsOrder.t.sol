// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import { ERC404BondingStorage, TierOpFailed } from "src/factories/erc404/ERC404BondingStorage.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "src/interfaces/ILiquidityDeployerModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @dev Minimal graduation sink; this suite never graduates, it is only required by `initialize`.
contract OrderMockLiquidityDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }

    function setMetadataURI(string calldata) external override { }
}

/**
 * @title TierOwnedIdsOrder
 * @notice noesis-356: pins `ownedIdsOf` as an ORDERED view, and pins that its order is the order
 *         DN404 actually burns in.
 * @dev MONEY-CODE ADJACENT. `ownedIdsOf` exists so a holder can be shown the exact pieces a pending
 *      `mintUp` will take before they sign it. A view that returned the right SET in the wrong ORDER
 *      would let that surface name the wrong pieces with full confidence, which is worse than naming
 *      none — so ORDER is what these tests assert, not membership.
 *
 *      The contract under test: DN404 reconciles `ownedLength == balance / unit` on every debit by
 *      burning ids LIFO off the TAIL of `owned[holder]`. Therefore, for a debit of `k` whole units,
 *      the ids that disappear are exactly the LAST `k` entries of `ownedIdsOf` read beforehand, and
 *      the survivors are the leading entries in unchanged relative order. `mintUp`'s escrow leg is
 *      such a debit (`(w - 1) * unit`), which is why mint up consumes `w` pieces while naming one.
 */
contract TierOwnedIdsOrderTest is Test {
    ERC404BondingInstance token;

    address owner = address(0x5);
    address user1 = address(0x10);
    address user2 = address(0x20);
    address treasury = address(0xFEE);

    uint256 constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 constant UNIT = 1_000_000 ether; // 1M coin = 1 NFT  =>  ID_LIMIT = 1000
    uint256 constant ID_LIMIT = MAX_SUPPLY / UNIT;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;

    // Ladder: 10-to-1 then 100-to-1, bands strictly above ID_LIMIT.
    uint32 constant T1_START = 1001;
    uint32 constant T1_END = 1100;
    uint32 constant T2_START = 1101;
    uint32 constant T2_END = 1110;
    uint256 constant T1_WEIGHT = 10;

    function setUp() public {
        BondingCurveMath.Params memory curveParams =
            BondingCurveMath.Params({ kCoeff: 0.0001 ether, poleWad: 1.0438e18, normalizationFactor: 1e18 });

        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        token = ERC404BondingInstance(payable(LibClone.clone(address(impl))));

        token.initialize(
            owner,
            address(0xBEEF),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: curveParams
            }),
            address(new OrderMockLiquidityDeployer()),
            address(0),
            address(new DN404Mirror(address(this)))
        );
        token.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: treasury,
                masterRegistry: address(0x400),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        token.initializeMetadata("TierToken", "TIER", "", "", "");

        // factory == address(this) here, exactly as in the other tier suites.
        ERC404BondingStorage.TierBand[] memory bands = new ERC404BondingStorage.TierBand[](2);
        bands[0] = ERC404BondingStorage.TierBand({ idStart: T1_START, idEnd: T1_END, weight: uint32(T1_WEIGHT) });
        bands[1] = ERC404BondingStorage.TierBand({ idStart: T2_START, idEnd: T2_END, weight: 100 });
        token.initTierBands(bands);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    /// @dev Move `nftCount` NFTs' worth of coin from the instance to `user`; NFTs auto-mint because
    ///      this instance's `_skipNFTDefault` is false.
    function _fund(address user, uint256 nftCount) internal {
        vm.prank(address(token));
        token.transfer(user, nftCount * UNIT);
    }

    function _ownerOrZero(uint256 id) internal view returns (address who) {
        try token.ownerOf(id) returns (address o) {
            who = o;
        } catch {
            who = address(0);
        }
    }

    // ┌────────────────────────────────────────────┐
    // │  The view enumerates, and it enumerates     │
    // │  in owned-array order                       │
    // └────────────────────────────────────────────┘

    function test_OwnedIdsOf_EnumeratesEveryOwnedIdExactlyOnce() public {
        _fund(user1, 12);

        uint256[] memory ids = token.ownedIdsOf(user1);
        assertEq(ids.length, 12, "one entry per whole unit held");

        for (uint256 i; i < ids.length; i++) {
            assertEq(_ownerOrZero(ids[i]), user1, "enumerated id is not owned by the holder");
            for (uint256 j = i + 1; j < ids.length; j++) {
                assertTrue(ids[i] != ids[j], "duplicate id in the enumeration");
            }
        }
    }

    function test_OwnedIdsOf_IsEmptyForAHolderWithNothing() public view {
        assertEq(token.ownedIdsOf(user2).length, 0);
    }

    /// @dev THE ORDER ASSERTION. A partial coin debit burns off the TAIL, so the survivors must be a
    ///      PREFIX of the pre-debit enumeration, index for index. A view that returned the same set in
    ///      any other order would fail here.
    function test_OwnedIdsOf_OrderIsTheOrderDn404BurnsIn() public {
        _fund(user1, 12);
        uint256[] memory before_ = token.ownedIdsOf(user1);

        uint256 burnCount = 5;
        vm.prank(user1);
        token.transfer(user2, burnCount * UNIT);

        uint256[] memory after_ = token.ownedIdsOf(user1);
        assertEq(after_.length, before_.length - burnCount, "burn count is balance-driven");

        // Survivors: the leading entries, in their original relative order.
        for (uint256 i; i < after_.length; i++) {
            assertEq(after_[i], before_[i], "surviving ids must be the unchanged prefix");
        }
        // Casualties: the trailing entries, and only those.
        for (uint256 i = after_.length; i < before_.length; i++) {
            assertTrue(_ownerOrZero(before_[i]) != user1, "a tail id survived the debit");
        }
    }

    // ┌────────────────────────────────────────────┐
    // │  Mint up: one id named, `weight` consumed   │
    // └────────────────────────────────────────────┘

    /// @dev The preview the app renders is exactly this arithmetic: the named `tierZeroId` plus the
    ///      last `weight - 1` entries of `ownedIdsOf` leave the wallet, and one band id arrives.
    function test_MintUp_ConsumesTheNamedIdPlusTheTrailingWeightMinusOne() public {
        _fund(user1, 12);
        uint256[] memory before_ = token.ownedIdsOf(user1);

        uint256 tailBurned = T1_WEIGHT - 1; // 9
        uint256 tailStart = before_.length - tailBurned; // 3

        // Index 0 is outside the burn tail, so this call is the one the app would build.
        uint256 tierZeroId = before_[0];
        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        uint256[] memory after_ = token.ownedIdsOf(user1);
        assertEq(after_.length, before_.length - tailBurned, "escrow leg burns exactly weight - 1 pieces");

        // The band id is installed in the vacated slot and then moved to index 0.
        assertTrue(after_[0] > ID_LIMIT, "the new band id sits at owned index 0");
        assertEq(_ownerOrZero(after_[0]), user1, "the holder owns the band id");

        // Everything the holder gave up: the named id, plus the whole tail.
        assertTrue(_ownerOrZero(tierZeroId) != user1, "the named id is consumed, not kept");
        for (uint256 i = tailStart; i < before_.length; i++) {
            assertTrue(_ownerOrZero(before_[i]) != user1, "a tail piece survived mint up");
        }
        assertEq(after_.length, 3, "12 held, 10 consumed, 1 band arrives");

        // The untouched middle keeps its identity and its order.
        assertEq(after_[1], before_[1]);
        assertEq(after_[2], before_[2]);
    }

    /// @dev The D2 case the panel now refuses in words: a `tierZeroId` the escrow leg's tail burn
    ///      reaches is destroyed before the ownership re-read, so the whole call reverts — as the bare
    ///      `TierOpFailed()`, which names no cause. `ownedIdsOf` is what lets the app see this coming.
    function test_MintUp_RevertsWhenTheNamedIdIsInTheBurnTail() public {
        _fund(user1, 12);
        uint256[] memory before_ = token.ownedIdsOf(user1);

        uint256 lastId = before_[before_.length - 1];
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector);
        token.mintUp(1, lastId);

        // A reverted attempt leaves the position exactly as it was.
        uint256[] memory after_ = token.ownedIdsOf(user1);
        assertEq(after_.length, before_.length);
        for (uint256 i; i < after_.length; i++) {
            assertEq(after_[i], before_[i], "a reverted mint up must not reorder the position");
        }
    }

    /// @dev Holding exactly `weight` pieces, index 0 is the ONLY id outside the burn tail. Pinned
    ///      because it is the state a holder lands in after topping up to afford the tier, and it is
    ///      where the choice of id is at its most constrained.
    function test_MintUp_AtExactlyWeightPiecesOnlyIndexZeroIsSelectable() public {
        _fund(user1, T1_WEIGHT);
        uint256[] memory before_ = token.ownedIdsOf(user1);
        assertEq(before_.length, T1_WEIGHT);

        for (uint256 i = 1; i < before_.length; i++) {
            vm.prank(user1);
            vm.expectRevert(TierOpFailed.selector);
            token.mintUp(1, before_[i]);
        }

        vm.prank(user1);
        token.mintUp(1, before_[0]);

        uint256[] memory after_ = token.ownedIdsOf(user1);
        assertEq(after_.length, 1, "the whole position folds into one band NFT");
        assertTrue(after_[0] > ID_LIMIT, "and that piece is the band");
    }
}
