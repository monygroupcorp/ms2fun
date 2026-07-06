// test/factories/erc404cypher/CypherLiquidityDeployerModule.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Test.sol";
import "../../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import {ILiquidityDeployerModule} from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import "../../../src/vaults/cypher/CypherAlignmentVault.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockWETH} from "../../mocks/MockWETH.sol";
import {MockAlgebraFactory, MockAlgebraPositionManager, MockAlgebraSwapRouter} from "../../mocks/MockCypherAlgebra.sol";

contract CypherLiquidityDeployerModuleTest is Test {
    CypherLiquidityDeployerModule deployer;
    CypherAlignmentVault vault;
    MockAlgebraFactory algebraFactory;
    MockAlgebraPositionManager positionManager;
    MockAlgebraSwapRouter swapRouter;
    MockERC20 token;
    MockWETH weth;

    address protocolTreasury = makeAddr("treasury");
    address instance = makeAddr("instance");

    function setUp() public {
        algebraFactory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        token = new MockERC20("Token", "TKN");
        weth = new MockWETH();

        deployer = new CypherLiquidityDeployerModule(
            address(algebraFactory), address(positionManager), address(weth)
        );

        CypherAlignmentVault impl = new CypherAlignmentVault();
        vault = CypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(positionManager), address(swapRouter), address(weth),
            address(token), protocolTreasury,
            address(deployer),  // liquidityDeployer = this module
            address(0)          // priceValidator inert
        );
    }

    function test_deployLiquidity_createsPoolAndMintsLP() public {
        uint256 ethReserve = 1 ether;
        uint256 tokenReserve = 1000e18;

        // Mint tokens to deployer module (simulating transfer from bonding instance)
        token.mint(address(deployer), tokenReserve);

        vm.deal(address(this), ethReserve);
        deployer.deployLiquidity{value: ethReserve}(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
            creator: address(0),
            carveEth: 0
            })
        );

        uint256 tokenId = vault.lpTokenId();
        address pool = vault.lpPool();
        assertGt(tokenId, 0);
        assertNotEq(pool, address(0));
        // instance is registered with ethToLP as contribution (ethReserve minus fees)
        assertGt(vault.benefactorContribution(instance), 0);
    }

    function test_implementsUniformInterface() public view {
        ILiquidityDeployerModule d = ILiquidityDeployerModule(address(deployer));
        assertTrue(address(d) != address(0));
    }

    function test_deployLiquidity_pays119_80_split() public {
        token.mint(address(deployer), 1000e18);
        uint256 ethReserve = 1 ether;

        vm.deal(address(this), ethReserve);
        uint256 treasuryBefore = protocolTreasury.balance;
        uint256 vaultBefore    = address(vault).balance;

        deployer.deployLiquidity{value: ethReserve}(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: 1000e18,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
            creator: address(0),
            carveEth: 0
            })
        );

        // Protocol gets 1% = 0.01 ETH
        assertEq(protocolTreasury.balance - treasuryBefore, 0.01 ether, "Protocol should get 1%");
        // Vault gets 19% = 0.19 ETH via receiveContribution
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "Vault should get 19%");
    }

    // ── Creator carve ─────────────────────────────────────────────────────────

    /// @notice Tithed carve deltas: creator 80% of carve; vault 19% raise + 19% carve; protocol
    ///         1% raise + 1% carve; the LP leg loses exactly the carve.
    function test_deployLiquidity_carve_paysCreatorVaultProtocol() public {
        address creator = makeAddr("creator");
        token.mint(address(deployer), 1000e18);
        uint256 ethReserve = 1 ether;
        uint256 carve = 0.1 ether;

        vm.deal(address(this), ethReserve);
        uint256 treasuryBefore = protocolTreasury.balance;
        uint256 vaultBefore    = address(vault).balance;

        vm.expectEmit(true, true, false, true);
        emit CypherLiquidityDeployerModule.CreatorCarvePaid(instance, creator, carve, carve);

        deployer.deployLiquidity{value: ethReserve}(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: 1000e18,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
                creator: creator,
                carveEth: carve
            })
        );

        assertEq(protocolTreasury.balance - treasuryBefore, 0.01 ether + 0.001 ether, "protocol = 1% raise + 1% carve");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether + 0.019 ether, "vault = 19% raise + 19% carve");
        assertEq(creator.balance, 0.08 ether, "creator = 80% of carve");
        // The LP leg = LP80 - carve = 0.8 - 0.1 = 0.7 (WETH deposited for the position). The vault
        // credits the benefactor BOTH the LP registration (0.7) and the receiveContribution
        // (0.209), so the tracked contribution is their sum.
        assertEq(weth.balanceOf(address(positionManager)), 0.7 ether, "LP leg loses exactly the carve");
        assertEq(vault.benefactorContribution(instance), 0.7 ether + 0.209 ether, "contribution = LP leg + vault cut");
    }
}
