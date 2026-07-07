// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ProtocolTreasuryV1} from "../../treasury/ProtocolTreasuryV1.sol";

/// @dev Minimal read surface the escrow needs from a bonding instance. Both are public state
///      getters on ERC404BondingInstance — no new graduation trigger is introduced here.
interface IBondInstance {
    function graduated() external view returns (bool);
    function bondingMaturityTime() external view returns (uint256);
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
    error BondAlreadyPosted();
    error NoBond();
    error BondAlreadySettled();
    error NotGraduated();
    error AlreadyGraduated();
    error NotYetForfeitable();

    // ── Types ───────────────────────────────────────────────────────────────
    struct Bond {
        address creator; // recorded refund recipient (the instance's `owner` / creator)
        uint256 amount; // escrowed ETH
        uint40 createdAt; // post timestamp; also the sentinel (0 == no bond)
        bool settled; // refunded / forfeited / released — terminal, blocks double-spend
    }

    // ── Immutable wiring ──────────────────────────────────────────────────────
    /// @notice The only address allowed to post bonds — the ERC404 factory choke point.
    address public immutable factory;

    // ── Storage ───────────────────────────────────────────────────────────────
    /// @notice Protocol treasury; forfeited bonds are deposited here tagged `BOND_FORFEIT`.
    address public protocolTreasury;

    /// @notice Bond required per create. **Default 0 = lever OFF** (byte-identical to today's
    ///         create path). Owner-tuned; sized against MINNOW raises when turned on.
    uint256 public bondAmount;
    /// @notice Grace window (in days) added on top of the forfeit deadline. Owner-tuned.
    uint256 public graceDays = 30;
    /// @notice Hard cap on how long a bond can sit before it becomes forfeitable even if the
    ///         instance never set a bonding maturity time. Owner-tuned.
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

    constructor(address _owner, address _factory, address _protocolTreasury) {
        if (_owner == address(0) || _factory == address(0) || _protocolTreasury == address(0)) {
            revert InvalidAddress();
        }
        _initializeOwner(_owner);
        factory = _factory;
        protocolTreasury = _protocolTreasury;
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
        if (bonds[instance].createdAt != 0) revert BondAlreadyPosted();

        bonds[instance] = Bond({
            creator: creator,
            amount: msg.value,
            createdAt: uint40(block.timestamp),
            settled: false
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
        SafeTransferLib.safeTransferETH(creator, amount);
        emit BondRefunded(instance, creator, amount);
    }

    /// @notice Forfeit a bond to the treasury once the deadline has passed without graduation.
    ///         Permissionless. Deadline = max(bondingMaturityTime, createdAt + maxBondDuration) +
    ///         graceDays; the max() covers the maturity-0 case (bonding never activated).
    function forfeit(address instance) external nonReentrant {
        Bond storage b = bonds[instance];
        if (b.createdAt == 0) revert NoBond();
        if (b.settled) revert BondAlreadySettled();
        if (IBondInstance(instance).graduated()) revert AlreadyGraduated();

        uint256 maturity = IBondInstance(instance).bondingMaturityTime();
        uint256 hardCap = uint256(b.createdAt) + maxBondDuration;
        uint256 deadline = (maturity > hardCap ? maturity : hardCap) + graceDays * 1 days;
        if (block.timestamp <= deadline) revert NotYetForfeitable();

        b.settled = true; // effects before interaction — blocks re-entrant double-forfeit
        uint256 amount = b.amount;
        address creator = b.creator;
        // Tagged deposit (NOT the plain receive(), which force-tags OTHER) so treasury accounting
        // attributes forfeited bonds to their own source bucket.
        ProtocolTreasuryV1(payable(protocolTreasury)).deposit{value: amount}(
            ProtocolTreasuryV1.Source.BOND_FORFEIT
        );
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
        SafeTransferLib.safeTransferETH(creator, amount);
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
