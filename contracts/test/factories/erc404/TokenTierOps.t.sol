// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { ERC404BondingInstance, OnlyFactory, AlreadyInitialized } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import {
    ERC404BondingStorage,
    TierOpFailed,
    InvalidBand,
    BandIdOverflow
} from "src/factories/erc404/ERC404BondingStorage.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "src/interfaces/ILiquidityDeployerModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @dev Minimal graduation sink — records the token/ETH it was handed.
contract TierMockLiquidityDeployer is ILiquidityDeployerModule {
    uint256 public tokenReserveSeen;
    uint256 public ethSeen;

    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata p) external payable override {
        tokenReserveSeen = p.tokenReserve;
        ethSeen = msg.value;
    }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }

    function setMetadataURI(string calldata) external override { }
}

/// @dev Exposes the DN404 policy hooks Token Tiers safety depends on. Never initialized — it is a
///      code-only probe of the instance's overrides.
contract TierPolicyProbe is ERC404BondingInstance {
    constructor(address ops) ERC404BondingInstance(ops) { }

    function probeAddToBurnedPool(uint256 a, uint256 b) external view returns (bool) {
        return _addToBurnedPool(a, b);
    }

    function probeUseExistsLookup() external view returns (bool) {
        return _useExistsLookup();
    }

    function probeUseAfterNFTTransfers() external returns (bool) {
        return _useAfterNFTTransfers();
    }

    function probeSkipNFTDefault(address a) external view returns (bool) {
        return _skipNFTDefault(a);
    }
}

/// @dev The same probe on the Ops side — the two MUST agree, since Ops runs in the instance's storage.
contract TierOpsPolicyProbe is ERC404BondingOps {
    function probeAddToBurnedPool(uint256 a, uint256 b) external view returns (bool) {
        return _addToBurnedPool(a, b);
    }

    function probeUseExistsLookup() external view returns (bool) {
        return _useExistsLookup();
    }

    function probeUseAfterNFTTransfers() external returns (bool) {
        return _useAfterNFTTransfers();
    }

    function probeSkipNFTDefault(address a) external view returns (bool) {
        return _skipNFTDefault(a);
    }
}

/**
 * @title TokenTierOps
 * @notice Token Tiers T2 (noesis-142): ladder seal + mintUp/mintDown + aggregate `coinBalanceOf`.
 * @dev MONEY-CODE. The suite's spine is the pair of invariants the design rests on:
 *      (1) CURVE ISOLATION — no tier op moves `reserve` or `totalBondingSupply`;
 *      (2) COIN CONSERVATION — Σ holders' `coinBalanceOf` + the instance's unescrowed balance is the
 *          constant total supply, whatever sequence of tier ops runs.
 *      Ops-side reverts reach the caller as the generic `TierOpFailed()` (the trampoline discards
 *      returndata — noesis-091); the specific errors stay visible in traces. Seal-side reverts
 *      (`InvalidBand`, `BandIdOverflow`, `OnlyFactory`, `AlreadyInitialized`) surface verbatim.
 */
contract TokenTierOpsTest is Test {
    ERC404BondingInstance token;
    TierMockLiquidityDeployer liquidityDeployer;

    address owner = address(0x5);
    address user1 = address(0x10);
    address user2 = address(0x20);
    address treasury = address(0xFEE);

    uint256 constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 constant UNIT = 1_000_000 ether; // 1M tokens = 1 NFT  =>  ID_LIMIT = 1000
    uint256 constant ID_LIMIT = MAX_SUPPLY / UNIT;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;

    // Ladder: 10-to-1. Bands sit ABOVE ID_LIMIT and are sized S / w (the product's band_N = S/w_N).
    uint32 constant T1_START = 1001;
    uint32 constant T1_END = 1100; // 1000 / 10  = 100 ids
    uint32 constant T2_START = 1101;
    uint32 constant T2_END = 1110; // 1000 / 100 =  10 ids

    function setUp() public {
        liquidityDeployer = new TierMockLiquidityDeployer();

        BondingCurveMath.Params memory curveParams = BondingCurveMath.Params({
            initialPrice: 0.0001 ether, quarticCoeff: 1, cubicCoeff: 1, quadraticCoeff: 1, normalizationFactor: 1e18
        });

        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        token = ERC404BondingInstance(payable(LibClone.clone(address(impl))));

        // factory == address(this): this test contract seals the ladder, exactly as ERC404Factory will
        // (wiring the factory to call `initTierBands` is noesis-141's create path, out of scope here).
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
            address(liquidityDeployer),
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
        token.initializeMetadata("TierToken", "TIER", "", "");

        vm.deal(user1, 1000 ether);
        vm.deal(user2, 1000 ether);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _defaultBands() internal pure returns (ERC404BondingStorage.TierBand[] memory bands) {
        bands = new ERC404BondingStorage.TierBand[](2);
        bands[0] = ERC404BondingStorage.TierBand({ idStart: T1_START, idEnd: T1_END, weight: 10 });
        bands[1] = ERC404BondingStorage.TierBand({ idStart: T2_START, idEnd: T2_END, weight: 100 });
    }

    function _seal() internal {
        token.initTierBands(_defaultBands());
    }

    /// @dev Move `nftCount` NFTs' worth of coin from the instance to `user`. NFTs auto-mint because
    ///      this instance overrides `_skipNFTDefault` to false.
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

    function _newlyIssuedBandId(bool[] memory before_) internal view returns (uint256) {
        for (uint256 id = T1_START; id <= T2_END; id++) {
            if (!before_[id - T1_START] && _ownerOrZero(id) != address(0)) return id;
        }
        revert("no band id was issued");
    }

    /// @dev Mint up on the first id that survives the escrow leg. The escrow transfer burns the
    ///      caller's NFTs LIFO off the TAIL of their `owned` array, and a caller-supplied id caught by
    ///      that burn reverts (by design) — the app is expected to pass a low-index id, which this
    ///      helper finds by trying candidates in order. A reverted attempt leaves no state behind.
    function _mintUpAny(address who, uint8 tierN) internal returns (bool ok, uint256 bandId) {
        bool[] memory occupancyBefore = _bandOccupancy();
        uint256[] memory ids = _ownedIdsOf(who);
        for (uint256 i; i < ids.length; i++) {
            if (ids[i] > ID_LIMIT) continue; // band ids are not tier-0 material
            vm.prank(who);
            (ok,) = address(token).call(abi.encodeWithSignature("mintUp(uint8,uint256)", tierN, ids[i]));
            if (ok) return (true, _newlyIssuedBandId(occupancyBefore));
        }
        return (false, 0);
    }

    function _activateBonding() internal {
        vm.startPrank(owner);
        token.setBondingOpenTime(block.timestamp + 1);
        token.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 2);
    }

    // ┌─────────────────────────┐
    // │   Seal (initTierBands)  │
    // └─────────────────────────┘

    function test_seal_storesLadderAndCursors() public {
        _seal();

        (uint32 s0, uint32 e0, uint32 w0) = token.tierBands(0);
        assertEq(s0, T1_START, "tier1 start");
        assertEq(e0, T1_END, "tier1 end");
        assertEq(w0, 10, "tier1 weight");
        (uint32 s1, uint32 e1, uint32 w1) = token.tierBands(1);
        assertEq(s1, T2_START, "tier2 start");
        assertEq(e1, T2_END, "tier2 end");
        assertEq(w1, 100, "tier2 weight");

        assertEq(token.bandNextFree(0), T1_START, "tier1 cursor starts at idStart");
        assertEq(token.bandNextFree(1), T2_START, "tier2 cursor starts at idStart");
        assertEq(token.bandOutstanding(1), 0, "nothing outstanding at seal");
        assertEq(token.totalTierEscrow(), 0, "no escrow at seal");
    }

    /// @notice Band sizing is the product's invariant `band_N x w_N = S`: every band can hold the WHOLE
    ///         supply if it all concentrated there, so a tier is never "sold out" by an artificial cap.
    function test_seal_bandSizeEqualsSupplyOverWeight() public pure {
        assertEq(uint256(T1_END - T1_START + 1) * 10, ID_LIMIT, "band_1 x w_1 == S");
        assertEq(uint256(T2_END - T2_START + 1) * 100, ID_LIMIT, "band_2 x w_2 == S");
    }

    function test_seal_revertsForNonFactory() public {
        vm.prank(user1);
        vm.expectRevert(OnlyFactory.selector);
        token.initTierBands(_defaultBands());
    }

    function test_seal_revertsOnSecondCall() public {
        _seal();
        vm.expectRevert(AlreadyInitialized.selector);
        token.initTierBands(_defaultBands());
    }

    function test_seal_revertsOnEmptyLadder() public {
        vm.expectRevert(InvalidBand.selector);
        token.initTierBands(new ERC404BondingStorage.TierBand[](0));
    }

    /// @notice A band reaching into the ORDINARY id space is rejected: that is exactly what would make a
    ///         band id auto-mintable and hand an unescrowed band NFT to an ordinary buyer.
    function test_seal_revertsWhenBandCollidesWithOrdinaryIds() public {
        ERC404BondingStorage.TierBand[] memory bands = new ERC404BondingStorage.TierBand[](1);
        bands[0] =
            ERC404BondingStorage.TierBand({ idStart: uint32(ID_LIMIT), idEnd: uint32(ID_LIMIT + 99), weight: 10 });
        vm.expectRevert(InvalidBand.selector);
        token.initTierBands(bands);
    }

    function test_seal_revertsOnOverlappingBands() public {
        ERC404BondingStorage.TierBand[] memory bands = _defaultBands();
        bands[1].idStart = T1_END; // overlaps tier 1
        bands[1].idEnd = T1_END + 9;
        vm.expectRevert(InvalidBand.selector);
        token.initTierBands(bands);
    }

    function test_seal_revertsOnNonIncreasingWeight() public {
        ERC404BondingStorage.TierBand[] memory bands = _defaultBands();
        bands[1].weight = 10; // equal to tier 1
        bands[1].idEnd = T2_START + 99;
        vm.expectRevert(InvalidBand.selector);
        token.initTierBands(bands);
    }

    function test_seal_revertsOnWeightBelowTwo() public {
        ERC404BondingStorage.TierBand[] memory bands = new ERC404BondingStorage.TierBand[](1);
        bands[0] =
            ERC404BondingStorage.TierBand({ idStart: T1_START, idEnd: uint32(T1_START + ID_LIMIT - 1), weight: 1 });
        vm.expectRevert(InvalidBand.selector);
        token.initTierBands(bands);
    }

    function test_seal_revertsOnWrongBandSize() public {
        ERC404BondingStorage.TierBand[] memory bands = _defaultBands();
        bands[0].idEnd = T1_END + 1; // one id too many for w = 10
        vm.expectRevert(InvalidBand.selector);
        token.initTierBands(bands);
    }

    /// @notice DN404's `_restrictNFTId` bounds ids to uint32 — a band running past it would be unownable.
    function test_seal_revertsOnUint32Overflow() public {
        ERC404BondingStorage.TierBand[] memory bands = new ERC404BondingStorage.TierBand[](1);
        bands[0] =
            ERC404BondingStorage.TierBand({ idStart: type(uint32).max - 50, idEnd: type(uint32).max, weight: 10 });
        vm.expectRevert(BandIdOverflow.selector);
        token.initTierBands(bands);
    }

    /// @notice A weight so large the band would be empty is rejected rather than sealed as a dead tier.
    function test_seal_revertsOnZeroSizedBand() public {
        ERC404BondingStorage.TierBand[] memory bands = new ERC404BondingStorage.TierBand[](1);
        bands[0] = ERC404BondingStorage.TierBand({ idStart: T1_START, idEnd: T1_START, weight: uint32(ID_LIMIT + 1) });
        vm.expectRevert(InvalidBand.selector);
        token.initTierBands(bands);
    }

    // ┌─────────────────────────┐
    // │   mintUp / mintDown     │
    // └─────────────────────────┘

    function test_mintUp_swapsIdAndEscrowsWeightMinusOne() public {
        _seal();
        _fund(user1, 10);

        uint256[] memory before = _ownedIdsOf(user1);
        assertEq(before.length, 10, "10 tier-0 NFTs");
        uint256 tierZeroId = before[0]; // low index: survives the escrow leg's LIFO burn
        uint256 instanceBalBefore = token.balanceOf(address(token));

        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        // One NFT, one unit of liquid balance, nine units escrowed here.
        assertEq(token.balanceOf(user1), UNIT, "liquid balance is 1 unit");
        assertEq(token.coinBalanceOf(user1), 10 * UNIT, "true holdings unchanged");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "escrow == (w-1) * unit");
        assertEq(token.balanceOf(address(token)), instanceBalBefore + 9 * UNIT, "escrow sits on the instance");

        uint256[] memory afterIds = _ownedIdsOf(user1);
        assertEq(afterIds.length, 1, "exactly one NFT left");
        assertEq(afterIds[0], T1_START, "first band id issued");
        assertEq(token.ownerOf(T1_START), user1, "band id owned by the holder");
        assertEq(_ownerOrZero(tierZeroId), address(0), "tier-0 id returned to the pool");
        assertEq(token.bandOutstanding(1), 1, "one band id outstanding");
        assertEq(token.totalSupply(), MAX_SUPPLY, "total supply is untouched by a tier op");
    }

    function test_mintUp_emitsMirrorTransfersForBothLegs() public {
        _seal();
        _fund(user1, 10);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];
        address mirror = token.mirrorERC721();

        vm.recordLogs();
        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        bytes32 transferSig = keccak256("Transfer(address,address,uint256)");
        bool sawBurn;
        bool sawMint;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != mirror || logs[i].topics.length != 4 || logs[i].topics[0] != transferSig) continue;
            address from = address(uint160(uint256(logs[i].topics[1])));
            address to = address(uint160(uint256(logs[i].topics[2])));
            uint256 id = uint256(logs[i].topics[3]);
            if (from == user1 && to == address(0) && id == tierZeroId) sawBurn = true;
            if (from == address(0) && to == user1 && id == T1_START) sawMint = true;
        }
        assertTrue(sawBurn, "ERC721 burn leg for the tier-0 id");
        assertTrue(sawMint, "ERC721 mint leg for the band id");
    }

    function test_roundTrip_returnsHolderToIdenticalPosition() public {
        _seal();
        _fund(user1, 10);

        uint256 balBefore = token.balanceOf(user1);
        uint256 coinBefore = token.coinBalanceOf(user1);
        uint256 ownedBefore = _ownedIdsOf(user1).length;
        uint256 tierZeroId = _ownedIdsOf(user1)[0];

        vm.startPrank(user1);
        token.mintUp(1, tierZeroId);
        token.mintDown(T1_START);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), balBefore, "liquid balance restored");
        assertEq(token.coinBalanceOf(user1), coinBefore, "true holdings restored");
        assertEq(_ownedIdsOf(user1).length, ownedBefore, "NFT count restored");
        assertEq(token.totalTierEscrow(), 0, "escrow fully released");
        assertEq(token.bandOutstanding(1), 0, "band id returned");
        assertEq(_ownerOrZero(T1_START), address(0), "band id unowned again");
    }

    /// @notice The freed band id is reissued LIFO — deterministic, O(1), no scanning.
    function test_mintDown_bandIdIsReusable() public {
        _seal();
        _fund(user1, 30);
        uint256[] memory ids = _ownedIdsOf(user1);

        vm.startPrank(user1);
        token.mintUp(1, ids[0]);
        token.mintUp(1, ids[1]);
        vm.stopPrank();
        assertEq(token.bandOutstanding(1), 2, "two outstanding");

        vm.prank(user1);
        token.mintDown(T1_START);
        assertEq(token.bandOutstanding(1), 1, "one outstanding");

        (bool ok,) = _mintUpAny(user1, 1);
        assertTrue(ok, "mint up again");
        assertEq(token.ownerOf(T1_START), user1, "the freed id is handed out again (LIFO)");
        assertEq(token.bandNextFree(0), T1_START + 2, "high-water cursor does not advance for a reuse");
    }

    function test_mintUp_higherTier() public {
        _seal();
        _fund(user1, 100);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];

        vm.prank(user1);
        token.mintUp(2, tierZeroId);

        assertEq(token.ownerOf(T2_START), user1, "tier-2 band id issued");
        assertEq(token.balanceOf(user1), UNIT, "one unit liquid");
        assertEq(token.coinBalanceOf(user1), 100 * UNIT, "true holdings unchanged");
        assertEq(token.totalTierEscrow(), 99 * UNIT, "escrow == 99 units");
    }

    /// @notice A band NFT is an ordinary DN404 NFT: it transfers, and its escrow follows the ID.
    function test_bandNftTransfersAndEscrowFollowsTheId() public {
        _seal();
        _fund(user1, 10);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];

        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        DN404Mirror mirror = DN404Mirror(payable(token.mirrorERC721()));
        vm.prank(user1);
        mirror.transferFrom(user1, user2, T1_START);

        assertEq(token.ownerOf(T1_START), user2, "band id moved");
        assertEq(token.coinBalanceOf(user2), 10 * UNIT, "escrow follows the id to the new holder");
        assertEq(token.coinBalanceOf(user1), 0, "old holder keeps nothing");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "escrow total unmoved by an ordinary transfer");

        // ...and the new holder can redeem it.
        vm.prank(user2);
        token.mintDown(T1_START);
        assertEq(token.balanceOf(user2), 10 * UNIT, "redeemed by the new holder");
        assertEq(token.totalTierEscrow(), 0, "escrow released");
    }

    // ┌─────────────────────────┐
    // │       Guard tests       │
    // └─────────────────────────┘
    // Every Ops-side revert reaches the caller as `TierOpFailed` (discard-returndata trampoline); the
    // specific error is named in the comment and visible in the trace.

    function test_mintUp_revertsBeforeSeal() public {
        _fund(user1, 10);
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector); // TiersNotConfigured
        token.mintUp(1, 1);
    }

    function test_mintDown_revertsBeforeSeal() public {
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector); // TiersNotConfigured
        token.mintDown(T1_START);
    }

    function test_mintUp_revertsOnUnknownTier() public {
        _seal();
        _fund(user1, 10);
        uint256 id = _ownedIdsOf(user1)[0];
        vm.startPrank(user1);
        vm.expectRevert(TierOpFailed.selector); // InvalidBand
        token.mintUp(0, id);
        vm.expectRevert(TierOpFailed.selector); // InvalidBand
        token.mintUp(3, id);
        vm.stopPrank();
    }

    function test_mintUp_revertsOnBandIdAsInput() public {
        _seal();
        _fund(user1, 20);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        token.mintUp(1, tierZeroId);
        // A band id is not tier-0 material: NotTierZeroId, before any state moves.
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector);
        token.mintUp(1, T1_START);
    }

    function test_mintUp_revertsWhenCallerDoesNotOwnTheId() public {
        _seal();
        _fund(user1, 10);
        _fund(user2, 10);
        uint256 othersId = _ownedIdsOf(user2)[0];
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector); // NotTierZeroId
        token.mintUp(1, othersId);
    }

    function test_mintUp_revertsWithoutEnoughBalance() public {
        _seal();
        _fund(user1, 5); // tier 1 needs 10 units of holdings
        uint256 id = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector); // DN404 InsufficientBalance on the escrow leg
        token.mintUp(1, id);
    }

    /// @notice The escrow leg burns the caller's NFTs LIFO off the TAIL of their owned array. An id
    ///         caught by that burn reverts the whole call — it never escrows against a dead id.
    function test_mintUp_revertsWhenTheChosenIdIsBurnedByTheEscrowLeg() public {
        _seal();
        _fund(user1, 10);
        uint256[] memory ids = _ownedIdsOf(user1);
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector); // NotTierZeroId, re-read after the escrow transfer
        token.mintUp(1, ids[9]); // the last-owned id: the 9-unit escrow burns exactly the tail nine
    }

    function test_mintDown_revertsOnOrdinaryId() public {
        _seal();
        _fund(user1, 10);
        uint256 id = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector); // NotBandId
        token.mintDown(id);
    }

    function test_mintDown_revertsForNonHolder() public {
        _seal();
        _fund(user1, 10);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        vm.prank(user2);
        vm.expectRevert(TierOpFailed.selector); // NotBandId (not the caller's)
        token.mintDown(T1_START);
    }

    function test_bandOutstanding_revertsOnUnknownTier() public {
        _seal();
        vm.expectRevert(InvalidBand.selector);
        token.bandOutstanding(3);
    }

    /// @notice `BandExhausted` is a defensive guard that a VALID ladder can never trip: sizing bands at
    ///         `S / w_N` means filling one consumes the entire coin supply. Proven here — the whole
    ///         supply concentrated at tier 2 fills its 10-id band exactly, and there is then neither an
    ///         id nor a coin left for an eleventh.
    function test_bandCannotBeExhaustedWhileSupplyBinds() public {
        _seal();
        _fund(user1, ID_LIMIT);

        for (uint256 i; i < 10; i++) {
            (bool ok,) = _mintUpAny(user1, 2);
            assertTrue(ok, "mint up to tier 2");
        }
        assertEq(token.bandOutstanding(2), 10, "band 2 exactly full");
        assertEq(token.bandNextFree(1), T2_END + 1, "cursor at the end of the band");
        assertEq(token.coinBalanceOf(user1), MAX_SUPPLY, "holder still owns the whole supply");
        assertEq(token.totalTierEscrow(), 10 * 99 * UNIT, "escrow == the whole supply minus the 10 NFT units");

        (bool more,) = _mintUpAny(user1, 2);
        assertFalse(more, "an eleventh tier-2 mint is impossible");
    }

    // ┌─────────────────────────────────────┐
    // │  Money invariants (the whole point) │
    // └─────────────────────────────────────┘

    /// @notice CURVE ISOLATION: no tier op may move `reserve` or `totalBondingSupply`. Fuzzed over a
    ///         sequence of mintUp/mintDown run against a live curve.
    /// forge-config: default.fuzz.runs = 16
    function test_fuzz_curveCountersAreUntouchedByTierOps(uint8 opBits) public {
        _seal();
        _activateBonding();

        vm.prank(user1);
        token.buyBonding{ value: 500 ether }(60 * UNIT, type(uint256).max, true, bytes(""), bytes(""), 0);

        uint256 reserveBefore = token.reserve();
        uint256 supplyBefore = token.totalBondingSupply();
        assertGt(reserveBefore, 0, "the curve actually took ETH");

        uint256[] memory live = new uint256[](8);
        uint256 liveCount;
        for (uint256 i; i < 8; i++) {
            if ((opBits >> i) & 1 == 1 || liveCount == 0) {
                (bool ok, uint256 bandId) = _mintUpAny(user1, 1);
                if (ok) live[liveCount++] = bandId;
            } else {
                uint256 id = live[--liveCount];
                vm.prank(user1);
                token.mintDown(id);
            }
            assertEq(token.reserve(), reserveBefore, "reserve moved on a tier op");
            assertEq(token.totalBondingSupply(), supplyBefore, "totalBondingSupply moved on a tier op");
        }
        assertEq(token.totalSupply(), MAX_SUPPLY, "total supply moved on a tier op");
    }

    /// @notice COIN CONSERVATION: Σ holders' `coinBalanceOf` + the instance's UNESCROWED balance is
    ///         always the constant total supply. Escrow is never created or destroyed, only moved.
    /// forge-config: default.fuzz.runs = 16
    function test_fuzz_coinIsConservedAcrossTierOps(uint8 opBits) public {
        _seal();
        _fund(user1, 300);
        _fund(user2, 150);
        _assertCoinConserved();

        uint256[] memory live = new uint256[](8);
        uint256 liveCount;
        for (uint256 i; i < 8; i++) {
            if ((opBits >> i) & 1 == 1 || liveCount == 0) {
                address who = (opBits >> ((i + 3) % 8)) & 1 == 1 ? user1 : user2;
                (bool ok, uint256 bandId) = _mintUpAny(who, 1);
                if (ok) live[liveCount++] = bandId;
            } else {
                uint256 id = live[--liveCount];
                vm.prank(token.ownerOf(id));
                token.mintDown(id);
            }
            _assertCoinConserved();
        }
    }

    function _assertCoinConserved() internal view {
        // T3 (noesis-143) split a third bucket out of the instance's balance: coin owed to a holder
        // whose band NFT was burned. It is zero in this suite (nothing here burns a band), but the sum
        // accounts for it so the invariant stays exact if a future T2-side change ever triggers one.
        uint256 instanceUnescrowed =
            token.balanceOf(address(token)) - token.totalTierEscrow() - token.totalPendingEscrowRelease();
        uint256 sum = token.coinBalanceOf(user1) + token.pendingEscrowRelease(user1) + token.coinBalanceOf(user2)
            + token.pendingEscrowRelease(user2) + instanceUnescrowed + token.balanceOf(address(liquidityDeployer));
        assertEq(sum, token.totalSupply(), "coin conservation broken");
    }

    /// @notice `totalTierEscrow` must always equal the escrow derivable from the outstanding band ids.
    function test_totalTierEscrowMatchesOutstandingBands() public {
        _seal();
        _fund(user1, 200);

        for (uint256 i; i < 2; i++) {
            (bool ok,) = _mintUpAny(user1, 1);
            assertTrue(ok, "tier 1 mint up");
        }
        (bool ok2,) = _mintUpAny(user1, 2);
        assertTrue(ok2, "tier 2 mint up");

        uint256 derived = token.bandOutstanding(1) * 9 * UNIT + token.bandOutstanding(2) * 99 * UNIT;
        assertEq(token.totalTierEscrow(), derived, "escrow counter vs derived escrow");

        vm.prank(user1);
        token.mintDown(T1_START + 1);
        derived = token.bandOutstanding(1) * 9 * UNIT + token.bandOutstanding(2) * 99 * UNIT;
        assertEq(token.totalTierEscrow(), derived, "escrow counter vs derived escrow after a redeem");
    }

    /// @notice Band ids are NEVER auto-emitted: take delivery of the ENTIRE supply and assert every
    ///         minted id sits in the ordinary space. DN404 bounds each issued id with
    ///         `_wrapNFTId(.., idLimit)`, `idLimit = totalSupply / unit` — fixed for this instance's life.
    function test_autoMintNeverEmitsABandId() public {
        _seal();
        _fund(user1, ID_LIMIT); // the whole supply, materialized as NFTs

        assertEq(token.balanceOf(user1), MAX_SUPPLY, "user holds the entire supply");
        uint256[] memory ids = _ownedIdsOf(user1);
        assertEq(ids.length, ID_LIMIT, "one NFT per unit");
        for (uint256 i; i < ids.length; i++) {
            assertLe(ids[i], ID_LIMIT, "an auto-minted id escaped into a band");
        }
        for (uint256 id = T1_START; id <= T2_END; id++) {
            assertEq(_ownerOrZero(id), address(0), "band id must be unowned");
        }
    }

    /// @notice Fact-3 regression: the DN404 defaults Token Tiers safety rests on. An ACTIVE burn pool
    ///         would recycle a burned band id back to an ordinary buyer (unescrowed); `_useExistsLookup`
    ///         false would change how free ids are found. If a future item overrides either, tier
    ///         safety must be re-argued — this test is the tripwire.
    function test_dn404PolicyDefaultsAreLoadBearing() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        TierPolicyProbe probe = new TierPolicyProbe(address(ops));
        TierOpsPolicyProbe opsProbe = new TierOpsPolicyProbe();

        assertFalse(probe.probeAddToBurnedPool(0, 0), "burn pool must stay INACTIVE");
        assertFalse(probe.probeAddToBurnedPool(type(uint96).max, type(uint96).max), "burn pool must stay INACTIVE");
        assertTrue(probe.probeUseExistsLookup(), "exists lookup must stay ON");
        // T3 (noesis-143) turned the after-transfer hook ON — it is what keeps a LIFO-burned band NFT
        // from stranding its escrow. Turning it back off silently re-opens that orphan.
        assertTrue(probe.probeUseAfterNFTTransfers(), "the burn-safety hook must stay ON (T3, noesis-143)");

        // Ops executes in the instance's storage — its policy hooks must agree with the instance's.
        assertEq(opsProbe.probeAddToBurnedPool(0, 0), probe.probeAddToBurnedPool(0, 0), "burn pool parity");
        assertEq(opsProbe.probeUseExistsLookup(), probe.probeUseExistsLookup(), "exists lookup parity");
        // The hook is an INTERNAL DN404 jump, so under delegatecall it is OPS's compiled body that runs.
        // A divergence here would mean the hook fires in one context and not the other — the exact
        // failure the shared-base placement exists to make impossible.
        assertEq(
            opsProbe.probeUseAfterNFTTransfers(),
            probe.probeUseAfterNFTTransfers(),
            "after-transfer hook parity across the delegatecall boundary"
        );
        assertEq(
            opsProbe.probeSkipNFTDefault(address(this)), probe.probeSkipNFTDefault(address(this)), "skipNFT parity"
        );
    }

    /// @notice Behavioral half of the burn-pool assertion: a burned id is re-issued by the ordinary
    ///         mint scan (a cycle), never dealt out of a pool that could also hold band ids.
    function test_burnedTierZeroIdIsReissuedByTheScan() public {
        _seal();
        _fund(user1, 5);
        uint256[] memory ids = _ownedIdsOf(user1);

        vm.prank(user1);
        token.transfer(user2, 2 * UNIT); // burns user1's two tail ids, mints two for user2

        assertEq(_ownedIdsOf(user1).length, 3, "user1 down to 3");
        uint256[] memory got = _ownedIdsOf(user2);
        assertEq(got.length, 2, "user2 up to 2");
        for (uint256 i; i < got.length; i++) {
            assertLe(got[i], ID_LIMIT, "re-issued ids stay in the ordinary space");
        }
        assertEq(got[0], ids[3], "the freed ids cycle straight back out");
    }

    /// @notice `withdrawDust` sweeps ETH above the tracked liabilities — it has no token leg at all, so
    ///         escrowed COIN is unreachable by it. Asserted behaviorally, not just by reading the code.
    function test_withdrawDustCannotSweepEscrow() public {
        _seal();
        _fund(user1, 10);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        uint256 instanceTokens = token.balanceOf(address(token));
        vm.deal(address(token), 1 ether); // pure surplus ETH
        vm.prank(owner);
        token.withdrawDust();

        assertEq(token.balanceOf(address(token)), instanceTokens, "withdrawDust moved COIN");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "escrow accounting untouched");
        vm.prank(user1);
        token.mintDown(T1_START);
        assertEq(token.balanceOf(user1), 10 * UNIT, "escrow still redeemable after a dust sweep");
    }

    /// @notice Graduation with outstanding band ids: `deployLiquidity` moves exactly `liquidityReserve`
    ///         (escrow never leaks into the LP leg) and the escrow stays redeemable afterwards.
    function test_graduationWithOutstandingBandsIsUnaffected() public {
        _seal();
        _activateBonding();

        vm.prank(user1);
        token.buyBonding{ value: 500 ether }(60 * UNIT, type(uint256).max, true, bytes(""), bytes(""), 0);
        (bool ok,) = _mintUpAny(user1, 1);
        assertTrue(ok, "mint up before graduating");

        uint256 escrowBefore = token.totalTierEscrow();
        assertEq(escrowBefore, 9 * UNIT, "escrow outstanding at graduation");

        vm.prank(owner);
        token.deployLiquidity(0);

        assertEq(liquidityDeployer.tokenReserveSeen(), token.liquidityReserve(), "LP leg must be exactly the reserve");
        assertEq(
            token.balanceOf(address(liquidityDeployer)), token.liquidityReserve(), "deployer holds exactly the reserve"
        );
        assertEq(token.totalTierEscrow(), escrowBefore, "escrow untouched by graduation");

        vm.prank(user1);
        token.mintDown(T1_START);
        assertEq(token.totalTierEscrow(), 0, "escrow redeemed after graduation");
        _assertCoinConserved();
    }

    /// @notice ERC20 `balanceOf` is deliberately NOT redefined: it stays the TRANSFERABLE amount, so
    ///         escrowed coin cannot be moved. `coinBalanceOf` is the aggregate view on top.
    function test_erc20BalanceOfStaysTheTransferableAmount() public {
        _seal();
        _fund(user1, 10);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        assertEq(token.balanceOf(user1), UNIT, "only the band NFT's own unit is liquid");
        assertEq(token.coinBalanceOf(user1), 10 * UNIT, "the aggregate view reports the truth");

        vm.prank(user1);
        vm.expectRevert(); // DN404 InsufficientBalance: escrowed coin is not transferable
        token.transfer(user2, 2 * UNIT);
    }

    /// @notice HAZARD, PINNED — an ERC20 transfer that drops the sender's balance can carry a band NFT
    ///         (and therefore `(w-1) * unit` of escrow) to the RECIPIENT, because DN404's
    ///         `_useDirectTransfersIfPossible` moves ids instead of burn+mint when the recipient takes
    ///         NFTs. Escrow stays conserved and redeemable — by the new owner. Sending one unit can
    ///         hand over ten units of value; the app must warn, and T3/T5 own the ergonomics.
    function test_HAZARD_erc20TransferCanCarryABandNftToTheRecipient() public {
        _seal();
        _fund(user1, 10);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        vm.prank(user1);
        token.transfer(user2, UNIT); // the last liquid unit — DN404 hands the band NFT over with it

        assertEq(token.ownerOf(T1_START), user2, "the band NFT followed the unit");
        assertEq(token.coinBalanceOf(user2), 10 * UNIT, "recipient received the escrow claim too");
        assertEq(token.coinBalanceOf(user1), 0, "sender parted with the whole denomination");
        assertEq(token.totalTierEscrow(), 9 * UNIT, "escrow conserved, not orphaned, on this path");
        _assertCoinConserved();

        vm.prank(user2);
        token.mintDown(T1_START); // still fully redeemable
        assertEq(token.balanceOf(user2), 10 * UNIT, "redeemed by the new owner");
    }

    /// @notice The T2 GAP, now CLOSED by T3 (noesis-143). When the balance-losing leg is not matched by
    ///         an NFT-taking recipient (recipient skips NFTs: a sell back to the curve, `stake`, or any
    ///         skipNFT holder), DN404 BURNS the band NFT to reconcile `ownedLength == balance / unit`.
    ///         Under T2 alone the escrow was then ORPHANED — still counted in `totalTierEscrow`, no
    ///         longer redeemable by anyone. The `_afterNFTTransfers` hook turns that burn into a credit.
    ///         Kept here, at the T2 site, so the gap can never silently REOPEN: the full behaviour is
    ///         exercised in `TierBurnSafety.t.sol`.
    function test_bandNftBurnedWhenRecipientSkipsNfts_releasesEscrow() public {
        _seal();
        _fund(user1, 10);
        uint256 tierZeroId = _ownedIdsOf(user1)[0];
        vm.prank(user1);
        token.mintUp(1, tierZeroId);

        vm.prank(user2);
        token.setSkipNFT(true); // recipient takes no NFTs => no direct transfer, the band NFT burns

        vm.prank(user1);
        token.transfer(user2, UNIT);

        assertEq(_ownerOrZero(T1_START), address(0), "the band NFT was burned by DN404 reconciliation");
        assertEq(token.totalTierEscrow(), 0, "escrow left the tier counter");
        assertEq(token.pendingEscrowRelease(user1), 9 * UNIT, "and became a claim for the burned holder");
        vm.prank(user1);
        vm.expectRevert(TierOpFailed.selector); // NotBandId — the id no longer exists
        token.mintDown(T1_START);

        vm.prank(user1);
        token.claimReleasedEscrow();
        assertEq(token.balanceOf(user1), 9 * UNIT, "the holder is made whole");
        _assertCoinConserved();
    }

    function test_coinBalanceOfIsPlainBalanceWithoutTiers() public {
        _fund(user1, 7);
        assertEq(token.coinBalanceOf(user1), 7 * UNIT, "no ladder sealed => plain balance");
    }
}
