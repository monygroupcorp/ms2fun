// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SmartTransferLib } from "../../libraries/SmartTransferLib.sol";
import { ProtocolTreasuryV1 } from "../../treasury/ProtocolTreasuryV1.sol";

/// @dev Minimal read surface the escrow needs from a bonding instance: a public state getter on
///      ERC404BondingInstance — no new graduation trigger is introduced here.
interface IBondInstance {
    function graduated() external view returns (bool);
}

/**
 * @title DeployBondEscrow
 * @notice Standalone escrow for a refundable creator bond posted at ERC404 instance-create.
 *         Refunded to the creator once the collection graduates; forfeited to the protocol
 *         treasury (tagged `BOND_FORFEIT`) if it never graduates within the deadline. The bond
 *         is a neutral anti-spam deposit, not a punishment — hence `forfeit` (unclaimed-deposit
 *         semantics) and the owner `release` escape hatch.
 * @dev Non-upgradeable + `Ownable` (owner = Safe/Timelock), deliberately SEPARATE from the factory
 *      and the instance: it holds the ETH so the factory keeps its "holds no ETH" invariant and
 *      nothing lands in the EIP-170-constrained instance. Lever defaults OFF (`bondAmount == 0`),
 *      so a factory with no escrow wired — or an escrow with a zero bond — behaves exactly as today.
 */
contract DeployBondEscrow is Ownable, ReentrancyGuard {
    // ── Errors ──────────────────────────────────────────────────────────────
    error InvalidAddress();
    error OnlyFactory();
    error NoBondValue();
    error IncorrectBondValue();
    error BondAlreadyPosted();
    error NoBond();
    error BondAlreadySettled();
    error NotGraduated();
    error AlreadyGraduated();
    error NotYetForfeitable();
    error BondTermsOutOfRange();

    // ── Types ───────────────────────────────────────────────────────────────
    struct Bond {
        address creator; // recorded refund recipient (the instance's `owner` / creator)
        uint256 amount; // escrowed ETH
        uint40 createdAt; // post timestamp; also the sentinel (0 == no bond)
        bool settled; // refunded / forfeited / released — terminal, blocks double-spend
        // The forfeit terms in force at `createdAt`, recorded so that neither party can move this
        // bond's deadline afterwards. Appended last and narrowed so all four pack into the slot
        // `createdAt` already opens — the snapshot costs no extra storage word at post time.
        uint40 maxBondDuration; // seconds, as `maxBondDuration` read at post
        uint32 graceDays; // days, as `graceDays` read at post
    }

    // ── Immutable wiring ──────────────────────────────────────────────────────
    /// @notice The only address allowed to post bonds — the ERC404 factory choke point.
    address public immutable factory;

    /// @notice Canonical WETH used as the ETH-transfer fallback wrapper on the creator-paying legs
    ///         (`refund`/`release`). If the recorded creator rejects plain ETH (e.g. a smart-wallet
    ///         whose `receive()` reverts), the bond is wrapped to WETH and delivered to the SAME
    ///         creator as an ERC20 — so a rejecting recipient can never strand its bond. Immutable on
    ///         a non-upgradeable contract → no storage-layout concern.
    address public immutable weth;

    // ── Storage ───────────────────────────────────────────────────────────────
    /// @notice Protocol treasury; forfeited bonds are deposited here tagged `BOND_FORFEIT`.
    address public protocolTreasury;

    /// @notice Bond required per create. **Default 0 = lever OFF** (byte-identical to today's
    ///         create path). Owner-tuned; sized against MINNOW raises when turned on.
    uint256 public bondAmount;
    /// @notice Grace window (in days) added on top of the forfeit deadline. Owner-tuned; recorded
    ///         onto each bond at post, so a change here governs FUTURE bonds only.
    uint256 public graceDays = 30;
    /// @notice How long a bond may sit before it becomes forfeitable. Owner-tuned; recorded onto
    ///         each bond at post, so a change here governs FUTURE bonds only.
    uint256 public maxBondDuration = 180 days;

    /// @notice instance => escrowed bond record.
    mapping(address => Bond) public bonds;

    // ── Events ──────────────────────────────────────────────────────────────
    event BondPosted(address indexed instance, address indexed creator, uint256 amount);
    event BondRefunded(address indexed instance, address indexed creator, uint256 amount);
    event BondForfeited(address indexed instance, address indexed creator, uint256 amount);
    event BondReleased(address indexed instance, address indexed creator, uint256 amount);
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event BondAmountUpdated(uint256 newBondAmount);
    event GraceDaysUpdated(uint256 newGraceDays);
    event MaxBondDurationUpdated(uint256 newMaxBondDuration);

    constructor(address _owner, address _factory, address _protocolTreasury, address _weth) {
        if (_owner == address(0) || _factory == address(0) || _protocolTreasury == address(0) || _weth == address(0)) {
            revert InvalidAddress();
        }
        _initializeOwner(_owner);
        factory = _factory;
        protocolTreasury = _protocolTreasury;
        weth = _weth;
    }

    // ── Escrow lifecycle ──────────────────────────────────────────────────────

    /// @notice Escrow a creator's bond for `instance`. Factory-only; the factory forwards exactly
    ///         `bondAmount` here and the excess to the treasury (see `ERC404Factory._createInstance`).
    /// @param instance The freshly-deployed bonding instance the bond is keyed to.
    /// @param creator  The refund recipient recorded for this bond (the instance owner/creator).
    function postBond(address instance, address creator) external payable {
        if (msg.sender != factory) revert OnlyFactory();
        if (instance == address(0) || creator == address(0)) revert InvalidAddress();
        if (msg.value == 0) revert NoBondValue();
        if (msg.value != bondAmount) revert IncorrectBondValue();
        if (bonds[instance].createdAt != 0) revert BondAlreadyPosted();
        // The setters are unbounded `uint256`; refuse to record a term that would not survive the
        // narrowing rather than silently truncating one — a truncated term shortens a real deadline.
        if (maxBondDuration > type(uint40).max || graceDays > type(uint32).max) revert BondTermsOutOfRange();

        bonds[instance] = Bond({
            creator: creator,
            amount: msg.value,
            createdAt: uint40(block.timestamp),
            settled: false,
            maxBondDuration: uint40(maxBondDuration),
            graceDays: uint32(graceDays)
        });
        emit BondPosted(instance, creator, msg.value);
    }

    /// @notice Refund a bond once its instance has graduated. Permissionless — anyone can trigger
    ///         the payout, but the ETH always goes to the recorded creator.
    function refund(address instance) external nonReentrant {
        Bond storage b = bonds[instance];
        if (b.createdAt == 0) revert NoBond();
        if (b.settled) revert BondAlreadySettled();
        if (!IBondInstance(instance).graduated()) revert NotGraduated();

        b.settled = true; // effects before interaction — blocks re-entrant double-refund
        uint256 amount = b.amount;
        address creator = b.creator;
        // WETH-fallback delivery: attempt plain ETH first, and if the creator rejects it (reverting
        // `receive()`), wrap to WETH and send it to the SAME creator — the bond is always deliverable.
        SmartTransferLib.smartTransferETH(creator, amount, weth);
        emit BondRefunded(instance, creator, amount);
    }

    /// @notice Forfeit a bond to the treasury once the deadline has passed without graduation.
    ///         Permissionless. Deadline = `createdAt` plus the `maxBondDuration` and `graceDays`
    ///         recorded on the bond when it was posted.
    /// @dev The forfeit deadline is fixed by the protocol-owned parameters in force at bond
    ///      creation. No instance-side, creator-settable value may extend it, and no later
    ///      protocol action may move it. In particular the instance's `bondingMaturityTime` — an
    ///      owner-or-agent setter with no upper bound — is deliberately not read here: anchoring
    ///      on it let a creator push the deadline past any protocol cap and strand the escrow.
    function forfeit(address instance) external nonReentrant {
        Bond storage b = bonds[instance];
        if (b.createdAt == 0) revert NoBond();
        if (b.settled) revert BondAlreadySettled();
        if (IBondInstance(instance).graduated()) revert AlreadyGraduated();

        uint256 deadline = uint256(b.createdAt) + b.maxBondDuration + uint256(b.graceDays) * 1 days;
        if (block.timestamp <= deadline) revert NotYetForfeitable();

        b.settled = true; // effects before interaction — blocks re-entrant double-forfeit
        uint256 amount = b.amount;
        address creator = b.creator;
        // Tagged deposit (NOT the plain receive(), which force-tags OTHER) so treasury accounting
        // attributes forfeited bonds to their own source bucket.
        ProtocolTreasuryV1(payable(protocolTreasury)).deposit{ value: amount }(ProtocolTreasuryV1.Source.BOND_FORFEIT);
        emit BondForfeited(instance, creator, amount);
    }

    /// @notice Owner escape hatch — release an unsettled bond back to its creator ahead of the
    ///         deadline (curation judgment; e.g. a legitimate collection that won't graduate).
    function release(address instance) external onlyOwner nonReentrant {
        Bond storage b = bonds[instance];
        if (b.createdAt == 0) revert NoBond();
        if (b.settled) revert BondAlreadySettled();

        b.settled = true;
        uint256 amount = b.amount;
        address creator = b.creator;
        // WETH-fallback delivery (same rationale as `refund`) — an ETH-rejecting creator still
        // receives its bond as WETH via the owner escape hatch, so `release` can always rescue it.
        SmartTransferLib.smartTransferETH(creator, amount, weth);
        emit BondReleased(instance, creator, amount);
    }

    // ── Owner levers ──────────────────────────────────────────────────────────

    function setProtocolTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        address old = protocolTreasury;
        protocolTreasury = _treasury;
        emit ProtocolTreasuryUpdated(old, _treasury);
    }

    function setBondAmount(uint256 _bondAmount) external onlyOwner {
        bondAmount = _bondAmount;
        emit BondAmountUpdated(_bondAmount);
    }

    function setGraceDays(uint256 _graceDays) external onlyOwner {
        graceDays = _graceDays;
        emit GraceDaysUpdated(_graceDays);
    }

    function setMaxBondDuration(uint256 _maxBondDuration) external onlyOwner {
        maxBondDuration = _maxBondDuration;
        emit MaxBondDurationUpdated(_maxBondDuration);
    }
}
