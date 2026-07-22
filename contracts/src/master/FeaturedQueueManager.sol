// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { IMasterRegistry } from "./interfaces/IMasterRegistry.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { SmartTransferLib } from "../libraries/SmartTransferLib.sol";

/**
 * @title FeaturedQueueManager
 * @notice Competitive featured placement for the protocol landing page.
 *
 * Three independent mechanics — each a separate payment, each doing one thing:
 *
 *   rentFeatured(instance, duration, rankBoost)
 *     Pay durationCost + rankBoost. durationCost buys time in the featured set.
 *     rankBoost is added to the instance's cumulative rank score.
 *     Rank from previous slots carries forward (decayed). No refunds on being outranked.
 *     All ETH forwarded directly to protocolTreasury.
 *
 *   boostRank(instance)
 *     Anyone can send ETH directly to an instance's rank score.
 *     Crystallises accumulated decay then adds the new amount.
 *     All ETH forwarded directly to protocolTreasury.
 *
 *   renewDuration(instance, duration)
 *     Anyone can extend an active slot's expiry at the flat daily rate.
 *     Zero effect on rank. ETH forwarded directly to protocolTreasury.
 *
 * Rank decays PROPORTIONALLY at dailyDecayRate basis-points of the *current* rank per day,
 * computed lazily at read time. Large and small ranks bleed at the same rate, so placement
 * stays contestable (no first-big-payer-wins permanence). `dailyDecayRate` is in bps (500 = 5%/day).
 * getFeaturedInstances returns active slots sorted by effective rank — position 1 first.
 *
 * Featured ETH is DELIBERATELY 100% protocol: every rentFeatured/boostRank/renewDuration payment
 * forwards whole to protocolTreasury, skipping the 80/19/1 alignment split. Featured placement is
 * an advertising surface with no bound alignment target to split to — kept whole to the protocol by
 * design (Mony, 2026-07-16), not an unsplit oversight. Mirrors GlobalMessageRegistry.withdrawETH.
 */
// slither-disable-next-line missing-inheritance
contract FeaturedQueueManager is SafeOwnableUUPS, ReentrancyGuard {
    // ── Custom Errors ─────────────────────────────────────────────────────
    error InvalidAddress();
    error InstanceNotRegistered();
    error AlreadyFeatured();
    error InvalidDuration();
    error InsufficientPayment();
    error QueueFull();
    error MustSendETH();
    error SlotNotActive();
    error SlotExpired();
    error DurationTooShort();
    error DurationTooLong();
    error InvalidBounds();
    error InvalidSize();
    error TreasuryNotSet();
    error SlotStillActive();

    // ── Data ───────────────────────────────────────────────────────────────

    struct FeaturedSlot {
        address renter;
        uint256 rankScore; // raw accumulated rank (before decay)
        uint256 lastBoostTime; // decay reference — updated on every rank write
        uint256 expiresAt; // visibility cutoff
    }

    // ── State ──────────────────────────────────────────────────────────────

    IMasterRegistry public masterRegistry;

    mapping(address => FeaturedSlot) public slots;
    address[] private _featuredList;
    mapping(address => bool) private _inList;
    mapping(address => uint256) private _featuredListIndex;

    uint256 public dailyRate = 0.001 ether; // duration cost per day
    uint256 public dailyDecayRate = 500; // proportional rank decay, bps of current rank per day (500 = 5%/day)
    uint256 public minDuration = 7 days;
    uint256 public maxDuration = 365 days;
    uint256 public maxFeaturedSize = 100;

    address public protocolTreasury;
    address public weth;

    bool private _initialized;

    // ── Events ─────────────────────────────────────────────────────────────

    event FeaturedRented(
        address indexed instance,
        address indexed renter,
        uint256 duration,
        uint256 durationCost,
        uint256 rankBoost,
        uint256 expiresAt
    );
    event RankBoosted(address indexed instance, address indexed booster, uint256 amount, uint256 newEffectiveRank);
    event DurationRenewed(
        address indexed instance,
        address indexed renewer,
        uint256 additionalDuration,
        uint256 cost,
        uint256 newExpiresAt
    );
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event MasterRegistrySet(address indexed registry);

    // ── Constructor / Init ─────────────────────────────────────────────────

    constructor() {
        _initializeOwner(msg.sender);
    }

    function initialize(address _masterRegistry, address _owner) external {
        if (_initialized) revert AlreadyInitialized();
        if (_masterRegistry == address(0)) revert InvalidAddress();
        if (_owner == address(0)) revert InvalidAddress();

        _initialized = true;
        masterRegistry = IMasterRegistry(_masterRegistry);
        _setOwner(_owner);

        dailyRate = 0.001 ether;
        dailyDecayRate = 500; // bps of current rank per day (5%/day)
        minDuration = 7 days;
        maxDuration = 365 days;
        maxFeaturedSize = 100;
    }

    // ── Core Write Functions ───────────────────────────────────────────────

    /**
     * @notice Enter the featured set. Payment explicitly splits between duration and rank.
     *         All ETH forwarded directly to protocolTreasury.
     * @param instance   Registered instance to feature
     * @param duration   How long to be visible (seconds); msg.value must cover durationCost
     * @param rankBoost  Additional ETH allocated to rank score; competes for position
     */
    // slither-disable-next-line timestamp
    function rentFeatured(address instance, uint256 duration, uint256 rankBoost) external payable nonReentrant {
        if (protocolTreasury == address(0)) revert TreasuryNotSet();
        if (!_isInstanceRegistered(instance)) revert InstanceNotRegistered();
        if (block.timestamp < slots[instance].expiresAt) revert AlreadyFeatured();
        if (duration < minDuration || duration > maxDuration) revert InvalidDuration();

        uint256 durationCost = (dailyRate * duration) / 1 days; // round down: favors renter
        uint256 totalDue = durationCost + rankBoost;
        if (msg.value < totalDue) revert InsufficientPayment();
        if (_activeCount() >= maxFeaturedSize) revert QueueFull();

        _addToList(instance);

        // Carry decayed rank forward, add new boost.
        // INTENDED: rank is instance-bound, not wallet-bound. A re-renter of an expired slot inherits
        // the project's accumulated (proportionally decayed) rank — rank belongs to the project, not the
        // renter (Mony, 2026-07-16). Not an oversight; do not reset-on-new-renter.
        uint256 newRank = _effectiveRank(slots[instance]) + rankBoost;

        slots[instance] = FeaturedSlot({
            renter: msg.sender,
            rankScore: newRank,
            lastBoostTime: block.timestamp,
            expiresAt: block.timestamp + duration
        });

        // Forward payment directly to treasury
        SafeTransferLib.safeTransferETH(protocolTreasury, totalDue);

        // Refund excess
        if (msg.value > totalDue) {
            SmartTransferLib.smartTransferETH(msg.sender, msg.value - totalDue, weth);
        }

        emit FeaturedRented(instance, msg.sender, duration, durationCost, rankBoost, slots[instance].expiresAt);
    }

    /**
     * @notice Add to an instance's rank score. Anyone can boost.
     *         Crystallises decay accrued since lastBoostTime, then adds the new amount.
     *         All ETH forwarded directly to protocolTreasury.
     * @param instance  Active featured instance to boost
     */
    // slither-disable-next-line timestamp
    function boostRank(address instance) external payable nonReentrant {
        if (protocolTreasury == address(0)) revert TreasuryNotSet();
        if (msg.value == 0) revert MustSendETH();
        if (block.timestamp >= slots[instance].expiresAt) revert SlotNotActive();

        uint256 newRank = _effectiveRank(slots[instance]) + msg.value;
        slots[instance].rankScore = newRank;
        slots[instance].lastBoostTime = block.timestamp;

        SafeTransferLib.safeTransferETH(protocolTreasury, msg.value);

        emit RankBoosted(instance, msg.sender, msg.value, newRank);
    }

    /**
     * @notice Extend an active slot's duration. Anyone can renew — fans can keep
     *         their favourite project visible. Zero effect on rank.
     *         ETH forwarded directly to protocolTreasury.
     * @param instance           Active featured instance
     * @param additionalDuration Extra seconds to add to expiresAt
     */
    // slither-disable-next-line timestamp
    function renewDuration(address instance, uint256 additionalDuration) external payable nonReentrant {
        if (protocolTreasury == address(0)) revert TreasuryNotSet();
        if (block.timestamp >= slots[instance].expiresAt) revert SlotExpired();
        if (additionalDuration < minDuration) revert DurationTooShort();
        if (additionalDuration > maxDuration) revert DurationTooLong();

        uint256 cost = (dailyRate * additionalDuration) / 1 days; // round down: favors renter
        if (msg.value < cost) revert InsufficientPayment();

        slots[instance].expiresAt += additionalDuration;

        SafeTransferLib.safeTransferETH(protocolTreasury, cost);

        if (msg.value > cost) {
            SmartTransferLib.smartTransferETH(msg.sender, msg.value - cost, weth);
        }

        emit DurationRenewed(instance, msg.sender, additionalDuration, cost, slots[instance].expiresAt);
    }

    // ── Read Functions ─────────────────────────────────────────────────────

    /**
     * @notice Active featured instances sorted by effective rank, position 1 first.
     * @param offset  Start index into the active-only list
     * @param limit   Max results to return
     * @return instances Sorted active instances
     * @return total     Total number of active featured slots
     */
    // slither-disable-next-line timestamp
    function getFeaturedInstances(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory instances, uint256 total)
    {
        // Pass 1: count active
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _featuredList.length; i++) {
            if (block.timestamp < slots[_featuredList[i]].expiresAt) activeCount++;
        }
        total = activeCount;

        if (offset >= activeCount || limit == 0) return (new address[](0), total);

        // Pass 2: collect active addresses and their effective ranks
        address[] memory active = new address[](activeCount);
        uint256[] memory ranks = new uint256[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < _featuredList.length; i++) {
            address inst = _featuredList[i];
            if (block.timestamp < slots[inst].expiresAt) {
                active[idx] = inst;
                ranks[idx] = _effectiveRank(slots[inst]);
                idx++;
            }
        }

        // Pass 3: insertion sort descending by effective rank
        for (uint256 i = 1; i < activeCount; i++) {
            address keyAddr = active[i];
            uint256 keyRank = ranks[i];
            uint256 j = i;
            while (j > 0 && ranks[j - 1] < keyRank) {
                active[j] = active[j - 1];
                ranks[j] = ranks[j - 1];
                j--;
            }
            active[j] = keyAddr;
            ranks[j] = keyRank;
        }

        // Pass 4: return paginated slice
        uint256 end = offset + limit > activeCount ? activeCount : offset + limit;
        instances = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            instances[i - offset] = active[i];
        }
    }

    /**
     * @notice Slot info for an instance.
     * @return renter        Address that rented the slot
     * @return effectiveRank Current rank after proportional decay
     * @return expiresAt     Slot expiry timestamp
     * @return isActive      True if slot is currently active
     */
    // slither-disable-next-line timestamp
    function getRentalInfo(address instance)
        external
        view
        returns (address renter, uint256 effectiveRank, uint256 expiresAt, bool isActive)
    {
        FeaturedSlot memory slot = slots[instance];
        return (slot.renter, _effectiveRank(slot), slot.expiresAt, block.timestamp < slot.expiresAt);
    }

    /**
     * @notice Effective rank for an instance after applying proportional decay.
     */
    function getEffectiveRank(address instance) external view returns (uint256) {
        return _effectiveRank(slots[instance]);
    }

    /**
     * @notice Number of currently active featured slots.
     */
    function queueLength() external view returns (uint256) {
        return _activeCount();
    }

    /**
     * @notice Duration cost for a given number of seconds.
     */
    function quoteDurationCost(uint256 duration) external view returns (uint256) {
        return (dailyRate * duration) / 1 days; // round down: favors renter
    }

    // ── Internal Helpers ───────────────────────────────────────────────────

    /**
     * @dev Proportional (linear-on-current) rank decay — `dailyDecayRate` bps of the raw `rankScore`
     *      per elapsed day, applied over the gap since the last rank write. Large and small ranks bleed
     *      at the same rate, so a big initial payer is overtaken over time (no permanence). Every rank
     *      write recrystallises rank + restamps `lastBoostTime`, bounding the linearisation error.
     *      `decayed` is clamped at `rankScore` (never negative). Partial days round down (favours the
     *      renter). 10000 bps = 100%.
     */
    // slither-disable-next-line divide-before-multiply,incorrect-equality,timestamp
    function _effectiveRank(FeaturedSlot memory slot) internal view returns (uint256) {
        if (slot.lastBoostTime == 0) return 0;
        uint256 daysPassed = (block.timestamp - slot.lastBoostTime) / 1 days; // round down: partial days don't decay
        uint256 decayed = (slot.rankScore * dailyDecayRate * daysPassed) / 10000;
        return slot.rankScore > decayed ? slot.rankScore - decayed : 0;
    }

    // slither-disable-next-line timestamp
    function _activeCount() internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < _featuredList.length; i++) {
            if (block.timestamp < slots[_featuredList[i]].expiresAt) count++;
        }
        return count;
    }

    function _addToList(address instance) internal {
        if (!_inList[instance]) {
            // Prune one expired entry to bound list growth before inserting.
            // Active slots are capped at maxFeaturedSize, so any excess entry is guaranteed expired.
            if (_featuredList.length >= maxFeaturedSize) _pruneOneExpired();
            _featuredListIndex[instance] = _featuredList.length;
            _featuredList.push(instance);
            _inList[instance] = true;
        }
    }

    // slither-disable-next-line timestamp
    function _pruneOneExpired() internal {
        uint256 len = _featuredList.length;
        for (uint256 i = 0; i < len; i++) {
            address inst = _featuredList[i];
            if (block.timestamp >= slots[inst].expiresAt) {
                address last = _featuredList[len - 1];
                _featuredList[i] = last;
                _featuredListIndex[last] = i;
                _featuredList.pop();
                _inList[inst] = false;
                delete _featuredListIndex[inst];
                return;
            }
        }
    }

    /**
     * @notice Prune a single expired entry from the featured list. Callable by anyone.
     *         Uses swap-and-pop to keep the list compact and prevent gas-griefing DoS.
     * @param instance The expired instance to remove
     */
    // slither-disable-next-line timestamp
    function pruneExpired(address instance) external {
        if (block.timestamp < slots[instance].expiresAt) revert SlotStillActive();
        if (!_inList[instance]) return;

        uint256 idx = _featuredListIndex[instance];
        address last = _featuredList[_featuredList.length - 1];

        _featuredList[idx] = last;
        _featuredListIndex[last] = idx;
        _featuredList.pop();

        _inList[instance] = false;
        delete _featuredListIndex[instance];
    }

    // slither-disable-next-line unused-return
    function _isInstanceRegistered(address instance) internal view returns (bool) {
        try masterRegistry.getInstanceInfo(instance) returns (IMasterRegistry.InstanceInfo memory) {
            return true;
        } catch {
            return false;
        }
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setMasterRegistry(address _masterRegistry) external onlyOwner {
        if (_masterRegistry == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistry(_masterRegistry);
        emit MasterRegistrySet(_masterRegistry);
    }

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

    // slither-disable-next-line events-maths
    function setDailyRate(uint256 _dailyRate) external onlyOwner {
        dailyRate = _dailyRate;
    }

    /// @dev `_dailyDecayRate` is in BASIS POINTS of current rank per day (bps), NOT absolute ETH.
    ///      500 = 5%/day. 10000 = 100%/day. Owner-tunable; see _effectiveRank for the decay curve.
    // slither-disable-next-line events-maths
    function setDailyDecayRate(uint256 _dailyDecayRate) external onlyOwner {
        dailyDecayRate = _dailyDecayRate;
    }

    // slither-disable-next-line events-maths
    function setDurationBounds(uint256 _min, uint256 _max) external onlyOwner {
        if (_min == 0 || _max <= _min) revert InvalidBounds();
        minDuration = _min;
        maxDuration = _max;
    }

    // slither-disable-next-line events-maths
    function setMaxFeaturedSize(uint256 _max) external onlyOwner {
        if (_max == 0) revert InvalidSize();
        maxFeaturedSize = _max;
    }
}
