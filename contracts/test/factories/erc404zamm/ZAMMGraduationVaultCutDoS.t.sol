// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { TitheSignals } from "../../helpers/TitheSignals.sol";
import { ZAMMLiquidityDeployerModule } from "../../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockZAMM } from "../../mocks/MockZAMM.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockToggleVault } from "../../mocks/MockToggleVault.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";

/// @notice noesis-097: a reverting alignment vault must not brick ERC404 graduation. The vaultCut send is
///         isolated in try/catch; on failure the ETH is retained in the module and stashed as
///         pendingVaultCut, recoverable later via flushPendingVaultCut.
contract ZAMMGraduationVaultCutDoSTest is Test {
    /// @dev This contract stands in for the graduating ERC404 instance, so it must answer the
    ///      deployer module's `IGraduationSkipNFTTarget` handshake. The real instance flags the
    ///      counterparty NFT-skipping; nothing here holds ids, so recording is enough.
    function markGraduationSkipNFT(address) external { }

    ZAMMLiquidityDeployerModule module;
    MockZAMM zamm;
    MockERC20 token;
    MockMasterRegistry registry;

    address treasury = address(0xBEEF);
    address creator = makeAddr("creator");
    address instance; // the graduating instance == msg.sender

    /// @dev This test contract acts as the graduating instance (msg.sender); the module's flush leg reads
    ///      the treasury back via IFactoryInstance.protocolTreasury() and — since noesis-435 — the creator
    ///      back via IFactoryInstance.owner().
    function protocolTreasury() external view returns (address) {
        return treasury;
    }

    function owner() external view returns (address) {
        return creator;
    }

    uint256 constant ETH_RESERVE = 10 ether;
    uint256 constant TOKEN_RESERVE = 1000 ether;
    uint256 constant EXPECTED_VAULT_CUT = 1.9 ether; // 19% of 10 ETH

    function setUp() public {
        zamm = new MockZAMM();
        token = new MockERC20("Test", "TST");
        registry = new MockMasterRegistry();
        module = new ZAMMLiquidityDeployerModule(address(zamm), 30, address(registry));
        instance = address(this);
    }

    function _params(address vault) internal view returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ETH_RESERVE,
            tokenReserve: TOKEN_RESERVE,
            protocolTreasury: treasury,
            vault: vault,
            token: address(token),
            instance: instance,
            creator: creator,
            carveEth: 0,
            excessEth: 0
        });
    }

    function _graduate(address vault) internal {
        token.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        module.deployLiquidity{ value: ETH_RESERVE }(_params(vault));
    }

    /// @notice Graduation completes even though the vault reverts; the cut is stashed, no ETH lost.
    function test_graduation_completesWhenVaultReverts_andStashesCut() public {
        MockToggleVault vault = new MockToggleVault(); // broken by default
        _graduate(address(vault));

        // Graduation still happened: LP was added and the pool holds the 80% pool ETH.
        assertEq(address(zamm).balance, 8 ether, "pool funded -> graduation completed");
        // The vault received nothing (it reverted) but the cut is retained in the module.
        assertEq(address(vault).balance, 0, "vault got nothing");
        assertEq(address(module).balance, EXPECTED_VAULT_CUT, "module retains the stashed cut ETH");

        (address stashedVault, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedVault, address(vault), "bound vault stored");
        assertEq(stashedAmount, EXPECTED_VAULT_CUT, "full cut stashed");
    }

    /// @notice Once the vault heals, a permissionless flush delivers the deferred cut and zeroes the stash.
    function test_flushPendingVaultCut_deliversAfterVaultHeals() public {
        MockToggleVault vault = new MockToggleVault();
        _graduate(address(vault));
        vault.setBroken(false);

        address rando = makeAddr("rando");
        vm.expectEmit(true, true, false, true);
        emit ZAMMLiquidityDeployerModule.VaultContributionRetried(address(vault), instance, EXPECTED_VAULT_CUT);
        vm.prank(rando); // permissionless
        module.flushPendingVaultCut(instance);

        assertEq(vault.received(instance), EXPECTED_VAULT_CUT, "cut delivered to bound vault");
        assertEq(address(vault).balance, EXPECTED_VAULT_CUT, "vault now holds the ETH");
        assertEq(address(module).balance, 0, "module no longer holds the cut");
        (, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash zeroed");
    }

    /// @notice A flush while the vault is still broken reverts and re-stashes (idempotent, no loss).
    function test_flushPendingVaultCut_reStashesWhenStillBroken() public {
        MockToggleVault vault = new MockToggleVault();
        _graduate(address(vault));

        vm.expectRevert(MockToggleVault.VaultBroken.selector);
        module.flushPendingVaultCut(instance);

        // Stash and ETH are untouched — the revert rolled back the zeroing.
        (address stashedVault, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedVault, address(vault), "vault still bound");
        assertEq(stashedAmount, EXPECTED_VAULT_CUT, "cut still stashed");
        assertEq(address(module).balance, EXPECTED_VAULT_CUT, "ETH retained");
    }

    /// @notice Flushing an instance with no pending cut reverts NoPendingVaultCut.
    function test_flushPendingVaultCut_revertsWhenNothingPending() public {
        vm.expectRevert(ZAMMLiquidityDeployerModule.NoPendingVaultCut.selector);
        module.flushPendingVaultCut(makeAddr("unknown"));
    }

    /// @notice Happy path unchanged: a healthy vault receives the cut inline, nothing is stashed.
    function test_happyPath_noStashWhenVaultAccepts() public {
        MockVault vault = new MockVault();
        _graduate(address(vault));

        assertEq(address(vault).balance, EXPECTED_VAULT_CUT, "vault received the cut inline");
        assertEq(address(module).balance, 0, "module retains nothing");
        (, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "no stash on the happy path");
    }

    // ── noesis-126/noesis-435: de-curation returns the cut to the creator, primary send + flush retry ──

    /// @notice If the alignment target is de-curated, the graduation community cut is returned to the
    ///         CREATOR at graduation instead of being fed to (or stashed for) the de-curated vault — and
    ///         the protocol treasury receives nothing beyond its own 1% graduation fee.
    function test_graduation_DecuratedTarget_ReturnsVaultCutToCreator() public {
        MockVault vault = new MockVault(); // healthy — the return must never touch it
        registry.setVaultRegistered(address(vault), false);

        uint256 treasuryBefore = treasury.balance;
        uint256 creatorBefore = creator.balance;

        // Balance assertions below prove the return exactly (cut → creator, not the vault, not stashed);
        // the VaultCutReturnedToCreator event on this same emit path is asserted by the signals test. An
        // expectEmit here would anchor to graduation's first log (a pool Transfer), not the later return.
        _graduate(address(vault));

        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        assertEq(address(module).balance, 0, "no ETH stashed on the return path");
        (, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "the return is not the pending-retry lane");
        // The treasury got its 1% graduation fee and NOT one wei of the community cut.
        assertEq(treasury.balance - treasuryBefore, ETH_RESERVE / 100, "treasury gets its fee and nothing more");
        assertEq(creator.balance - creatorBefore, EXPECTED_VAULT_CUT, "creator got the returned community cut");
    }

    /// @notice A cut stashed while the target was live must NOT be force-fed to the vault on flush once the
    ///         target has since been de-curated — it is returned to the instance's creator, read back via
    ///         `IFactoryInstance.owner()` with no change to the `PendingCut` struct, and the treasury
    ///         balance is unchanged.
    function test_flushPendingVaultCut_DecuratedTarget_ReturnsToCreator() public {
        MockToggleVault vault = new MockToggleVault(); // broken -> forces the stash
        _graduate(address(vault));

        registry.setVaultRegistered(address(vault), false); // DAO revokes after the stash
        uint256 treasuryBefore = treasury.balance;
        uint256 creatorBefore = creator.balance;

        vm.expectEmit(true, true, false, true);
        emit ZAMMLiquidityDeployerModule.PendingVaultCutReturnedToCreator(address(vault), creator, EXPECTED_VAULT_CUT);
        vm.prank(makeAddr("rando")); // permissionless
        module.flushPendingVaultCut(instance);

        assertEq(creator.balance - creatorBefore, EXPECTED_VAULT_CUT, "flush returned the cut to the creator");
        assertEq(treasury.balance - treasuryBefore, 0, "treasury balance unchanged");
        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        assertEq(address(module).balance, 0, "module no longer holds the cut");
        (, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash cleared");
    }

    /// @notice noesis-435 acceptance 3: the returned cut keeps the brick-proof send. A creator contract
    ///         that rejects plain ETH still receives the flushed cut and the flush does not revert.
    function test_flushPendingVaultCut_DecuratedTarget_EthRejectingCreator() public {
        MockToggleVault vault = new MockToggleVault(); // broken -> forces the stash
        _graduate(address(vault));

        EthRejectingCreator rejecter = new EthRejectingCreator();
        creator = address(rejecter); // owner() now answers a contract that reverts on plain ETH
        registry.setVaultRegistered(address(vault), false);

        module.flushPendingVaultCut(instance); // must NOT revert

        assertEq(address(rejecter).balance, EXPECTED_VAULT_CUT, "rejecting creator was force-paid the cut");
        (, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash cleared");
    }

    /// @notice noesis-314: the two returns are distinguishable in the log. Drives BOTH branches — a cut
    ///         returned as it is earned, and a stashed cut returned on flush — and asserts each path emits
    ///         its own signal and only its own. Same money, same destination, but one is new revenue and
    ///         the other is a re-route of revenue already reported; a tithe report reading a single event
    ///         for both would count that cut twice.
    function test_returnSignals_primaryAndFlush_differ() public {
        assertTrue(
            ZAMMLiquidityDeployerModule.VaultCutReturnedToCreator.selector
                != ZAMMLiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector,
            "the two return signals are distinct topics"
        );

        // -- Branch 1: returned as it is earned. --
        MockVault live = new MockVault();
        registry.setVaultRegistered(address(live), false); // revoked before the cut is even earned
        vm.recordLogs();
        _graduate(address(live));
        Vm.Log[] memory primary = vm.getRecordedLogs();
        assertEq(
            TitheSignals.count(primary, ZAMMLiquidityDeployerModule.VaultCutReturnedToCreator.selector),
            1,
            "primary path emits the earned signal"
        );
        assertEq(
            TitheSignals.count(primary, ZAMMLiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector),
            0,
            "primary path does not claim to be a retry"
        );

        // -- Branch 2: stashed while the target was live, returned on flush. --
        MockToggleVault broken = new MockToggleVault(); // broken -> forces the stash
        _graduate(address(broken)); // target still live at stash time
        registry.setVaultRegistered(address(broken), false); // revoked after the stash
        vm.recordLogs();
        module.flushPendingVaultCut(instance);
        Vm.Log[] memory flushed = vm.getRecordedLogs();
        assertEq(
            TitheSignals.count(flushed, ZAMMLiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector),
            1,
            "flush path emits the retry signal"
        );
        assertEq(
            TitheSignals.count(flushed, ZAMMLiquidityDeployerModule.VaultCutReturnedToCreator.selector),
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
