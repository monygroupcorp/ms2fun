// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { ERC721AuctionFactory } from "../src/factories/erc721/ERC721AuctionFactory.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FeaturedQueueManager } from "../src/master/FeaturedQueueManager.sol";
import { GlobalMessageRegistry } from "../src/registry/GlobalMessageRegistry.sol";
import { ProfileRegistry } from "../src/registry/ProfileRegistry.sol";

/// @dev Minimal Solady-Ownable surface — instances + registries all expose this single-step transfer.
interface IOwnable {
    function transferOwnership(address newOwner) external payable;
}

/// @notice Shared surface for the two-phase anvil seed: the deployed-address struct, the exact-cost
///         buy helpers, and the phase-1 → phase-2 hand-off file.
///
///         WHY THE SEED IS TWO SCRIPTS. `buyBonding` reverts `TooEarly` before `bondingOpenTime`
///         (noesis-205), and `setBondingOpenTime` reverts `TimeMustBeInFuture` on a non-future time.
///         A single script therefore cannot both ARM a launch and BUY into it: forge simulates the
///         whole script before broadcasting any of it, and anvil block timestamps track the REAL
///         clock, so a small arm offset is raced by broadcast lag (the arm tx reverts) while a large
///         one is never crossed (the buy tx reverts). `vm.warp` cannot help — it moves only the
///         script's in-memory EVM, never the live chain — and `vm.sleep` makes it worse by delaying
///         broadcast until the arm tx is past its own open time.
///
///         Only the ORCHESTRATOR can advance the chain between the two. So `deploy.ts` runs
///         SeedAnvil (create + arm), advances the anvil clock past every open time, then runs
///         SeedAnvilBuys (buys + everything downstream of them). Do NOT merge these back into one
///         script to "simplify" it — that is the shape that is broken, and it fails at SIMULATION,
///         so nothing broadcasts and the fork is left with a deployed protocol and no seed at all.
abstract contract SeedAnvilShared is Script {
    // Well-known Anvil account #1 (public test key) — used to seed a second, non-deployer actor.
    uint256 internal constant ACCOUNT_1_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    // The team's testing wallet. After the deployer finishes all owner-only seeding, ownership of
    // every seeded instance + the platform registries is handed to ADMIN so it can drive the creator
    // admin + (future) protocol-admin console from the UI. Anvil-only — DeployCore stays untouched.
    address internal constant ADMIN = 0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86;

    /// @dev The local fork's chain id. Asserted when reading the hand-off file so a seed-state file
    ///      left behind by a PREVIOUS fork cannot be replayed against dead addresses on a new one.
    uint256 internal constant ANVIL_CHAIN_ID = 1337;

    string internal constant SEED_STATE_PATH = "./deployments/anvil-seed.json";

    // ── Per-piece art: METADATA directory bases (mainnet-harvested, gateway-verified) ────────────
    // ERC404 piece art composes as `base + tokenId` with NO suffix (ERC404BondingInstance._tokenURI;
    // TokenTierBandResolver and TierRevealModule concat the same way). So a base MUST point at a
    // collection's METADATA directory, whose entries are extensionless numeric JSON — an IMAGE
    // directory 404s for every id (`…/42.png` serves bytes, `…/42` does not). Each JSON carries the
    // `image` the frontend renders after it resolves `tokenURI(id)`.
    // These are the metadata layer of the same collections the seed already harvests images from:
    // ART_NEON_DRIFT / ART_ABERRATION / ART_EMBER read back to ART_BASE_ANIME's image directory, and
    // ART_LIVE_SALON / ART_PRISM to ART_BASE_ARCTIC's.
    // A different collection per instance keeps each one visually its own drop rather than one image
    // repeated — and on the stacked instance it makes WHICH metadata layer is answering obvious by eye.
    // The four bases are the whole roster; surfaces added later REUSE one rather than introduce a
    // fifth, choosing whichever is not already answering next to them. Current reuse: ART_BASE_DOODLE
    // backs both `ember-preopen`'s pieces and — on two surfaces that never sit beside it — the
    // agent-created commission and `prism-stacked`'s opt-in wave, whose stack already spends the
    // other three (base = ANIME, band = ARCTIC, commissions = SIMIAN) — and `quench-ready`, which
    // sits in the ready-to-graduate group where ARCTIC (cinder) and SIMIAN (molten) already answer.
    string internal constant ART_BASE_ANIME = "ipfs://QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4/";
    string internal constant ART_BASE_ARCTIC = "ipfs://bafybeibc5sgo2plmjkq2tzmhrn54bk3crhnc23zd2msg4ea7a4pxrkgfna/";
    string internal constant ART_BASE_SIMIAN = "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/";
    string internal constant ART_BASE_DOODLE = "ipfs://QmPMc4tcBsMqLRuCQtPmPe84bpSjrC3Ky7t3JWuHXYB4aS/";

    // Deployed addresses (read from anvil.json).
    struct Deployed {
        ERC1155Factory erc1155;
        ERC721AuctionFactory erc721;
        ERC404Factory erc404;
        ProfileRegistry profiles;
        FeaturedQueueManager queue;
        GlobalMessageRegistry messages;
        address vault; // first Uni LP vault — generic contract vault
        address zammVault; // first ZAMM LP vault
        address cypherVault; // first Cypher (Algebra) LP vault
        address endowmentVault; // first Aave endowment vault
        address stakingModule; // ERC404StakingModule (approved STAKING component)
        address zammDeployer; // ModuleZAMMDeployer (approved LIQUIDITY_DEPLOYER)
        address uniDeployer; // ModuleUniV4Deployer (approved LIQUIDITY_DEPLOYER)
        address cypherDeployer; // ModuleCypherDeployer (approved LIQUIDITY_DEPLOYER)
        address resolverRouter; // MetadataResolverRouter (approved RESOLVER)
        address overlay; // MetadataOverlayModule (approved OVERLAY)
        address tier; // TokenTierBandResolver (approved TIER)
        address alignmentRegistry; // AlignmentRegistryV1 proxy (target curation)
        address master; // MasterRegistryV1 proxy (agent authorization; deployer-owned pre-handover)
    }

    /// @dev The ERC404 instances phase 1 arms, resolved BY NAME in phase 2.
    struct SeededErc404 {
        address ember; // PREOPEN — never bought, open time is +1 day and stays uncrossed
        address vapor; // MID-CURVE — several buys + staking
        address cinder; // READY-TO-GRADUATE (Uni-V4)
        address molten; // READY-TO-GRADUATE (ZAMM)
        address quench; // READY-TO-GRADUATE (Cypher/Algebra)
        address carve; // CARVE DEMO — bought until reserve >= 3 ETH
        address stacked; // STACKED METADATA — buy-with-mint + overlay authoring
    }

    uint256 internal deployerKey;
    address internal deployer;
    address internal acct1;

    // ─────────────────────────── Address loading ───────────────────────────

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile("./deployments/anvil.json");
        d.erc1155 = ERC1155Factory(vm.parseJsonAddress(json, ".factories.ERC1155"));
        d.erc721 = ERC721AuctionFactory(vm.parseJsonAddress(json, ".factories.ERC721"));
        d.erc404 = ERC404Factory(payable(vm.parseJsonAddress(json, ".factories.ERC404")));
        d.profiles = ProfileRegistry(vm.parseJsonAddress(json, ".contracts.ProfileRegistry"));
        d.queue = FeaturedQueueManager(payable(vm.parseJsonAddress(json, ".contracts.FeaturedQueueManager")));
        d.messages = GlobalMessageRegistry(vm.parseJsonAddress(json, ".contracts.GlobalMessageRegistry"));
        d.stakingModule = vm.parseJsonAddress(json, ".contracts.ERC404StakingModule");
        d.zammDeployer = vm.parseJsonAddress(json, ".contracts.ModuleZAMMDeployer");
        d.uniDeployer = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.cypherDeployer = vm.parseJsonAddress(json, ".contracts.ModuleCypherDeployer");
        d.resolverRouter = vm.parseJsonAddress(json, ".contracts.MetadataResolverRouter");
        d.overlay = vm.parseJsonAddress(json, ".contracts.MetadataOverlayModule");
        d.tier = vm.parseJsonAddress(json, ".contracts.TokenTierBandResolver");
        // Resolve the seed's vaults by FAMILY via DeployCore's convenience pointers, not by index
        // into the `vaults` array — that array's ordering shifts as LP families (ZAMM/Cypher) are
        // enabled per network, so a fixed index silently binds to the wrong vault type.
        d.vault = vm.parseJsonAddress(json, ".contracts.SeedUniVault");
        d.zammVault = vm.parseJsonAddress(json, ".contracts.SeedZammVault");
        d.cypherVault = vm.parseJsonAddress(json, ".contracts.SeedCypherVault");
        d.endowmentVault = vm.parseJsonAddress(json, ".contracts.SeedAaveVault");
        d.alignmentRegistry = vm.parseJsonAddress(json, ".contracts.AlignmentRegistry");
        d.master = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
    }

    // ─────────────────────── Phase 1 → phase 2 hand-off ───────────────────────

    /// @dev Phase 2 runs as a separate forge process with no memory of phase 1, so phase 1 persists
    ///      what it created. Instances are keyed BY NAME, never by array index: `_readDeployed`
    ///      above carries the same lesson for vaults, and a change in seed ORDER must not silently
    ///      rebind `carve` to `stacked`. `all` is the ownership-handover list and MAY be reordered
    ///      freely — nothing resolves a role out of it.
    function _writeSeedState(SeededErc404 memory s, address[] memory all) internal {
        string memory inner = "anvilSeedInstances";
        vm.serializeAddress(inner, "ember", s.ember);
        vm.serializeAddress(inner, "vapor", s.vapor);
        vm.serializeAddress(inner, "cinder", s.cinder);
        vm.serializeAddress(inner, "molten", s.molten);
        vm.serializeAddress(inner, "quench", s.quench);
        vm.serializeAddress(inner, "carve", s.carve);
        string memory instancesJson = vm.serializeAddress(inner, "stacked", s.stacked);

        string memory root = "anvilSeedState";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "all", all);
        string memory out = vm.serializeString(root, "instances", instancesJson);

        vm.writeJson(out, SEED_STATE_PATH);
        console.log("Wrote seed state:", SEED_STATE_PATH);
    }

    function _readSeedState() internal view returns (SeededErc404 memory s, address[] memory all) {
        string memory json = vm.readFile(SEED_STATE_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        // A seed-state file from a PREVIOUS fork points at addresses that no longer hold code. Fail
        // loudly here rather than broadcasting buys into the void and reporting success — the same
        // guard deploy.ts applies to anvil.json.
        require(chainId == ANVIL_CHAIN_ID, "anvil-seed.json: wrong chainId (stale file from another chain?)");
        require(block.chainid == ANVIL_CHAIN_ID, "SeedAnvilBuys: not running against anvil");

        s.ember = vm.parseJsonAddress(json, ".instances.ember");
        s.vapor = vm.parseJsonAddress(json, ".instances.vapor");
        s.cinder = vm.parseJsonAddress(json, ".instances.cinder");
        s.molten = vm.parseJsonAddress(json, ".instances.molten");
        s.quench = vm.parseJsonAddress(json, ".instances.quench");
        s.carve = vm.parseJsonAddress(json, ".instances.carve");
        s.stacked = vm.parseJsonAddress(json, ".instances.stacked");
        all = vm.parseJsonAddressArray(json, ".all");

        // A phase-1 that silently failed to record an instance would otherwise show up much later as
        // an unowned collection or a missing buy. Catch it at the boundary.
        require(s.ember != address(0), "seed state: ember missing");
        require(s.vapor != address(0), "seed state: vapor missing");
        require(s.cinder != address(0), "seed state: cinder missing");
        require(s.molten != address(0), "seed state: molten missing");
        require(s.quench != address(0), "seed state: quench missing");
        require(s.carve != address(0), "seed state: carve missing");
        require(s.stacked != address(0), "seed state: stacked missing");
        require(all.length > 0, "seed state: no instances to hand over");
    }

    // ─────────────────────────── Buy helpers ───────────────────────────

    /// @dev Same exact-cost math as _buyBonding but mints NFTs (mintNFT=true) so the buyer owns ids.
    function _buyBondingMint(ERC404BondingInstance b, uint256 key, uint256 amount) internal {
        _buy(b, key, amount, true);
    }

    /// @dev Compute the EXACT cost the instance will charge and pay it, so buyBonding never reverts.
    ///      The instance computes cost = BondingCurveMath.calculateCost(curveParams, supply, amount),
    ///      then adds a fee = cost * bondingFeeBps / 10000. We reproduce both with the SAME library
    ///      + the instance's public getters and set maxCost == value == cost + fee. (Excess, if any,
    ///      is refunded by the contract.) mintNFT=false keeps tokens fungible for staking.
    ///
    ///      NOTE: this reverts `TooEarly` unless the CHAIN has passed the instance's bondingOpenTime.
    ///      That is why every caller lives in phase 2, after deploy.ts advances the clock.
    function _buyBonding(ERC404BondingInstance b, uint256 key, uint256 amount) internal {
        _buy(b, key, amount, false);
    }

    function _buy(ERC404BondingInstance b, uint256 key, uint256 amount, bool mintNFT) private {
        BondingCurveMath.Params memory params = _curveParams(b);
        uint256 cost = BondingCurveMath.calculateCost(params, b.totalBondingSupply(), amount);
        uint256 fee = (cost * b.bondingFeeBps()) / 10000;
        uint256 total = cost + fee;
        vm.startBroadcast(key);
        b.buyBonding{ value: total }(amount, total, mintNFT, bytes(""), "", 0);
        vm.stopBroadcast();
    }

    /// @dev Reconstruct the curve Params struct from the public auto-getter (returns a 3-tuple).
    function _curveParams(ERC404BondingInstance b) internal view returns (BondingCurveMath.Params memory p) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = b.curveParams();
        p = BondingCurveMath.Params({ kCoeff: kCoeff, poleWad: poleWad, normalizationFactor: normalizationFactor });
    }
}
