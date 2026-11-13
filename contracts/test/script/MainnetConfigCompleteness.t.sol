// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { DeployMainnet } from "../../script/DeployMainnet.s.sol";
import { MainnetAddresses } from "../../script/MainnetAddresses.sol";
import { SepoliaSalts } from "../../script/SepoliaSalts.sol";

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

    /// @dev `NetworkConfig.zQuoter`'s own doc: "EVERY DEPLOYMENT WIRES A QUOTER. address(0) IS A TEST
    ///      SHAPE, NOT A DEPLOYMENT OPTION." Unset ships multi-venue acquisition silently off, and
    ///      `deploy()` only warns — the vault takes the quoter as a constructor immutable, so it is
    ///      not repairable afterwards.
    function test_bestRouteAcquisitionIsWired() public view {
        assertTrue(harness.config().zQuoter != address(0), "cfg.zQuoter unset disables best-route acquisition");
    }

    // ── The config carries these fields and no others ────────────────────────

    /// @dev The CYPHER venue wound down and the whole family came out of the tree, `NetworkConfig`'s
    ///      field for it included. This used to assert the opposite — that the mainnet config wired
    ///      the rail — and inverting it into a runtime read of the remaining fields would have proved
    ///      nothing: a re-added `cypherPositionManager` would compile, deploy, and leave every such
    ///      assertion green.
    ///
    ///      So the guard is the compiler's, and it is deliberately blunt: the named-argument struct
    ///      constructor below must supply EVERY field of `NetworkConfig` and may supply no other, so
    ///      a field added, removed or renamed anywhere in that struct fails to build this file until
    ///      someone comes here and says so. A wound-down rail cannot quietly reappear in the config a
    ///      mainnet deploy reads. The cost is that an intended field change also stops here — that is
    ///      the price of the guard, not a defect in it, and the fix is one line in the list below.
    ///
    ///      The runtime half keeps the enumeration honest: the rebuilt struct is compared to the real
    ///      config, so a field copied from the wrong source is caught rather than merely named.
    function test_theNetworkConfigCarriesExactlyTheseFields() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        DeployCore.NetworkConfig memory rebuilt = DeployCore.NetworkConfig({
            chainId: cfg.chainId,
            weth: cfg.weth,
            v4PoolManager: cfg.v4PoolManager,
            v3Factory: cfg.v3Factory,
            v2Factory: cfg.v2Factory,
            zamm: cfg.zamm,
            aaveStataToken: cfg.aaveStataToken,
            aaveWeth: cfg.aaveWeth,
            zrouter: cfg.zrouter,
            zrouterChain: cfg.zrouterChain,
            safe: cfg.safe,
            zQuoter: cfg.zQuoter,
            saltMasterRegistry: cfg.saltMasterRegistry,
            saltTreasury: cfg.saltTreasury,
            saltQueueManager: cfg.saltQueueManager,
            saltGlobalMsgReg: cfg.saltGlobalMsgReg,
            saltAlignmentReg: cfg.saltAlignmentReg,
            saltComponentReg: cfg.saltComponentReg,
            saltNonce: cfg.saltNonce,
            priceDeviationBps: cfg.priceDeviationBps,
            twapSeconds: cfg.twapSeconds,
            zrouterFee: cfg.zrouterFee,
            zrouterTickSpacing: cfg.zrouterTickSpacing,
            zammFeeOrHook: cfg.zammFeeOrHook,
            hookFeeBips: cfg.hookFeeBips,
            lpFeeRate: cfg.lpFeeRate,
            alignmentTargets: cfg.alignmentTargets,
            jsonOutputPath: cfg.jsonOutputPath
        });
        assertEq(
            keccak256(abi.encode(rebuilt)),
            keccak256(abi.encode(cfg)),
            "the field list above no longer enumerates the mainnet config faithfully"
        );
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

    // ── The alignment roster is populated ─────────────────────────────────────

    /// @dev The curated launch roster: five communities, each already rehearsed on Sepolia under a
    ///      fixture standing in for the mainnet address asserted here
    ///      (`SeedSepoliaShared._alignmentRoster`). Pins the tokens and the order, not merely the
    ///      count, so a roster entry silently dropped or swapped is a named failure.
    function test_theAlignmentRosterIsPopulated() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertEq(cfg.alignmentTargets.length, 5, "the mainnet roster no longer carries the curated five");
        assertEq(cfg.alignmentTargets[0].token, 0x0000000000c5dc95539589fbD24BE07c6C14eCa4, "CULT");
        assertEq(cfg.alignmentTargets[1].token, 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820, "MS2");
        assertEq(cfg.alignmentTargets[2].token, 0xE0f63A424a4439cBE457D80E4f4b51aD25b2c56C, "SPX6900");
        assertEq(cfg.alignmentTargets[3].token, 0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a, "MOG");
        assertEq(cfg.alignmentTargets[4].token, 0xE9b1cFEA55BAA219e34301f2F31b9FD0921664ED, "ZAMM");
        for (uint256 i = 0; i < cfg.alignmentTargets.length; i++) {
            assertTrue(cfg.alignmentTargets[i].deployUniVault, "every roster entry opens the Uni venue");
            assertEq(cfg.alignmentTargets[i].communityPayout, address(0), "payout is pinned post-deploy, not here");
        }
    }

    // ── What is still owed before this script may be run ─────────────────────

    /// @dev `cfg.safe` administers the Timelock that owns the protocol (`DeployTimelock`,
    ///      `MigrateOwnership`), so a zero here silently deploys a `MockSafe` instead — this is the
    ///      governance root and it is pinned to the real Safe, not merely asserted non-zero.
    function test_theGovernanceSafeIsWired() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertEq(
            cfg.safe,
            0xBCE7DF8d399F145745C660DecB9ef50CA723d262,
            "cfg.safe must be the 1-of-1 mainnet Safe owned by 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6"
        );
    }

    /// @dev Mainnet spends the salt set Sepolia rehearsed. The guarded salt takes no chain id, so the
    ///      same deployer and the same salts give mainnet the six registry addresses Sepolia carries;
    ///      `SepoliaSaltSet.t.sol` checks the set itself.
    function test_theSaltSetIsTheOneSepoliaRehearsed() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertEq(cfg.saltMasterRegistry, SepoliaSalts.MASTER_REGISTRY, "master registry salt");
        assertEq(cfg.saltTreasury, SepoliaSalts.TREASURY, "treasury salt");
        assertEq(cfg.saltQueueManager, SepoliaSalts.QUEUE_MANAGER, "queue manager salt");
        assertEq(cfg.saltGlobalMsgReg, SepoliaSalts.GLOBAL_MSG_REG, "global message registry salt");
        assertEq(cfg.saltAlignmentReg, SepoliaSalts.ALIGNMENT_REG, "alignment registry salt");
        assertEq(cfg.saltComponentReg, SepoliaSalts.COMPONENT_REG, "component registry salt");
    }

    /// @dev The perpetual swap tithe's RATE. Ruled 2026-11-10 (rth): mainnet launches on 1% fees,
    ///      live from the first graduation, not deferred to a later `EnableAlignmentTithe`
    ///      switch-on. The rate is IMMUTABLE per hook, baked into the hook's init code at graduation,
    ///      so the number this config holds on the day is the number every pool graduating from
    ///      launch keeps for good — matched here to the rate Sepolia rehearsed.
    function test_theMainnetTitheRateIsLiveAtLaunch() public view {
        DeployCore.NetworkConfig memory cfg = harness.config();
        assertEq(cfg.hookFeeBips, 100, "mainnet's perpetual swap-tithe rate must be live at 1% from launch");
        assertEq(uint256(cfg.lpFeeRate), 3000, "mainnet's hooked-pool LP fee rate must match the rehearsed 0.3%");
    }
}

/// @dev `_mainnetConfig()` is `internal`, which is right — it is the script's own statement of the
///      network and not an API. Inheriting is how a test reads it without widening that.
contract MainnetConfigHarness is DeployMainnet {
    function config() external pure returns (NetworkConfig memory) {
        return _mainnetConfig();
    }
}
