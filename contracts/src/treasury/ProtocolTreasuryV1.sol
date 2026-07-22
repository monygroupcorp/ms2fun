// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

/**
 * @title ProtocolTreasuryV1
 * @notice UUPS upgradeable treasury that receives protocol revenue from all sources.
 * @dev Lean revenue sink: `deposit(Source)` / `receive()` in, owner-gated `withdraw*` out, plus
 *      revenue-by-source views. Tracks per-source receipts and an aggregate withdrawn total.
 *
 *      This is a LIVE-deployed UUPS proxy. Protocol-owned-liquidity (V4) was carved out into the
 *      standalone `ProtocolOwnedLiquidityV1` and the retired-DAO revenue conductor was stripped
 *      (noesis-066). To preserve the deployed proxy's storage layout on upgrade, the removed slots
 *      are held in place as `deprecated_*` placeholders rather than deleted — do NOT reorder or
 *      collapse them. Slot 2 co-hosts `_initialized` (packed at byte 20); its address placeholder
 *      MUST stay a same-size `address` so `_initialized` does not shift.
 */
contract ProtocolTreasuryV1 is SafeOwnableUUPS {
    // ============ Custom Errors ============
    // Note: AlreadyInitialized() and Unauthorized() are inherited from Ownable

    error InvalidAddress();
    error NoValue();
    error InsufficientBalance();
    error InvalidRecipient();
    error TransferFailed();

    // ============ Revenue Tracking ============

    // Enum kept as-is (a prune is a separate follow-up). POL_FEES is no longer produced here — it
    // moved with the POL carve-out to ProtocolOwnedLiquidityV1 — but the ordinals are preserved so
    // existing producers (e.g. DeployBondEscrow => BOND_FORFEIT) keep their on-chain source tags.
    enum Source {
        BONDING_FEE,
        CREATION_FEE,
        QUEUE_REVENUE,
        OTHER,
        POL_FEES,
        BOND_FORFEIT
    }

    // -- Storage layout (slot-locked to the deployed proxy — see contract NatSpec) --
    // slot 0
    mapping(Source => uint256) public totalReceived;
    // slot 1 — was `mapping(Source => uint256) totalWithdrawn` (never written). Held as a placeholder;
    // the honest aggregate withdrawn total is the appended `totalWithdrawn` below.
    uint256 private deprecated_totalWithdrawn_slot1;
    // slot 2 (bytes 0-19) — was `address revenueConductor`. MUST remain a same-size `address` so the
    // packed `_initialized` bool at byte 20 keeps its position.
    address private deprecated_revenueConductor;
    // slot 2 (byte 20) — live `true` on the deployed proxy; packed with the placeholder above.
    bool private _initialized;
    // slot 3 — was `address v4PoolManager` (moved to ProtocolOwnedLiquidityV1).
    address private deprecated_v4PoolManager;
    // slot 4 — was `address weth` (moved to ProtocolOwnedLiquidityV1).
    address private deprecated_weth;
    // slot 5 — was `IMasterRegistry masterRegistry`; its only consumer was the receivePOL gate, which
    // moved to ProtocolOwnedLiquidityV1, so it is deprecated here.
    address private deprecated_masterRegistry;
    // slot 6 — was `mapping(address => POLPosition) _polPositions` (moved).
    uint256 private deprecated_polPositions_slot6;
    // slot 7 — was `address[] polInstances` (moved).
    uint256 private deprecated_polInstances_slot7;

    // slot 8 — appended after the deprecated tail: honest aggregate of ETH withdrawn via withdrawETH.
    // ETH is fungible once pooled, so a single aggregate (not per-source) is the honest accounting.
    uint256 public totalWithdrawn;

    // Reserved storage for future upgrades (append-only growth below slot 8).
    uint256[50] private __gap;

    // ============ Events ============

    event RevenueReceived(Source indexed source, address indexed from, uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event ERC20Withdrawn(address indexed token, address indexed to, uint256 amount);
    event ERC721Withdrawn(address indexed token, address indexed to, uint256 tokenId);

    // ============ Initialization ============

    function initialize(address _owner) external {
        if (_initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert InvalidAddress();
        _initialized = true;
        _setOwner(_owner);
    }

    // ============ Revenue Intake ============

    /// @notice Receive ETH with source attribution
    function deposit(Source source) external payable {
        if (msg.value == 0) revert NoValue();
        totalReceived[source] += msg.value;
        emit RevenueReceived(source, msg.sender, msg.value);
    }

    /// @notice Plain ETH receive — tagged as OTHER
    receive() external payable {
        totalReceived[Source.OTHER] += msg.value;
        emit RevenueReceived(Source.OTHER, msg.sender, msg.value);
    }

    // ============ Withdrawals (Owner Only) ============

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        if (amount > address(this).balance) revert InsufficientBalance();
        // Effects before interaction: record the aggregate withdrawn total before the transfer.
        totalWithdrawn += amount;
        SafeTransferLib.safeTransferETH(to, amount);
        emit ETHWithdrawn(to, amount);
    }

    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        SafeTransferLib.safeTransfer(token, to, amount);
        emit ERC20Withdrawn(token, to, amount);
    }

    // slither-disable-next-line missing-zero-check,reentrancy-events
    function withdrawERC721(address token, address to, uint256 tokenId) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        // Use low-level call for ERC721 transferFrom(address,address,uint256)
        (bool success,) =
            token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", address(this), to, tokenId));
        if (!success) revert TransferFailed();
        emit ERC721Withdrawn(token, to, tokenId);
    }

    // ============ ERC721 Receiver ============

    /// @notice Accept ERC721 safeTransfer
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ============ Views ============

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Revenue accounting for a source. `received` is per-source; `withdrawn` is the protocol
    ///         aggregate of ETH withdrawn (ETH is fungible once pooled — there is no honest per-source
    ///         withdrawn figure, and the withdrawal path is not source-tagged).
    function getRevenueBySource(Source source) external view returns (uint256 received, uint256 withdrawn) {
        return (totalReceived[source], totalWithdrawn);
    }
}
