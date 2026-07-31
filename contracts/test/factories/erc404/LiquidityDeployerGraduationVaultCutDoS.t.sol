// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockToggleVault } from "../../mocks/MockToggleVault.sol";
import { MockVault } from "../../mocks/MockVault.sol";

/// @dev Exposes the internal graduation-fee dispatch (`_postUnlock`) so the vaultCut send isolation can be
///      unit-tested without a full V4 PoolManager (the surrounding V4 liquidity add is fork-tested; this
///      mirrors the existing `_computeAmounts` harness convention in LiquidityDeployerModule.t.sol).
contract PostUnlockHarness is LiquidityDeployerModule {
    constructor() LiquidityDeployerModule(address(0), address(0x3), 3000, 60, address(0)) { }

    function postUnlock(ILiquidityDeployerModule.DeployParams calldata p, AmountsResult memory r) external {
        _postUnlock(p, r);
    }
}

/// @notice noesis-097: a reverting alignment vault must not brick the ERC404 (Uniswap V4) graduation
///         fee dispatch. The vaultCut send is isolated in try/catch; on failure the ETH is retained in the
///         module and stashed as pendingVaultCut, recoverable later via flushPendingVaultCut.
contract LiquidityDeployerGraduationVaultCutDoSTest is Test {
    PostUnlockHarness harness;

    address instance = makeAddr("instance");
    uint256 constant VAULT_CUT = 1.9 ether;

    function setUp() public {
        harness = new PostUnlockHarness();
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
            carveEth: 0
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
}
