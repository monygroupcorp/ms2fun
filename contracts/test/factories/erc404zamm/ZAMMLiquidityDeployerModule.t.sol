// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ZAMMLiquidityDeployerModule} from "../../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import {ILiquidityDeployerModule} from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import {MockZAMM} from "../../mocks/MockZAMM.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockVault} from "../../mocks/MockVault.sol";
import {MockMasterRegistry} from "../../mocks/MockMasterRegistry.sol";

contract ZAMMLiquidityDeployerModuleTest is Test {
    ZAMMLiquidityDeployerModule module;
    MockZAMM zamm;
    MockERC20 token;
    MockVault vault;
    MockMasterRegistry registry;

    address treasury = address(0xBEEF);
    // The graduating instance is the caller (msg.sender) — the strict guard requires
    // msg.sender == p.instance && registered. This test contract stands in for that instance.
    address instance;

    function setUp() public {
        zamm = new MockZAMM();
        token = new MockERC20("Test", "TST");
        vault = new MockVault();
        registry = new MockMasterRegistry();
        module = new ZAMMLiquidityDeployerModule(address(zamm), 30, address(registry));
        instance = address(this);
    }

    function test_deployLiquidity_basicFlow() public {
        uint256 ethReserve = 10 ether;
        uint256 tokenReserve = 1000 ether;

        // Mint tokens to module (simulates instance transferring them before calling)
        token.mint(address(module), tokenReserve);

        ILiquidityDeployerModule.DeployParams memory p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ethReserve,
            tokenReserve: tokenReserve,
            protocolTreasury: treasury,
            vault: address(vault),
            token: address(token),
            instance: instance,
            creator: address(0),
            carveEth: 0
        });

        vm.deal(address(this), ethReserve);
        module.deployLiquidity{value: ethReserve}(p);

        // feeOrHook is now an immutable on the module
        assertEq(module.feeOrHook(), 30);

        // Fixed 1/19/80 split
        uint256 expectedProtocolFee = ethReserve / 100;
        uint256 expectedVaultCut    = (ethReserve * 19) / 100;
        assertEq(treasury.balance, expectedProtocolFee, "Protocol should receive 1%");
        assertEq(address(vault).balance, expectedVaultCut, "Vault should receive 19%");
    }

    function test_deployLiquidity_revertsOnETHMismatch() public {
        token.mint(address(module), 1000 ether);
        ILiquidityDeployerModule.DeployParams memory p = ILiquidityDeployerModule.DeployParams({
            ethReserve: 10 ether,
            tokenReserve: 1000 ether,
            protocolTreasury: treasury,
            vault: address(vault),
            token: address(token),
            instance: instance,
            creator: address(0),
            carveEth: 0
        });

        vm.deal(address(this), 5 ether);
        vm.expectRevert();
        module.deployLiquidity{value: 5 ether}(p);
    }

    // ── Creator carve ─────────────────────────────────────────────────────────

    function _carveParams(uint256 ethReserve, address creator, uint256 carveEth)
        internal
        view
        returns (ILiquidityDeployerModule.DeployParams memory p)
    {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ethReserve,
            tokenReserve: 1000 ether,
            protocolTreasury: treasury,
            vault: address(vault),
            token: address(token),
            instance: instance,
            creator: creator,
            carveEth: carveEth
        });
    }

    /// @notice Tithed carve deltas: creator 80% of carve; vault 19% raise + 19% carve; protocol
    ///         1% raise + 1% carve; the pool loses exactly the carve.
    function test_deployLiquidity_carve_paysCreatorVaultProtocol() public {
        address creator = makeAddr("creator");
        uint256 ethReserve = 10 ether;
        uint256 carve = 1 ether;
        token.mint(address(module), 1000 ether);

        vm.expectEmit(true, true, false, true);
        emit ZAMMLiquidityDeployerModule.CreatorCarvePaid(instance, creator, carve, carve);

        vm.deal(address(this), ethReserve);
        module.deployLiquidity{value: ethReserve}(_carveParams(ethReserve, creator, carve));

        assertEq(treasury.balance, 0.1 ether + 0.01 ether, "protocol = 1% raise + 1% carve");
        assertEq(address(vault).balance, 1.9 ether + 0.19 ether, "vault = 19% raise + 19% carve");
        assertEq(creator.balance, 0.8 ether, "creator = 80% of carve");
        // Pool ETH = LP80 - carve = 8 - 1 = 7 (held by MockZAMM after addLiquidity).
        assertEq(address(zamm).balance, 7 ether, "pool loses exactly the carve");
    }

    /// @notice A carve that would consume the whole LP share leaves nothing for the pool — the
    ///         NoETHForPool guard semantics are retained.
    function test_deployLiquidity_carve_wholeLpShareRevertsNoETHForPool() public {
        address creator = makeAddr("creator");
        token.mint(address(module), 1000 ether);
        vm.deal(address(this), 10 ether);
        vm.expectRevert(ZAMMLiquidityDeployerModule.NoETHForPool.selector);
        module.deployLiquidity{value: 10 ether}(_carveParams(10 ether, creator, 100 ether));
    }

    /// @notice creator == address(0) defensively zeroes the carve (everything to the pool).
    function test_deployLiquidity_carve_zeroCreatorZeroesCarve() public {
        token.mint(address(module), 1000 ether);
        vm.deal(address(this), 10 ether);
        module.deployLiquidity{value: 10 ether}(_carveParams(10 ether, address(0), 1 ether));

        assertEq(treasury.balance, 0.1 ether, "protocol = plain 1%");
        assertEq(address(vault).balance, 1.9 ether, "vault = plain 19%");
        assertEq(address(zamm).balance, 8 ether, "full LP80 reaches the pool");
    }

    // ── Caller guard (strict, registry-checked) ───────────────────────────────

    /// @notice An unregistered caller acting as its own instance reverts: the registry check fails.
    function test_deployLiquidity_revertsForUnregisteredInstance() public {
        registry.setRegisteredInstance(address(this), false);
        token.mint(address(module), 1000 ether);
        vm.deal(address(this), 10 ether);
        ILiquidityDeployerModule.DeployParams memory p = _carveParams(10 ether, address(0), 0);
        p.instance = address(this);
        vm.expectRevert(ZAMMLiquidityDeployerModule.UnauthorizedCaller.selector);
        module.deployLiquidity{value: 10 ether}(p);
    }

    /// @notice A caller passing a crafted p.instance it does not control reverts (no impersonation).
    function test_deployLiquidity_revertsWhenSenderNotInstance() public {
        token.mint(address(module), 1000 ether);
        vm.deal(address(this), 10 ether);
        ILiquidityDeployerModule.DeployParams memory p = _carveParams(10 ether, address(0), 0);
        p.instance = makeAddr("victimInstance"); // registered per mock default, but != msg.sender
        vm.expectRevert(ZAMMLiquidityDeployerModule.UnauthorizedCaller.selector);
        module.deployLiquidity{value: 10 ether}(p);
    }
}
