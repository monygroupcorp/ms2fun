// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { ERC721AuctionInstance } from "./ERC721AuctionInstance.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IFactory } from "../../interfaces/IFactory.sol";
import { CreateXSalt, ICreateX, CREATEX } from "../../shared/CreateXConstants.sol";

/**
 * @title ERC721AuctionFactory
 * @notice Deploys and registers ERC721 auction instances for 1/1 artists.
 *         Single responsibility: validate → deploy via CREATE3 → register.
 *         Protocol fees flow directly to treasury — no custody.
 */
contract ERC721AuctionFactory is Ownable, ReentrancyGuard, IFactory {
    error InvalidAddress();
    error InvalidName();
    error VaultMustBeContract();
    error NameAlreadyTaken();
    error NotAuthorizedAgent();

    // slither-disable-next-line immutable-states
    IMasterRegistry public masterRegistry;
    address public immutable globalMessageRegistry;
    address public protocolTreasury;
    address public weth;

    struct CreateParams {
        string name;
        string metadataURI;
        address creator;
        address vault;
        string symbol;
        uint8 lines;
        uint40 baseDuration;
        uint40 timeBuffer;
        uint256 bidIncrement;
        // EIP-2981 secondary royalty the collection asks marketplaces for. 0 = ask for none, which is
        // what every collection deployed before this field existed reports. Paid to the creator, not
        // to the alignment vault — the 19% is levied on the winning bid and takes nothing from a resale.
        address royaltyReceiver; // address(0) = track the instance owner
        uint16 royaltyBps; // at most RoyaltyLib.MAX_ROYALTY_BPS; validated by the instance
    }

    event InstanceCreated(address indexed instance, address indexed creator, string name, address indexed vault);
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event VaultCapabilityWarning(address indexed vault, bytes32 indexed capability);

    constructor(address _masterRegistry, address _globalMessageRegistry, address _weth) {
        _initializeOwner(msg.sender);
        if (_globalMessageRegistry == address(0)) revert InvalidAddress();
        if (_weth == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistry(_masterRegistry);
        globalMessageRegistry = _globalMessageRegistry;
        weth = _weth;
    }

    /// @notice Deploy a new ERC721 auction instance. Any ETH forwarded directly to treasury.
    function createInstance(bytes32 salt, CreateParams calldata params)
        external
        payable
        nonReentrant
        returns (address instance)
    {
        // Forward fee directly to treasury — factory holds no ETH
        if (msg.value > 0 && protocolTreasury != address(0)) {
            SafeTransferLib.safeTransferETH(protocolTreasury, msg.value);
        }

        if (bytes(params.name).length == 0) revert InvalidName();
        if (params.creator == address(0)) revert InvalidAddress();
        if (params.vault == address(0)) revert InvalidAddress();
        if (params.vault.code.length == 0) revert VaultMustBeContract();

        bool agentCreated = false;
        if (msg.sender != params.creator) {
            if (!masterRegistry.isAgent(msg.sender)) revert NotAuthorizedAgent();
            agentCreated = true;
        }

        if (masterRegistry.isNameTaken(params.name)) revert NameAlreadyTaken();

        // Soft vault capability check
        try IAlignmentVault(payable(params.vault)).supportsCapability(keccak256("YIELD_GENERATION")) returns (
            bool supported
        ) {
            if (!supported) emit VaultCapabilityWarning(params.vault, keccak256("YIELD_GENERATION"));
        } catch {
            emit VaultCapabilityWarning(params.vault, keccak256("YIELD_GENERATION"));
        }

        instance = _deployInstance(salt, params, agentCreated);
        masterRegistry.registerInstance(
            instance, address(this), params.creator, params.name, params.metadataURI, params.vault
        );

        emit InstanceCreated(instance, params.creator, params.name, params.vault);
    }

    function _deployInstance(bytes32 salt, CreateParams calldata params, bool agentCreated)
        private
        returns (address instance)
    {
        bytes memory initCode = abi.encodePacked(
            type(ERC721AuctionInstance).creationCode,
            abi.encode(
                ERC721AuctionInstance.ConstructorParams({
                    vault: params.vault,
                    protocolTreasury: protocolTreasury,
                    owner: params.creator,
                    name: params.name,
                    symbol: params.symbol,
                    metadataURI: params.metadataURI,
                    lines: params.lines,
                    baseDuration: params.baseDuration,
                    timeBuffer: params.timeBuffer,
                    bidIncrement: params.bidIncrement,
                    globalMessageRegistry: globalMessageRegistry,
                    masterRegistry: address(masterRegistry),
                    factory: address(this),
                    weth: weth
                })
            )
        );
        // CreateX reads its front-run guard off the SHAPE of this salt: first 20 bytes the caller,
        // 21st byte 0x00, and the guard becomes keccak256(msg.sender, salt), which no third party can
        // reproduce. See CreateXSalt.
        bytes32 create3Salt = CreateXSalt.permissioned(address(this), msg.sender, salt);
        instance = ICreateX(CREATEX).deployCreate3(create3Salt, initCode);
        if (agentCreated) {
            ERC721AuctionInstance(payable(instance)).setAgentDelegationFromFactory();
        }
        // Royalty is set here rather than in the constructor so the instance's deployed bytecode and
        // its constructor ABI are unchanged by this field. The instance validates the rate against
        // its own cap and reverts the whole create if it is out of range, so an over-cap rate can
        // never be silently discarded into a deployed collection.
        ERC721AuctionInstance(payable(instance)).initializeRoyalty(params.royaltyReceiver, params.royaltyBps);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setWeth(address _weth) external onlyOwner {
        if (_weth == address(0)) revert InvalidAddress();
        weth = _weth;
    }

    function setProtocolTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        address old = protocolTreasury;
        protocolTreasury = _treasury;
        emit ProtocolTreasuryUpdated(old, _treasury);
    }

    // ── IFactory ─────────────────────────────────────────────────────────────

    function protocol() external view returns (address) {
        return owner();
    }

    function features() external view returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function requiredFeatures() external pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    /// @notice Preview the deterministic address for a given salt.
    function computeInstanceAddress(address creator, bytes32 salt) external view returns (address) {
        bytes32 create3Salt = CreateXSalt.permissioned(address(this), creator, salt);
        return ICreateX(CREATEX).computeCreate3Address(CreateXSalt.guarded(address(this), create3Salt), CREATEX);
    }
}
