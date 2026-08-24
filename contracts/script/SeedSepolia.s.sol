// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import { SeedSepoliaShared, IShowcaseCurveState } from "./SeedSepoliaShared.sol";
import { AlignmentRegistryV1 } from "../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../src/master/interfaces/IAlignmentRegistry.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { UniAlignmentVaultFactory } from "../src/vaults/uni/UniAlignmentVaultFactory.sol";
import { IVaultPriceValidator } from "../src/interfaces/IVaultPriceValidator.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { MockERC20 } from "../test/mocks/MockERC20.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/// @notice Sepolia showcase seed, PHASE 1: alignment wiring, then CREATE + ARM every ERC404 row.
///         Buys nothing.
///
///         Run against the deployment `DeploySepolia` wrote (`deployments/sepolia.json`); every
///         address is read from that file rather than declared here.
///
///         ── WHY THIS BUYS NOTHING ──
///         `setBondingOpenTime` rejects a non-future timestamp and `buyBonding` reverts `TooEarly`
///         before it, and forge simulates an entire script at ONE timestamp before broadcasting any
///         of it. One script therefore cannot both arm a curve and buy into it. Phase 2
///         (`SeedSepoliaBuys.s.sol`) runs after the arm window has actually elapsed in wall-clock
///         time — see `app/scripts/sepolia-seed/` for the orchestrator that waits it out.
///
///         ── WHAT IT COSTS ──
///         Creating and arming a curve moves no ETH: the create call carries no value (the deploy
///         bond lever ships off) and every other call here is a write. Phase 1's cost is gas.
///
///         Run with:
///           forge script script/SeedSepolia.s.sol --account <keystore> --sender <deployer> \
///             --rpc-url <sepolia-rpc> --broadcast
contract SeedSepolia is SeedSepoliaShared {
    // V4 pool params for the alignment-target pools this seed stands up: 0.3% fee, tickSpacing 60,
    // no hooks — the same tier `DeployCore` builds the deployment's vault keys from.
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    /// @dev Starting price 1:1 (sqrt(1) * 2^96). A pool must be initialized before it can be named;
    ///      it holds no liquidity until someone adds some.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run() public {
        deployer = msg.sender;

        Deployed memory d = _readDeployed();
        require(block.chainid == SEPOLIA_CHAIN_ID, "SeedSepolia: not running against Sepolia (or a fork of it)");

        _reportSpend("phase 1 (create + arm)", 0, deployer.balance);

        // ── Alignment wiring: fixture tokens, targets, vaults, pools ──
        SeedHandoff memory h = _seedAlignment(d);

        // ── The ERC404 roster: create + arm, nothing bought ──
        ShowcaseLeg[] memory legs = _showcaseRoster();
        address[] memory instances = new address[](legs.length);
        uint256 armWindow = _armWindow();
        uint256 maturityOffset = _maturityOffset();
        uint256 latestArm;

        for (uint256 i = 0; i < legs.length; i++) {
            _assertPieceBase(legs[i].pieceBase, legs[i].slug);
            (address inst, uint256 armedUntil) = _createAndArm(d, legs[i], h.ms2Vault, armWindow, maturityOffset);
            instances[i] = inst;
            if (armedUntil > latestArm) latestArm = armedUntil;
            console.log(string.concat("ARMED ", legs[i].slug), inst);
        }

        // Phase 2 becomes legal only once the LAST clock phase 1 set has passed, plus slack for the
        // wall-clock the broadcast itself consumed. Recorded rather than recomputed later, so the
        // orchestrator waits for the same instant the chain will judge the buys against.
        h.phase2NotBefore = latestArm + _phase2Slack();

        _assertPhase1(legs, instances);
        _writeSeedState(legs, instances, h);

        console.log("=== SeedSepolia (phase 1: create + arm) complete ===");
        console.log("  rows armed:", legs.length);
        console.log("  block.timestamp now:", block.timestamp);
        console.log("  phase 2 is legal from (unix):", h.phase2NotBefore);
        console.log("  wall-clock wait from now (seconds):", h.phase2NotBefore - block.timestamp);
        console.log("  NEXT: wait out the window, then run SeedSepoliaBuys.s.sol");
    }

    // ─────────────────────── Alignment targets, vaults, pools ───────────────────────

    /// @dev Two fixture alignment targets with their own Uni-V4 vaults, carried over from the seed
    ///      this replaces. The tokens are FIXTURES: `MockERC20`s that exist so a target has an asset
    ///      to name and a vault something to be aligned to. They are labelled as fixtures in the
    ///      target's own on-chain description, because a testnet target that reads as a real
    ///      community token is exactly the fiction the showcase refuses.
    function _seedAlignment(Deployed memory d) internal returns (SeedHandoff memory h) {
        AlignmentRegistryV1 registry = AlignmentRegistryV1(d.alignmentRegistry);
        UniAlignmentVaultFactory factory = UniAlignmentVaultFactory(d.uniVaultFactory);

        vm.startBroadcast();

        MockERC20 ms2 = new MockERC20("Station Fixture Token", "MS2");
        MockERC20 cult = new MockERC20("Community Fixture Token", "CULT");
        h.ms2Token = address(ms2);
        h.cultToken = address(cult);

        h.ms2TargetId = _registerTarget(
            registry,
            address(ms2),
            "MS2",
            "Station",
            "Alignment target demonstrating the vault flow. Its asset is a testnet FIXTURE token, not a traded coin - what it exists to show is where a collection's alignment tithe goes and what the vault does with it."
        );
        h.cultTargetId = _registerTarget(
            registry,
            address(cult),
            "CULT",
            "Community",
            "A second alignment target, so the registry index and the target picker have more than one row to choose between. Its asset is a testnet FIXTURE token."
        );

        h.ms2Vault = _deployAndWireVault(d, factory, address(ms2), "MS2", h.ms2TargetId);
        h.cultVault = _deployAndWireVault(d, factory, address(cult), "CULT", h.cultTargetId);

        vm.stopBroadcast();

        console.log("ALIGNMENT ms2 target/vault:", h.ms2TargetId, h.ms2Vault);
        console.log("ALIGNMENT cult target/vault:", h.cultTargetId, h.cultVault);
    }

    function _registerTarget(
        AlignmentRegistryV1 registry,
        address token,
        string memory symbol,
        string memory title,
        string memory description
    ) internal returns (uint256 targetId) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: token, symbol: symbol, info: description, metadataURI: "" });
        targetId = registry.registerAlignmentTarget(title, description, "", assets);
    }

    /// @dev Deploy the target's vault, initialize its V4 pool, point the vault at that pool, and
    ///      register it. All four, because leaving any one undone produces a vault that looks wired
    ///      and cannot LP: the pool key lives on the vault (not in the registry), the pool has to
    ///      exist before it can be named, and an unregistered vault is refused at instance-create.
    function _deployAndWireVault(
        Deployed memory d,
        UniAlignmentVaultFactory factory,
        address token,
        string memory symbol,
        uint256 targetId
    ) internal returns (address vault) {
        bytes32 salt = keccak256(abi.encode(block.chainid, targetId, symbol, "UNIv4-SHOWCASE"));
        vault = factory.deployVault(salt, token, targetId, IVaultPriceValidator(address(0)));

        // Native ETH is currency0 — address(0) sorts below every token address, so the ordering holds
        // without a comparison.
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(address(0))
        });
        IPoolManager(d.v4PoolManager).initialize(key, SQRT_PRICE_1_1);
        factory.setVaultPoolKey(vault, key);

        MasterRegistryV1(d.masterRegistry)
            .registerVault(
                vault,
                deployer,
                string.concat(symbol, " UNIv4 Vault"),
                _collectionMeta(
                    string.concat(symbol, " UNIv4 Vault"),
                    "Alignment vault for the showcase. A collection aligned to this target sends it 19 percent of its graduation raise, by contract.",
                    ""
                ),
                targetId
            );
    }

    // ─────────────────────── Create + arm ───────────────────────

    /// @dev Create one roster row and set its clocks. Returns the latest timestamp the row's state
    ///      depends on, which is what phase 2 must wait past.
    ///
    ///      THE PRE-OPEN ROW IS ARMED ON A DIFFERENT CLOCK, DELIBERATELY. Every other row opens after
    ///      the short arm window because a human is waiting on it. The pre-open row must still be
    ///      pre-open when a stranger arrives days later — that state IS its whole demonstration — so
    ///      it takes `SEPOLIA_PREOPEN_DELAY_SECONDS` (default 30 days) and is excluded from the wait
    ///      phase 2 computes.
    function _createAndArm(
        Deployed memory d,
        ShowcaseLeg memory leg,
        address vault,
        uint256 armWindow,
        uint256 maturityOffset
    ) internal returns (address inst, uint256 armedUntil) {
        vm.startBroadcast();
        inst = _createShowcaseInstance(d, leg, vault);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));

        if (leg.state == STATE_PREOPEN) {
            b.setBondingOpenTime(block.timestamp + _preopenDelay());
            b.setBondingActive(true);
            armedUntil = 0; // never waited for
        } else {
            uint256 openAt = block.timestamp + armWindow;
            b.setBondingOpenTime(openAt);
            armedUntil = openAt;
            if (leg.state == STATE_READY) {
                // Maturity is what makes the graduate action live, and the setter requires it to be
                // strictly after the open time — so it is the open time plus a small offset, and it,
                // not the open time, is this row's real wait.
                uint256 matureAt = openAt + maturityOffset;
                b.setBondingMaturityTime(matureAt);
                armedUntil = matureAt;
            }
            b.setBondingActive(true);
        }
        vm.stopBroadcast();
    }

    // ─────────────────────── Phase 1 post-conditions ───────────────────────

    /// @dev Everything phase 1 claims, checked before the hand-off file is written. `require`s, not
    ///      logs: forge simulates the whole script first, so a failure here leaves no partial seed and
    ///      names the row that failed.
    function _assertPhase1(ShowcaseLeg[] memory legs, address[] memory instances) internal view {
        for (uint256 i = 0; i < legs.length; i++) {
            IShowcaseCurveState s = IShowcaseCurveState(instances[i]);
            string memory slug = legs[i].slug;
            require(instances[i] != address(0), string.concat("phase1: ", slug, " was not created"));
            require(s.bondingActive(), string.concat("phase1: ", slug, " is not armed"));
            require(s.bondingOpenTime() > block.timestamp, string.concat("phase1: ", slug, " opened during phase 1"));
            require(s.totalBondingSupply() == 0, string.concat("phase1: ", slug, " was bought into by phase 1"));
            if (legs[i].state == STATE_READY) {
                require(
                    s.bondingMaturityTime() > s.bondingOpenTime(),
                    string.concat("phase1: ", slug, " has no maturity after its open time")
                );
            }
        }
        console.log("PHASE-1 post-conditions OK");
    }
}
