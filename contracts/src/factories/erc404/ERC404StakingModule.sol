// src/factories/erc404/ERC404StakingModule.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IComponentModule } from "../../interfaces/IComponentModule.sol";
import { Ownable } from "solady/auth/Ownable.sol";

interface IMasterRegistryMin {
    function isRegisteredInstance(address instance) external view returns (bool);
}

/**
 * @title ERC404StakingModule
 * @notice Factory-scoped singleton accounting backend for ERC404 staking
 * @dev Holds no ETH or tokens. All state keyed by instance address.
 *      Only registered instances (via MasterRegistry) can write to this module.
 *      ETH custody and token custody remain in the instance contract.
 *
 *      Authorization: msg.sender must be a registered instance in MasterRegistry.
 *      This is the same pattern used by GlobalMessageRegistry.
 *
 *      Accounting: full Synthetix `StakingRewards` model. Fees are NOT distributed as an
 *      instant lump — `recordFeesReceived` sets a per-second `rewardRate` that STREAMS the
 *      delta over a fixed `rewardsDuration` window (`periodFinish`), folding any leftover from
 *      an unfinished prior window into the new rate. `rewardPerToken()` accrues continuously as
 *      `elapsed * rewardRate * 1e18 / totalStaked`; a global checkpoint (`_updateReward`) settles
 *      `rewardPerTokenStored`/`lastUpdateTime` at the start of every state-changing entry. Each
 *      user checkpoint (`rewardPerTokenPaid`) records the rate at their last interaction, so late
 *      joiners cannot claim retroactive fees AND a flash-staker present for one block earns only
 *      that block's `rewardRate` sliver — killing the fee-post sandwich (noesis-098 F6).
 */
contract ERC404StakingModule is IComponentModule, Ownable {
    error NotRegisteredInstance();
    error InvalidAddress();
    error AlreadyEnabled();
    error StakingNotEnabled();
    error AmountMustBePositive();
    error InsufficientStakedBalance();
    error NoStakedBalance();
    error NoPendingRewards();

    IMasterRegistryMin public immutable masterRegistry;

    // Per-instance state (all mappings keyed by instance address)
    mapping(address => bool) public stakingEnabled;
    mapping(address => mapping(address => uint256)) public stakedBalance; // instance => user => amount
    mapping(address => uint256) public totalStaked; // instance => total

    // rewardPerToken accounting (replaces totalFeesAccumulated / feesAlreadyClaimed)
    mapping(address => uint256) public rewardPerTokenStored; // instance => cumulative ETH per staked token (scaled 1e18)
    mapping(address => mapping(address => uint256)) public rewardPerTokenPaid; // instance => user => checkpoint
    mapping(address => mapping(address => uint256)) public rewardsAccrued; // instance => user => unclaimed ETH

    // Synthetix streaming state (noesis-098 F6). Fees stream over a fixed window instead of a lump.
    /// @notice Fixed streaming window for staking rewards (mirrors Synthetix's default `StakingRewards`
    ///         period). Not creator-settable: a constant closes the flash-stake sandwich uniformly.
    uint256 public constant rewardsDuration = 7 days;
    mapping(address => uint256) public rewardRate; // instance => reward wei streamed per second
    mapping(address => uint256) public periodFinish; // instance => timestamp the current stream ends
    mapping(address => uint256) public lastUpdateTime; // instance => last accrual checkpoint timestamp

    // IComponentModule self-description (wizard metadata; owner-managed)
    string private _metadataURI;

    event StakingEnabled(address indexed instance);
    event Staked(address indexed instance, address indexed user, uint256 amount, uint256 newTotal);
    event Unstaked(address indexed instance, address indexed user, uint256 amount, uint256 newTotal);
    event FeesReceived(address indexed instance, uint256 delta, uint256 newCumulative);
    event RewardsClaimed(address indexed instance, address indexed user, uint256 amount);

    modifier onlyRegisteredInstance() {
        if (!masterRegistry.isRegisteredInstance(msg.sender)) revert NotRegisteredInstance();
        _;
    }

    constructor(address _masterRegistry) {
        if (_masterRegistry == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistryMin(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    // ── Streaming views (Synthetix) ───────────────────────────────────────────

    /// @notice Last timestamp at which rewards still accrue for `instance` (min of now and periodFinish).
    function lastTimeRewardApplicable(address instance) public view returns (uint256) {
        uint256 pf = periodFinish[instance];
        return block.timestamp < pf ? block.timestamp : pf;
    }

    /// @notice Live cumulative ETH-per-staked-token for `instance`, including accrual since the last
    ///         checkpoint. Returns the stored value when nothing is staked (no accrual with 0 divisor).
    function rewardPerToken(address instance) public view returns (uint256) {
        uint256 total = totalStaked[instance];
        if (total == 0) return rewardPerTokenStored[instance];
        uint256 elapsed = lastTimeRewardApplicable(instance) - lastUpdateTime[instance];
        return rewardPerTokenStored[instance] + (elapsed * rewardRate[instance] * 1e18) / total; // round down: dust stays in instance
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _earned(address instance, address user) private view returns (uint256) {
        uint256 staked = stakedBalance[instance][user];
        uint256 rpt = rewardPerToken(instance); // live rate: includes streamed accrual since last checkpoint
        uint256 paid = rewardPerTokenPaid[instance][user];
        return rewardsAccrued[instance][user] + (staked * (rpt - paid)) / 1e18; // round down: favors pool
    }

    /// @dev Global + per-user reward checkpoint (Synthetix `updateReward`). Settles the streamed
    ///      `rewardPerTokenStored`/`lastUpdateTime` to now, then freezes `user`'s entitlement at the
    ///      new rate before their balance changes. Pass `address(0)` to settle only the global stream.
    function _updateReward(address instance, address user) private {
        rewardPerTokenStored[instance] = rewardPerToken(instance);
        lastUpdateTime[instance] = lastTimeRewardApplicable(instance);
        if (user != address(0)) {
            rewardsAccrued[instance][user] = _earned(instance, user);
            rewardPerTokenPaid[instance][user] = rewardPerTokenStored[instance];
        }
    }

    // ── Write functions (instance-only) ──────────────────────────────────────

    /// @notice Enable staking for the calling instance. Irreversible.
    function enableStaking() external onlyRegisteredInstance {
        if (stakingEnabled[msg.sender]) revert AlreadyEnabled();
        stakingEnabled[msg.sender] = true;
        emit StakingEnabled(msg.sender);
    }

    /// @notice Record that `user` has staked `amount` tokens (tokens already in instance)
    function recordStake(address user, uint256 amount) external onlyRegisteredInstance {
        if (!stakingEnabled[msg.sender]) revert StakingNotEnabled();
        if (amount == 0) revert AmountMustBePositive();

        address instance = msg.sender;

        // Checkpoint: settle the stream + freeze user's entitlement before changing their balance
        _updateReward(instance, user);

        // Now update balance
        stakedBalance[instance][user] += amount;
        totalStaked[instance] += amount;

        emit Staked(instance, user, amount, totalStaked[instance]);
    }

    /// @notice Record that `user` has unstaked `amount` tokens. Returns pending reward amount.
    /// @dev Caller (instance) must pay the returned rewardAmount to `user` in ETH.
    /// @dev EXIT PATH — deliberately NOT `onlyRegisteredInstance` (noesis-098 F7): it settles only the
    ///      caller-instance's own tracked balance, so a rogue caller can only touch its own empty
    ///      namespace (reverts on the balance check). Keeping the gate here would let a registry
    ///      de-listing confiscate stakers' custodied principal + accrued ETH. A revoked instance can no
    ///      longer ACCEPT stakes/fees (those paths stay gated) but can always let its stakers exit.
    function recordUnstake(address user, uint256 amount) external returns (uint256 rewardAmount) {
        if (!stakingEnabled[msg.sender]) revert StakingNotEnabled();
        if (amount == 0) revert AmountMustBePositive();
        if (stakedBalance[msg.sender][user] < amount) revert InsufficientStakedBalance();

        address instance = msg.sender;

        // Checkpoint (settle stream + user) before changing balance
        _updateReward(instance, user);

        // Auto-claim
        rewardAmount = rewardsAccrued[instance][user];
        if (rewardAmount > 0) {
            rewardsAccrued[instance][user] = 0;
            emit RewardsClaimed(instance, user, rewardAmount);
        }

        stakedBalance[instance][user] -= amount;
        totalStaked[instance] -= amount;

        emit Unstaked(instance, user, amount, totalStaked[instance]);
    }

    /// @notice Record that `delta` ETH was received from vault (already in instance) and STREAM it
    ///         over `rewardsDuration` (Synthetix `notifyRewardAmount`), instead of an instant lump.
    /// @dev Instance calls this after vault.claimFees() transfers ETH to instance. Any leftover from an
    ///      unfinished prior window is folded into the new `rewardRate`, so no fees are lost on overlap.
    ///      If totalStaked == 0, NO stream is started (there is no one to accrue to): delta is silently
    ///      unclaimable, held in the instance balance and recoverable by the owner via
    ///      ERC404BondingInstance.withdrawDust(). This mirrors the instance's own `stakingReserve` credit
    ///      guard (noesis-061), which likewise only records the liability when totalStaked > 0 — so the
    ///      reserve still covers the full delta the moment a stream is actually started.
    function recordFeesReceived(uint256 delta) external onlyRegisteredInstance {
        if (!stakingEnabled[msg.sender]) revert StakingNotEnabled();
        address instance = msg.sender;

        // Settle streamed accrual up to now with the OLD rate before repricing the window.
        _updateReward(instance, address(0));

        if (totalStaked[instance] > 0) {
            uint256 leftover = block.timestamp < periodFinish[instance]
                ? (periodFinish[instance] - block.timestamp) * rewardRate[instance]
                : 0;
            rewardRate[instance] = (delta + leftover) / rewardsDuration; // round down: truncation dust stays in instance
            lastUpdateTime[instance] = block.timestamp;
            periodFinish[instance] = block.timestamp + rewardsDuration;
        }
        emit FeesReceived(instance, delta, rewardPerTokenStored[instance]);
    }

    /// @notice Compute and record a claim for `user`. Returns ETH amount instance must pay.
    /// @dev Instance calls this, then transfers the returned amount to user in ETH.
    /// @dev EXIT PATH — deliberately NOT `onlyRegisteredInstance` (noesis-098 F7): settles only the
    ///      caller-instance's own tracked rewards, so a de-listed instance's stakers can still claim.
    function computeClaim(address user) external returns (uint256 rewardAmount) {
        address instance = msg.sender;
        if (!stakingEnabled[instance]) revert StakingNotEnabled();
        if (stakedBalance[instance][user] == 0) revert NoStakedBalance();

        // Settle stream + user checkpoint, then pay out the freshly-accrued total.
        _updateReward(instance, user);

        rewardAmount = rewardsAccrued[instance][user];
        if (rewardAmount == 0) revert NoPendingRewards();

        rewardsAccrued[instance][user] = 0;

        emit RewardsClaimed(instance, user, rewardAmount);
    }

    // ── View functions (public) ───────────────────────────────────────────────

    /// @notice Estimate pending rewards for a user without changing state
    function calculatePendingRewards(address instance, address user) external view returns (uint256) {
        if (!stakingEnabled[instance]) return 0;
        if (stakedBalance[instance][user] == 0) return 0;
        return _earned(instance, user);
    }

    /// @notice Get all staking stats for an instance+user pair
    function getStakingInfo(address instance, address user)
        external
        view
        returns (
            bool enabled,
            uint256 userStaked,
            uint256 globalTotalStaked,
            uint256 userProportion, // basis points
            uint256 pendingRewards
        )
    {
        enabled = stakingEnabled[instance];
        userStaked = stakedBalance[instance][user];
        globalTotalStaked = totalStaked[instance];
        userProportion = globalTotalStaked > 0
            ? (userStaked * 10000) / globalTotalStaked  // round down: view-only, no value transfer
            : 0;
        pendingRewards = _earned(instance, user);
    }

    // ── IComponentModule self-description (wizard) ──────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }
}
