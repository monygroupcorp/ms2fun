// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {IAlignmentRegistry} from "./interfaces/IAlignmentRegistry.sol";

/// @dev Minimal read surface for the dup guard — `tokenToTargetIds` is a public mapping on
///      AlignmentRegistryV1 (no length getter, so the guard is best-effort on the first target).
interface IAlignmentRegistryDup {
    function tokenToTargetIds(address token, uint256 index) external view returns (uint256);
    function isAlignmentTargetActive(uint256 targetId) external view returns (bool);
}

/// @title AlignmentTargetRequestRegistry
/// @notice Permissionless intake for proposing a new alignment target (a community + its token), with
///         admin-only approval. A standalone escrow/queue that sits IN FRONT of AlignmentRegistryV1 —
///         it never registers a target itself. On approval the owner reads the request and calls
///         `AlignmentRegistryV1.registerAlignmentTarget` with the proposed data (two-tx, by design:
///         see docs/phases/alignment-target-requests.md, D5/D7). Anti-spam is a refundable ETH deposit
///         (refunded on approve/expiry, forfeitable to the treasury on spam-reject), mirroring the
///         FeaturedQueueManager pay-to-enter idiom.
/// @dev Non-upgradeable + Ownable (owner = Safe/Timelock). Deposits are escrowed here while Pending.
contract AlignmentTargetRequestRegistry is Ownable, ReentrancyGuard {
    // ── Errors ──────────────────────────────────────────────────────────────
    error InvalidAddress();
    error InvalidTitle();
    error NoAssets();
    error IncorrectDeposit();
    error QueueFull();
    error NotPending();
    error TokenAlreadyActive();
    error TokenNotInAssets();
    error TargetNotRegistered();
    error NotExpired();
    error NoRefund();

    // ── Types ───────────────────────────────────────────────────────────────
    enum Status { None, Pending, Approved, Rejected, Expired }

    struct Request {
        address requester;
        address token;        // primary token — feeds the pool scout + the dup guard
        string  title;
        string  description;
        string  metadataURI;
        uint256 deposit;      // escrowed while Pending
        uint40  submittedAt;
        Status  status;
    }

    // ── Storage ─────────────────────────────────────────────────────────────
    IAlignmentRegistry public immutable alignmentRegistry;
    address public protocolTreasury;

    /// @notice Required ETH deposit to submit (0 disables the deposit). Owner-tuned.
    uint256 public requestDeposit;
    /// @notice Max simultaneously-Pending requests (anti-DoS bound on the queue).
    uint256 public maxPending;
    /// @notice A Pending request older than this can be pruned (auto reject + refund). 0 disables.
    uint256 public requestTTL;

    uint256 public nextRequestId; // 1-based; id 0 is the "none" sentinel
    mapping(uint256 => Request) internal _requests;
    mapping(uint256 => IAlignmentRegistry.AlignmentAsset[]) internal _requestAssets;

    /// @notice Pull-payment refund ledger — ETH owed to a requester from an approved / good-faith-
    ///         rejected / expired request. Credited by those paths, claimed via `withdrawRefund`, so a
    ///         requester that can't receive ETH can never revert an admin action (only its own claim).
    mapping(address => uint256) public refunds;

    // Bounded list of Pending ids (swap-and-pop; index is 1-based, 0 = not present).
    uint256[] internal _pending;
    mapping(uint256 => uint256) internal _pendingIndex;

    // ── Events ──────────────────────────────────────────────────────────────
    event RequestSubmitted(uint256 indexed id, address indexed requester, address indexed token, string title, uint256 deposit);
    event RequestApproved(uint256 indexed id, address indexed requester, uint256 refunded);
    event RequestRejected(uint256 indexed id, address indexed requester, bool forfeited, uint256 amount);
    event RequestExpired(uint256 indexed id, address indexed requester, uint256 refunded);
    event RefundWithdrawn(address indexed to, uint256 amount);
    event RequestDepositUpdated(uint256 newDeposit);
    event MaxPendingUpdated(uint256 newMax);
    event RequestTTLUpdated(uint256 newTTL);
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    constructor(
        address _owner,
        IAlignmentRegistry _alignmentRegistry,
        address _protocolTreasury,
        uint256 _requestDeposit,
        uint256 _maxPending,
        uint256 _requestTTL
    ) {
        if (_owner == address(0) || address(_alignmentRegistry) == address(0) || _protocolTreasury == address(0)) {
            revert InvalidAddress();
        }
        _initializeOwner(_owner);
        alignmentRegistry = _alignmentRegistry;
        protocolTreasury = _protocolTreasury;
        requestDeposit = _requestDeposit;
        maxPending = _maxPending;
        requestTTL = _requestTTL;
    }

    // ── Intake (permissionless) ───────────────────────────────────────────────

    /// @notice Propose a new alignment target. Escrows exactly `requestDeposit` ETH.
    /// @dev Mirrors AlignmentRegistryV1's own validation (non-empty title, ≥1 asset, nonzero asset
    ///      tokens) so a later approve→registerAlignmentTarget can't revert on the proposed data.
    /// @param token Primary alignment token (used by the admin pool scout + the dup guard)
    /// @param title Human title of the community/target
    /// @param description Longer description
    /// @param metadataURI Off-chain metadata URI
    /// @param assets Proposed asset set (≥1; each token nonzero)
    /// @return id The new request id
    function submitRequest(
        address token,
        string calldata title,
        string calldata description,
        string calldata metadataURI,
        IAlignmentRegistry.AlignmentAsset[] calldata assets
    ) external payable nonReentrant returns (uint256 id) {
        if (token == address(0)) revert InvalidAddress();
        if (bytes(title).length == 0 || bytes(title).length > 256) revert InvalidTitle();
        if (assets.length == 0) revert NoAssets();
        bool tokenInAssets;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].token == address(0)) revert InvalidAddress();
            if (assets[i].token == token) tokenInAssets = true;
        }
        // The primary token must be one of the proposed assets, so registering the assets makes THIS
        // token active (satisfying approveRequest's target-exists check) and the scout/dup-guard token
        // is a real aligned asset, not arbitrary.
        if (!tokenInAssets) revert TokenNotInAssets();
        if (msg.value != requestDeposit) revert IncorrectDeposit();
        if (_pending.length >= maxPending) revert QueueFull();
        if (_tokenHasActiveTarget(token)) revert TokenAlreadyActive();

        id = ++nextRequestId;
        _requests[id] = Request({
            requester: msg.sender,
            token: token,
            title: title,
            description: description,
            metadataURI: metadataURI,
            deposit: msg.value,
            submittedAt: uint40(block.timestamp),
            status: Status.Pending
        });
        for (uint256 i = 0; i < assets.length; i++) {
            _requestAssets[id].push(assets[i]);
        }
        _pending.push(id);
        _pendingIndex[id] = _pending.length; // 1-based

        emit RequestSubmitted(id, msg.sender, token, title, msg.value);
    }

    // ── Admin review (owner) ──────────────────────────────────────────────────

    /// @notice Approve a request and refund its deposit. Does NOT register the target — the owner then
    ///         calls AlignmentRegistryV1.registerAlignmentTarget with this request's data (prefilled by
    ///         the admin UI from getRequest/getRequestAssets). Two-tx by design (D7).
    function approveRequest(uint256 id) external onlyOwner nonReentrant {
        Request storage r = _requests[id];
        if (r.status != Status.Pending) revert NotPending();
        // Enforce the two-tx order (register THEN approve, D7): approve is the "you made this a target,
        // here's your deposit back" step, so the target must actually exist first. Without this an admin
        // could silently refund + delist a request without ever registering it, leaving the requester
        // "approved" with no target. (Reject — declining to make a target — has no such requirement.)
        if (!_tokenHasActiveTarget(r.token)) revert TargetNotRegistered();
        r.status = Status.Approved;
        _removePending(id);
        uint256 amount = r.deposit;
        r.deposit = 0;
        if (amount > 0) refunds[r.requester] += amount; // pull-payment (claim via withdrawRefund)
        emit RequestApproved(id, r.requester, amount);
    }

    /// @notice Reject a request. `forfeit=true` sends the deposit to the treasury (spam); `forfeit=false`
    ///         refunds the requester (good-faith-but-declined).
    function rejectRequest(uint256 id, bool forfeit) external onlyOwner nonReentrant {
        Request storage r = _requests[id];
        if (r.status != Status.Pending) revert NotPending();
        r.status = Status.Rejected;
        _removePending(id);
        uint256 amount = r.deposit;
        r.deposit = 0;
        if (amount > 0) {
            // Forfeit → straight to the (trusted) treasury; good-faith → pull-payment for the requester.
            if (forfeit) SafeTransferLib.safeTransferETH(protocolTreasury, amount);
            else refunds[r.requester] += amount;
        }
        emit RequestRejected(id, r.requester, forfeit, amount);
    }

    // ── Expiry (permissionless anti-DoS) ──────────────────────────────────────

    /// @notice Prune a Pending request past its TTL: auto-reject and refund the requester (expiry is not
    ///         spam). Callable by anyone so the queue can't be wedged full by un-acted requests.
    function pruneExpired(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != Status.Pending) revert NotPending();
        if (requestTTL == 0 || block.timestamp <= uint256(r.submittedAt) + requestTTL) revert NotExpired();
        r.status = Status.Expired;
        _removePending(id);
        uint256 amount = r.deposit;
        r.deposit = 0;
        if (amount > 0) refunds[r.requester] += amount; // pull-payment (claim via withdrawRefund)
        emit RequestExpired(id, r.requester, amount);
    }

    /// @notice Claim ETH owed to the caller from an approved / good-faith-rejected / expired request.
    /// @dev Pull-payment: state cleared before the send (CEI) + nonReentrant. A caller that can't
    ///      receive ETH only reverts its OWN claim — it can never brick an admin action.
    function withdrawRefund() external nonReentrant returns (uint256 amount) {
        amount = refunds[msg.sender];
        if (amount == 0) revert NoRefund();
        refunds[msg.sender] = 0;
        SafeTransferLib.safeTransferETH(msg.sender, amount);
        emit RefundWithdrawn(msg.sender, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function getRequestAssets(uint256 id) external view returns (IAlignmentRegistry.AlignmentAsset[] memory) {
        return _requestAssets[id];
    }

    /// @notice The current Pending request ids (bounded by maxPending).
    function getPending() external view returns (uint256[] memory) {
        return _pending;
    }

    function pendingCount() external view returns (uint256) {
        return _pending.length;
    }

    // ── Config (owner) ─────────────────────────────────────────────────────────

    function setRequestDeposit(uint256 v) external onlyOwner {
        requestDeposit = v;
        emit RequestDepositUpdated(v);
    }

    function setMaxPending(uint256 v) external onlyOwner {
        maxPending = v;
        emit MaxPendingUpdated(v);
    }

    function setRequestTTL(uint256 v) external onlyOwner {
        requestTTL = v;
        emit RequestTTLUpdated(v);
    }

    function setProtocolTreasury(address v) external onlyOwner {
        if (v == address(0)) revert InvalidAddress();
        address old = protocolTreasury;
        protocolTreasury = v;
        emit ProtocolTreasuryUpdated(old, v);
    }

    // ── Internal ────────────────────────────────────────────────────────────────

    /// @dev Best-effort dup guard: reject if the token's FIRST registered target is active. The registry
    ///      exposes no array length for `tokenToTargetIds`, so a token with multiple targets is only
    ///      partially covered — the admin still dedupes on review. try/catch: an empty array reverts
    ///      (index OOB) → treated as "no active target".
    function _tokenHasActiveTarget(address token) internal view returns (bool) {
        try IAlignmentRegistryDup(address(alignmentRegistry)).tokenToTargetIds(token, 0) returns (uint256 targetId) {
            return alignmentRegistry.isAlignmentTargetActive(targetId);
        } catch {
            return false;
        }
    }

    function _removePending(uint256 id) internal {
        uint256 idx = _pendingIndex[id];
        if (idx == 0) return;
        uint256 last = _pending.length;
        if (idx != last) {
            uint256 movedId = _pending[last - 1];
            _pending[idx - 1] = movedId;
            _pendingIndex[movedId] = idx;
        }
        _pending.pop();
        delete _pendingIndex[id];
    }
}
