// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import {
    SeedSepoliaShared,
    IShowcaseCurveState,
    IMerkleGatingView,
    IShowcaseTierState,
    IShowcaseStakingState,
    IShowcaseCarveParams
} from "./SeedSepoliaShared.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { IDynamicPricingModule } from "../src/factories/erc1155/interfaces/IDynamicPricingModule.sol";
import { ERC721AuctionInstance } from "../src/factories/erc721/ERC721AuctionInstance.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { MerkleProofLib } from "solady/utils/MerkleProofLib.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";

/// @dev The two pool parameters the graduation pool is opened with. Read off the deployed module so
///      the liquidity check below names the pool graduation actually created, not a guess at it.
interface IUniV4DeployerParams {
    function poolFee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function alignmentHookFactory() external view returns (address);
}

/// @notice Sepolia showcase seed, PHASE 2: the buys that produce the mid-curve, ready-to-graduate and
///         graduated states, and the graduation itself.
///
///         Runs after phase 1 and after the arm window has elapsed IN WALL-CLOCK TIME. It must not run
///         before that: `buyBonding` reverts `TooEarly` on an unopened curve, and because forge
///         simulates a script before broadcasting any of it, that revert kills the whole run at
///         SIMULATION and names the buy rather than the missing wait. The guard below fails earlier
///         still, with the seconds remaining, so the operator is never left reading a `TooEarly`.
///
///         Rows are resolved BY NAME from `deployments/sepolia-seed.json`, which phase 1 wrote.
///
///         Run with:
///           forge script script/SeedSepoliaBuys.s.sol --account <keystore> --sender <deployer> \
///             --rpc-url <sepolia-rpc> --broadcast
contract SeedSepoliaBuys is SeedSepoliaShared {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function run() public {
        deployer = msg.sender;

        Deployed memory d = _readDeployed();
        ShowcaseLeg[] memory legs = _showcaseRoster();
        (address[] memory instances, SeedHandoff memory h) = _readSeedState(legs);

        // Written as an `if`/`revert` rather than a `require`, because Solidity evaluates a require's
        // message eagerly: the subtraction that reports the remaining wait underflows on exactly the
        // runs that are supposed to pass.
        if (block.timestamp < h.phase2NotBefore) {
            revert(
                string.concat(
                    "phase 2: the arm window has not elapsed yet - wait ",
                    vm.toString(h.phase2NotBefore - block.timestamp),
                    " more seconds"
                )
            );
        }

        // ── The projection, printed BEFORE anything is broadcast ──
        //
        // Every buy's cost is computed against the supply the curve will actually be at when that buy
        // lands, walking the rows in the same order they are bought. On a public testnet this ETH is a
        // human's faucet balance, so the total has to be visible at simulation time — which is before
        // `--broadcast` sends the first transaction.
        uint256[] memory amounts = new uint256[](legs.length);
        uint256 projected;
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].fillBps == 0) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            amounts[i] = _fillAmount(b, legs[i].fillBps);
            projected += _buyCost(b, amounts[i]);
        }
        // The breadth rows' curve spend, projected the same way and against the same balance. Reported
        // as ONE number with the roster's, because what the operator is deciding is whether to send
        // this phase at all.
        uint256 breadthProjected = _projectBreadth(h);
        _reportSpend("phase 2 (buys + graduation)", projected + breadthProjected, deployer.balance);
        console.log("  of which the breadth rows (wei):", breadthProjected);
        require(
            deployer.balance > projected + breadthProjected,
            "phase 2: deployer balance does not cover the projected curve spend"
        );

        // ── The buys ──
        uint256 spent;
        for (uint256 i = 0; i < legs.length; i++) {
            if (amounts[i] == 0) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            // mintNFT: the pieces are half of what a DN404 collection is, and a showcase row whose
            // gallery is empty demonstrates the coin only. The fill is sized in whole units precisely
            // so this mints a countable number of ids rather than a wall of them.
            uint256 cost = _buyBondingMint(b, amounts[i]);
            spent += cost;
            console.log(string.concat("BOUGHT ", legs[i].slug), amounts[i], cost);
        }

        // ── The graduation ──
        uint128 poolLiquidity = _graduate(d, legs, instances);

        _assertShowcaseStates(_states(instances), legs, block.timestamp, poolLiquidity);

        // ── The breadth rows: fill them, cross them, then assert every claim ──
        (uint256 breadthSpent, uint256 carveRaise) = _fillBreadth(d, h);
        spent += breadthSpent;
        _assertBreadth(d, h, carveRaise);

        console.log("=== SeedSepoliaBuys (phase 2: buys + graduation) complete ===");
        console.log("  curve ETH spent (wei):", spent);
        console.log("  graduated pool liquidity:", poolLiquidity);
        console.log("  block.timestamp now:", block.timestamp);
        console.log("POST-CONDITIONS OK: pre-open / mid-curve / ready-to-graduate / graduated");
    }

    // ─────────────────────── Fills ───────────────────────

    /// @dev The tokens to buy for a given fill, rounded DOWN to a whole DN404 unit. Whole units are
    ///      what mint pieces; a fill that is not a unit multiple buys coin that shows up in no gallery.
    function _fillAmount(ERC404BondingInstance b, uint256 fillBps) internal view returns (uint256 amount) {
        uint256 unit = b.unit();
        uint256 target = (_bondableRemaining(b) * fillBps) / 10_000;
        amount = (target / unit) * unit;
        require(amount >= unit, "fill: rounds below one whole unit (raise the fill bps)");
    }

    // ─────────────────────── Graduation ───────────────────────

    /// @dev Graduate the row that claims the graduated state and read back the venue pool's liquidity.
    ///
    ///      `deployLiquidity(0)` — no carve. The carve is its own surface with its own disclosure, and
    ///      the row that carries a declared allowance here is the READY row, which is left uncrossed
    ///      so a visitor can perform the graduation (and the carve) themselves. Taking the carve on
    ///      this row would spend the demonstration to reach it.
    function _graduate(Deployed memory d, ShowcaseLeg[] memory legs, address[] memory instances)
        internal
        returns (uint128 liquidity)
    {
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].state != STATE_GRADUATED) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            require(b.reserve() > 0, string.concat("graduate: ", legs[i].slug, " holds no raise"));

            vm.startBroadcast();
            b.deployLiquidity(0);
            vm.stopBroadcast();

            liquidity = _poolLiquidity(d, instances[i]);
            console.log(string.concat("GRADUATED ", legs[i].slug), instances[i], liquidity);
        }
    }

    /// @dev Live liquidity in the pool graduation opened. The key is rebuilt from the deployer
    ///      module's own immutables — the fee tier, the tick spacing and the hook selection are the
    ///      module's, so reading them back is the only way to name the same pool it created.
    function _poolLiquidity(Deployed memory d, address instance) internal view returns (uint128) {
        IUniV4DeployerParams mod = IUniV4DeployerParams(d.uniDeployer);
        // The hook is only non-zero when an alignment-hook factory has been selected on the module,
        // which ships OFF. Reading it keeps this check correct if that lever is ever turned on.
        require(mod.alignmentHookFactory() == address(0), "pool: an alignment hook is wired - key unknown to the seed");
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)), // native ETH sorts below every token
            currency1: Currency.wrap(instance),
            fee: mod.poolFee(),
            tickSpacing: mod.tickSpacing(),
            hooks: IHooks(address(0))
        });
        return IPoolManager(d.v4PoolManager).getLiquidity(key.toId());
    }

    function _states(address[] memory instances) internal pure returns (IShowcaseCurveState[] memory states) {
        states = new IShowcaseCurveState[](instances.length);
        for (uint256 i = 0; i < instances.length; i++) {
            states[i] = IShowcaseCurveState(instances[i]);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    //                        WAVE 2 — CROSSING THE BREADTH ROWS INTO THEIR STATES
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // Everything here needs the wall-clock wait phase 1 recorded, for the same two reasons the spine
    // does: a curve rejects a buy before its open time, and an auction lot rejects a settle before its
    // end. Neither can be fast-forwarded on a public testnet, which is why they are in this phase.

    /// @dev The breadth rows' curve spend, walked in the order the buys land, so the projection is the
    ///      cost the chain will actually charge rather than a sum of independent quotes.
    function _projectBreadth(SeedHandoff memory h) internal view returns (uint256 projected) {
        ERC404BondingInstance quarry = ERC404BondingInstance(payable(h.staking404));
        projected += _buyCost(quarry, _fillAmount(quarry, _stakingFillBps()));

        ERC404BondingInstance prism = ERC404BondingInstance(payable(h.tiers404));
        projected += _buyCost(prism, _tierBuyAmount(prism));

        ERC404BondingInstance carve = ERC404BondingInstance(payable(h.carve404));
        projected += _buyCost(carve, _fillAmount(carve, _carveFillBps()));

        // The overlay commission is paid by the seed to prove the pay-and-pin path settles. It is not
        // curve spend, but it leaves the same balance, so it belongs in the number being confirmed.
        projected += _commissionPrice();
    }

    /// @dev The tier row is bought in WHOLE UNITS rather than in bps: every tier operation is
    ///      denominated in units, and a fill that is not a unit multiple buys coin that can never be
    ///      folded into a band.
    function _tierBuyAmount(ERC404BondingInstance b) internal view returns (uint256 amount) {
        amount = _tierUnits() * b.unit();
        require(
            amount <= _bondableRemaining(b), "tiers: the tier walk needs more units than the curve has left to sell"
        );
    }

    /// @return spent      the ETH the breadth rows put into their curves
    /// @return carveRaise the raise the carve row graduated ON, captured BEFORE `deployLiquidity`
    ///         zeroes it — the figure the carve was judged against, read rather than reconstructed.
    function _fillBreadth(Deployed memory d, SeedHandoff memory h)
        internal
        returns (uint256 spent, uint256 carveRaise)
    {
        spent += _fillStakingRow(h);
        spent += _fillTierRow(d, h);
        uint256 carveCost;
        (carveCost, carveRaise) = _fillCarveRow(d, h);
        spent += carveCost;
        _crossAuctions(h);
    }

    // ─────────────────────── 3. Staking: buy, then stake part of it ───────────────────────

    /// @dev Only PART of the bought position is staked. A row whose entire float is locked cannot
    ///      demonstrate the stake action a second time, and the unstake action needs something to
    ///      leave behind — so the split is a knob and defaults to half.
    function _fillStakingRow(SeedHandoff memory h) internal returns (uint256 cost) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(h.staking404));
        uint256 amount = _fillAmount(b, _stakingFillBps());
        cost = _buyBondingMint(b, amount);

        uint256 toStake = (amount * _stakeShareBps()) / 10_000;
        require(toStake > 0, "staking: the stake share rounds to nothing");
        vm.startBroadcast();
        b.stake(toStake);
        vm.stopBroadcast();

        console.log("STAKED quarry-staking (amount, cost wei):", toStake, cost);
    }

    // ─────────────────────── 4/5. Tiers + the metadata stack ───────────────────────

    /// @dev The tier walk, in the only order that works.
    ///
    ///      The SCARCE rung is taken first. `mintUp` pays its escrow by transferring coin out, and
    ///      DN404 reconciles that by burning the caller's NFTs LIFO off the TAIL of their owned array
    ///      — so the id being folded must sit near the FRONT or the escrow leg burns it and reverts
    ///      the whole call. Taking the expensive rung first, off index 0, keeps every later burn away
    ///      from the id it is about to consume.
    ///
    ///      The OPEN rung is then taken and immediately given back, because "reversible" is the half
    ///      of Token Tiers that a static seed cannot otherwise show: after the mint-down the rung has
    ///      room again, its escrow has returned as spendable coin, and the freed band id is at the
    ///      front of the queue for the next holder.
    function _fillTierRow(Deployed memory d, SeedHandoff memory h) internal returns (uint256 cost) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(h.tiers404));
        cost = _buyBondingMint(b, _tierBuyAmount(b));

        uint256 idLimit = b.maxSupply() / b.unit();

        vm.startBroadcast();
        b.mintUp(TIER_N_SCARCE, _lowestOrdinaryId(b, idLimit));
        b.mintUp(TIER_N_OPEN, _lowestOrdinaryId(b, idLimit));
        b.mintDown(_lowestBandIdOfTier(b, idLimit, TIER_N_OPEN));
        vm.stopBroadcast();

        // The metadata layers, authored on ids the seed still holds. `unlock` is a HOLDER write, so it
        // cannot precede the buy, and `setCommission` becomes immutable the moment it is paid.
        uint256[] memory ordinary = _ordinaryIds(b, idLimit);
        require(ordinary.length >= 2, "tiers: not enough ordinary ids left to author both commissions");
        uint256 paidId = ordinary[0];
        uint256 unpaidId = ordinary[1];
        uint256 price = _commissionPrice();

        vm.startBroadcast();
        MetadataOverlayModule ov = MetadataOverlayModule(d.overlay);
        // A commission's payload is a real metadata URI in a THIRD collection, not a label: the
        // overlay wins over both the band and the base, so it has to carry a picture of its own for
        // the top of the precedence stack to show anything.
        ov.setCommission(
            h.tiers404,
            paidId,
            string.concat(ART_BASE_SIMIAN, vm.toString(paidId)),
            MetadataOverlayModule.CommCond.PAY,
            price,
            MetadataOverlayModule.Payout.ARTIST
        );
        ov.unlock{ value: price }(h.tiers404, paidId);
        // A second, UNPAID commission so the pay-and-pin path arrives as a live action for a visitor
        // rather than pre-consumed by the seed.
        ov.setCommission(
            h.tiers404,
            unpaidId,
            string.concat(ART_BASE_SIMIAN, vm.toString(unpaidId)),
            MetadataOverlayModule.CommCond.PAY,
            price,
            MetadataOverlayModule.Payout.ARTIST
        );
        vm.stopBroadcast();

        console.log("TIERS prism-tiers walked (cost wei):", cost);
        console.log("  commission paid on id / left unpaid on id:", paidId, unpaidId);
    }

    /// @dev The caller's lowest ORDINARY id — one in `[1..idLimit]`, never a band id. Lowest because
    ///      the owned array is filled in mint order, so the lowest id is also the one furthest from
    ///      the tail the escrow leg burns from.
    function _lowestOrdinaryId(ERC404BondingInstance b, uint256 idLimit) internal view returns (uint256 id) {
        uint256[] memory ids = b.ownedIdsOf(deployer);
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] != 0 && ids[i] <= idLimit && (id == 0 || ids[i] < id)) id = ids[i];
        }
        require(id != 0, "tiers: no ordinary id held (nothing to fold into a band)");
    }

    /// @dev The caller's lowest id inside tier `tierN`'s sealed band range.
    function _lowestBandIdOfTier(ERC404BondingInstance b, uint256 idLimit, uint8 tierN)
        internal
        view
        returns (uint256 id)
    {
        (uint32 idStart, uint32 idEnd,) = IShowcaseTierState(address(b)).tierBands(uint256(tierN) - 1);
        require(idStart > idLimit, "tiers: a band range overlaps the ordinary id space");
        uint256[] memory ids = b.ownedIdsOf(deployer);
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] >= idStart && ids[i] <= idEnd && (id == 0 || ids[i] < id)) id = ids[i];
        }
        require(id != 0, "tiers: the mint-up left no band id to mint back down");
    }

    function _ordinaryIds(ERC404BondingInstance b, uint256 idLimit) internal view returns (uint256[] memory out) {
        uint256[] memory ids = b.ownedIdsOf(deployer);
        uint256 n;
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] != 0 && ids[i] <= idLimit) n++;
        }
        out = new uint256[](n);
        uint256 k;
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] != 0 && ids[i] <= idLimit) out[k++] = ids[i];
        }
    }

    // ─────────────────────── 7. The carve ───────────────────────

    /// @dev Buy the carve row, then graduate it WITH the carve requested at the declared maximum.
    ///
    ///      WHAT THE PAYOUT DEPENDS ON, STATED BEFORE IT HAPPENS. The effective carve is the minimum
    ///      of the request, the bracket allowance on the raise, and the headroom the LP share has
    ///      ABOVE the pool floor. A faucet-sized raise does not clear that floor, so the protocol
    ///      clamps the carve to zero — the graduation still completes (the floor is a clamp, never a
    ///      gate), and the row still carries its declaration. The seed reads the protocol's own figure
    ///      rather than recomputing it, and prints the raise the row would need for the carve to pay,
    ///      so raising the fill is one environment variable rather than a code change.
    function _fillCarveRow(Deployed memory d, SeedHandoff memory h) internal returns (uint256 cost, uint256 raise) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(h.carve404));
        cost = _buyBondingMint(b, _fillAmount(b, _carveFillBps()));

        IShowcaseCarveParams factory_ = IShowcaseCarveParams(address(d.erc404));
        raise = b.reserve();
        uint256 minPoolEth = factory_.minPoolEth();
        uint256 carveEth = factory_.effectiveCarveEth(raise, CARVE_DECLARED_MAX_BPS, CARVE_REQUEST_BPS);

        console.log("CARVE carve-demo raise (wei):", raise);
        console.log("  pool floor (wei):", minPoolEth);
        console.log("  effective carve at this raise (wei):", carveEth);
        console.log("  raise at which the carve stops clamping to zero (wei):", _carveThresholdRaise(minPoolEth));

        vm.startBroadcast();
        b.deployLiquidity(CARVE_REQUEST_BPS);
        vm.stopBroadcast();
    }

    // ─────────────────────── 6. The auctions ───────────────────────

    /// @dev Cross the timed house's two lots into their terminal states. Both are permissionless after
    ///      the end time, and both advance their line — so the house is left clean rather than with a
    ///      settled lot still blocking its queue.
    function _crossAuctions(SeedHandoff memory h) internal {
        ERC721AuctionInstance t = ERC721AuctionInstance(payable(h.auctionTimed));
        require(
            block.timestamp >= t.getAuction(uint24(h.soldLotId)).endTime,
            "auctions: the timed lots have not ended yet (the wait was too short)"
        );

        vm.startBroadcast();
        t.settleAuction(uint24(h.soldLotId));
        t.reclaimUnsold(uint24(h.unsoldLotId));
        vm.stopBroadcast();

        console.log("AUCTION settled lot / reclaimed lot:", h.soldLotId, h.unsoldLotId);
    }

    // ─────────────────────── Breadth post-conditions ───────────────────────

    /// @dev Every claim the breadth rows make, asserted against the chain after phase 2 has crossed
    ///      them. `require`s, not logs — forge simulates the whole script first, so a failure here
    ///      leaves no partial seed and names the mechanism that did not reach its state.
    function _assertBreadth(Deployed memory d, SeedHandoff memory h, uint256 carveRaise) internal view {
        _assertEditionShowcase(_readEditionFacts(h.editions));
        _assertGatingShowcase(_readGatingFacts(d, h.gatedEditions), block.timestamp);
        _assertStakingShowcase(_readStakingFacts(d, h.staking404));
        _assertTierShowcase(_readTierFacts(d, h.tiers404));
        _assertCarveShowcase(_readCarveFacts(d, h.carve404, carveRaise));
        (AuctionLotFacts memory live, AuctionLotFacts memory sold, AuctionLotFacts memory reclaimed) =
            _readAuctionFacts(h);
        _assertAuctionShowcase(live, sold, reclaimed, block.timestamp);

        console.log("BREADTH POST-CONDITIONS OK:");
        console.log("  editions (fixed / dynamic / free claim), allowlist gating");
        console.log("  staking surface + seeded position, tiers (up, down, exhausted band), metadata stack");
        console.log("  auctions (live / settled / reclaimed), carve declared + requested");
    }

    function _readEditionFacts(address instance) internal view returns (EditionFacts memory f) {
        ERC1155Instance ed = ERC1155Instance(payable(instance));
        f.nextEditionId = ed.nextEditionId();

        (,, uint256 fixedPrice, uint256 fixedSupply,,, ERC1155Instance.PricingModel fixedModel,,) =
            ed.editions(EDITION_FIXED);
        f.fixedModel = uint8(fixedModel);
        f.fixedPrice = fixedPrice;
        f.fixedSupply = fixedSupply;

        (,, uint256 dynBase,,,, ERC1155Instance.PricingModel dynModel, uint256 dynRate,) = ed.editions(EDITION_DYNAMIC);
        f.dynamicModel = uint8(dynModel);
        f.dynamicBasePrice = dynBase;
        f.dynamicRate = dynRate;
        f.dynamicModule = address(ed.dynamicPricingModule());
        if (f.dynamicModule != address(0)) {
            f.dynamicPriceAfterProbe =
                IDynamicPricingModule(f.dynamicModule).calculatePrice(dynBase, dynRate, DYNAMIC_PROBE_MINTS);
        }

        (,,, uint256 freeSupply, uint256 freeMinted,,,,) = ed.editions(EDITION_FREE_CLAIM);
        f.freeClaimSupply = freeSupply;
        f.freeClaimMinted = freeMinted;
        f.freeClaimAllocation = ed.freeMintAllocation(EDITION_FREE_CLAIM);
    }

    function _readGatingFacts(Deployed memory d, address instance) internal view returns (GatingFacts memory f) {
        ERC1155Instance veil = ERC1155Instance(payable(instance));
        f.attachedModule = address(veil.gatingModule());
        f.expectedModule = d.merkleGating;
        f.scope = uint8(veil.gatingScope());
        f.freeClaimAllocation = veil.freeMintAllocation(GATED_EDITION);

        bytes32[] memory installed = IMerkleGatingView(d.merkleGating).getRoots(instance, GATED_EDITION);
        uint256[] memory opens = IMerkleGatingView(d.merkleGating).getTierOpenTimes(instance, GATED_EDITION);
        f.installedTierCount = installed.length;
        if (installed.length > 0) f.installedRoot = installed[0];
        if (opens.length > 0) f.tierOpenTime = opens[0];

        address stranger = _allowlistStranger();
        (bytes32 root, bytes32[] memory proofOperator,) =
            _buildAllowlistTier(deployer, GATED_OPERATOR_QTY, _allowlistFixtureMember(), GATED_MEMBER_QTY, stranger);
        f.provenRoot = root;
        f.listedMemberVerifies =
            MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(deployer, GATED_OPERATOR_QTY));
        f.unlistedAddressRejected =
            !MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(stranger, GATED_OPERATOR_QTY));
    }

    function _readStakingFacts(Deployed memory d, address instance) internal view returns (StakingFacts memory f) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        IShowcaseStakingState sm = IShowcaseStakingState(d.stakingModule);
        f.module = address(b.stakingModule());
        f.expectedModule = d.stakingModule;
        f.active = b.stakingActive();
        f.userStaked = sm.stakedBalance(instance, deployer);
        f.totalStaked = sm.totalStaked(instance);
        f.liquidBalance = b.balanceOf(deployer);
    }

    function _readTierFacts(Deployed memory d, address instance) internal view returns (TierFacts memory f) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        IShowcaseTierState t = IShowcaseTierState(instance);

        (uint32 openStart, uint32 openEnd,) = t.tierBands(uint256(TIER_N_OPEN) - 1);
        (uint32 scarceStart, uint32 scarceEnd,) = t.tierBands(uint256(TIER_N_SCARCE) - 1);
        f.openCapacity = uint256(openEnd - openStart) + 1;
        f.scarceCapacity = uint256(scarceEnd - scarceStart) + 1;
        f.openOutstanding = b.bandOutstanding(TIER_N_OPEN);
        f.scarceOutstanding = b.bandOutstanding(TIER_N_SCARCE);
        f.totalTierEscrow = t.totalTierEscrow();

        MetadataOverlayModule ov = MetadataOverlayModule(d.overlay);
        uint256 idLimit = b.maxSupply() / b.unit();
        uint256[] memory ordinary = _ordinaryIds(b, idLimit);
        require(ordinary.length >= 1, "tiers: the row holds no ordinary id to read a commission off");
        // The paid id is the one the seed unlocked; `paid` is the module's own settled flag.
        for (uint256 i = 0; i < ordinary.length; i++) {
            if (ov.paid(instance, ordinary[i])) {
                f.commissionPaid = true;
                f.commissionArt = ov.commissionURI(instance, ordinary[i]);
                break;
            }
        }
        f.waveCount = ov.waveCount(instance);
        f.baseArt = ART_BASE_ANIME;
        f.bandArt = ART_BASE_ARCTIC;
    }

    /// @param raise the reserve the row held immediately BEFORE `deployLiquidity`. Passed in rather
    ///        than read back, because graduation zeroes `reserve` — the number the carve was judged
    ///        against no longer exists on the instance once the carve has happened.
    function _readCarveFacts(Deployed memory d, address instance, uint256 raise)
        internal
        view
        returns (CarveFacts memory f)
    {
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        IShowcaseCarveParams factory_ = IShowcaseCarveParams(address(d.erc404));
        f.declaredMaxBps = b.declaredMaxAllowanceBps();
        f.requestBps = CARVE_REQUEST_BPS;
        f.graduated = b.graduated();
        f.raise = raise;
        f.minPoolEth = factory_.minPoolEth();
        f.effectiveCarveEth = factory_.effectiveCarveEth(f.raise, f.declaredMaxBps, f.requestBps);
    }

    function _readAuctionFacts(SeedHandoff memory h)
        internal
        view
        returns (AuctionLotFacts memory live, AuctionLotFacts memory sold, AuctionLotFacts memory reclaimed)
    {
        live = _readLot(h.auctionLive, h.liveLotId, "salon-line live lot");
        sold = _readLot(h.auctionTimed, h.soldLotId, "relic-line settled lot");
        reclaimed = _readLot(h.auctionTimed, h.unsoldLotId, "relic-line reclaimed lot");
    }

    function _readLot(address house, uint256 lotId, string memory label)
        internal
        view
        returns (AuctionLotFacts memory f)
    {
        ERC721AuctionInstance a = ERC721AuctionInstance(payable(house));
        ERC721AuctionInstance.Auction memory lot = a.getAuction(uint24(lotId));
        f.label = label;
        f.settled = lot.settled;
        f.highBidder = lot.highBidder;
        f.highBid = lot.highBid;
        f.endTime = lot.endTime;
        // Whether the piece EXISTS is what separates a settled lot from a reclaimed one: `settled` is
        // set by both terminal paths, and only `settleAuction` mints. `ownerOf` reverts on a token
        // that was never minted, which is the reclaimed case, so the revert is the answer rather than
        // an error.
        try a.ownerOf(lotId) returns (address owner_) {
            f.minted = true;
            f.tokenOwner = owner_;
        } catch {
            f.minted = false;
        }
    }
}
