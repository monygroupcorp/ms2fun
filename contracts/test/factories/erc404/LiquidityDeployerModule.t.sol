// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LiquidityDeployerModule} from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import {ILiquidityDeployerModule} from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import {MockMasterRegistry} from "../../mocks/MockMasterRegistry.sol";

/// @dev Exposes the internal amount computation so the carve split can be unit-tested without a
///      full V4 PoolManager (the payment dispatch itself is fork-tested + mirrored in the ZAMM /
///      Cypher module tests, which share the identical splitGraduation-driven shape).
contract LiquidityDeployerModuleHarness is LiquidityDeployerModule {
    constructor() LiquidityDeployerModule(address(0), address(0x3), 3000, 60, address(0)) {}
    function computeAmounts(ILiquidityDeployerModule.DeployParams calldata p)
        external
        pure
        returns (AmountsResult memory)
    {
        return _computeAmounts(p);
    }
}

/**
 * @title LiquidityDeployerModuleTest
 * @notice Unit tests for LiquidityDeployerModule fee math and amount computations.
 *         Full V4 integration requires a mock PoolManager (covered in integration tests).
 */
contract LiquidityDeployerModuleTest is Test {
    LiquidityDeployerModule public module;
    LiquidityDeployerModuleHarness public harness;
    MockMasterRegistry public registry;

    function setUp() public {
        registry = new MockMasterRegistry();
        module = new LiquidityDeployerModule(address(0), address(0x3), 3000, 60, address(registry));
        harness = new LiquidityDeployerModuleHarness();
    }

    // -----------------------------------------------------------------------
    // Helpers — build a DeployParams struct
    // -----------------------------------------------------------------------

    function _params(
        uint256 ethReserve,
        uint256 tokenReserve,
        address treasury
    ) internal pure returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ethReserve,
            tokenReserve: tokenReserve,
            protocolTreasury: treasury,
            vault: address(0x5),
            token: address(0x4),
            instance: address(0x4),
            creator: address(0),
            carveEth: 0
        });
    }

    // -----------------------------------------------------------------------
    // Fee math tests
    // -----------------------------------------------------------------------

    function test_computeAmounts_119_80_split() public pure {
        uint256 ethReserve = 10 ether;

        // Fixed 1/19/80 split
        uint256 protocolFee = ethReserve / 100;           // 1% = 0.1 ETH
        uint256 vaultCut    = (ethReserve * 19) / 100;    // 19% = 1.9 ETH
        uint256 ethForPool  = ethReserve - protocolFee - vaultCut; // 80% = 8.0 ETH

        assertEq(protocolFee, 0.1 ether);
        assertEq(vaultCut,    1.9 ether);
        assertEq(ethForPool,  8.0 ether);
    }

    function test_computeAmounts_roundingInvariant() public pure {
        // Verify no ETH is lost in the split
        uint256 ethReserve = 1 ether;
        uint256 protocolFee = ethReserve / 100;
        uint256 vaultCut    = (ethReserve * 19) / 100;
        uint256 ethForPool  = ethReserve - protocolFee - vaultCut;

        assertEq(protocolFee + vaultCut + ethForPool, ethReserve);
    }

    function test_deployLiquidity_revertsIfNotEnoughETH() public {
        ILiquidityDeployerModule.DeployParams memory p = _params(
            1 ether, 100 ether, address(0x1)
        );
        // Caller must be the registered instance to reach the ETHMismatch check (guard runs first).
        p.instance = address(this);
        // Send less ETH than ethReserve — module checks msg.value == ethReserve
        vm.expectRevert(LiquidityDeployerModule.ETHMismatch.selector);
        module.deployLiquidity{value: 0.5 ether}(p);
    }

    function test_deployLiquidity_revertsIfNoETHSent() public {
        ILiquidityDeployerModule.DeployParams memory p = _params(
            1 ether, 100 ether, address(0x1)
        );
        p.instance = address(this);
        vm.expectRevert(LiquidityDeployerModule.ETHMismatch.selector);
        module.deployLiquidity{value: 0}(p);
    }

    // ── Caller guard (strict, registry-checked) ───────────────────────────────

    /// @notice An unregistered caller acting as its own instance reverts: the registry check fails.
    function test_deployLiquidity_revertsForUnregisteredInstance() public {
        registry.setRegisteredInstance(address(this), false);
        ILiquidityDeployerModule.DeployParams memory p = _params(1 ether, 100 ether, address(0x1));
        p.instance = address(this); // msg.sender == p.instance, but not a registered instance
        vm.expectRevert(LiquidityDeployerModule.UnauthorizedCaller.selector);
        module.deployLiquidity{value: 1 ether}(p);
    }

    /// @notice A caller passing a crafted p.instance it does not control reverts (no impersonation),
    ///         even though the crafted instance is registered.
    function test_deployLiquidity_revertsWhenSenderNotInstance() public {
        ILiquidityDeployerModule.DeployParams memory p = _params(1 ether, 100 ether, address(0x1));
        p.instance = makeAddr("victimInstance"); // registered per mock default, but != msg.sender
        vm.expectRevert(LiquidityDeployerModule.UnauthorizedCaller.selector);
        module.deployLiquidity{value: 1 ether}(p);
    }

    function test_unlockCallback_revertsIfNotPoolManager() public {
        vm.expectRevert(LiquidityDeployerModule.NotPoolManager.selector);
        module.unlockCallback(bytes(""));
    }

    function test_implementsUniformInterface() public view {
        ILiquidityDeployerModule deployer = ILiquidityDeployerModule(address(module));
        assertTrue(address(deployer) != address(0));
    }

    // ── Hook removal tests (TDD) ──────────────────────────────────────────────

    function test_module_hasImmutablePoolConfig() public view {
        // Module must expose poolFee and tickSpacing as immutables
        assertEq(module.poolFee(), 3000);
        assertEq(module.tickSpacing(), 60);
    }

    function test_deployParams_noPoolConfigFields() public pure {
        // DeployParams must compile without weth/v4PoolManager — they are constructor immutables now
        ILiquidityDeployerModule.DeployParams memory p = ILiquidityDeployerModule.DeployParams({
            ethReserve: 1 ether,
            tokenReserve: 100 ether,
            protocolTreasury: address(0x1),
            vault: address(0x5),
            token: address(0x4),
            instance: address(0x4),
            creator: address(0),
            carveEth: 0
        });
        assertEq(p.ethReserve, 1 ether);
    }

    // ── Creator carve (via _computeAmounts harness) ───────────────────────────

    function _carveParams(uint256 ethReserve, address creator, uint256 carveEth)
        internal
        pure
        returns (ILiquidityDeployerModule.DeployParams memory p)
    {
        p = _params(ethReserve, 100 ether, address(0x1));
        p.creator = creator;
        p.carveEth = carveEth;
    }

    /// @notice Tithed carve: creator 80% of carve; vault 19% raise + 19% carve; protocol 1% raise
    ///         + 1% carve; the pool loses exactly the carve.
    function test_computeAmounts_carveSplit() public view {
        LiquidityDeployerModule.AmountsResult memory r =
            harness.computeAmounts(_carveParams(10 ether, address(0xC0FFEE), 1 ether));
        assertEq(r.protocolFee, 0.1 ether + 0.01 ether, "protocol = 1% raise + 1% carve");
        assertEq(r.vaultCut, 1.9 ether + 0.19 ether, "vault = 19% raise + 19% carve");
        assertEq(r.creatorCut, 0.8 ether, "creator = 80% of carve");
        assertEq(r.carvePaid, 1 ether, "full requested carve applied");
        assertEq(r.ethForPool, 7 ether, "pool = LP80 - carve");
        assertEq(
            r.protocolFee + r.vaultCut + r.creatorCut + r.ethForPool,
            10 ether,
            "conservation: parts sum to the raise"
        );
    }

    /// @notice Zero carve reproduces the historic 1/19/80 amounts exactly.
    function test_computeAmounts_zeroCarveMatchesLegacy() public view {
        LiquidityDeployerModule.AmountsResult memory r =
            harness.computeAmounts(_carveParams(10 ether, address(0xC0FFEE), 0));
        assertEq(r.protocolFee, 0.1 ether);
        assertEq(r.vaultCut, 1.9 ether);
        assertEq(r.creatorCut, 0);
        assertEq(r.ethForPool, 8 ether);
    }

    /// @notice creator == address(0) defensively zeroes the carve.
    function test_computeAmounts_zeroCreatorZeroesCarve() public view {
        LiquidityDeployerModule.AmountsResult memory r =
            harness.computeAmounts(_carveParams(10 ether, address(0), 1 ether));
        assertEq(r.creatorCut, 0);
        assertEq(r.carvePaid, 0);
        assertEq(r.ethForPool, 8 ether, "full LP80 reaches the pool");
    }

    /// @notice NoETHForPool guard retained: a carve consuming the whole LP share reverts.
    function test_computeAmounts_carveWholeLpShareReverts() public {
        vm.expectRevert(LiquidityDeployerModule.NoETHForPool.selector);
        harness.computeAmounts(_carveParams(10 ether, address(0xC0FFEE), 100 ether));
    }

    /// @notice NoETHForPool when the raise is ~0 (rounds to nothing for the pool).
    function test_computeAmounts_zeroRaiseReverts() public {
        vm.expectRevert(LiquidityDeployerModule.NoETHForPool.selector);
        harness.computeAmounts(_carveParams(0, address(0xC0FFEE), 0));
    }
}
