// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
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
    ZAMMLiquidityDeployerModule module;
    MockZAMM zamm;
    MockERC20 token;
    MockMasterRegistry registry;

    address treasury = address(0xBEEF);
    address instance; // the graduating instance == msg.sender

    /// @dev This test contract acts as the graduating instance (msg.sender); the module's flush-redirect
    ///      reads the treasury back via IFactoryInstance.protocolTreasury().
    function protocolTreasury() external view returns (address) {
        return treasury;
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
            creator: address(0),
            carveEth: 0
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

    // ── noesis-126: target-revocation redirect on the graduation primary send + flush retry ──

    /// @notice If the alignment target is revoked, the graduation vault cut is redirected to
    ///         `protocolTreasury` at graduation instead of being fed to (or stashed for) the de-curated vault.
    function test_graduation_RevokedTarget_RedirectsVaultCutToTreasury() public {
        MockVault vault = new MockVault(); // healthy — the redirect must never touch it
        registry.setVaultRegistered(address(vault), false);

        uint256 treasuryBefore = treasury.balance;

        // Balance assertions below prove the redirect exactly (tithe → treasury, not the vault, not stashed);
        // the VaultCutRedirected event on this same emit path is asserted by the flush-redirect test. An
        // expectEmit here would anchor to graduation's first log (a ZAMM Transfer), not the later redirect.
        _graduate(address(vault));

        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        assertEq(address(module).balance, 0, "no ETH stashed on the redirect path");
        (, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "redirect is not the pending-retry lane");
        // Treasury absorbed the 1% graduation fee plus the redirected 19% tithe.
        assertEq(
            treasury.balance - treasuryBefore,
            (ETH_RESERVE / 100) + EXPECTED_VAULT_CUT,
            "treasury got fee + redirected tithe"
        );
    }

    /// @notice A cut stashed while the target was live must NOT be force-fed to the vault on flush once the
    ///         target has since been revoked — it is redirected to the instance's protocol treasury.
    function test_flushPendingVaultCut_RevokedTarget_RedirectsToTreasury() public {
        MockToggleVault vault = new MockToggleVault(); // broken -> forces the stash
        _graduate(address(vault));

        registry.setVaultRegistered(address(vault), false); // DAO revokes after the stash
        uint256 treasuryBefore = treasury.balance;

        vm.expectEmit(true, true, false, true);
        emit ZAMMLiquidityDeployerModule.VaultCutRedirected(address(vault), treasury, EXPECTED_VAULT_CUT);
        vm.prank(makeAddr("rando")); // permissionless
        module.flushPendingVaultCut(instance);

        assertEq(treasury.balance - treasuryBefore, EXPECTED_VAULT_CUT, "flush redirected the tithe");
        assertEq(address(vault).balance, 0, "de-curated vault received nothing");
        assertEq(address(module).balance, 0, "module no longer holds the cut");
        (, uint256 stashedAmount) = module.pendingVaultCut(instance);
        assertEq(stashedAmount, 0, "stash cleared");
    }
}
