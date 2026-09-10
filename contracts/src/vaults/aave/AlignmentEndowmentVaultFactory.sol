// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AlignmentEndowmentVault } from "./AlignmentEndowmentVault.sol";
import { IAlignmentRegistry } from "../../master/interfaces/IAlignmentRegistry.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IFactory } from "../../interfaces/IFactory.sol";
import { ICreateX, CREATEX } from "../../shared/CreateXConstants.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/// @title AlignmentEndowmentVaultFactory
/// @notice Deploys AlignmentEndowmentVault clones via CREATE3 (EIP-1167 minimal proxy).
///         The factory becomes the owner of every vault it deploys. That ownership carries the
///         emergency escrow migration and nothing about the community payout: a vault's target sink is
///         read live from the alignment registry on every send, this factory has no setter for it, and
///         the vault has none either. Redirecting a community's money is not a capability the protocol
///         holds — the registry pins a payout once and only the address receiving it rotates it.
///
///         Vault creation is owner-gated: only the protocol may deploy a vault for an approved,
///         active alignment target. The factory self-registers each vault in the
///         MasterRegistry with an ON-CHAIN-DERIVED name (`<target.title> Aave Endowment Vault`) and a
///         factory-hardcoded metadataURI — neither is caller-supplied, closing the roster-phishing
///         vector. A per-`(targetId, token)` dedup rejects duplicate vaults. To self-register the
///         factory must be an active `IFactory` in the MasterRegistry (see MasterRegistryV1.registerVault):
///         it implements `IFactory` with `protocol() == owner()` and empty feature sets (a vault factory
///         contributes no wizard component-steps).
contract AlignmentEndowmentVaultFactory is Ownable, IFactory {
    /// @notice Factory-hardcoded metadataURI for every self-registered vault — NOT caller-supplied, so
    ///         it cannot be weaponised for roster phishing. Matches the deploy seed's literal.
    string constant METADATA_URI = "https://ms2.fun";

    address public immutable vaultImplementation;
    address public immutable weth;
    address public immutable stataToken;
    address public immutable protocolTreasury;
    address public immutable masterRegistry;
    IAlignmentRegistry public immutable alignmentRegistry;

    /// @notice The single canonical vault per `(alignmentTargetId, alignmentToken)` pair. The registry
    ///         dedups on vault ADDRESS only, which does not stop N distinct vaults for the same
    ///         (target, token); this mapping closes that roster-spam vector.
    mapping(bytes32 => address) public canonicalVault;

    /// @notice A vault for this `(targetId, token)` already exists (see `canonicalVault`).
    error VaultAlreadyExists();

    event VaultDeployed(address indexed vault, address indexed alignmentToken, uint256 indexed targetId);

    constructor(
        // slither-disable-next-line missing-zero-check
        address _weth,
        // slither-disable-next-line missing-zero-check
        address _stataToken,
        // slither-disable-next-line missing-zero-check
        address _protocolTreasury,
        // slither-disable-next-line missing-zero-check
        address _masterRegistry,
        IAlignmentRegistry _alignmentRegistry
    ) {
        _initializeOwner(msg.sender);
        weth = _weth;
        stataToken = _stataToken;
        protocolTreasury = _protocolTreasury;
        masterRegistry = _masterRegistry;
        alignmentRegistry = _alignmentRegistry;
        vaultImplementation = address(new AlignmentEndowmentVault());
    }

    // ── IFactory ───────────────────────────────────────────────────────────────
    // The MasterRegistry gates factory registration on `protocol() != address(0)`. A vault factory
    // contributes no wizard component-steps, so its feature sets are empty (mirrors ERC721AuctionFactory).

    /// @inheritdoc IFactory
    function protocol() external view returns (address) {
        return owner();
    }

    /// @inheritdoc IFactory
    function features() external pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    /// @inheritdoc IFactory
    function requiredFeatures() external pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    // `setVaultCommunityPayout` is deliberately absent. It forwarded to the vault's owner-only sink
    // setter, which was consulted whenever the alignment registry's payout for the target was zero —
    // and since pinning that registry payout is itself owner-gated, an owner who never pinned one kept a
    // sink they could re-point here at will, over a community that had nothing to rotate. The vault now
    // reads the registry and only the registry, so there is nothing for this to write.

    /// @notice Emergency: migrate a vault's ESCROWED tranche (pro-rata, impairment-aware) to `to` (the
    ///         factory owns its vaults, and the vault's `migratePosition` is onlyOwner). For an Aave
    ///         reserve deprecation. Per-benefactor accounting is preserved on-chain; the vested tranche
    ///         is the target's and is not moved here.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param to    Recovery recipient for the redeemed ETH
    function migrateVault(address vault, address to) external onlyOwner {
        AlignmentEndowmentVault(payable(vault)).migratePosition(to);
    }

    /// @notice Deploy a new vault clone via CREATE3
    /// @dev onlyOwner. A vault binds itself to an alignment target and self-registers on the shared
    ///      roster, so creation is a protocol act. `salt` stays bound to `msg.sender`, which under this
    ///      gate is the owner.
    /// @param salt CREATE3 deployment salt for deterministic vanity address
    /// @param alignmentToken The token this vault aligns to
    /// @param alignmentTargetId The alignment target this vault is bound to
    /// @return vault Address of the deployed vault clone
    // slither-disable-next-line reentrancy-events
    function deployVault(bytes32 salt, address alignmentToken, uint256 alignmentTargetId)
        external
        onlyOwner
        returns (address vault)
    {
        // Dedup: one canonical vault per (target, token). The registry only dedups on vault address,
        // so this guard is what stops N vaults per (target, token) from spamming the roster.
        bytes32 dedupKey = keccak256(abi.encode(alignmentTargetId, alignmentToken));
        if (canonicalVault[dedupKey] != address(0)) revert VaultAlreadyExists();

        bytes memory proxyCreationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", vaultImplementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
        // Bind salt to msg.sender to prevent front-running the deterministic CREATE3 address.
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(msg.sender, salt));
        vault = ICreateX(CREATEX).deployCreate3(senderBoundSalt, proxyCreationCode);

        // No payout is passed: the vault resolves its target sink from `alignmentRegistry` on every send,
        // so there is no deploy-time copy to seed and no window in which a stale one could be paid.
        AlignmentEndowmentVault(payable(vault))
            .initialize(
                address(this), weth, stataToken, protocolTreasury, masterRegistry, alignmentToken, alignmentTargetId
            );

        canonicalVault[dedupKey] = vault;

        // Self-register in the MasterRegistry with an ON-CHAIN-DERIVED name (never caller-supplied) and
        // the factory-hardcoded metadataURI. `msg.sender` — the owner, under the gate above — is credited
        // as the vault creator. The registry
        // enforces target-active + token-in-target, and requires this factory to be an active IFactory.
        string memory derivedName =
            string.concat(alignmentRegistry.getAlignmentTarget(alignmentTargetId).title, " Aave Endowment Vault");
        IMasterRegistry(masterRegistry).registerVault(vault, msg.sender, derivedName, METADATA_URI, alignmentTargetId);

        emit VaultDeployed(vault, alignmentToken, alignmentTargetId);
    }

    /// @notice Preview the deterministic address for a given salt
    function computeVaultAddress(address creator, bytes32 salt) external view returns (address) {
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(creator, salt));
        bytes32 guardedSalt = keccak256(abi.encode(senderBoundSalt)); // CreateX RandomBytes guard path
        return ICreateX(CREATEX).computeCreate3Address(guardedSalt, CREATEX);
    }
}
