// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta, toBalanceDelta } from "v4-core/types/BalanceDelta.sol";

import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";

/// @dev Minimal V4 PoolManager: enough of the surface for one full graduation add — `extsload` for
///      `StateLibrary.getSlot0`, `initialize`, `unlock` (re-entering the caller's `unlockCallback`),
///      `modifyLiquidity` returning a caller-configured debt, and the `sync`/`settle`/`take` triple the
///      deployer settles through. The real add-liquidity math is fork-tested elsewhere; what this stands
///      in for is the leg that matters here — the graduated coin actually landing on the pool.
contract MockV4PoolManager {
    bytes32 private _slot0;
    int128 public owed0;
    int128 public owed1;

    function setOwed(int128 a0, int128 a1) external {
        owed0 = a0;
        owed1 = a1;
    }

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0;
    }

    function initialize(PoolKey calldata, uint160 sqrtPriceX96) external returns (int24) {
        _slot0 = bytes32(uint256(sqrtPriceX96));
        return 0;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function modifyLiquidity(PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        returns (BalanceDelta, BalanceDelta)
    {
        // Negative = the adder owes the pool; this is the settle path that moves the coin.
        return (toBalanceDelta(-owed0, -owed1), toBalanceDelta(int128(0), int128(0)));
    }

    function sync(Currency) external { }

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency, address, uint256) external { }

    receive() external payable { }
}

/**
 * @title ERC404GraduationSkipNFTTest
 * @notice Graduation moves the whole `liquidityReserve` through two contracts — the deployer module and
 *         the venue's pool. This instance's `_skipNFTDefault` override returns `false` for every address,
 *         so an unflagged recipient (contract or not) takes delivery of one NFT id per `unit`, and the
 *         reserve's worth of ids was therefore minted to the module, burned again on the settle leg, and
 *         minted a second time to the pool. The cost of that round trip scales with the collection size,
 *         so past a few thousand ids graduation no longer fits in a block.
 *
 *         The guard: a graduation carrying 20,000 ids' worth of reserve, asserted to complete inside a
 *         stated gas bound, with neither counterparty holding an id afterwards — while the pool's coin
 *         balance proves the reserve really arrived. Reverting the fix restores the round trip and the
 *         gas bound fails.
 */
contract ERC404GraduationSkipNFTTest is Test {
    ERC404BondingInstance internal instance;
    DN404Mirror internal mirror;
    LiquidityDeployerModule internal deployer;
    MockV4PoolManager internal poolManager;
    MockMasterRegistry internal registry;
    MockVault internal vault;
    CurveParamsComputer internal curveComputer;

    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal treasury = address(0x7EA);

    /// @dev 100,000 ids at 1e18 per id, 20% reserved for liquidity → 20,000 ids' worth of reserve.
    ///      The earlier behavior round-tripped an NFT per reserved unit; at ~17.75k gas apiece that is
    ///      an order of magnitude past a 30M block, so this size was simply not graduatable.
    uint256 internal constant NFT_COUNT = 100_000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant LIQUIDITY_RESERVE_BPS = 2000;
    uint256 internal constant RESERVED_IDS = (NFT_COUNT * LIQUIDITY_RESERVE_BPS) / 10000; // 20,000

    /// @dev Ceiling for the whole graduation call. Comfortably above the settled cost of a
    ///      no-NFT-work graduation and far below what a single reserved id's round trip would add
    ///      twenty thousand times over.
    uint256 internal constant GRADUATION_GAS_BOUND = 3_000_000;

    function setUp() public {
        registry = new MockMasterRegistry();
        vault = new MockVault();
        poolManager = new MockV4PoolManager();
        deployer = new LiquidityDeployerModule(address(poolManager), address(0xBEEF), 3000, 60, address(registry));
        curveComputer = new CurveParamsComputer(address(this));

        BondingCurveMath.Params memory curve =
            curveComputer.computeCurveParams(NFT_COUNT, 10 ether, 1, LIQUIDITY_RESERVE_BPS);

        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        mirror = new DN404Mirror(owner);

        instance.initialize(
            owner,
            address(vault),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
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
                protocolTreasury: treasury,
                masterRegistry: address(registry),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        instance.initializeMetadata("Graduation Gas", "GRAD", "", "", "");
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);

        assertEq(instance.liquidityReserve(), RESERVED_IDS * UNIT, "reserve sizing");
    }

    /// @dev SELL THE WHOLE CURVE. Graduation's coin side is derived from the price the curve actually
    ///      reached (noesis-188), so the reserved-id count this file is about is only in play at a full
    ///      sale — where the derived side reproduces `liquidityReserve`, i.e. the 20,000 ids' worth
    ///      measured here. The buyer flags itself NFT-skipping first: its own 80,000 ids are not the
    ///      subject, the graduation counterparties' are.
    function _seedReserve() internal {
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(
            MAX_SUPPLY - instance.liquidityReserve(), type(uint256).max, false, bytes(""), bytes(""), 0
        );
        vm.stopPrank();
        assertGt(instance.reserve(), 0, "the curve took ETH");
    }

    /// @dev The coin side graduation will settle, recomputed here from the stored curve parameters
    ///      rather than taken from the contract under test: `tokensForPool = ethForPool / p(S)`,
    ///      capped by the coin the instance still holds.
    function _poolCoinSide() internal view returns (uint256) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = instance.curveParams();
        uint256 sWad = instance.totalBondingSupply() / normalizationFactor;
        uint256 raise = instance.reserve();
        uint256 ethForPool = raise - raise / 100 - (raise * 19) / 100;
        uint256 want = FixedPointMathLib.fullMulDiv(ethForPool, (poleWad - sWad) * normalizationFactor, kCoeff);
        uint256 available = instance.balanceOf(address(instance));
        return want > available ? available : want;
    }

    /// @dev The mock pool reports the debt the real one would on the coin leg. The ETH leg is left at
    ///      zero — this file measures the id traffic the coin leg generates, not the ETH settlement.
    function _armPool() internal {
        // ETH is currency0 (address(0) sorts below any token), so the coin is currency1.
        poolManager.setOwed(int128(0), int128(int256(_poolCoinSide())));
    }

    function test_graduation_isGasBoundedAtALargeCollection() public {
        _seedReserve();
        _armPool();

        vm.prank(owner);
        uint256 before = gasleft();
        instance.deployLiquidity(0);
        uint256 spent = before - gasleft();

        assertTrue(instance.graduated(), "graduation completed");
        assertLt(spent, GRADUATION_GAS_BOUND, "graduation gas scaled with the reserved id count");
    }

    function test_graduation_mintsNoIdsToItsCounterparties() public {
        _seedReserve();
        _armPool();

        vm.prank(owner);
        instance.deployLiquidity(0);

        // The coin really did travel instance → module → pool. Without this the id assertions below
        // would hold trivially. At a full sale the derived coin side is the create-time reserve to
        // within a basis point — the pole is solved at create so the curve's end price IS the pool's.
        uint256 delivered = instance.balanceOf(address(poolManager));
        assertGt(delivered, 0, "the pool holds no coin");
        assertApproxEqRel(delivered, RESERVED_IDS * UNIT, 1e14, "the pool holds the reserve");
        assertEq(instance.balanceOf(address(deployer)), 0, "the module passed the reserve on");

        assertEq(mirror.balanceOf(address(deployer)), 0, "the deployer module holds no id");
        assertEq(mirror.balanceOf(address(poolManager)), 0, "the pool holds no id");
        assertTrue(instance.getSkipNFT(address(deployer)), "the module is flagged NFT-skipping");
        assertTrue(instance.getSkipNFT(address(poolManager)), "the pool is flagged NFT-skipping");
    }

    /// @dev The flag is set permanently, not saved and restored: the pool keeps receiving coin for the
    ///      life of the market, and a restored `false` would re-mint the reserve's worth of ids into it
    ///      on the sell side of the very next swap.
    function test_poolStaysNFTSkippingAfterGraduation() public {
        _seedReserve();
        _armPool();

        vm.prank(owner);
        instance.deployLiquidity(0);

        // A later credit to the pool — the shape of a swap paying coin back in — mints nothing.
        vm.prank(buyer);
        instance.transfer(address(poolManager), UNIT);
        assertEq(mirror.balanceOf(address(poolManager)), 0, "a post-graduation credit minted ids to the pool");
    }
}
