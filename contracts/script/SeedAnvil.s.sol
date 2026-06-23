// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1155Factory} from "../src/factories/erc1155/ERC1155Factory.sol";
import {FeaturedQueueManager} from "../src/master/FeaturedQueueManager.sol";
import {GlobalMessageRegistry} from "../src/registry/GlobalMessageRegistry.sol";
import {ProfileRegistry} from "../src/registry/ProfileRegistry.sol";
import {FreeMintParams} from "../src/interfaces/IFactoryTypes.sol";
import {GatingScope} from "../src/gating/IGatingModule.sol";

/// @notice Anvil-only seed: stands up a few ERC1155 collections + a couple of profiles so the
///         discovery cards, images, and profile pages light up with real on-chain data. Runs AFTER
///         DeployAnvil; reads the deployed addresses from deployments/anvil.json. All metadata is
///         backend-free — inline `data:` JSON with inline `data:` SVG images, so the seed needs no
///         IPFS/network and renders offline. NEVER part of a production deploy (DeployCore stays
///         clean); this lives only in the local dev bridge.
contract SeedAnvil is Script {

    // Well-known Anvil account #1 (public test key) — used to seed a second, non-deployer profile.
    uint256 constant ACCOUNT_1_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    function run() public {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        string memory json = vm.readFile("./deployments/anvil.json");
        ERC1155Factory factory = ERC1155Factory(vm.parseJsonAddress(json, ".factories.ERC1155"));
        ProfileRegistry profiles = ProfileRegistry(vm.parseJsonAddress(json, ".contracts.ProfileRegistry"));
        // `vaults` is serialized as a JSON-encoded STRING (DeployCore builds it by hand), so parse
        // it out first, then index the inner array for the first deployed vault's address.
        string memory vaultsJson = vm.parseJsonString(json, ".vaults");
        address vault = vm.parseJsonAddress(vaultsJson, "[0].address");
        FeaturedQueueManager queue =
            FeaturedQueueManager(payable(vm.parseJsonAddress(json, ".contracts.FeaturedQueueManager")));
        GlobalMessageRegistry messages =
            GlobalMessageRegistry(vm.parseJsonAddress(json, ".contracts.GlobalMessageRegistry"));

        // ── Collections (creator must be the broadcaster) ───────────────────────
        // Each is created AND featured (rentFeatured) so it surfaces in getHomePageData — the
        // discovery browse reads the featured queue, not the raw instance set. rankBoost descends
        // so the list has a stable order; a generous value covers the cost and the excess refunds.
        vm.startBroadcast(deployerKey);

        address c0 = _createCollection(factory, deployer, vault, 0,
            "neon-drift", "Neon Drift",
            "Generative monochrome fragments. An edition aligned to the MS2 community.", "ND");
        address c1 = _createCollection(factory, deployer, vault, 1,
            "monolith", "Monolith",
            "One slab, many hands. A minimalist open edition.", "MO");
        address c2 = _createCollection(factory, deployer, vault, 2,
            "ghost-mint", "Ghost Mint",
            "Faint signals from the fossil layer. Free-claim editions.", "GM");

        uint256 duration = 30 days; // within [minDuration, maxDuration]
        queue.rentFeatured{value: 1 ether}(c0, duration, 0.03 ether);
        queue.rentFeatured{value: 1 ether}(c1, duration, 0.02 ether);
        queue.rentFeatured{value: 1 ether}(c2, duration, 0.01 ether);

        // Deployer profile.
        profiles.setProfile(_profileMeta(
            "MS2 Labs", "ms2labs",
            "Building the lean onchain launchpad. Alignment is the product.", "M"));

        // Deployer activity (POST=0 to own wall: instance == sender). Lights up the profile feed.
        _post(messages, deployer, "gm. neon-drift is live and aligned to MS2.");
        _post(messages, deployer, "the vault is the product. alignment compounds.");
        // A post to a COLLECTION channel (instance == c0) so the collection-detail feed renders too.
        _post(messages, c0, "first drop. minting is open.");

        vm.stopBroadcast();

        // ── A second profile + post from a different account ────────────────────
        vm.startBroadcast(ACCOUNT_1_KEY);
        address acct1 = vm.addr(ACCOUNT_1_KEY);
        profiles.setProfile(_profileMeta(
            "Vela", "vela",
            "Collector. Aligned to the cult.", "V"));
        _post(messages, acct1, "minted from monolith. clean.");
        _post(messages, c0, "grabbed one from neon-drift. love the aberration.");
        vm.stopBroadcast();

        console.log("Seeded 3 collections + 2 profiles + 5 messages. ERC1155 factory:", address(factory));
    }

    function _createCollection(
        ERC1155Factory factory,
        address creator,
        address vault,
        uint256 index,
        string memory slug,
        string memory displayName,
        string memory description,
        string memory glyph
    ) internal returns (address instance) {
        ERC1155Factory.CreateParams memory params = ERC1155Factory.CreateParams({
            name: slug,
            metadataURI: _collectionMeta(displayName, description, glyph),
            creator: creator,
            vault: vault,
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        });
        bytes32 salt = keccak256(abi.encode(block.timestamp, index, slug));
        instance = factory.createInstance(salt, params);
    }

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
