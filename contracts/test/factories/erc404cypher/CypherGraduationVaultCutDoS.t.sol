// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { CypherLiquidityDeployerModule } from "../../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";
import { MockAlgebraFactory, MockAlgebraPositionManager } from "../../mocks/MockCypherAlgebra.sol";
import { MockToggleVault } from "../../mocks/MockToggleVault.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";

/// @notice noesis-097: a reverting alignment vault must not brick Cypher (Algebra) ERC404 graduation. The
///         vaultCut send is isolated in try/catch; on failure the ETH is retained in the module and stashed
///         as pendingVaultCut, recoverable later via flushPendingVaultCut.
contract CypherGraduationVaultCutDoSTest is Test {
    CypherLiquidityDeployerModule deployer;
    MockAlgebraFactory algebraFactory;
    MockAlgebraPositionManager positionManager;
    MockERC20 token;
    MockWETH weth;
    MockMasterRegistry registry;

    address protocolTreasury = makeAddr("treasury");
    address instance; // graduating instance == msg.sender

    uint256 constant ETH_RESERVE = 1 ether;
    uint256 constant TOKEN_RESERVE = 1000e18;
    uint256 constant EXPECTED_VAULT_CUT = 0.19 ether; // 19% of 1 ETH

    function setUp() public {
        algebraFactory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        token = new MockERC20("Token", "TKN");
        weth = new MockWETH();
        registry = new MockMasterRegistry();
        instance = address(this);
        deployer = new CypherLiquidityDeployerModule(
            address(algebraFactory), address(positionManager), address(weth), address(registry)
        );
    }

    function _graduate(address vault) internal {
        token.mint(address(deployer), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        deployer.deployLiquidity{ value: ETH_RESERVE }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ETH_RESERVE,
                tokenReserve: TOKEN_RESERVE,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: vault,
                instance: instance,
                creator: address(0),
                carveEth: 0
            })
        );
    }

    /// @notice Graduation completes (pool created, LP minted to instance) even though the vault reverts;
    ///         the cut is stashed in the module, no ETH lost.
    function test_graduation_completesWhenVaultReverts_andStashesCut() public {
        MockToggleVault vault = new MockToggleVault(); // broken by default
        _graduate(address(vault));

        // Graduation still happened: pool created and the launch LP minted to the instance.
        assertNotEq(algebraFactory.poolByPair(address(token), address(weth)), address(0), "pool created");
        assertEq(positionManager.ownerOf(1), instance, "LP minted to instance -> graduation completed");
        // Vault got nothing; the cut is retained in the module.
        assertEq(address(vault).balance, 0, "vault got nothing");
        assertEq(address(deployer).balance, EXPECTED_VAULT_CUT, "module retains the stashed cut ETH");

        (address stashedVault, uint256 stashedAmount) = deployer.pendingVaultCut(instance);
        assertEq(stashedVault, address(vault), "bound vault stored");
        assertEq(stashedAmount, EXPECTED_VAULT_CUT, "full cut stashed");
    }

    /// @notice Once the vault heals, a permissionless flush delivers the deferred cut and zeroes the stash.
    function test_flushPendingVaultCut_deliversAfterVaultHeals() public {
        MockToggleVault vault = new MockToggleVault();
        _graduate(address(vault));
        vault.setBroken(false);

        vm.expectEmit(true, true, false, true);
        emit CypherLiquidityDeployerModule.VaultContributionRetried(address(vault), instance, EXPECTED_VAULT_CUT);
        vm.prank(makeAddr("rando")); // permissionless
        deployer.flushPendingVaultCut(instance);

        assertEq(vault.received(instance), EXPECTED_VAULT_CUT, "cut delivered to bound vault");
        assertEq(address(vault).balance, EXPECTED_VAULT_CUT, "vault now holds the ETH");
        assertEq(address(deployer).balance, 0, "module no longer holds the cut");
        (, uint256 stashedAmount) = deployer.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash zeroed");
    }

    /// @notice A flush while the vault is still broken reverts and re-stashes (idempotent, no loss).
    function test_flushPendingVaultCut_reStashesWhenStillBroken() public {
        MockToggleVault vault = new MockToggleVault();
        _graduate(address(vault));

        vm.expectRevert(MockToggleVault.VaultBroken.selector);
        deployer.flushPendingVaultCut(instance);

        (address stashedVault, uint256 stashedAmount) = deployer.pendingVaultCut(instance);
        assertEq(stashedVault, address(vault), "vault still bound");
        assertEq(stashedAmount, EXPECTED_VAULT_CUT, "cut still stashed");
        assertEq(address(deployer).balance, EXPECTED_VAULT_CUT, "ETH retained");
    }

    /// @notice Flushing an instance with no pending cut reverts NoPendingVaultCut.
    function test_flushPendingVaultCut_revertsWhenNothingPending() public {
        vm.expectRevert(CypherLiquidityDeployerModule.NoPendingVaultCut.selector);
        deployer.flushPendingVaultCut(makeAddr("unknown"));
    }

    /// @notice Happy path unchanged: a healthy vault receives the cut inline, nothing is stashed.
    function test_happyPath_noStashWhenVaultAccepts() public {
        MockVault vault = new MockVault();
        _graduate(address(vault));

        assertEq(address(vault).balance, EXPECTED_VAULT_CUT, "vault received the cut inline");
        assertEq(address(deployer).balance, 0, "module retains nothing");
        (, uint256 stashedAmount) = deployer.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "no stash on the happy path");
    }
}
