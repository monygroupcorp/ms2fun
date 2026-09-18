// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployMainnet } from "../../script/DeployMainnet.s.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { MainnetAddresses } from "../../script/MainnetAddresses.sol";
import { IStataToken } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @dev Exposes the mainnet network config so the rehearsal deploys the real thing rather than a
///      hand-copied approximation of it. The salts are replaced by the caller: the shipped set is
///      still `bytes32(0)` (unmined — see the script's TODO 1), and six zero salts collide on the
///      second proxy. Salt choice is irrelevant to what this file asserts.
contract DeployMainnetHarness is DeployMainnet {
    function mainnetConfig() external pure returns (NetworkConfig memory) {
        return _mainnetConfig();
    }
}

/// @dev Stand-in benefactor. The endowment vault credits principal to a CONTRACT and reads
///      `IOwnable(benefactor).owner()` on the yield-claim path, so a codeless address cannot be one.
contract StubMainnetBenefactor {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }
}

/**
 * @title AaveEndowmentMainnetForkTest
 * @notice The live half of the fix that switched the Aave endowment family on for mainnet.
 *
 *         `DeployMainnet` named no `cfg.aaveStataToken`, which `DeployCore` reads as "this network
 *         has no endowment rail" — so the family was omitted, the deploy succeeded, and nothing said
 *         anything. `test/script/MainnetConfigCompleteness.t.sol` holds the config side of that and
 *         runs in the gate. This file is the part a unit test cannot reach: that the address now in
 *         the config is the right one on the actual chain, and that the family it enables works
 *         there end to end.
 *
 *         Mainnet is the EASY shape of the pair the Sepolia twin exercises — `waEthWETH.asset()` is
 *         canonical WETH, so `cfg.aaveWeth` stays unset and resolves back to `cfg.weth`. That is
 *         asserted here rather than assumed, because it is the premise the mainnet config is written
 *         on and the deploy reverts if it ever stops holding.
 *
 * @dev Fork-gated: `MAINNET_RPC_URL` unset -> `vm.skip(true)`, so the suite degrades instead of
 *      failing where no RPC is configured. Not in the default gate, which compiles it only.
 *      Run: MAINNET_RPC_URL=<url> forge test --mp test/fork/AaveEndowmentMainnetFork.t.sol -vv
 */
contract AaveEndowmentMainnetForkTest is Test {
    bool skipped;

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            skipped = true;
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    // ── The address in the config is the right one on the live chain ─────────

    /// @dev The invariant `deploy()` asserts, read straight off mainnet. If Aave migrates the token,
    ///      this is the test that says so — before a launch-day deploy reverts on the assertion.
    function test_theConfiguredStataTokenIsBackedByCanonicalWeth() public {
        if (skipped) return;

        DeployCore.NetworkConfig memory cfg = _config();
        assertEq(cfg.aaveStataToken, MainnetAddresses.WETH_STATA_TOKEN, "config names the shared address");
        assertEq(cfg.aaveWeth, address(0), "mainnet leaves the endowment WETH to resolve to cfg.weth");
        assertEq(
            IStataToken(cfg.aaveStataToken).asset(),
            MainnetAddresses.WETH,
            "waEthWETH.asset() is canonical mainnet WETH: the premise cfg.aaveWeth being unset rests on"
        );
    }

    // ── The family deploys and takes a real deposit ──────────────────────────

    function test_endowmentFamilyDeploysAndTakesADepositOnMainnet() public {
        if (skipped) return;

        DeployCore.NetworkConfig memory cfg = _config();

        DeployCore s = new DeployCore();
        s.deploy(address(s), cfg);

        assertTrue(address(s.aaveVaultFactory()) != address(0), "the endowment factory was deployed at all");
        assertEq(s.aaveVaultFactory().weth(), MainnetAddresses.WETH, "endowment family on canonical WETH");

        IStataToken stata = IStataToken(cfg.aaveStataToken);
        address vault = s.aaveVaults(0);
        StubMainnetBenefactor benefactor = new StubMainnetBenefactor(address(this));

        assertEq(stata.balanceOf(vault), 0, "vault holds no position before the contribution");

        uint256 amount = 0.01 ether;
        vm.deal(address(this), amount);
        IAlignmentVault(payable(vault)).receiveContribution{ value: amount }(
            Currency.wrap(address(0)), amount, address(benefactor)
        );

        assertGt(stata.balanceOf(vault), 0, "contribution reached the stataToken");
        assertGe(stata.maxWithdraw(vault), amount - 1, "position is worth the contribution");
    }

    // ── Vacuity: the family really is gated on that one field ────────────────

    /// @dev The defect, reproduced. Clearing the one address on an otherwise identical config
    ///      deploys with NO endowment factory and NO revert — which is what made the omission
    ///      invisible for as long as it stood.
    function test_clearingTheStataTokenSilentlyOmitsTheFamily() public {
        if (skipped) return;

        DeployCore.NetworkConfig memory cfg = _config();
        cfg.aaveStataToken = address(0);

        DeployCore s = new DeployCore();
        s.deploy(address(s), cfg); // no revert — this is the point

        assertEq(address(s.aaveVaultFactory()), address(0), "no endowment factory, and nothing said so");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// @dev The real mainnet config, with one endowment target to hang a vault on and salts that do
    ///      not collide. The shipped roster is empty (the script's TODO 2), and an empty roster
    ///      deploys the factory but no vault, so the target is supplied here rather than waited for.
    function _config() internal returns (DeployCore.NetworkConfig memory cfg) {
        cfg = new DeployMainnetHarness().mainnetConfig();

        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: MainnetAddresses.WETH, // registry paperwork only; an endowment vault never touches it
            symbol: "REHEARSAL",
            name: "Endowment rehearsal target",
            description: "Fixture target, fork rehearsal only.",
            deployUniVault: false,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: address(0xB0B)
        });
        cfg.alignmentTargets = targets;

        cfg.saltMasterRegistry = keccak256("rehearsal.masterRegistry");
        cfg.saltTreasury = keccak256("rehearsal.treasury");
        cfg.saltQueueManager = keccak256("rehearsal.queueManager");
        cfg.saltGlobalMsgReg = keccak256("rehearsal.globalMsgReg");
        cfg.saltAlignmentReg = keccak256("rehearsal.alignmentReg");
        cfg.saltComponentReg = keccak256("rehearsal.componentReg");
        cfg.saltNonce = block.timestamp;
        cfg.jsonOutputPath = "";
    }
}
