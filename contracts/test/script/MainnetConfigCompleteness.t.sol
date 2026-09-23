// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { DeployMainnet } from "../../script/DeployMainnet.s.sol";
import { MainnetAddresses } from "../../script/MainnetAddresses.sol";

/// @notice Reads `DeployMainnet`'s own config and asserts that every vault family the protocol ships
///         is actually switched on in it.
///
///         THE FAILURE MODE THIS EXISTS FOR, which is not hypothetical. Each family in `DeployCore`
///         is gated on one address being non-zero, and a zero reads as "this network does not have
///         that rail" — so the family is quietly omitted and the deploy SUCCEEDS. `DeployMainnet`
///         named no Aave stataToken at all, so a mainnet deploy would have shipped with no endowment
///         family, no revert, and no line in the output saying so, while the app carries endowment
///         surfaces and `DeployAnvil` — the mainnet-fork REHEARSAL — wired the family from its own
///         separate copy of the same addresses. noesis-404 found exactly this omission on Sepolia
///         and fixed it there; nobody checked mainnet, because nothing read mainnet's config back.
///
///         So these assertions are deliberately about the gates and not about the addresses: an
///         address typed wrong is caught by `deploy()`'s own invariants and by the fork tests, but an
///         address never typed at all is caught by nothing else.
contract MainnetConfigCompletenessTest is Test {
    MainnetConfigHarness internal harness;

    function setUp() public {
        harness = new MainnetConfigHarness();
    }

    // ── Every family the protocol ships is switched on ───────────────────────

    function test_theEndowmentFamilyIsWired() public view {
        assertTrue(
            harness.config().aaveStataToken != address(0),
            "cfg.aaveStataToken unset gates the whole Aave endowment family off (DeployCore:413)"
        );
    }

    function test_theZammFamilyIsWired() public view {
        assertTrue(
            harness.config().zamm != address(0),
            "cfg.zamm unset omits the ZAMM vault factory and liquidity deployer (DeployCore:400,645)"
        );
    }

    /// @dev CYPHER wound down (rth 2026-09-23) and the whole family came out of the tree. This used
    ///      to assert the opposite — that the mainnet config wired the rail — so it is inverted rather
    ///      than deleted: the config must carry NO Cypher field at all, and a re-introduction would
    ///      fail to compile here before it could reach a deploy. The mainnet addresses are gone from
    ///      `MainnetAddresses` for the same reason.
    function test_theCypherFamilyIsGone() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertTrue(cfg.v4PoolManager != address(0), "the venue families that remain are still wired");
        assertTrue(cfg.zamm != address(0), "the venue families that remain are still wired");
    }

    /// @dev `NetworkConfig.zQuoter`'s own doc: "EVERY DEPLOYMENT WIRES A QUOTER. address(0) IS A TEST
    ///      SHAPE, NOT A DEPLOYMENT OPTION." Unset ships multi-venue acquisition silently off, and
    ///      `deploy()` only warns — the vault takes the quoter as a constructor immutable, so it is
    ///      not repairable afterwards.
    function test_bestRouteAcquisitionIsWired() public view {
        assertTrue(harness.config().zQuoter != address(0), "cfg.zQuoter unset disables best-route acquisition");
    }

    // ── The endowment rail's two halves agree ────────────────────────────────

    /// @dev `deploy()` asserts `IStataToken(cfg.aaveStataToken).asset() == (cfg.aaveWeth || cfg.weth)`
    ///      against the live token, which is a fork check. What is checkable here is the config side of
    ///      it: mainnet leaves `aaveWeth` unset precisely because `waEthWETH.asset()` IS canonical WETH,
    ///      so a value appearing in that field is a change of premise and should be read, not inherited.
    ///      The live half is `test/fork/AaveEndowmentMainnetFork.t.sol`.
    function test_theEndowmentFamilyUsesCanonicalWeth() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertEq(cfg.aaveWeth, address(0), "mainnet resolves the endowment WETH back to cfg.weth");
        assertEq(cfg.weth, MainnetAddresses.WETH, "cfg.weth is canonical mainnet WETH");
    }

    // ── The rehearsal and the deploy read the same addresses ─────────────────

    /// @dev Not a tautology, and this is the assertion that closes the drift rather than the one
    ///      omission it produced: `DeployAnvil` runs on a MAINNET FORK, so every rail it inherits has
    ///      to be the rail mainnet has. Both scripts now read `MainnetAddresses`, and this pins the
    ///      mainnet side of that to the shared file — a future config that re-introduces a literal
    ///      here diverges from what the rehearsal exercises, and fails.
    function test_theMainnetConfigReadsTheSharedAddresses() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertEq(cfg.weth, MainnetAddresses.WETH, "weth");
        assertEq(cfg.v4PoolManager, MainnetAddresses.V4_POOL_MANAGER, "v4 pool manager");
        assertEq(cfg.v3Factory, MainnetAddresses.V3_FACTORY, "v3 factory");
        assertEq(cfg.v2Factory, MainnetAddresses.V2_FACTORY, "v2 factory");
        assertEq(cfg.zamm, MainnetAddresses.ZAMM_V1, "zamm");
        assertEq(cfg.zrouter, MainnetAddresses.ZROUTER, "zrouter");
        assertEq(cfg.zQuoter, MainnetAddresses.ZQUOTER, "zquoter");
        assertEq(cfg.aaveStataToken, MainnetAddresses.WETH_STATA_TOKEN, "aave stataToken");
    }

    // ── What is still owed before this script may be run ─────────────────────

    /// @dev Stated as a test so the launch-day preconditions are read back from the config rather than
    ///      from the TODO comment above it. These are the three the script's header names, and they are
    ///      TRUE while they are still owed — this file asserts the shape of the gap, and the seat that
    ///      closes one flips its assertion. `cfg.safe == 0` deploys a MockSafe; zero salts are unmined;
    ///      an empty roster launches with nothing to align to.
    function test_theKnownLaunchTodosAreStillOpen() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertEq(cfg.safe, address(0), "TODO 3: cfg.safe still deploys a MockSafe on mainnet");
        assertEq(cfg.saltMasterRegistry, bytes32(0), "TODO 1: the CREATE3 salt set is still unmined");
        assertEq(cfg.alignmentTargets.length, 0, "TODO 2: the alignment roster is still empty");
    }
}

/// @dev `_mainnetConfig()` is `internal`, which is right — it is the script's own statement of the
///      network and not an API. Inheriting is how a test reads it without widening that.
contract MainnetConfigHarness is DeployMainnet {
    function config() external pure returns (NetworkConfig memory) {
        return _mainnetConfig();
    }
}
