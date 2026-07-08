// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FeaturedQueueManager } from "../src/master/FeaturedQueueManager.sol";
import { GlobalMessageRegistry } from "../src/registry/GlobalMessageRegistry.sol";
import { ProfileRegistry } from "../src/registry/ProfileRegistry.sol";
import { FreeMintParams } from "../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../src/gating/IGatingModule.sol";
import { IPasswordTierGatingModule, TierConfig, TierType } from "../src/gating/IPasswordTierGatingModule.sol";
import { IAlignmentVault } from "../src/interfaces/IAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";

interface IOwnable {
    function transferOwnership(address newOwner) external payable;
}

/// @notice Anvil-only ADDITIVE seed. Runs AFTER DeployAnvil + SeedAnvil; creates its OWN rich
///         collections/activity (does not touch SeedAnvil's instances), then hands its instances to
///         ADMIN. Only "open now" / far-future states (no vm.warp, no time-advance dependency).
contract SeedRich is Script {
    address constant ADMIN = 0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86;
    uint256[8] private ACTOR_KEYS = [
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a,
        0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6,
        0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a,
        0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba,
        0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e,
        0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356,
        0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97,
        0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6
    ];

    struct Deployed {
        ERC1155Factory erc1155;
        ERC404Factory erc404;
        ProfileRegistry profiles;
        FeaturedQueueManager queue;
        GlobalMessageRegistry messages;
        address vault;
        address endowmentVault;
        address stakingModule;
        address zammDeployer;
        address gatingModule;
    }

    uint256 deployerKey;
    address deployer;
    address[] private _instances;

    // Cross-phase references
    address private _spectra;
    address private _drift;

    function run() public {
        deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        Deployed memory d = _readDeployed();

        _phase1Profiles(d);
        _phase2Erc1155(d);
        _phase3Gated1155(d);
        _phase4Erc404(d);
        _phase5Board(d);
        _phase6Vault(d);

        _transferAdmin();
        console.log("=== SeedRich complete. instances:", _instances.length);
    }

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory j = vm.readFile("./deployments/anvil.json");
        d.erc1155 = ERC1155Factory(vm.parseJsonAddress(j, ".factories.ERC1155"));
        d.erc404 = ERC404Factory(payable(vm.parseJsonAddress(j, ".factories.ERC404")));
        d.profiles = ProfileRegistry(vm.parseJsonAddress(j, ".contracts.ProfileRegistry"));
        d.queue = FeaturedQueueManager(payable(vm.parseJsonAddress(j, ".contracts.FeaturedQueueManager")));
        d.messages = GlobalMessageRegistry(vm.parseJsonAddress(j, ".contracts.GlobalMessageRegistry"));
        d.stakingModule = vm.parseJsonAddress(j, ".contracts.ERC404StakingModule");
        d.zammDeployer = vm.parseJsonAddress(j, ".contracts.ModuleZAMMDeployer");
        d.gatingModule = vm.parseJsonAddress(j, ".contracts.PasswordTierGatingModule");
        string memory vaultsJson = vm.parseJsonString(j, ".vaults");
        d.vault = vm.parseJsonAddress(vaultsJson, "[0].address");
        d.endowmentVault = vm.parseJsonAddress(vaultsJson, "[2].address");
    }

    function _transferAdmin() internal {
        vm.startBroadcast(deployerKey);
        for (uint256 i = 0; i < _instances.length; i++) {
            IOwnable(_instances[i]).transferOwnership(ADMIN);
        }
        vm.stopBroadcast();
    }

    // ── Phase 1 — profiles ────────────────────────────────────────────────────
    function _phase1Profiles(Deployed memory d) internal {
        _setProfile(d, ACTOR_KEYS[0], "Rune", "rune", "Monochrome maximalist.", _svg("R"));
        _setProfile(d, ACTOR_KEYS[1], "Mire", "mire", "Floor sweeper.", _svg("M"));
        _setProfile(d, ACTOR_KEYS[2], "Cael", "cael", "Editions only.", _svg("C"));
        _setProfile(d, ACTOR_KEYS[3], "Onyx", "onyx", "Auction sniper.", _svg("O"));
        _setProfile(d, ACTOR_KEYS[4], "Veil", "veil", "Bonding degen.", _svg("V"));
        _setProfile(d, ACTOR_KEYS[5], "Ash", "ash", "Lurker.", _svg("A"));
        _setProfile(d, ACTOR_KEYS[6], "Dusk", "dusk", "Posts at 3am.", _svg("D"));
        _setProfile(d, ACTOR_KEYS[7], "Iris", "iris", "Curator.", _svg("I"));
    }

    // ── Phase 2 — ERC1155 edition states ─────────────────────────────────────
    function _phase2Erc1155(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _create1155(d, "spectra", "Spectra", "Edition mechanics showcase.", _svg("S"));
        _spectra = inst;
        ERC1155Instance r = ERC1155Instance(inst);
        // id 1 dynamic (price rises), id 2 fixed supply 3 (we sell out), id 3 future-open (stays locked).
        r.addEdition(
            "Rising",
            0.002 ether,
            100,
            _pieceMeta("Rising", _svg("RS")),
            ERC1155Instance.PricingModel.LIMITED_DYNAMIC,
            500,
            0
        );
        r.addEdition(
            "Scarce", 0.003 ether, 3, _pieceMeta("Scarce", _svg("SC")), ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0
        );
        r.addEdition(
            "Embargo",
            0.001 ether,
            50,
            _pieceMeta("Embargo", _svg("EM")),
            ERC1155Instance.PricingModel.LIMITED_FIXED,
            0,
            block.timestamp + 7 days
        );
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.015 ether);
        vm.stopBroadcast();

        _buyEdition(inst, 1, 1, ACTOR_KEYS[0]);
        _buyEdition(inst, 1, 2, ACTOR_KEYS[1]);
        _buyEdition(inst, 1, 1, deployerKey); // #0 holds some
        _buyEdition(inst, 2, 2, ACTOR_KEYS[2]); // sell out id 2 (3 total)
        _buyEdition(inst, 2, 1, ACTOR_KEYS[3]);
    }

    // ── Phase 3 — gated ERC1155 ───────────────────────────────────────────────
    function _phase3Gated1155(Deployed memory d) internal {
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = keccak256(bytes("ms2"));
        uint256[] memory caps = new uint256[](1);
        caps[0] = 5;
        TierConfig memory cfg = TierConfig(TierType.VOLUME_CAP, hashes, caps, new uint256[](0));

        vm.startBroadcast(deployerKey);
        ERC1155Factory.CreateParams memory p = ERC1155Factory.CreateParams({
            name: "vault-club",
            metadataURI: _collMeta("Vault Club", "Members-only. Password required.", _svg("K")),
            creator: deployer,
            vault: d.vault,
            styleUri: "/seed-art/styles/vault-club.css",
            gatingModule: d.gatingModule,
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        });
        address inst = d.erc1155.createInstance(keccak256(abi.encode(block.timestamp, "vault-club")), p, cfg);
        _instances.push(inst);
        ERC1155Instance(inst)
            .addEdition(
                "Members Pass",
                0.01 ether,
                50,
                _pieceMeta("Members Pass", _svg("MP")),
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0
            );
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.035 ether);
        vm.stopBroadcast();

        _buyEditionGated(inst, 1, 2, ACTOR_KEYS[0], "ms2");
        _buyEditionGated(inst, 1, 1, deployerKey, "ms2");
    }

    // ── Phase 4 — ERC404 bonding + gated bonding ──────────────────────────────
    function _phase4Open(Deployed memory d) internal {
        // Open bonding with staking, many buys (candles) + a sell.
        vm.startBroadcast(deployerKey);
        address open = _create404(d, "drift404", "Drift404", "DRIFT", d.stakingModule, address(0));
        _drift = open;
        ERC404BondingInstance b = ERC404BondingInstance(payable(open));
        b.setBondingOpenTime(block.timestamp + 1); // must be set before setBondingActive
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(open, 30 days, 0.05 ether);
        vm.stopBroadcast();
        _buyBonding(b, ACTOR_KEYS[0], 1e23, "");
        _buyBonding(b, ACTOR_KEYS[1], 2e23, "");
        _buyBonding(b, deployerKey, 12e23, ""); // #0 holds enough for a whole-unit NFT
        vm.startBroadcast(deployerKey);
        b.activateStaking();
        b.stake(5e22);
        b.transfer(deployer, 1e24); // mint #0 an NFT (already holds the tokens)
        vm.stopBroadcast();
        // a sell (down candle)
        vm.startBroadcast(ACTOR_KEYS[1]);
        b.sellBonding(1e23, 0, bytes32(0), "", 0);
        vm.stopBroadcast();
    }

    function _phase4Gated(Deployed memory d) internal {
        // Gated bonding.
        bytes32[] memory h = new bytes32[](1);
        h[0] = keccak256(bytes("ms2"));
        uint256[] memory c = new uint256[](1);
        c[0] = 5e24;
        TierConfig memory cfg = TierConfig(TierType.VOLUME_CAP, h, c, new uint256[](0));
        vm.startBroadcast(deployerKey);
        address gated = _create404Gated(d, "haze404", "Haze404", "HAZE", cfg);
        ERC404BondingInstance g = ERC404BondingInstance(payable(gated));
        g.setBondingOpenTime(block.timestamp + 1); // must be set before setBondingActive
        g.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(gated, 30 days, 0.055 ether);
        vm.stopBroadcast();
        _buyBonding(g, ACTOR_KEYS[0], 1e23, "ms2");
    }

    function _phase4Erc404(Deployed memory d) internal {
        _phase4Open(d);
        _phase4Gated(d);
    }

    // ── Phase 5 — board threads ───────────────────────────────────────────────
    function _phase5Board(Deployed memory d) internal {
        uint256 m1 = _postAs(d, ACTOR_KEYS[0], _spectra, "rising edition is climbing. aped.");
        _replyAs(d, ACTOR_KEYS[1], _spectra, m1, "scarce one already sold out lol");
        _reactAs(d, ACTOR_KEYS[2], _spectra, m1, unicode"🔥");
        _reactAs(d, ACTOR_KEYS[3], _spectra, m1, unicode"👀");
        uint256 m2 = _postAs(d, ACTOR_KEYS[4], _drift, "drift404 curve looks juicy. wen graduate");
        _replyAs(d, ACTOR_KEYS[5], _drift, m2, "early. staking now.");
        _reactAs(d, ACTOR_KEYS[6], _drift, m2, unicode"🚀");
    }

    // ── Phase 6 — vault contributions ────────────────────────────────────────
    function _phase6Vault(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        IAlignmentVault(payable(d.endowmentVault)).receiveContribution{ value: 0.3 ether }(
            Currency.wrap(address(0)), 0.3 ether, _spectra
        );
        vm.stopBroadcast();
    }

    // ── Helpers (used by later batches) ──────────────────────────────────────
    function _create1155(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory desc,
        string memory img
    ) internal returns (address inst) {
        ERC1155Factory.CreateParams memory p = ERC1155Factory.CreateParams({
            name: slug,
            metadataURI: _collMeta(name, desc, img),
            creator: deployer,
            vault: d.vault,
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        });
        inst = d.erc1155.createInstance(keccak256(abi.encode(block.timestamp, slug)), p);
        _instances.push(inst);
    }

    function _buyEdition(address inst, uint256 editionId, uint256 amount, uint256 key) internal {
        uint256 cost = ERC1155Instance(inst).calculateMintCost(editionId, amount);
        vm.startBroadcast(key);
        ERC1155Instance(inst).mint{ value: cost }(editionId, amount, bytes32(0), "", cost);
        vm.stopBroadcast();
    }

    function _buyEditionGated(address inst, uint256 editionId, uint256 amount, uint256 key, string memory pw) internal {
        uint256 cost = ERC1155Instance(inst).calculateMintCost(editionId, amount);
        vm.startBroadcast(key);
        ERC1155Instance(inst).mint{ value: cost }(editionId, amount, keccak256(bytes(pw)), "", cost);
        vm.stopBroadcast();
    }

    function _buyBonding(ERC404BondingInstance b, uint256 key, uint256 amount, string memory pw) internal {
        (uint256 ip, uint256 q4, uint256 q3, uint256 q2, uint256 nf) = b.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params(ip, q4, q3, q2, nf);
        uint256 cost = BondingCurveMath.calculateCost(p, b.totalBondingSupply(), amount);
        uint256 total = cost + (cost * b.bondingFeeBps()) / 10000;
        vm.startBroadcast(key);
        b.buyBonding{ value: total }(amount, total, false, pw_(pw), "", 0);
        vm.stopBroadcast();
    }

    function pw_(string memory pw) private pure returns (bytes32) {
        return bytes(pw).length == 0 ? bytes32(0) : keccak256(bytes(pw));
    }

    function _create404(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory sym,
        address staking,
        address gating
    ) internal returns (address inst) {
        ERC404Factory.CreateParams memory p = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, slug)),
            name: slug,
            symbol: sym,
            styleUri: "",
            tokenBaseURI: "",
            owner: deployer,
            vault: d.vault,
            nftCount: 10,
            presetId: 1,
            stakingModule: staking,
            declaredMaxAllowanceBps: 0
        });
        inst = d.erc404
            .createInstance(
                p,
                _collMeta(name, "Bonding ERC404.", _svg(sym)),
                d.zammDeployer,
                gating,
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            );
        _instances.push(inst);
    }

    function _create404Gated(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory sym,
        TierConfig memory cfg
    ) internal returns (address inst) {
        ERC404Factory.CreateParams memory p = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, slug)),
            name: slug,
            symbol: sym,
            styleUri: "",
            tokenBaseURI: "",
            owner: deployer,
            vault: d.vault,
            nftCount: 10,
            presetId: 1,
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });
        inst = d.erc404
            .createInstance(
                p,
                _collMeta(name, "Gated bonding.", _svg(sym)),
                d.zammDeployer,
                d.gatingModule,
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
                cfg
            );
        _instances.push(inst);
    }

    function _setProfile(
        Deployed memory d,
        uint256 key,
        string memory name,
        string memory handle,
        string memory bio,
        string memory img
    ) internal {
        vm.startBroadcast(key);
        d.profiles.setProfile(_profMeta(name, handle, bio, img));
        vm.stopBroadcast();
    }

    function _postAs(Deployed memory d, uint256 key, address ch, string memory c) internal returns (uint256 id) {
        id = d.messages.messageCount();
        vm.startBroadcast(key);
        d.messages.post(ch, 0, 0, bytes32(0), bytes32(0), c);
        vm.stopBroadcast();
    }

    function _replyAs(Deployed memory d, uint256 key, address ch, uint256 ref, string memory c) internal {
        vm.startBroadcast(key);
        d.messages.post(ch, 1, ref, bytes32(0), bytes32(0), c);
        vm.stopBroadcast();
    }

    function _reactAs(Deployed memory d, uint256 key, address ch, uint256 ref, string memory e) internal {
        vm.startBroadcast(key);
        d.messages.post(ch, 3, ref, bytes32(0), bytes32(0), e);
        vm.stopBroadcast();
    }

    // ── Backend-free metadata (image is a served /seed-art path or an inline data: SVG) ──
    function _collMeta(string memory name, string memory desc, string memory img)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"description\":\"",
            desc,
            "\",\"category\":\"edition\",\"image\":\"",
            img,
            "\"}"
        );
    }

    function _pieceMeta(string memory name, string memory img) internal pure returns (string memory) {
        return
            string.concat("data:application/json,{\"schemaVersion\":1,\"name\":\"", name, "\",\"image\":\"", img, "\"}");
    }

    function _profMeta(string memory name, string memory handle, string memory bio, string memory img)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"handle\":\"",
            handle,
            "\",\"bio\":\"",
            bio,
            "\",\"avatar\":\"",
            img,
            "\"}"
        );
    }

    function _svg(string memory glyph) internal pure returns (string memory) {
        return string.concat(
            "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>",
            "<rect width='400' height='400' fill='black'/><text x='200' y='250' fill='white' font-family='monospace' font-size='150' text-anchor='middle'>",
            glyph,
            "</text></svg>"
        );
    }
}
