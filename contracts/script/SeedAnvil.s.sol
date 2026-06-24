// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1155Factory} from "../src/factories/erc1155/ERC1155Factory.sol";
import {ERC1155Instance} from "../src/factories/erc1155/ERC1155Instance.sol";
import {ERC721AuctionFactory} from "../src/factories/erc721/ERC721AuctionFactory.sol";
import {ERC721AuctionInstance} from "../src/factories/erc721/ERC721AuctionInstance.sol";
import {ERC404Factory} from "../src/factories/erc404/ERC404Factory.sol";
import {ERC404BondingInstance} from "../src/factories/erc404/ERC404BondingInstance.sol";
import {BondingCurveMath} from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import {FeaturedQueueManager} from "../src/master/FeaturedQueueManager.sol";
import {GlobalMessageRegistry} from "../src/registry/GlobalMessageRegistry.sol";
import {ProfileRegistry} from "../src/registry/ProfileRegistry.sol";
import {FreeMintParams} from "../src/interfaces/IFactoryTypes.sol";
import {GatingScope} from "../src/gating/IGatingModule.sol";
import {IAlignmentVault} from "../src/interfaces/IAlignmentVault.sol";
import {Currency} from "v4-core/types/Currency.sol";

/// @notice Anvil-only FULL-STATE seed: stands up demoable instances of every project type
///         (ERC1155 editions, ERC721 auctions, ERC404 bonding) plus profiles + activity, so the
///         discovery cards, trading surfaces, candles, staking, and profile pages all light up with
///         real on-chain state. Runs AFTER DeployAnvil; reads the deployed addresses from
///         deployments/anvil.json. All metadata is backend-free — inline `data:` JSON with inline
///         `data:` SVG images, so the seed needs no IPFS/network and renders offline. NEVER part of
///         a production deploy (DeployCore stays clean); this lives only in the local dev bridge.
///
///         TIME MODEL: vm.warp sets block.timestamp for the WHOLE script. So all "must be in the
///         past" work happens FIRST, then time is warped forward monotonically, and anything that
///         must be LIVE/active is created AFTER the final warp. Anchors:
///           T0 = deploy time
///           T1 = T0 + 2 hours   (past the 1h gallery auctions so they can settle / expire)
///           ... mid-curve + ready-to-graduate cross their own open/maturity with +1/+2s warps ...
///           Tfinal = after the ready-to-graduate maturity warp (live auction created here).
contract SeedAnvil is Script {

    // Well-known Anvil account #1 (public test key) — used to seed a second, non-deployer actor.
    uint256 constant ACCOUNT_1_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    // Deployed addresses (read from anvil.json in run()).
    struct Deployed {
        ERC1155Factory erc1155;
        ERC721AuctionFactory erc721;
        ERC404Factory erc404;
        ProfileRegistry profiles;
        FeaturedQueueManager queue;
        GlobalMessageRegistry messages;
        address vault;          // first Uni vault (index 0) — generic contract vault
        address endowmentVault; // first Aave endowment vault (index 2)
        address stakingModule;  // ERC404StakingModule (approved STAKING component)
        address zammDeployer;   // ModuleZAMMDeployer (approved LIQUIDITY_DEPLOYER)
    }

    uint256 deployerKey;
    address deployer;
    address acct1;

    function run() public {
        deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        acct1 = vm.addr(ACCOUNT_1_KEY);

        Deployed memory d = _readDeployed();

        // ── Phase A: ERC1155 editions + profiles + activity (the original seed, enriched) ──
        address c0 = _seedErc1155(d);

        // ── Phase B: ERC721 gallery auction (settles / expires in the past; FIRST warp +2h) ──
        _seedErc721Gallery(d);

        // ── Phase C: ERC404 bonding — preopen + mid-curve(+staking) ──
        _seedErc404PreOpen(d);
        _seedErc404MidCurve(d);

        // ── Phase D: ERC404 ready-to-graduate (crosses maturity; holds the final bonding warp) ──
        _seedErc404ReadyToGraduate(d);

        // ── Phase E: live ERC721 auction (created AFTER the final warp, so it counts down now) ──
        _seedErc721Live(d);

        // Second profile + activity (independent of the time model).
        vm.startBroadcast(ACCOUNT_1_KEY);
        d.profiles.setProfile(_profileMeta(
            "Vela", "vela",
            "Collector. Aligned to the cult.", "V"));
        _post(d.messages, acct1, "minted from monolith. clean.");
        _post(d.messages, c0, "grabbed one from neon-drift. love the aberration.");
        vm.stopBroadcast();

        console.log("=== SeedAnvil complete ===");
        console.log("ERC1155: 3 collections (neon-drift, monolith, ghost-mint[free-claim]) w/ editions");
        console.log("ERC721 : 2 auctions (gallery=settled+expired, live=active+bid)");
        console.log("ERC404 : 3 bonding (preopen, mid-curve+staking, ready-to-graduate)");
        console.log("Profiles: 2 (MS2 Labs, Vela) + activity. block.timestamp now:", block.timestamp);
    }

    // ─────────────────────────── Address loading ───────────────────────────

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile("./deployments/anvil.json");
        d.erc1155 = ERC1155Factory(vm.parseJsonAddress(json, ".factories.ERC1155"));
        d.erc721  = ERC721AuctionFactory(vm.parseJsonAddress(json, ".factories.ERC721"));
        d.erc404  = ERC404Factory(payable(vm.parseJsonAddress(json, ".factories.ERC404")));
        d.profiles = ProfileRegistry(vm.parseJsonAddress(json, ".contracts.ProfileRegistry"));
        d.queue = FeaturedQueueManager(payable(vm.parseJsonAddress(json, ".contracts.FeaturedQueueManager")));
        d.messages = GlobalMessageRegistry(vm.parseJsonAddress(json, ".contracts.GlobalMessageRegistry"));
        d.stakingModule = vm.parseJsonAddress(json, ".contracts.ERC404StakingModule");
        d.zammDeployer  = vm.parseJsonAddress(json, ".contracts.ModuleZAMMDeployer");
        // `vaults` is serialized as a JSON-encoded STRING (DeployCore builds it by hand): parse it
        // out first, then index the inner array. [0]=first Uni vault, [2]=first Aave endowment vault.
        string memory vaultsJson = vm.parseJsonString(json, ".vaults");
        d.vault = vm.parseJsonAddress(vaultsJson, "[0].address");
        d.endowmentVault = vm.parseJsonAddress(vaultsJson, "[2].address");
    }

    // ─────────────────────────── Phase A: ERC1155 ───────────────────────────

    /// @dev Creates the 3 original collections, gives each real editions, makes ghost-mint a
    ///      free-claim collection, features them, seeds the endowment, and writes the deployer
    ///      profile + activity. Returns c0 (used by later activity posts).
    function _seedErc1155(Deployed memory d) internal returns (address c0) {
        vm.startBroadcast(deployerKey);

        // c0 binds to the Aave ENDOWMENT vault so its collection page shows the endowment panel.
        c0 = _createCollection(d.erc1155, d.endowmentVault, 0,
            "neon-drift", "Neon Drift",
            "Generative monochrome fragments. An edition aligned to the MS2 community.", "ND", 0);
        address c1 = _createCollection(d.erc1155, d.vault, 1,
            "monolith", "Monolith",
            "One slab, many hands. A minimalist open edition.", "MO", 0);
        // c2: free-claim. allocation=5 reserved free mints, configured at creation by the factory
        // (initializeFreeMint is onlyFactory — it is NOT called post-create from this script).
        address c2 = _createCollection(d.erc1155, d.vault, 2,
            "ghost-mint", "Ghost Mint",
            "Faint signals from the fossil layer. Free-claim editions.", "GM", 5);

        // Editions. basePrice must be > 0 even for the free-claim collection (addEdition reverts on
        // zero price; claimFreeMint ignores price — the edition just needs to exist as a target).
        // PricingModel: 0=UNLIMITED (open, fixed price, supply MUST be 0), 1=LIMITED_FIXED,
        // 2=LIMITED_DYNAMIC (needs the dynamic module + a non-zero rate). openTime=0 => open now.
        ERC1155Instance(c0).addEdition(
            "Aberration #1", 0.01 ether, 50, _pieceMeta("Aberration #1", "AB", "neon-drift"),
            ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0);
        ERC1155Instance(c0).addEdition(
            "Drift Open", 0.005 ether, 0, _pieceMeta("Drift Open", "DR", "neon-drift"),
            ERC1155Instance.PricingModel.UNLIMITED, 0, 0);

        ERC1155Instance(c1).addEdition(
            "Slab", 0.002 ether, 0, _pieceMeta("Slab", "SL", "monolith"),
            ERC1155Instance.PricingModel.UNLIMITED, 0, 0);

        // ghost-mint needs at least one edition so claimFreeMint has a target.
        ERC1155Instance(c2).addEdition(
            "Ghost", 0.001 ether, 100, _pieceMeta("Ghost", "GH", "ghost-mint"),
            ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0);

        // Feature each (rentFeatured) so it surfaces in getHomePageData. rankBoost descends for a
        // stable order; a generous value covers the cost and the excess refunds.
        uint256 duration = 30 days;
        d.queue.rentFeatured{value: 1 ether}(c0, duration, 0.03 ether);
        d.queue.rentFeatured{value: 1 ether}(c1, duration, 0.02 ether);
        d.queue.rentFeatured{value: 1 ether}(c2, duration, 0.01 ether);

        // Seed the endowment so c0's vault panel shows real principal (benefactor = the c0 instance).
        IAlignmentVault(payable(d.endowmentVault)).receiveContribution{value: 0.5 ether}(
            Currency.wrap(address(0)), 0.5 ether, c0
        );

        // Deployer profile + activity (POST=0 to own wall: instance == sender).
        d.profiles.setProfile(_profileMeta(
            "MS2 Labs", "ms2labs",
            "Building the lean onchain launchpad. Alignment is the product.", "M"));
        _post(d.messages, deployer, "gm. neon-drift is live and aligned to MS2.");
        _post(d.messages, deployer, "the vault is the product. alignment compounds.");
        _post(d.messages, c0, "first drop. minting is open.");

        vm.stopBroadcast();
    }

    function _createCollection(
        ERC1155Factory factory,
        address vault,
        uint256 index,
        string memory slug,
        string memory displayName,
        string memory description,
        string memory glyph,
        uint256 freeMintAllocation
    ) internal returns (address instance) {
        ERC1155Factory.CreateParams memory params = ERC1155Factory.CreateParams({
            name: slug,
            metadataURI: _collectionMeta(displayName, description, glyph),
            creator: deployer,
            vault: vault,
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({allocation: freeMintAllocation, scope: GatingScope.BOTH})
        });
        bytes32 salt = keccak256(abi.encode(block.timestamp, index, slug));
        instance = factory.createInstance(salt, params);
    }

    // ─────────────────────────── Phase B: ERC721 gallery ───────────────────────────

    /// @dev Gallery auction created at T0 with a 1h duration. Two pieces (lines 0 and 1) each
    ///      auto-start (first per line). acct1 bids on piece #1. We then warp +2h (past endTime) and
    ///      settle #1 (-> settled, NFT minted) and leave #2 (-> ended, no bids, reclaimable). This
    ///      is the FIRST warp in the whole script.
    function _seedErc721Gallery(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address gallery = _createAuction(d, "gallery-relics", "Gallery Relics", "GAL", "GL");
        ERC721AuctionInstance g = ERC721AuctionInstance(payable(gallery));
        // Each queuePiece's msg.value = minBid; first piece per line auto-starts (endTime = now+1h).
        g.queuePiece{value: 0.05 ether}(_pieceMeta("Relic I", "R1", "gallery-relics"));  // tokenId 1, line 0
        g.queuePiece{value: 0.05 ether}(_pieceMeta("Relic II", "R2", "gallery-relics")); // tokenId 2, line 1
        d.queue.rentFeatured{value: 1 ether}(gallery, 30 days, 0.025 ether);
        vm.stopBroadcast();

        // acct1 bids on piece #1 (a non-owner EOA; settleAuction _safeMints to the winner).
        vm.startBroadcast(ACCOUNT_1_KEY);
        g.createBid{value: 0.1 ether}(1, "0x");
        vm.stopBroadcast();

        // FIRST warp: now + 2h, past the 1h auctions' endTime.
        vm.warp(block.timestamp + 2 hours);

        // Settle piece #1 (has a bid) -> settled. Piece #2 left untouched -> ended, no bids.
        vm.startBroadcast(deployerKey);
        g.settleAuction(1);
        vm.stopBroadcast();
    }

    // ─────────────────────────── Phase E: ERC721 live ───────────────────────────

    /// @dev Live auction created AFTER the final warp so both pieces count down into the future.
    ///      One gets a bid (active-with-bids), the other is active-no-bid (clean bid form to demo).
    function _seedErc721Live(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address live = _createAuction(d, "live-salon", "Live Salon", "LIV", "LV");
        ERC721AuctionInstance l = ERC721AuctionInstance(payable(live));
        l.queuePiece{value: 0.05 ether}(_pieceMeta("Salon I", "S1", "live-salon"));  // tokenId 1, line 0
        l.queuePiece{value: 0.05 ether}(_pieceMeta("Salon II", "S2", "live-salon")); // tokenId 2, line 1
        d.queue.rentFeatured{value: 1 ether}(live, 30 days, 0.04 ether);
        vm.stopBroadcast();

        vm.startBroadcast(ACCOUNT_1_KEY);
        l.createBid{value: 0.1 ether}(1, "0x"); // piece #1 active-with-bids; piece #2 stays no-bid
        vm.stopBroadcast();
    }

    function _createAuction(
        Deployed memory d,
        string memory slug,
        string memory displayName,
        string memory symbol,
        string memory glyph
    ) internal returns (address instance) {
        ERC721AuctionFactory.CreateParams memory params = ERC721AuctionFactory.CreateParams({
            name: slug,
            metadataURI: _collectionMeta(displayName, "Single-line auction house.", glyph),
            creator: deployer,
            vault: d.vault, // must be a contract; the generic Uni vault qualifies
            symbol: symbol,
            lines: 2,
            baseDuration: 1 hours,
            timeBuffer: 300,
            bidIncrement: 0.01 ether
        });
        bytes32 salt = keccak256(abi.encode(block.timestamp, slug, "ERC721"));
        instance = d.erc721.createInstance(salt, params); // msg.value 0: no creation fee on anvil
    }

    // ─────────────────────────── Phase C/D: ERC404 bonding ───────────────────────────

    /// @dev PREOPEN: created, bonding flagged active, open time in the FUTURE -> derivePhase=preopen
    ///      (UI shows a countdown). No buys.
    function _seedErc404PreOpen(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(d, "ember-preopen", "Ember", "EMBER", address(0));
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 days); // strictly future -> preopen
        b.setBondingActive(true);
        d.queue.rentFeatured{value: 1 ether}(inst, 30 days, 0.06 ether);
        vm.stopBroadcast();
    }

    /// @dev MID-CURVE: the main demo. Created WITH the staking module, opened just-ahead then crossed,
    ///      several buys from deployer + acct1 (BondingSale events -> price history for candles), then
    ///      staking activated and a position staked. No graduation.
    function _seedErc404MidCurve(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(d, "vapor-mid", "Vapor", "VAPOR", d.stakingModule);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        // setBondingOpenTime requires a strictly-future ts; set now+1 then warp +1 so buys land in
        // the live window. (Monotonic: we are already at T0+2h from the gallery warp.)
        uint256 openAt = block.timestamp + 1;
        b.setBondingOpenTime(openAt);
        b.setBondingActive(true);
        d.queue.rentFeatured{value: 1 ether}(inst, 30 days, 0.05 ether);
        vm.stopBroadcast();

        if (block.timestamp < openAt) vm.warp(openAt + 1);

        // Buy amount: >= normalizationFactor (else cost rounds to 0 -> PurchaseTooSmall) and well
        // under maxBondingSupply (~9e24 for preset 1: maxSupply 1e25 - 10% reserve). unit = 1e24.
        uint256 buyAmount = 1e23; // 0.1 NFT-equivalent worth of tokens per buy

        _buyBonding(b, deployerKey, buyAmount);
        _buyBonding(b, ACCOUNT_1_KEY, buyAmount);
        _buyBonding(b, deployerKey, buyAmount);

        // Activate staking and stake a portion of the deployer's bought tokens (deployer holds
        // 2*buyAmount from two buys; stake half of one buy).
        vm.startBroadcast(deployerKey);
        b.activateStaking();
        b.stake(buyAmount / 2);
        vm.stopBroadcast();
    }

    /// @dev READY-TO-GRADUATE: created, opened, one buy (so reserve > 0), maturity set just ahead,
    ///      then warped past maturity -> deployLiquidity's isMatured is true so the UI surfaces the
    ///      graduate button. We do NOT call deployLiquidity (it hits an external AMM); the human
    ///      graduates live. This holds the FINAL bonding-related warp.
    function _seedErc404ReadyToGraduate(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(d, "cinder-ready", "Cinder", "CINDER", address(0));
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        uint256 openAt = block.timestamp + 1;   // strictly future (required)
        uint256 matureAt = block.timestamp + 2; // > openAt (required), still near-now
        b.setBondingOpenTime(openAt);
        b.setBondingMaturityTime(matureAt);
        b.setBondingActive(true);
        d.queue.rentFeatured{value: 1 ether}(inst, 30 days, 0.045 ether);
        vm.stopBroadcast();

        // Cross openAt, buy (reserve > 0 is required by deployLiquidity), then cross maturity.
        if (block.timestamp < openAt) vm.warp(openAt + 1);
        _buyBonding(b, deployerKey, 1e23);

        // FINAL warp: past matureAt so isMatured == true (graduation unlocked, not executed).
        if (block.timestamp <= matureAt) vm.warp(matureAt + 1);
    }

    /// @dev Compute the EXACT cost the instance will charge and pay it, so buyBonding never reverts.
    ///      The instance computes cost = BondingCurveMath.calculateCost(curveParams, supply, amount),
    ///      then adds a fee = cost * bondingFeeBps / 10000. We reproduce both with the SAME library
    ///      + the instance's public getters and set maxCost == value == cost + fee. (Excess, if any,
    ///      is refunded by the contract.) mintNFT=false keeps tokens fungible for staking.
    function _buyBonding(ERC404BondingInstance b, uint256 key, uint256 amount) internal {
        BondingCurveMath.Params memory params = _curveParams(b);
        uint256 cost = BondingCurveMath.calculateCost(params, b.totalBondingSupply(), amount);
        uint256 fee = (cost * b.bondingFeeBps()) / 10000;
        uint256 total = cost + fee;
        vm.startBroadcast(key);
        b.buyBonding{value: total}(amount, total, false, bytes32(0), "0x", 0);
        vm.stopBroadcast();
    }

    /// @dev Reconstruct the curve Params struct from the public auto-getter (returns a 5-tuple).
    function _curveParams(ERC404BondingInstance b)
        internal
        view
        returns (BondingCurveMath.Params memory p)
    {
        (
            uint256 initialPrice,
            uint256 quarticCoeff,
            uint256 cubicCoeff,
            uint256 quadraticCoeff,
            uint256 normalizationFactor
        ) = b.curveParams();
        p = BondingCurveMath.Params({
            initialPrice: initialPrice,
            quarticCoeff: quarticCoeff,
            cubicCoeff: cubicCoeff,
            quadraticCoeff: quadraticCoeff,
            normalizationFactor: normalizationFactor
        });
    }

    function _createBonding(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory symbol,
        address stakingModule
    ) internal returns (address instance) {
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, slug, "ERC404")),
            name: slug,
            symbol: symbol,
            styleUri: "",
            tokenBaseURI: "",
            owner: deployer,
            vault: d.vault,
            nftCount: 10,
            presetId: 1, // STANDARD: targetETH 25 ether, unitPerNFT 1e6
            stakingModule: stakingModule
        });
        instance = d.erc404.createInstance(
            params,
            _collectionMeta(name, "Bonding-curve ERC404.", symbol),
            d.zammDeployer,      // approved LIQUIDITY_DEPLOYER
            address(0),          // no gating
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        ); // msg.value 0: no creation fee on anvil
    }

    // ─────────────────────────── Activity ───────────────────────────

    /// @dev Direct POST (messageType 0) to a channel; sender is the broadcaster. The profile feed
    ///      filters by sender, so posting to the sender's own address (self-wall) keeps it coherent.
    function _post(GlobalMessageRegistry messages, address channel, string memory content) internal {
        messages.post(channel, 0, 0, bytes32(0), bytes32(0), content);
    }

    // ── Backend-free metadata builders (data: JSON wrapping a data: SVG image) ───
    // SVG uses single-quoted attributes + named colors (no '#') so it nests cleanly inside a
    // JSON double-quoted string and renders monochrome (Gallery Brutalism).

    function _svg(string memory glyph) internal pure returns (string memory) {
        return string.concat(
            "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>",
            "<rect width='400' height='400' fill='black'/>",
            "<text x='200' y='250' fill='white' font-family='monospace' font-size='150' text-anchor='middle'>",
            glyph,
            "</text></svg>"
        );
    }

    function _collectionMeta(
        string memory name,
        string memory description,
        string memory glyph
    ) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"", name,
            "\",\"description\":\"", description,
            "\",\"category\":\"edition\",\"image\":\"", _svg(glyph),
            "\"}"
        );
    }

    /// @dev Per-piece/edition metadata (same shape, piece-scoped name + glyph).
    function _pieceMeta(
        string memory name,
        string memory glyph,
        string memory collection
    ) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"", name,
            "\",\"collection\":\"", collection,
            "\",\"image\":\"", _svg(glyph),
            "\"}"
        );
    }

    function _profileMeta(
        string memory name,
        string memory handle,
        string memory bio,
        string memory glyph
    ) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"", name,
            "\",\"handle\":\"", handle,
            "\",\"bio\":\"", bio,
            "\",\"avatar\":\"", _svg(glyph),
            "\"}"
        );
    }
}
