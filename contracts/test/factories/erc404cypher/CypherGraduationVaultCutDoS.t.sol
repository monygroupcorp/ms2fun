// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { TitheSignals } from "../../helpers/TitheSignals.sol";
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
    /// @dev This contract stands in for the graduating ERC404 instance, so it must answer the
    ///      deployer module's `IGraduationSkipNFTTarget` handshake. The real instance flags the
    ///      counterparty NFT-skipping; nothing here holds ids, so recording is enough.
    function markGraduationSkipNFT(address) external { }

    CypherLiquidityDeployerModule deployer;
    MockAlgebraFactory algebraFactory;
    MockAlgebraPositionManager positionManager;
    MockERC20 token;
    MockWETH weth;
    MockMasterRegistry registry;

    // Public so this test contract satisfies IFactoryInstance.protocolTreasury() and, since noesis-435,
    // IFactoryInstance.owner() — it acts as the graduating instance (msg.sender), and the module's flush
    // leg reads both back from it.
    address public protocolTreasury = makeAddr("treasury");
    address public owner = makeAddr("creator");
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
                creator: owner,
                carveEth: 0,
                excessEth: 0
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

    // ── noesis-126/noesis-435: de-curation returns the cut to the creator, primary send + flush retry ──

    /// @notice If the alignment target is de-curated, the graduation community cut is returned to the
    ///         CREATOR at graduation instead of being fed to (or stashed for) the de-curated vault — and
    ///         the protocol treasury receives nothing beyond its own 1% graduation fee.
    function test_graduation_DecuratedTarget_ReturnsVaultCutToCreator() public {
        MockVault vault = new MockVault(); // healthy — the return must never touch it
        registry.setVaultRegistered(address(vault), false);

        uint256 treasuryBefore = protocolTreasury.balance;
        uint256 creatorBefore = owner.balance;

        // Balance assertions below prove the return exactly (cut → creator, not the vault, not stashed);
        // the VaultCutReturnedToCreator event on this same emit path is asserted by the signals test. An
        // expectEmit here would anchor to graduation's first log (an Algebra Transfer), not the later return.
        _graduate(address(vault));

        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        assertEq(address(deployer).balance, 0, "no ETH stashed on the return path");
        (, uint256 stashedAmount) = deployer.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "the return is not the pending-retry lane");
        // The treasury got its 1% graduation fee and NOT one wei of the community cut.
        assertEq(protocolTreasury.balance - treasuryBefore, ETH_RESERVE / 100, "treasury gets its fee and nothing more");
        assertEq(owner.balance - creatorBefore, EXPECTED_VAULT_CUT, "creator got the returned community cut");
    }

    /// @notice A cut stashed while the target was live must NOT be force-fed to the vault on flush once the
    ///         target has since been de-curated — it is returned to the instance's creator, read back via
    ///         `IFactoryInstance.owner()` with no change to the `PendingCut` struct, and the treasury
    ///         balance is unchanged.
    function test_flushPendingVaultCut_DecuratedTarget_ReturnsToCreator() public {
        MockToggleVault vault = new MockToggleVault(); // broken -> forces the stash
        _graduate(address(vault));

        registry.setVaultRegistered(address(vault), false); // DAO revokes after the stash
        uint256 treasuryBefore = protocolTreasury.balance;
        uint256 creatorBefore = owner.balance;

        vm.expectEmit(true, true, false, true);
        emit CypherLiquidityDeployerModule.PendingVaultCutReturnedToCreator(address(vault), owner, EXPECTED_VAULT_CUT);
        vm.prank(makeAddr("rando")); // permissionless
        deployer.flushPendingVaultCut(instance);

        assertEq(owner.balance - creatorBefore, EXPECTED_VAULT_CUT, "flush returned the cut to the creator");
        assertEq(protocolTreasury.balance - treasuryBefore, 0, "treasury balance unchanged");
        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        assertEq(address(deployer).balance, 0, "module no longer holds the cut");
        (, uint256 stashedAmount) = deployer.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash cleared");
    }

    /// @notice noesis-435 acceptance 3: the returned cut keeps the brick-proof send. A creator contract
    ///         that rejects plain ETH still receives the flushed cut and the flush does not revert.
    function test_flushPendingVaultCut_DecuratedTarget_EthRejectingCreator() public {
        MockToggleVault vault = new MockToggleVault(); // broken -> forces the stash
        _graduate(address(vault));

        EthRejectingCreator rejecter = new EthRejectingCreator();
        owner = address(rejecter); // owner() now answers a contract that reverts on plain ETH
        registry.setVaultRegistered(address(vault), false);

        deployer.flushPendingVaultCut(instance); // must NOT revert

        assertEq(address(rejecter).balance, EXPECTED_VAULT_CUT, "rejecting creator was force-paid the cut");
        (, uint256 stashedAmount) = deployer.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash cleared");
    }

    /// @notice noesis-314: the two returns are distinguishable in the log. Drives BOTH branches — a cut
    ///         returned as it is earned, and a stashed cut returned on flush — and asserts each path emits
    ///         its own signal and only its own. Same money, same destination, but one is new revenue and
    ///         the other is a re-route of revenue already reported; a tithe report reading a single event
    ///         for both would count that cut twice.
    function test_returnSignals_primaryAndFlush_differ() public {
        assertTrue(
            CypherLiquidityDeployerModule.VaultCutReturnedToCreator.selector
                != CypherLiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector,
            "the two return signals are distinct topics"
        );

        // -- Branch 1: returned as it is earned. --
        MockVault live = new MockVault();
        registry.setVaultRegistered(address(live), false); // revoked before the cut is even earned
        vm.recordLogs();
        _graduate(address(live));
        Vm.Log[] memory primary = vm.getRecordedLogs();
        assertEq(
            TitheSignals.count(primary, CypherLiquidityDeployerModule.VaultCutReturnedToCreator.selector),
            1,
            "primary path emits the earned signal"
        );
        assertEq(
            TitheSignals.count(primary, CypherLiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector),
            0,
            "primary path does not claim to be a retry"
        );

        // -- Branch 2: stashed while the target was live, returned on flush. --
        MockToggleVault broken = new MockToggleVault(); // broken -> forces the stash
        _graduate(address(broken)); // target still live at stash time
        registry.setVaultRegistered(address(broken), false); // revoked after the stash
        vm.recordLogs();
        deployer.flushPendingVaultCut(instance);
        Vm.Log[] memory flushed = vm.getRecordedLogs();
        assertEq(
            TitheSignals.count(flushed, CypherLiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector),
            1,
            "flush path emits the retry signal"
        );
        assertEq(
            TitheSignals.count(flushed, CypherLiquidityDeployerModule.VaultCutReturnedToCreator.selector),
            0,
            "flush path is not reported as new revenue"
        );
    }
}

/// @notice A creator that rejects plain ETH. Proves the returned community cut keeps the brick-proof
///         property the redirect leg had before noesis-435 folded it into the creator payout.
contract EthRejectingCreator {
    receive() external payable {
        revert("no ETH");
    }
}
