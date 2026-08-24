// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FreeMintParams } from "../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../src/gating/IGatingModule.sol";

/// @dev The read surface the showcase post-conditions are stated against. Declared as an interface
///      rather than typed to `ERC404BondingInstance` on purpose: the same assertions are exercised by
///      a unit test against a settable stub, which is what proves they are not vacuous
///      (`test/coverage/SepoliaShowcasePostConditions.t.sol`). Every member is a public state getter
///      on the real instance, so the interface and the instance cannot drift apart silently.
interface IShowcaseCurveState {
    function bondingOpenTime() external view returns (uint256);
    function bondingMaturityTime() external view returns (uint256);
    function bondingActive() external view returns (bool);
    function graduated() external view returns (bool);
    function reserve() external view returns (uint256);
    function totalBondingSupply() external view returns (uint256);
}

/// @notice The chain-agnostic base for the Sepolia showcase seed — the pieces phase 1 (create + arm)
///         and phase 2 (buys + graduation) both need: the deployment reader, the roster, the
///         hand-off state file, the buy helpers, and the post-conditions.
///
///         ── WHY THIS FILE MIRRORS `SeedAnvilShared` INSTEAD OF EXTENDING A COMMON ANCESTOR ──
///
///         The item that authored this preferred a shared ancestor both seeds inherit. That is the
///         right shape and it is not what landed, for a reason worth stating rather than hiding:
///         `SeedAnvilShared` is one file in which the genuinely reusable parts (the exact-cost buy
///         helper, the curve-params reconstruction, the JSON readers, the string predicates) are
///         interleaved with anvil-only facts — a hardcoded `./deployments/anvil.json` path, a fixed
///         local chain id, the well-known local test keys, and a roster of eleven instances that only
///         a mainnet fork can serve. Splitting those apart means editing the file the local dev-chain
///         rebuild depends on end to end, and that rebuild is the anvil seed's only regression gate.
///         The trade taken here is: the anvil seed is left BYTE-IDENTICAL (this branch changes no file
///         the anvil path reads), and the Sepolia spine carries its own copy of ~120 lines of curve
///         arithmetic and string handling.
///
///         The duplication is therefore deliberate and bounded. The follow-on is to lift the shared
///         core into its own file once the Sepolia seed's shape has stopped moving — the two waves
///         still to land on top of this one (further venues, further project types) are what would
///         make that extraction premature today.
///
///         ── THE TIME MODEL, AND WHY SEPOLIA IS NOT ANVIL ──
///
///         Arming a curve and buying into it cannot share one `forge script`: `setBondingOpenTime`
///         rejects a non-future timestamp, `buyBonding` reverts `TooEarly` before it, and forge
///         simulates a whole script at ONE timestamp before broadcasting any of it. So the seed is
///         two scripts with a clock advance in between — the same split the local seed uses.
///
///         What is different: the local chain is told to advance (`evm_increaseTime`). A public
///         testnet cannot be told anything. The gap between the two phases is REAL WALL-CLOCK TIME
///         that a human waits out, so the arm window is short and configurable
///         (`SEPOLIA_ARM_WINDOW_SECONDS`, default 20 minutes) rather than the local seed's day-long
///         offsets, and phase 1 records the exact timestamp phase 2 becomes legal
///         (`phase2NotBefore`) in the hand-off file so the orchestrator polls for it instead of
///         guessing.
abstract contract SeedSepoliaShared is Script {
    // ─────────────────────────── Network + paths ───────────────────────────

    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev Written by `DeploySepolia`. Read, never written, by this seed.
    string internal constant DEPLOYMENT_PATH = "./deployments/sepolia.json";
    /// @dev Phase 1 writes it; phase 2 and the orchestrator read it.
    string internal constant SEED_STATE_PATH = "./deployments/sepolia-seed.json";

    // ─────────────────────────── Clock knobs ───────────────────────────
    //
    // Every window below is a WALL-CLOCK wait for whoever runs the seed, so the defaults are sized
    // for a human at a terminal rather than for a chain that can be fast-forwarded.

    /// @dev How long after phase 1 the showcase curves open. Deliberately short.
    string internal constant ENV_ARM_WINDOW = "SEPOLIA_ARM_WINDOW_SECONDS";
    uint256 internal constant DEFAULT_ARM_WINDOW = 20 minutes;

    /// @dev Maturity sits just after the open time (the setter requires strictly-after), so a curve
    ///      that phase 2 reaches is open AND matured — which is what makes the graduate action live
    ///      on the ready-to-graduate row rather than merely arguable.
    string internal constant ENV_MATURITY_OFFSET = "SEPOLIA_MATURITY_OFFSET_SECONDS";
    uint256 internal constant DEFAULT_MATURITY_OFFSET = 2 minutes;

    /// @dev The slack phase 2 waits past the last maturity before it may run. Absorbs the wall-clock
    ///      the phase-1 broadcast itself consumes plus block-time jitter.
    string internal constant ENV_PHASE2_SLACK = "SEPOLIA_PHASE2_SLACK_SECONDS";
    uint256 internal constant DEFAULT_PHASE2_SLACK = 2 minutes;

    /// @dev The pre-open row is the one state that must SURVIVE the seed rather than be crossed by
    ///      it, because a visitor arriving days later still has to find a curve that has not opened.
    ///      It is therefore armed on its own, much longer clock — this is not the arm window.
    string internal constant ENV_PREOPEN_DELAY = "SEPOLIA_PREOPEN_DELAY_SECONDS";
    uint256 internal constant DEFAULT_PREOPEN_DELAY = 30 days;

    // ─────────────────────────── Fill knobs ───────────────────────────
    //
    // Fills are expressed as a share of the instance's own bondable supply so they stay meaningful
    // whichever preset a row selects. They are ALSO the entire ETH cost of the seed, and that ETH is
    // a human's faucet balance, so every one of them is overridable without touching the source.
    //
    // THE DEFAULTS ARE SIZED FOR A FAUCET, NOT FOR DEPTH. A Sepolia faucet dispenses a fraction of an
    // ETH per day, so the defaults below buy enough curve to render every surface the rows exist to
    // show and no more — a measured 0.242 ETH across the three bought rows on the NICHE preset. Depth
    // is a separate decision with a separate cost: raising these makes the graduated row's pool and
    // the vault's tithe correspondingly larger, which is what a deployment meant to be attacked wants.
    // Raise them by environment, and read the projection the seed prints before confirming.

    string internal constant ENV_MID_FILL_BPS = "SEPOLIA_MID_FILL_BPS";
    string internal constant ENV_READY_FILL_BPS = "SEPOLIA_READY_FILL_BPS";
    string internal constant ENV_GRADUATED_FILL_BPS = "SEPOLIA_GRADUATED_FILL_BPS";

    // ─────────────────────────── Curve preset ───────────────────────────

    /// @dev NICHE (`targetETH` 5 ether) — the smallest preset `DeployCore` registers, and the only
    ///      sane choice for a deployment funded out of a faucet. STANDARD/HYPE raise 25/50 ETH across
    ///      the same span, which multiplies every fill below by five or ten for no demonstrative gain.
    uint8 internal constant PRESET_NICHE = 0;

    /// @dev Pieces per collection. DN404 mints one id per whole unit credited, so this is also the
    ///      granularity of a buy: at 50, a fill in the low thousands of bps mints pieces in the tens.
    uint256 internal constant SHOWCASE_NFT_COUNT = 50;

    // ─────────────────────────── Art ───────────────────────────
    //
    // Per-piece bases are METADATA directories whose entries are addressed by the BARE token id,
    // because `base + tokenId` composes with no separator and no extension. An image directory 404s
    // for every id. These are the same content-addressed directories the local seed resolved and
    // gateway-verified; reusing them keeps the showcase's art off any host we would have to keep up.

    string internal constant ART_BASE_ANIME = "ipfs://QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4/";
    string internal constant ART_BASE_ARCTIC = "ipfs://bafybeibc5sgo2plmjkq2tzmhrn54bk3crhnc23zd2msg4ea7a4pxrkgfna/";
    string internal constant ART_BASE_SIMIAN = "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/";
    string internal constant ART_BASE_DOODLE = "ipfs://QmPMc4tcBsMqLRuCQtPmPe84bpSjrC3Ky7t3JWuHXYB4aS/";

    // Collection tile art — single gateway-verified pointers from the same harvested set.
    string internal constant ART_EMBER = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/7.png";
    string internal constant ART_VAPOR = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/128.png";
    string internal constant ART_CINDER = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/777.png";
    string internal constant ART_FLARE = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/42.png";

    // ─────────────────────────── The roster ───────────────────────────

    uint8 internal constant STATE_PREOPEN = 0;
    uint8 internal constant STATE_MID_CURVE = 1;
    uint8 internal constant STATE_READY = 2;
    uint8 internal constant STATE_GRADUATED = 3;

    /// @dev A roster row. BOTH phases build the identical list and index it BY NAME, never by
    ///      position: the waves that follow this one add venues and project types to the showcase,
    ///      and a phase-2 that resolved `instances[2]` would silently re-target when they do.
    struct ShowcaseLeg {
        string slug; // registry name, and the key in the hand-off file
        string title; // display name in the collection metadata
        string symbol;
        string description; // states the FEATURE demonstrated — see `_showcaseRoster`
        string image;
        string pieceBase;
        uint8 state;
        uint16 declaredMaxBps;
        uint256 fillBps; // phase-2 share of bondable supply to buy (0 for the pre-open row)
    }

    /// @dev The addresses the deploy wrote, narrowed to what an ERC404 showcase seed touches.
    struct Deployed {
        ERC404Factory erc404;
        address masterRegistry;
        address alignmentRegistry;
        address componentRegistry;
        address uniVaultFactory;
        address uniDeployer; // approved LIQUIDITY_DEPLOYER — the Uni-V4 module
        address priceValidator;
        address protocolTreasury;
        address zRouter;
        address weth;
        address v4PoolManager;
    }

    /// @dev What phase 1 hands phase 2, beyond the instances themselves.
    struct SeedHandoff {
        uint256 phase2NotBefore;
        address ms2Token;
        address cultToken;
        address ms2Vault;
        address cultVault;
        uint256 ms2TargetId;
        uint256 cultTargetId;
    }

    /// @dev The seed's sender. Resolved from `msg.sender` inside `run()`, which is forge's
    ///      `--sender` — so the same scripts serve a keystore (`--account`) on the live testnet and an
    ///      unlocked account (`--unlocked`) on a fork rehearsal, with no key material in the
    ///      environment either way. It must be the account that owns the deployment's registries.
    address internal deployer;

    // ─────────────────────────── Env-backed knobs ───────────────────────────

    function _armWindow() internal view returns (uint256) {
        return vm.envOr(ENV_ARM_WINDOW, DEFAULT_ARM_WINDOW);
    }

    function _maturityOffset() internal view returns (uint256) {
        return vm.envOr(ENV_MATURITY_OFFSET, DEFAULT_MATURITY_OFFSET);
    }

    function _phase2Slack() internal view returns (uint256) {
        return vm.envOr(ENV_PHASE2_SLACK, DEFAULT_PHASE2_SLACK);
    }

    function _preopenDelay() internal view returns (uint256) {
        return vm.envOr(ENV_PREOPEN_DELAY, DEFAULT_PREOPEN_DELAY);
    }

    // ─────────────────────────── The roster, stated once ───────────────────────────

    /// @notice The four curve states the showcase must hold, as one list both phases read.
    ///
    /// @dev EVERY DESCRIPTION STATES THE FEATURE, NOT A FICTION. The showcase's defining constraint
    ///      is that a stranger can learn the product by reading the roster: a description says what
    ///      the collection demonstrates and what to do with it. The NAMES stay evocative; the
    ///      descriptions carry the teaching. Copy that roleplays a real drop is the thing this
    ///      roster exists not to be, and re-introducing it costs a later wave the unwind.
    function _showcaseRoster() internal view returns (ShowcaseLeg[] memory legs) {
        legs = new ShowcaseLeg[](4);

        legs[0] = ShowcaseLeg({
            slug: "ember-preopen",
            title: "Ember",
            symbol: "EMBER",
            description: "This collection demonstrates the PRE-OPEN state. The curve is armed and the countdown is running, and nothing can be bought until it expires - a buy attempted now is rejected on-chain, not hidden by the interface. Watch what the collection page does as the timer runs down.",
            image: ART_EMBER,
            pieceBase: ART_BASE_DOODLE,
            state: STATE_PREOPEN,
            declaredMaxBps: 0,
            fillBps: 0
        });

        legs[1] = ShowcaseLeg({
            slug: "vapor-mid",
            title: "Vapor",
            symbol: "VAPOR",
            description: "This collection demonstrates a LIVE BONDING CURVE part-way through its sale. Each buy mints coin and, in whole units, the pieces that ride it - one asset with two surfaces. Buy into it and watch the price, the piece gallery and the holder list move.",
            image: ART_VAPOR,
            pieceBase: ART_BASE_ANIME,
            state: STATE_MID_CURVE,
            declaredMaxBps: 0,
            fillBps: vm.envOr(ENV_MID_FILL_BPS, uint256(400))
        });

        legs[2] = ShowcaseLeg({
            slug: "cinder-ready",
            title: "Cinder",
            symbol: "CINDER",
            description: "This collection demonstrates the READY-TO-GRADUATE state. The curve is open, matured and holds a raise, so the graduation action is live and uncrossed - the collection is one call away from opening a Uniswap V4 pool. The creator declared a carve allowance up front, which the page shows before you buy.",
            image: ART_CINDER,
            pieceBase: ART_BASE_ARCTIC,
            state: STATE_READY,
            declaredMaxBps: 5000,
            fillBps: vm.envOr(ENV_READY_FILL_BPS, uint256(700))
        });

        legs[3] = ShowcaseLeg({
            slug: "flare-graduated",
            title: "Flare",
            symbol: "FLARE",
            description: "This collection demonstrates the GRADUATED state. Its curve has closed and the raise opened a real Uniswap V4 pool, so the coin now trades on the venue instead of on the curve - and 19 percent of the raise went to the alignment vault by contract. Trade it, then read the graduation on-chain.",
            image: ART_FLARE,
            pieceBase: ART_BASE_SIMIAN,
            state: STATE_GRADUATED,
            declaredMaxBps: 0,
            fillBps: vm.envOr(ENV_GRADUATED_FILL_BPS, uint256(700))
        });
    }

    // ─────────────────────────── Address loading ───────────────────────────

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile(DEPLOYMENT_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        require(chainId == SEPOLIA_CHAIN_ID, "sepolia.json: not a Sepolia deployment file");

        d.erc404 = ERC404Factory(payable(vm.parseJsonAddress(json, ".factories.ERC404")));
        d.uniVaultFactory = vm.parseJsonAddress(json, ".factories.UNI");
        d.masterRegistry = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
        d.alignmentRegistry = vm.parseJsonAddress(json, ".contracts.AlignmentRegistry");
        d.componentRegistry = vm.parseJsonAddress(json, ".contracts.ComponentRegistry");
        d.uniDeployer = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.priceValidator = vm.parseJsonAddress(json, ".contracts.UniswapVaultPriceValidator");
        d.protocolTreasury = vm.parseJsonAddress(json, ".contracts.ProtocolTreasury");
        d.zRouter = vm.parseJsonAddress(json, ".contracts.zRouter");
        d.v4PoolManager = vm.parseJsonAddress(json, ".uniswap.v4PoolManager");
        // WETH is not a top-level field of the deployment file; it is the deploy config's, and the
        // vault factory carries it as an immutable. Read it back off the factory rather than
        // re-declaring an address literal here — this item introduces no new external addresses.
        d.weth = IWethSource(d.uniVaultFactory).weth();

        require(address(d.erc404) != address(0), "sepolia.json: ERC404 factory missing");
        require(d.uniVaultFactory != address(0), "sepolia.json: UNI vault factory missing");
        require(d.uniDeployer != address(0), "sepolia.json: ModuleUniV4Deployer missing (stale deployment file?)");
        require(d.v4PoolManager != address(0), "sepolia.json: v4PoolManager missing");
    }

    // ─────────────────────────── Hand-off state ───────────────────────────

    function _writeSeedState(ShowcaseLeg[] memory legs, address[] memory instances, SeedHandoff memory h) internal {
        require(legs.length == instances.length, "seed state: roster/instance length mismatch");

        string memory inner = "sepoliaShowcaseInstances";
        string memory instancesJson;
        for (uint256 i = 0; i < legs.length; i++) {
            instancesJson = vm.serializeAddress(inner, legs[i].slug, instances[i]);
        }

        string memory root = "sepoliaSeedState";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "phase2NotBefore", h.phase2NotBefore);
        vm.serializeUint(root, "armWindowSeconds", _armWindow());
        vm.serializeAddress(root, "ms2Token", h.ms2Token);
        vm.serializeAddress(root, "cultToken", h.cultToken);
        vm.serializeAddress(root, "ms2Vault", h.ms2Vault);
        vm.serializeAddress(root, "cultVault", h.cultVault);
        vm.serializeUint(root, "ms2TargetId", h.ms2TargetId);
        vm.serializeUint(root, "cultTargetId", h.cultTargetId);
        vm.serializeAddress(root, "all", instances);
        string memory out = vm.serializeString(root, "instances", instancesJson);

        vm.writeJson(out, SEED_STATE_PATH);
        console.log("Wrote seed state:", SEED_STATE_PATH);
    }

    /// @dev Resolve the roster BY NAME out of the hand-off file, in roster order.
    function _readSeedState(ShowcaseLeg[] memory legs)
        internal
        view
        returns (address[] memory instances, SeedHandoff memory h)
    {
        string memory json = vm.readFile(SEED_STATE_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        // A hand-off file left behind by a DIFFERENT chain (a fork rehearsal, an earlier deployment)
        // points at addresses that hold no code here. Fail at the boundary rather than broadcasting
        // buys into the void and reporting success.
        require(chainId == block.chainid, "sepolia-seed.json: wrong chainId (stale file from another chain?)");

        h.phase2NotBefore = vm.parseJsonUint(json, ".phase2NotBefore");
        h.ms2Token = vm.parseJsonAddress(json, ".ms2Token");
        h.cultToken = vm.parseJsonAddress(json, ".cultToken");
        h.ms2Vault = vm.parseJsonAddress(json, ".ms2Vault");
        h.cultVault = vm.parseJsonAddress(json, ".cultVault");
        h.ms2TargetId = vm.parseJsonUint(json, ".ms2TargetId");
        h.cultTargetId = vm.parseJsonUint(json, ".cultTargetId");

        instances = new address[](legs.length);
        for (uint256 i = 0; i < legs.length; i++) {
            // Bracket-quoted, not dotted: the slugs carry hyphens, which a dotted JSON path splits
            // on rather than treating as part of the key.
            instances[i] = vm.parseJsonAddress(json, string.concat(".instances[\"", legs[i].slug, "\"]"));
            require(
                instances[i] != address(0), string.concat("seed state: ", legs[i].slug, " missing from the hand-off")
            );
            require(
                instances[i].code.length > 0,
                string.concat("seed state: ", legs[i].slug, " holds no code on this chain")
            );
        }
    }

    // ─────────────────────────── Buy helpers ───────────────────────────
    //
    // The cost is computed with the SAME library the instance charges with, so `maxCost == value ==
    // cost` and a buy never reverts on a bound the seed itself chose. There is no buy-side fee (the
    // protocol fee is taken on exit), so the value is the curve price exactly.

    function _buyCost(ERC404BondingInstance b, uint256 amount) internal view returns (uint256) {
        return BondingCurveMath.calculateCost(_curveParams(b), b.totalBondingSupply(), amount);
    }

    /// @dev Buy `amount` tokens, minting the pieces the whole units carry. Reverts `TooEarly` unless
    ///      the CHAIN has passed the instance's open time — which is why every caller is in phase 2.
    function _buyBondingMint(ERC404BondingInstance b, uint256 amount) internal returns (uint256 cost) {
        cost = _buyBonding(b, amount, true);
    }

    function _buyBonding(ERC404BondingInstance b, uint256 amount, bool mintNFT) internal returns (uint256 cost) {
        cost = _buyCost(b, amount);
        require(cost > 0, "buy: cost rounds to zero (amount below the curve normalization factor)");
        vm.startBroadcast();
        b.buyBonding{ value: cost }(amount, cost, mintNFT, bytes(""), "", 0);
        vm.stopBroadcast();
    }

    /// @dev Reconstruct the curve Params struct from the public auto-getter (returns a 3-tuple).
    function _curveParams(ERC404BondingInstance b) internal view returns (BondingCurveMath.Params memory p) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = b.curveParams();
        p = BondingCurveMath.Params({ kCoeff: kCoeff, poleWad: poleWad, normalizationFactor: normalizationFactor });
    }

    /// @dev The tokens still buyable on a curve: the bonding cap the instance itself enforces, less
    ///      what has already been sold.
    function _bondableRemaining(ERC404BondingInstance b) internal view returns (uint256) {
        uint256 cap = b.maxSupply() - b.liquidityReserve() - (b.freeMintAllocation() * b.unit());
        uint256 sold = b.totalBondingSupply();
        return cap > sold ? cap - sold : 0;
    }

    // ─────────────────────────── Post-conditions ───────────────────────────
    //
    // WHY THESE ARE `require`s AND NOT LOGS. Forge simulates an entire script before broadcasting any
    // of it, so a failed post-condition costs a named failure and NO partial seed. A comment claiming
    // an outcome is not an outcome. Do not soften one to make a run pass.
    //
    // WHY THEY LIVE HERE AND TAKE AN INTERFACE. The identical function is exercised by a unit test
    // against a stub whose state is settable, which is what demonstrates that removing the graduation
    // (or the maturity, or the raise) turns them RED. An assertion nothing can fail is the failure
    // mode these are written against.

    /// @notice Assert the four curve states the showcase claims to hold.
    /// @param states  The roster's instances, in roster order.
    /// @param legs    The roster.
    /// @param nowTs   The timestamp to judge the clock-dependent states at.
    /// @param poolLiquidity Live liquidity in the graduated row's venue pool. Passed in rather than
    ///        read here so the assertion stays chain-free and unit-testable; phase 2 reads it off the
    ///        pool manager and hands it over.
    function _assertShowcaseStates(
        IShowcaseCurveState[] memory states,
        ShowcaseLeg[] memory legs,
        uint256 nowTs,
        uint128 poolLiquidity
    ) internal view {
        require(states.length == legs.length, "post: roster/state length mismatch");
        bool sawPreopen;
        bool sawMid;
        bool sawReady;
        bool sawGraduated;

        for (uint256 i = 0; i < legs.length; i++) {
            IShowcaseCurveState s = states[i];
            string memory slug = legs[i].slug;

            if (legs[i].state == STATE_PREOPEN) {
                // The pre-open row is the one the visitor must find UNBOUGHT and UNOPENED. Its open
                // time still being in the future is the whole property: it is what makes `buyBonding`
                // revert `TooEarly` on-chain, which is the behaviour the description promises.
                require(s.bondingActive(), string.concat("post: ", slug, " is not armed"));
                require(s.bondingOpenTime() > nowTs, string.concat("post: ", slug, " has already opened"));
                require(s.totalBondingSupply() == 0, string.concat("post: ", slug, " has been bought into"));
                require(!s.graduated(), string.concat("post: ", slug, " is graduated"));
                sawPreopen = true;
            } else if (legs[i].state == STATE_MID_CURVE) {
                require(s.bondingActive(), string.concat("post: ", slug, " is not armed"));
                require(s.bondingOpenTime() <= nowTs, string.concat("post: ", slug, " has not opened"));
                require(!s.graduated(), string.concat("post: ", slug, " is graduated (mid-curve row)"));
                require(s.totalBondingSupply() > 0, string.concat("post: ", slug, " has no partial fill"));
                require(s.reserve() > 0, string.concat("post: ", slug, " holds no raise"));
                sawMid = true;
            } else if (legs[i].state == STATE_READY) {
                // Ready-to-graduate is three facts at once, and dropping any one of them leaves the
                // graduate action unreachable: open, matured, and holding a raise. `deployLiquidity`
                // reverts `NoReserve` on a zero raise, so a matured empty curve is not "ready".
                require(s.bondingActive(), string.concat("post: ", slug, " is not armed"));
                require(s.bondingOpenTime() <= nowTs, string.concat("post: ", slug, " has not opened"));
                require(
                    s.bondingMaturityTime() != 0 && s.bondingMaturityTime() <= nowTs,
                    string.concat("post: ", slug, " has not matured (graduate action would not be live)")
                );
                require(s.reserve() > 0, string.concat("post: ", slug, " holds no raise to graduate"));
                require(!s.graduated(), string.concat("post: ", slug, " has already graduated"));
                sawReady = true;
            } else if (legs[i].state == STATE_GRADUATED) {
                require(s.graduated(), string.concat("post: ", slug, " has NOT graduated"));
                // The raise is moved out and the reserve zeroed by `deployLiquidity`; a graduated row
                // still holding one did not complete.
                require(s.reserve() == 0, string.concat("post: ", slug, " graduated with the raise still held"));
                require(poolLiquidity > 0, string.concat("post: ", slug, " venue pool holds no liquidity"));
                sawGraduated = true;
            } else {
                revert("post: unknown roster state");
            }
        }

        require(sawPreopen, "post: no pre-open row in the roster");
        require(sawMid, "post: no mid-curve row in the roster");
        require(sawReady, "post: no ready-to-graduate row in the roster");
        require(sawGraduated, "post: no graduated row in the roster");
    }

    // ─────────────────────────── The art acceptance test ───────────────────────────
    //
    // A seeded collection whose art does not render is a failed seed, whatever its economics say. A
    // per-piece base composes as `base + tokenId` with NO separator, so a base missing its trailing
    // slash addresses `<cid>7` instead of `<cid>/7`, and one carrying two produces `//7`.

    function _assertPieceBase(string memory base, string memory label) internal pure {
        bytes memory b = bytes(base);
        require(b.length > 8, string.concat("art: ", label, " has no per-piece base URI"));
        require(_startsWith(base, "ipfs://"), string.concat("art: ", label, " base is not content-addressed"));
        require(b[b.length - 1] == "/", string.concat("art: ", label, " base has no trailing slash"));
        require(b[b.length - 2] != "/", string.concat("art: ", label, " base ends in a double slash"));
        require(!_contains(base, "TODO"), string.concat("art: ", label, " base still carries a placeholder"));
    }

    function _startsWith(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i < n.length; i++) {
            if (h[i] != n[i]) return false;
        }
        return true;
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }

    // ─────────────────────────── Metadata ───────────────────────────

    /// @dev Backend-free collection metadata: an unencoded `data:application/json,{...}` URI whose
    ///      image is a plain `ipfs://` pointer. No server, no gateway pinned, nothing to keep up.
    function _collectionMeta(string memory name, string memory description, string memory image)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"description\":\"",
            description,
            "\",\"category\":\"edition\",\"image\":\"",
            image,
            "\"}"
        );
    }

    // ─────────────────────────── ETH discipline ───────────────────────────

    /// @dev Print what a phase is about to spend BEFORE it spends it. On a public testnet the ETH is
    ///      a human's faucet balance, not a fork's fabricated one, so the number has to be visible at
    ///      simulation time — which is before `--broadcast` sends anything.
    function _reportSpend(string memory phase, uint256 curveEth, uint256 balanceBefore) internal pure {
        console.log("--------------------------------------------------");
        console.log(string.concat("ETH projection - ", phase));
        console.log("  curve spend (wei):", curveEth);
        console.log("  deployer balance before (wei):", balanceBefore);
        console.log("  gas is NOT included above - it is charged per broadcast tx by forge");
        console.log("--------------------------------------------------");
    }

    /// @dev Create + arm helper shared by phase 1's rows. Kept here so the create parameters a row
    ///      does NOT vary (owner, preset, piece count, gating, free mint) are stated exactly once.
    function _createShowcaseInstance(Deployed memory d, ShowcaseLeg memory leg, address vault)
        internal
        returns (address instance)
    {
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, leg.slug, "ERC404-SEPOLIA")),
            name: leg.slug,
            symbol: leg.symbol,
            styleUri: "",
            tokenBaseURI: leg.pieceBase,
            owner: deployer,
            vault: vault,
            nftCount: SHOWCASE_NFT_COUNT,
            presetId: PRESET_NICHE,
            stakingModule: address(0),
            declaredMaxAllowanceBps: leg.declaredMaxBps
        });
        instance = d.erc404
            .createInstance(
                params,
                _collectionMeta(leg.title, leg.description, leg.image),
                d.uniDeployer,
                address(0), // no gating on the spine rows
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            );
    }
}

/// @dev The vault factory's WETH immutable — read so the seed never re-declares an external address.
interface IWethSource {
    function weth() external view returns (address);
}
