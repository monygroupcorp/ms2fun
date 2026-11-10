// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ProtocolOwnedLiquidityV1 } from "../../../src/treasury/ProtocolOwnedLiquidityV1.sol";

import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";

import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { BalanceDelta, toBalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { LiquidityAmounts } from "../../../src/libraries/v4/LiquidityAmounts.sol";

/// @notice A V4 PoolManager stub shared by the graduation add and the POL deposit this test proves
///         lands. Unlike the simpler graduation mocks elsewhere, `extsload` packs BOTH the price and
///         the tick (via the real `TickMath`), because `LiquidityDeployerModule._fundProtocolOwnedLiquidity`
///         reads the live tick to pick its range, not just the price.
contract MockV4PoolManagerWithTick {
    bytes32 private _slot0;

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0;
    }

    function initialize(PoolKey calldata, uint160 sqrtPriceX96) external returns (int24 tick) {
        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        _slot0 = bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    /// @dev A full-range or single-sided add never moves the live price, matching real V4 behavior,
    ///      so this reads `_slot0` without writing it back.
    function modifyLiquidity(PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata p, bytes calldata)
        external
        view
        returns (BalanceDelta, BalanceDelta)
    {
        uint160 price = uint160(uint256(_slot0) & uint256(type(uint160).max));
        (uint256 amount0, uint256 amount1) = LiquidityAmounts.getAmountsForLiquidity(
            price,
            TickMath.getSqrtPriceAtTick(p.tickLower),
            TickMath.getSqrtPriceAtTick(p.tickUpper),
            uint128(uint256(p.liquidityDelta))
        );
        return
            (toBalanceDelta(-int128(int256(amount0)), -int128(int256(amount1))), toBalanceDelta(int128(0), int128(0)));
    }

    function sync(Currency) external { }

    function settle() external payable returns (uint256) {
        return msg.value;
    }

    function take(Currency currency, address to, uint256 amount) external {
        if (Currency.unwrap(currency) == address(0)) {
            (bool ok,) = payable(to).call{ value: amount }("");
            require(ok, "take: eth");
        } else {
            IERC20Like(Currency.unwrap(currency)).transfer(to, amount);
        }
    }

    receive() external payable { }
}

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title GraduationFundsProtocolOwnedLiquidityTest
 * @notice Closes the gap this goal exists to close: nothing in `src/` ever called
 *         `ProtocolOwnedLiquidityV1.receivePOL`. `LiquidityDeployerModule._fundProtocolOwnedLiquidity`
 *         now does, from the graduation's own protocol-fee leg, once the owner has pointed
 *         `protocolOwnedLiquidity` at a deployed POL contract and that contract's `approvedDeployer`
 *         back at the module. Both knobs default off, so a graduation with neither set is byte-for-byte
 *         what it was before this goal.
 *
 *         This rig runs the REAL `ERC404BondingInstance` through a REAL graduation against the REAL
 *         `LiquidityDeployerModule` and the REAL `ProtocolOwnedLiquidityV1` (behind its real UUPS
 *         proxy) — only the V4 `PoolManager` underneath is a stub. The call is proven to land by the
 *         POL contract's own post-state: a stored position keyed to the graduating instance, and the
 *         fee no longer reaching the treasury.
 */
contract GraduationFundsProtocolOwnedLiquidityTest is Test {
    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal treasury = address(0x7EA);
    address internal weth = address(0xBEEF);

    uint256 internal constant NFT_COUNT = 1000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant TARGET_ETH = 10 ether;
    uint256 internal constant PROD_BPS = 1000;

    ERC404BondingInstance internal instance;
    LiquidityDeployerModule internal deployer;
    ProtocolOwnedLiquidityV1 internal pol;
    MockMasterRegistry internal registry;
    MockVault internal vault;
    MockV4PoolManagerWithTick internal poolManager;

    function _rig(uint16 polFeeBps) internal {
        registry = new MockMasterRegistry();
        vault = new MockVault();
        poolManager = new MockV4PoolManagerWithTick();
        deployer = new LiquidityDeployerModule(address(poolManager), weth, 3000, 60, address(registry));

        ProtocolOwnedLiquidityV1 polImpl = new ProtocolOwnedLiquidityV1();
        bytes memory initData = abi.encodeWithSelector(ProtocolOwnedLiquidityV1.initialize.selector, owner);
        pol = ProtocolOwnedLiquidityV1(payable(address(new ERC1967Proxy(address(polImpl), initData))));

        vm.startPrank(owner);
        pol.setV4PoolManager(address(poolManager));
        pol.setWETH(weth);
        pol.setMasterRegistry(address(registry));
        pol.setApprovedDeployer(address(deployer));
        vm.stopPrank();

        // `deployer`'s owner is this test contract (it was `new`-ed above, outside any prank), not
        // `owner` — matching the existing `LiquidityDeployerModule` rig convention in this suite.
        deployer.setProtocolOwnedLiquidity(address(pol));
        deployer.setPolFeeBps(polFeeBps);

        CurveParamsComputer curveComputer = new CurveParamsComputer(address(this));
        BondingCurveMath.Params memory curve = curveComputer.computeCurveParams(NFT_COUNT, TARGET_ETH, 1, PROD_BPS);

        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        DN404Mirror mirror = new DN404Mirror(owner);
        instance.initialize(
            owner,
            address(vault),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: PROD_BPS,
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
                weth: weth
            })
        );
        instance.initializeMetadata("POL Wiring", "POLW", "", "", "");
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    function _buyPercent(uint256 pct) internal {
        uint256 amount = ((MAX_SUPPLY - instance.liquidityReserve()) * pct) / 100;
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(amount, type(uint256).max, false, bytes(""), bytes(""), 0);
        vm.stopPrank();
    }

    function _graduate() internal returns (Vm.Log[] memory logs) {
        vm.recordLogs();
        vm.prank(owner);
        instance.deployLiquidity(0);
        logs = vm.getRecordedLogs();
    }

    function _fundedEvent(Vm.Log[] memory logs)
        internal
        view
        returns (bool seen, address fundedInstance, uint256 ethAmount)
    {
        bytes32 sig = keccak256("ProtocolOwnedLiquidityFunded(address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(deployer) && logs[i].topics[0] == sig) {
                fundedInstance = address(uint160(uint256(logs[i].topics[1])));
                ethAmount = abi.decode(logs[i].data, (uint256));
                seen = true;
            }
        }
    }

    /// @notice THE CALL LANDS. A registered instance's own graduation (through the shared singleton
    ///         deployer module, acting as `approvedDeployer`) makes `ProtocolOwnedLiquidityV1.receivePOL`
    ///         execute and store a real, non-zero liquidity position keyed to that instance — not to
    ///         the deployer module that was `msg.sender` inside the call.
    function test_graduation_fundsProtocolOwnedLiquidity() public {
        _rig(10_000); // the whole protocol fee leg, to make the treasury-got-nothing assertion crisp
        _buyPercent(100);

        assertEq(pol.polInstanceCount(), 0, "no POL position before graduation");
        uint256 treasuryBefore = treasury.balance;

        Vm.Log[] memory logs = _graduate();

        (bool seen, address fundedInstance, uint256 ethAmount) = _fundedEvent(logs);
        assertTrue(seen, "ProtocolOwnedLiquidityFunded must be emitted");
        assertEq(fundedInstance, address(instance), "funded event names the graduating instance");
        assertGt(ethAmount, 0, "a real amount was funded");

        assertEq(pol.polInstanceCount(), 1, "POL now holds exactly one position");
        assertEq(pol.polInstances(0), address(instance), "position is keyed to the instance, not the deployer module");

        (,,, uint128 liquidity) = pol.getPolPosition(address(instance));
        assertGt(liquidity, 0, "the deployed position carries real liquidity");

        // With the whole fee leg diverted, the treasury's fee income from this graduation is zero.
        assertEq(treasury.balance, treasuryBefore, "treasury received none of the fee leg");

        // The position is real, non-stranded capital: the pool manager (standing in for the venue)
        // now holds the ETH leg, and POL itself holds no loose balance.
        assertEq(address(pol).balance, 0, "no loose ETH left in POL");
        assertGt(address(poolManager).balance, 0, "the ETH leg actually reached the venue");
    }

    /// @notice Off by default: with neither knob set, the protocol fee leg goes to the treasury
    ///         exactly as it always has, and `receivePOL` is never called.
    function test_graduation_doesNothingWhenPolFeeBpsIsZero() public {
        _rig(0);
        _buyPercent(100);

        uint256 treasuryBefore = treasury.balance;
        Vm.Log[] memory logs = _graduate();

        (bool seen,,) = _fundedEvent(logs);
        assertFalse(seen, "no ProtocolOwnedLiquidityFunded when polFeeBps is 0");
        assertEq(pol.polInstanceCount(), 0, "no POL position created");
        assertGt(treasury.balance, treasuryBefore, "the fee leg still reaches the treasury unchanged");
    }

    /// @notice A partial bps diverts only that slice; the rest still reaches the treasury.
    function test_graduation_partialPolFeeBpsSplitsTheFeeLeg() public {
        _rig(4_000); // 40% of the protocol fee leg
        _buyPercent(100);

        uint256 treasuryBefore = treasury.balance;
        Vm.Log[] memory logs = _graduate();

        (bool seen,, uint256 ethAmount) = _fundedEvent(logs);
        assertTrue(seen, "ProtocolOwnedLiquidityFunded must be emitted");
        assertGt(ethAmount, 0, "a real amount was funded");
        assertGt(treasury.balance, treasuryBefore, "the remaining 60% still reaches the treasury");

        (,,, uint128 liquidity) = pol.getPolPosition(address(instance));
        assertGt(liquidity, 0, "the deployed position carries real liquidity");
    }
}
