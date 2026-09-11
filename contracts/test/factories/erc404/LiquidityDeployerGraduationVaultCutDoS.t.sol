// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { TitheSignals } from "../../helpers/TitheSignals.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockToggleVault } from "../../mocks/MockToggleVault.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockInstance } from "../../mocks/MockInstance.sol";

/// @dev Exposes the internal graduation-fee dispatch (`_postUnlock`) so the vaultCut send isolation can be
///      unit-tested without a full V4 PoolManager (the surrounding V4 liquidity add is fork-tested; this
///      mirrors the existing `_computeAmounts` harness convention in LiquidityDeployerModule.t.sol).
contract PostUnlockHarness is LiquidityDeployerModule {
    constructor(address reg) LiquidityDeployerModule(address(0), address(0x3), 3000, 60, reg) { }

    function postUnlock(ILiquidityDeployerModule.DeployParams calldata p, AmountsResult memory r) external {
        _postUnlock(p, r);
    }
}

/// @notice noesis-097: a reverting alignment vault must not brick the ERC404 (Uniswap V4) graduation
///         fee dispatch. The vaultCut send is isolated in try/catch; on failure the ETH is retained in the
///         module and stashed as pendingVaultCut, recoverable later via flushPendingVaultCut.
contract LiquidityDeployerGraduationVaultCutDoSTest is Test {
    PostUnlockHarness harness;
    MockMasterRegistry registry;

    address instance = makeAddr("instance");
    uint256 constant VAULT_CUT = 1.9 ether;

    function setUp() public {
        registry = new MockMasterRegistry();
        harness = new PostUnlockHarness(address(registry));
        // The module holds the graduation ETH at fee-dispatch time; fund the harness with the cut so a
        // stashed pendingVaultCut is backed by real ETH.
        vm.deal(address(harness), VAULT_CUT);
    }

    function _params(address vault) internal view returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: 10 ether,
            tokenReserve: 100 ether,
            protocolTreasury: address(0), // skip protocol send — isolate the vaultCut path
            vault: vault,
            token: address(0x4),
            instance: instance,
            creator: address(0), // skip creator send
            carveEth: 0,
            excessEth: 0
        });
    }

    function _amounts() internal pure returns (LiquidityDeployerModule.AmountsResult memory r) {
        r.vaultCut = VAULT_CUT; // all other cuts zero so only the vault send is exercised
    }

    /// @notice A reverting vault does not revert the dispatch; the cut is stashed, no ETH lost.
    function test_dispatch_stashesCutWhenVaultReverts() public {
        MockToggleVault vault = new MockToggleVault(); // broken by default

        vm.expectEmit(true, true, false, true);
        emit LiquidityDeployerModule.VaultContributionFailed(address(vault), instance, VAULT_CUT);
        harness.postUnlock(_params(address(vault)), _amounts());

        assertEq(address(vault).balance, 0, "vault got nothing");
        assertEq(address(harness).balance, VAULT_CUT, "module retains the stashed cut ETH");
        (address stashedVault, uint256 stashedAmount) = harness.pendingVaultCut(instance);
        assertEq(stashedVault, address(vault), "bound vault stored");
        assertEq(stashedAmount, VAULT_CUT, "full cut stashed");
    }

    /// @notice Once the vault heals, a permissionless flush delivers the deferred cut and zeroes the stash.
    function test_flushPendingVaultCut_deliversAfterVaultHeals() public {
        MockToggleVault vault = new MockToggleVault();
        harness.postUnlock(_params(address(vault)), _amounts());
        vault.setBroken(false);

        vm.expectEmit(true, true, false, true);
        emit LiquidityDeployerModule.VaultContributionRetried(address(vault), instance, VAULT_CUT);
        vm.prank(makeAddr("rando")); // permissionless
        harness.flushPendingVaultCut(instance);

        assertEq(vault.received(instance), VAULT_CUT, "cut delivered to bound vault");
        assertEq(address(vault).balance, VAULT_CUT, "vault now holds the ETH");
        assertEq(address(harness).balance, 0, "module no longer holds the cut");
        (, uint256 stashedAmount) = harness.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash zeroed");
    }

    /// @notice A flush while the vault is still broken reverts and re-stashes (idempotent, no loss).
    function test_flushPendingVaultCut_reStashesWhenStillBroken() public {
        MockToggleVault vault = new MockToggleVault();
        harness.postUnlock(_params(address(vault)), _amounts());

        vm.expectRevert(MockToggleVault.VaultBroken.selector);
        harness.flushPendingVaultCut(instance);

        (address stashedVault, uint256 stashedAmount) = harness.pendingVaultCut(instance);
        assertEq(stashedVault, address(vault), "vault still bound");
        assertEq(stashedAmount, VAULT_CUT, "cut still stashed");
        assertEq(address(harness).balance, VAULT_CUT, "ETH retained");
    }

    /// @notice Flushing an instance with no pending cut reverts NoPendingVaultCut.
    function test_flushPendingVaultCut_revertsWhenNothingPending() public {
        vm.expectRevert(LiquidityDeployerModule.NoPendingVaultCut.selector);
        harness.flushPendingVaultCut(makeAddr("unknown"));
    }

    /// @notice Happy path unchanged: a healthy vault receives the cut inline, nothing is stashed.
    function test_happyPath_noStashWhenVaultAccepts() public {
        MockVault vault = new MockVault();
        harness.postUnlock(_params(address(vault)), _amounts());

        assertEq(address(vault).balance, VAULT_CUT, "vault received the cut inline");
        assertEq(address(harness).balance, 0, "module retains nothing");
        (, uint256 stashedAmount) = harness.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "no stash on the happy path");
    }

    // ── noesis-126/noesis-435: de-curation returns the cut to the creator, primary send + flush retry ──

    /// @notice If the alignment target is de-curated, the graduation community cut is returned to the
    ///         CREATOR instead of being fed to (or stashed for) the de-curated vault, and the protocol
    ///         treasury receives nothing.
    function test_postUnlock_DecuratedTarget_ReturnsVaultCutToCreator() public {
        MockVault vault = new MockVault(); // healthy — but the return must never touch it
        address treasury = makeAddr("treasury");
        address creator = makeAddr("creator");
        registry.setVaultRegistered(address(vault), false);

        ILiquidityDeployerModule.DeployParams memory p = ILiquidityDeployerModule.DeployParams({
            ethReserve: 10 ether,
            tokenReserve: 100 ether,
            protocolTreasury: treasury,
            vault: address(vault),
            token: address(0x4),
            instance: instance,
            creator: creator,
            carveEth: 0,
            excessEth: 0
        });

        vm.expectEmit(true, true, false, true);
        emit LiquidityDeployerModule.VaultCutReturnedToCreator(address(vault), creator, VAULT_CUT);
        harness.postUnlock(p, _amounts());

        assertEq(creator.balance, VAULT_CUT, "community cut returned to the creator");
        assertEq(treasury.balance, 0, "treasury balance unchanged");
        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        assertEq(address(harness).balance, 0, "no ETH stashed on the return path");
        (, uint256 stashedAmount) = harness.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "the return is not the pending-retry lane");
    }

    /// @notice A cut stashed while the target was live must NOT be force-fed to the vault on flush once the
    ///         target has since been de-curated — it is returned to the instance's creator, read back via
    ///         `IFactoryInstance.owner()` with no change to the `PendingCut` struct.
    function test_flushPendingVaultCut_DecuratedTarget_ReturnsToCreator() public {
        MockToggleVault vault = new MockToggleVault(); // broken -> forces the stash
        MockInstance mi = new MockInstance(address(vault)); // exposes protocolTreasury() and owner()
        address treasury = mi.protocolTreasury();
        address creator = makeAddr("creator");
        mi.setOwner(creator);

        ILiquidityDeployerModule.DeployParams memory p = ILiquidityDeployerModule.DeployParams({
            ethReserve: 10 ether,
            tokenReserve: 100 ether,
            protocolTreasury: address(0),
            vault: address(vault),
            token: address(0x4),
            instance: address(mi),
            creator: creator,
            carveEth: 0,
            excessEth: 0
        });
        // Target still live at stash time: the broken vault reverts, the cut is stashed under the instance.
        harness.postUnlock(p, _amounts());
        (, uint256 stashed) = harness.pendingVaultCut(address(mi));
        assertEq(stashed, VAULT_CUT, "precondition: cut stashed while target live");

        // DAO revokes the target after the stash.
        registry.setVaultRegistered(address(vault), false);

        vm.expectEmit(true, true, false, true);
        emit LiquidityDeployerModule.PendingVaultCutReturnedToCreator(address(vault), creator, VAULT_CUT);
        vm.prank(makeAddr("rando")); // permissionless
        harness.flushPendingVaultCut(address(mi));

        assertEq(creator.balance, VAULT_CUT, "flush returned the cut to the creator");
        assertEq(treasury.balance, 0, "treasury balance unchanged");
        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        (, uint256 stashedAfter) = harness.pendingVaultCut(address(mi));
        assertEq(stashedAfter, 0, "stash cleared");
    }

    /// @notice noesis-435 acceptance 3: the returned cut keeps the brick-proof send. A creator contract
    ///         that rejects plain ETH still receives the flushed cut and the flush does not revert.
    function test_flushPendingVaultCut_DecuratedTarget_EthRejectingCreator() public {
        MockToggleVault vault = new MockToggleVault(); // broken -> forces the stash
        MockInstance mi = new MockInstance(address(vault));
        EthRejectingCreator rejecter = new EthRejectingCreator();
        mi.setOwner(address(rejecter));

        ILiquidityDeployerModule.DeployParams memory p = ILiquidityDeployerModule.DeployParams({
            ethReserve: 10 ether,
            tokenReserve: 100 ether,
            protocolTreasury: address(0),
            vault: address(vault),
            token: address(0x4),
            instance: address(mi),
            creator: address(rejecter),
            carveEth: 0,
            excessEth: 0
        });
        harness.postUnlock(p, _amounts());
        registry.setVaultRegistered(address(vault), false);

        harness.flushPendingVaultCut(address(mi)); // must NOT revert

        assertEq(address(rejecter).balance, VAULT_CUT, "rejecting creator was force-paid the cut");
        (, uint256 stashedAfter) = harness.pendingVaultCut(address(mi));
        assertEq(stashedAfter, 0, "stash cleared");
    }

    /// @notice noesis-314: the two returns are distinguishable in the log. Drives BOTH branches — a cut
    ///         returned as it is earned, and a stashed cut returned on flush — and asserts each path emits
    ///         its own signal and only its own. Same money, same destination, but one is new revenue and
    ///         the other is a re-route of revenue already reported; a tithe report reading a single event
    ///         for both would count that cut twice.
    function test_returnSignals_primaryAndFlush_differ() public {
        assertTrue(
            LiquidityDeployerModule.VaultCutReturnedToCreator.selector
                != LiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector,
            "the two return signals are distinct topics"
        );

        // ── Branch 1: returned as it is earned. ──
        MockVault live = new MockVault();
        registry.setVaultRegistered(address(live), false); // revoked before the cut is even earned
        address treasury = makeAddr("earnedTreasury");
        ILiquidityDeployerModule.DeployParams memory pe = _params(address(live));
        pe.protocolTreasury = treasury;
        vm.recordLogs();
        harness.postUnlock(pe, _amounts());
        Vm.Log[] memory primary = vm.getRecordedLogs();
        assertEq(
            TitheSignals.count(primary, LiquidityDeployerModule.VaultCutReturnedToCreator.selector),
            1,
            "primary path emits the earned signal"
        );
        assertEq(
            TitheSignals.count(primary, LiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector),
            0,
            "primary path does not claim to be a retry"
        );

        // ── Branch 2: stashed while the target was live, returned on flush. ──
        MockToggleVault broken = new MockToggleVault(); // broken -> forces the stash
        MockInstance mi = new MockInstance(address(broken));
        ILiquidityDeployerModule.DeployParams memory pf = _params(address(broken));
        pf.instance = address(mi);
        vm.deal(address(harness), VAULT_CUT); // fund the second cut
        harness.postUnlock(pf, _amounts()); // target still live: the broken vault reverts, cut is stashed
        registry.setVaultRegistered(address(broken), false); // revoked after the stash
        vm.recordLogs();
        harness.flushPendingVaultCut(address(mi));
        Vm.Log[] memory flushed = vm.getRecordedLogs();
        assertEq(
            TitheSignals.count(flushed, LiquidityDeployerModule.PendingVaultCutReturnedToCreator.selector),
            1,
            "flush path emits the retry signal"
        );
        assertEq(
            TitheSignals.count(flushed, LiquidityDeployerModule.VaultCutReturnedToCreator.selector),
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
