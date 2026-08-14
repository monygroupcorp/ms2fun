// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { SeedAnvilShared, IOwnable } from "./SeedAnvilShared.sol";

/// @notice Anvil-only seed, PHASE 2: every buy, everything downstream of a buy, and the ownership
///         handover to the testing wallet.
///
///         Runs after SeedAnvil (phase 1) and after deploy.ts advances the anvil clock past every
///         `bondingOpenTime` phase 1 armed. It must not run before that advance: `buyBonding`
///         reverts `TooEarly` on an unopened curve (noesis-205), and because forge simulates a
///         script before broadcasting any of it, that revert kills the whole run at SIMULATION —
///         nothing broadcasts, and the failure names the buy rather than the missing advance.
///
///         Instances are resolved BY NAME from deployments/anvil-seed.json, which phase 1 wrote.
contract SeedAnvilBuys is SeedAnvilShared {
    function run() public {
        deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        acct1 = vm.addr(ACCOUNT_1_KEY);

        Deployed memory d = _readDeployed();
        (SeededErc404 memory s, address[] memory all) = _readSeedState();

        // EMBER is deliberately absent from everything below: it is the PREOPEN demo, its open time
        // is +1 day, and buying into it would both revert and destroy the state it exists to show.
        _buysMidCurve(s.vapor);
        _buyReadyToGraduate(s.cinder, "cinder");
        _buyReadyToGraduate(s.molten, "molten");
        _buysCarveDemo(s.carve);
        _buysStacked(d, s.stacked);

        // Hand everything to the team's testing wallet (LAST — after all owner-only seeding, which
        // includes this phase's staking activation and overlay authoring).
        _transferAdmin(all);

        console.log("=== SeedAnvilBuys (phase 2: buys + handover) complete ===");
        console.log("ERC404 : vapor mid-curve + staked; cinder/molten bought (reserve > 0, graduate-ready)");
        console.log("ERC404 : carve reserve >= 3 ETH; stacked ids 1-3 held + overlay authored");
        console.log("block.timestamp now:", block.timestamp);
    }

    /// @dev MID-CURVE: several buys from deployer + acct1 so BondingSale events give the candles a
    ///      real price history, then staking activated and a slice staked, then ADMIN gets a whole
    ///      unit so the testing wallet's PORTFOLIO shows real ERC404 holdings.
    function _buysMidCurve(address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));

        // Buy amount: >= normalizationFactor (else cost rounds to 0 -> PurchaseTooSmall) and well
        // under maxBondingSupply (~9e24 for preset 1: maxSupply 1e25 - 10% reserve). unit = 1e24.
        uint256 buyAmount = 1e23; // 0.1 NFT-equivalent worth of tokens per buy

        _buyBonding(b, deployerKey, buyAmount);
        _buyBonding(b, ACCOUNT_1_KEY, buyAmount);
        _buyBonding(b, deployerKey, buyAmount);
        // One larger deployer buy so there's enough to seed ADMIN a whole NFT (unit = 1e24).
        _buyBonding(b, deployerKey, 12e23);

        vm.startBroadcast(deployerKey);
        b.activateStaking();
        b.stake(buyAmount / 2);
        b.transfer(ADMIN, 1e24); // DN404: a whole-unit transfer mints the NFT to ADMIN
        vm.stopBroadcast();

        console.log("MID-CURVE vapor bought + staked:", inst);
    }

    /// @dev READY-TO-GRADUATE: one buy, because deployLiquidity requires reserve > 0. Maturity was
    ///      set in phase 1 to a time still ahead of this buy, so the curve is open but NOT yet
    ///      matured here; deploy.ts's second advance is what unlocks the graduate button.
    function _buyReadyToGraduate(address inst, string memory label) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        _buyBonding(b, deployerKey, 1e23);
        require(b.reserve() > 0, string.concat(label, ": reserve is 0, deployLiquidity would revert"));
        console.log("READY-TO-GRADUATE bought:", label, inst);
    }

    /// @dev CARVE DEMO: walk the curve until the reserve clears 3 ETH so the carve has real headroom
    ///      above the 1 ETH pool floor. Bounded: preset 1 targets ~25 ETH over ~9e24 bondable
    ///      tokens, so 3 ETH arrives well inside the iteration cap.
    ///
    ///      The require below is the seed's one real assertion about buy VOLUME — it reds if the
    ///      buys stop landing rather than letting a thin reserve reach the demo silently. Do not
    ///      soften it to make a run pass.
    function _buysCarveDemo(address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        for (uint256 i = 0; i < 24 && b.reserve() < 3 ether; i++) {
            _buyBonding(b, i % 2 == 0 ? ACCOUNT_1_KEY : deployerKey, 5e23);
        }
        require(b.reserve() >= 3 ether, "carve demo: reserve did not reach 3 ETH");
        console.log("CARVE demo reserve (wei):", b.reserve());
    }

    /// @dev STACKED METADATA: deployer buys 3 whole units WITH NFTs minted -> owns ids 1,2,3 (all
    ///      below the reserved band, as intended). The artist authoring that follows includes a
    ///      HOLDER write (unlock+pin on id 3), so it cannot precede the buy — which is why the whole
    ///      block lives in phase 2 rather than only the buy.
    function _buysStacked(Deployed memory d, address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        _buyBondingMint(b, deployerKey, 3e24);

        vm.startBroadcast(deployerKey);
        MetadataOverlayModule ov = MetadataOverlayModule(d.overlay);
        // An opt-in open event wave (holders select it; not auto because autoLatest=false).
        ov.publishWave(inst, "event-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST);
        // A paid commission on id 3 (outside the band range), then unlock+pin it as the holder.
        ov.setCommission(
            inst, 3, "commission-3", MetadataOverlayModule.CommCond.PAY, 0.01 ether, MetadataOverlayModule.Payout.ARTIST
        );
        ov.unlock{ value: 0.01 ether }(inst, 3);
        vm.stopBroadcast();

        console.log("STACKED prism bought + authored:", inst);
    }

    /// @dev Hand ownership of every seeded INSTANCE to ADMIN (the testing wallet) + fund it, so it
    ///      drives creator admin from the UI. Runs LAST, as the deployer, after all owner-only seeding
    ///      (instances use Solady's single-step transferOwnership).
    ///
    ///      The platform REGISTRIES (MasterRegistry/Alignment/Component/FeaturedQueue) are UUPS proxies
    ///      that override transferOwnership to force the 2-step `requestOwnershipHandover` flow — which
    ///      the NEW owner must initiate, and we don't hold ADMIN's key here. So protocol-admin
    ///      ownership is deferred to Phase 3 (handled via anvil impersonation in deploy.ts, or by ADMIN
    ///      requesting the handover from the admin console). The deployer stays the protocol owner.
    function _transferAdmin(address[] memory all) internal {
        vm.startBroadcast(deployerKey);
        // Fund ADMIN so it can pay gas + value actions (queuePiece deposit, bids, buys) immediately.
        (bool funded,) = ADMIN.call{ value: 50 ether }("");
        require(funded, "fund ADMIN failed");
        for (uint256 i = 0; i < all.length; i++) {
            IOwnable(all[i]).transferOwnership(ADMIN);
        }
        vm.stopBroadcast();
        console.log("Handed", all.length, "instances (creator admin) + 50 ETH to ADMIN:");
        console.log(ADMIN);
    }
}
