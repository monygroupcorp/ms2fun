# EXEC Quadratic Voting System for Factory Approvals

## Overview

This document designs a fun, engaging quadratic voting system that makes EXEC tokens integral to the factory approval process. The system combines democratic governance with gamification to create an engaging experience for EXEC holders.

## Table of Contents

1. [Core Concept](#core-concept)
2. [Quadratic Voting Mechanics](#quadratic-voting-mechanics)
3. [EXEC Integration](#exec-integration)
4. [Gamification Elements](#gamification-elements)
5. [Implementation Design](#implementation-design)
6. [Contract Specification](#contract-specification)
7. [Frontend Integration](#frontend-integration)
8. [Incentive Mechanisms](#incentive-mechanisms)

---

## Core Concept

### Quadratic Voting Explained

**Traditional Voting**: 1 token = 1 vote (whale dominance)
**Quadratic Voting**: Votes = √(token balance) (more democratic)

**Example**:
- Alice: 10,000 EXEC → √10,000 = 100 votes
- Bob: 1,000 EXEC → √1,000 = 31.6 votes (rounded to 32)
- Charlie: 100 EXEC → √100 = 10 votes

**Benefits**:
- Prevents whale dominance
- Rewards active participation
- More democratic decision-making
- Encourages token distribution

### System Flow

```
1. Factory Application Submitted
   ↓
2. EXEC Holders Review & Vote
   ↓
3. Quadratic Votes Counted
   ↓
4. Approval Threshold Reached?
   ↓
5. Yes → Factory Approved + Rewards Distributed
   No → Application Rejected (or extended)
```

---

## Quadratic Voting Mechanics

### Vote Calculation

```solidity
/**
 * @notice Calculate votes for an EXEC holder
 * @param execBalance EXEC token balance
 * @return votes Number of votes (square root of balance)
 */
function calculateVotes(uint256 execBalance) public pure returns (uint256) {
    if (execBalance == 0) return 0;
    
    // Calculate square root
    // Using Babylonian method or built-in sqrt if available
    uint256 sqrt = sqrt(execBalance);
    
    // Round down to nearest integer
    return sqrt;
}

/**
 * @notice Calculate square root (Babylonian method)
 */
function sqrt(uint256 x) internal pure returns (uint256) {
    if (x == 0) return 0;
    
    uint256 z = (x + 1) / 2;
    uint256 y = x;
    
    while (z < y) {
        y = z;
        z = (x / z + z) / 2;
    }
    
    return y;
}
```

### Vote Weighting

**Base Formula**: `votes = √(execBalance)`

**Enhancements**:
1. **Minimum Threshold**: Require minimum EXEC balance to vote
   ```solidity
   uint256 public constant MIN_EXEC_TO_VOTE = 100 * 10**18; // 100 EXEC minimum
   ```

2. **Vote Multipliers**: Reward long-term holders
   ```solidity
   // Time-based multiplier
   mapping(address => uint256) public firstStakeTime;
   
   function getTimeMultiplier(address voter) public view returns (uint256) {
       uint256 daysHeld = (block.timestamp - firstStakeTime[voter]) / 1 days;
       if (daysHeld >= 365) return 120; // 20% bonus after 1 year
       if (daysHeld >= 180) return 110; // 10% bonus after 6 months
       return 100; // Base multiplier
   }
   ```

3. **Staking Requirement**: Must stake EXEC to vote
   ```solidity
   mapping(address => uint256) public stakedExec;
   
   function stakeExec(uint256 amount) external {
       execToken.transferFrom(msg.sender, address(this), amount);
       stakedExec[msg.sender] += amount;
       if (firstStakeTime[msg.sender] == 0) {
           firstStakeTime[msg.sender] = block.timestamp;
       }
   }
   ```

---

## EXEC Integration

### Staking System

**Purpose**: Lock EXEC tokens to participate in governance

```solidity
contract ExecStaking {
    IERC404 public execToken;
    MasterRegistry public masterRegistry;
    
    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastVoteTime;
        uint256 totalVotesCast;
    }
    
    mapping(address => Stake) public stakes;
    mapping(address => uint256) public pendingRewards;
    
    /**
     * @notice Stake EXEC tokens to participate in governance
     */
    function stake(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        execToken.transferFrom(msg.sender, address(this), amount);
        
        Stake storage stake = stakes[msg.sender];
        stake.amount += amount;
        if (stake.stakedAt == 0) {
            stake.stakedAt = block.timestamp;
        }
        
        emit Staked(msg.sender, amount);
    }
    
    /**
     * @notice Unstake EXEC tokens (with cooldown)
     */
    function unstake(uint256 amount) external {
        Stake storage stake = stakes[msg.sender];
        require(stake.amount >= amount, "Insufficient staked");
        
        // Cooldown period: 7 days after last vote
        require(
            block.timestamp >= stake.lastVoteTime + 7 days,
            "Cooldown period active"
        );
        
        stake.amount -= amount;
        execToken.transfer(msg.sender, amount);
        
        emit Unstaked(msg.sender, amount);
    }
    
    /**
     * @notice Get voting power for an address
     */
    function getVotingPower(address voter) external view returns (uint256) {
        Stake memory stake = stakes[voter];
        if (stake.amount == 0) return 0;
        
        uint256 baseVotes = sqrt(stake.amount);
        uint256 timeMultiplier = getTimeMultiplier(voter);
        
        return (baseVotes * timeMultiplier) / 100;
    }
}
```

### Vote Casting

```solidity
enum VoteType {
    Approve,    // Vote to approve factory
    Reject,     // Vote to reject factory
    Abstain     // No opinion (counts toward quorum)
}

struct Vote {
    address voter;
    VoteType voteType;
    uint256 votes;          // Quadratic votes cast
    uint256 timestamp;
    string reason;          // Optional reason
}

mapping(address => mapping(address => Vote)) public votes; // factory => voter => vote
mapping(address => Vote[]) public factoryVotes;           // factory => all votes
mapping(address => uint256) public approveVotes;          // factory => total approve votes
mapping(address => uint256) public rejectVotes;           // factory => total reject votes

/**
 * @notice Cast vote on factory application
 */
function castVote(
    address factoryAddress,
    VoteType voteType,
    string memory reason
) external {
    require(
        applications[factoryAddress].status == ApplicationStatus.Pending,
        "Application not pending"
    );
    
    require(
        votes[factoryAddress][msg.sender].voter == address(0),
        "Already voted"
    );
    
    // Get voting power
    uint256 votingPower = execStaking.getVotingPower(msg.sender);
    require(votingPower > 0, "No voting power");
    
    // Record vote
    Vote memory vote = Vote({
        voter: msg.sender,
        voteType: voteType,
        votes: votingPower,
        timestamp: block.timestamp,
        reason: reason
    });
    
    votes[factoryAddress][msg.sender] = vote;
    factoryVotes[factoryAddress].push(vote);
    
    // Update totals
    if (voteType == VoteType.Approve) {
        approveVotes[factoryAddress] += votingPower;
    } else if (voteType == VoteType.Reject) {
        rejectVotes[factoryAddress] += votingPower;
    }
    
    // Update staker's last vote time
    execStaking.updateLastVoteTime(msg.sender);
    
    emit VoteCast(factoryAddress, msg.sender, voteType, votingPower);
    
    // Check if threshold reached
    checkApprovalThreshold(factoryAddress);
}
```

---

## Gamification Elements

### 1. Voting Streaks

**Concept**: Reward consistent participation

```solidity
mapping(address => uint256) public votingStreak;
mapping(address => uint256) public lastVoteBlock;

function castVote(...) external {
    // ... existing vote logic ...
    
    // Update streak
    if (lastVoteBlock[msg.sender] == block.number - 1) {
        votingStreak[msg.sender]++;
    } else {
        votingStreak[msg.sender] = 1;
    }
    
    lastVoteBlock[msg.sender] = block.number;
    
    // Streak bonuses
    if (votingStreak[msg.sender] >= 10) {
        // Bonus voting power for consistent voters
        uint256 streakBonus = votingStreak[msg.sender] / 10;
        // Apply bonus to next vote
    }
}
```

### 2. Reputation System

**Concept**: Build reputation through quality votes

```solidity
struct Reputation {
    uint256 score;
    uint256 correctPredictions;  // Votes that aligned with final outcome
    uint256 totalVotes;
    uint256 badges;              // Achievement badges
}

mapping(address => Reputation) public reputation;

/**
 * @notice Update reputation after application resolved
 */
function updateReputation(address factoryAddress, bool approved) external {
    Vote[] memory factoryVotesList = factoryVotes[factoryAddress];
    
    for (uint256 i = 0; i < factoryVotesList.length; i++) {
        address voter = factoryVotesList[i].voter;
        VoteType voteType = factoryVotesList[i].voteType;
        
        bool correct = (approved && voteType == VoteType.Approve) ||
                       (!approved && voteType == VoteType.Reject);
        
        if (correct) {
            reputation[voter].correctPredictions++;
            reputation[voter].score += 10; // Points for correct vote
        }
        
        reputation[voter].totalVotes++;
    }
}
```

### 3. Achievement Badges

**Concept**: Unlock achievements for various milestones

```solidity
enum Badge {
    FirstVote,           // Cast first vote
    ConsistentVoter,     // Vote on 10+ applications
    QualityReviewer,     // 80%+ correct predictions
    EarlyAdopter,        // Vote within first 24h
    WhaleVoter,          // Cast 1000+ votes total
    StreakMaster         // 30+ day voting streak
}

mapping(address => mapping(Badge => bool)) public badges;

function checkBadges(address voter) internal {
    Reputation memory rep = reputation[voter];
    
    // First Vote
    if (rep.totalVotes >= 1 && !badges[voter][Badge.FirstVote]) {
        badges[voter][Badge.FirstVote] = true;
        emit BadgeEarned(voter, Badge.FirstVote);
    }
    
    // Consistent Voter
    if (rep.totalVotes >= 10 && !badges[voter][Badge.ConsistentVoter]) {
        badges[voter][Badge.ConsistentVoter] = true;
        emit BadgeEarned(voter, Badge.ConsistentVoter);
    }
    
    // Quality Reviewer
    if (rep.totalVotes >= 5 && 
        (rep.correctPredictions * 100) / rep.totalVotes >= 80 &&
        !badges[voter][Badge.QualityReviewer]) {
        badges[voter][Badge.QualityReviewer] = true;
        emit BadgeEarned(voter, Badge.QualityReviewer);
    }
    
    // ... other badges
}
```

### 4. Leaderboards

**Concept**: Show top voters and most accurate reviewers

```solidity
struct LeaderboardEntry {
    address voter;
    uint256 score;
    uint256 votesCast;
    uint256 accuracy;
}

/**
 * @notice Get top voters by score
 */
function getTopVoters(uint256 limit) external view returns (LeaderboardEntry[] memory) {
    // Would need to maintain sorted list or query off-chain
    // For on-chain, use events and index off-chain
}

// Emit events for off-chain indexing
event LeaderboardUpdated(address indexed voter, uint256 score, uint256 rank);
```

---

## Implementation Design

### Approval Thresholds

**Dynamic Thresholds**:
```solidity
struct ApprovalThreshold {
    uint256 minApproveVotes;     // Minimum approve votes needed
    uint256 minQuorum;           // Minimum total votes for quorum
    uint256 approvalRatio;       // Approve/Reject ratio needed (e.g., 60%)
    uint256 timeWindow;          // Voting period (e.g., 7 days)
}

mapping(address => ApprovalThreshold) public thresholds;

function checkApprovalThreshold(address factoryAddress) internal {
    FactoryApplication storage app = applications[factoryAddress];
    ApprovalThreshold memory threshold = thresholds[factoryAddress];
    
    uint256 totalVotes = approveVotes[factoryAddress] + rejectVotes[factoryAddress];
    
    // Check quorum
    if (totalVotes < threshold.minQuorum) {
        return; // Not enough votes yet
    }
    
    // Check approval ratio
    uint256 approveRatio = (approveVotes[factoryAddress] * 100) / totalVotes;
    
    if (approveVotes[factoryAddress] >= threshold.minApproveVotes &&
        approveRatio >= threshold.approvalRatio) {
        // Auto-approve
        approveFactory(factoryAddress, getReviewers(factoryAddress));
    } else if (rejectVotes[factoryAddress] > approveVotes[factoryAddress] * 2) {
        // Auto-reject if 2:1 reject ratio
        rejectFactory(factoryAddress, "Community rejected", true);
    }
}
```

### Default Thresholds

```solidity
function setDefaultThresholds() internal {
    ApprovalThreshold memory defaultThreshold = ApprovalThreshold({
        minApproveVotes: 1000,      // Need 1000+ approve votes
        minQuorum: 2000,            // Need 2000+ total votes
        approvalRatio: 60,          // 60% approval needed
        timeWindow: 7 days          // 7 day voting period
    });
    
    // Apply to new applications
}
```

---

## Contract Specification

### Complete Voting Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IERC404 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ExecQuadraticVoting is ReentrancyGuard, Ownable {
    IERC404 public execToken;
    MasterRegistry public masterRegistry;
    
    // Staking
    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastVoteTime;
        uint256 totalVotesCast;
    }
    
    mapping(address => Stake) public stakes;
    mapping(address => uint256) public firstStakeTime;
    
    // Voting
    enum VoteType { Approve, Reject, Abstain }
    
    struct Vote {
        address voter;
        VoteType voteType;
        uint256 votes;
        uint256 timestamp;
        string reason;
    }
    
    mapping(address => mapping(address => Vote)) public votes;
    mapping(address => Vote[]) public factoryVotes;
    mapping(address => uint256) public approveVotes;
    mapping(address => uint256) public rejectVotes;
    
    // Reputation
    struct Reputation {
        uint256 score;
        uint256 correctPredictions;
        uint256 totalVotes;
        uint256 votingStreak;
        uint256 lastVoteBlock;
    }
    
    mapping(address => Reputation) public reputation;
    
    // Thresholds
    struct ApprovalThreshold {
        uint256 minApproveVotes;
        uint256 minQuorum;
        uint256 approvalRatio;
        uint256 timeWindow;
    }
    
    mapping(address => ApprovalThreshold) public thresholds;
    ApprovalThreshold public defaultThreshold;
    
    uint256 public constant MIN_EXEC_TO_VOTE = 100 * 10**18;
    uint256 public constant UNSTAKE_COOLDOWN = 7 days;
    
    // Events
    event Staked(address indexed voter, uint256 amount);
    event Unstaked(address indexed voter, uint256 amount);
    event VoteCast(
        address indexed factory,
        address indexed voter,
        VoteType voteType,
        uint256 votes
    );
    event BadgeEarned(address indexed voter, uint256 badgeId);
    event ReputationUpdated(address indexed voter, uint256 newScore);
    
    constructor(address _execToken, address _masterRegistry) {
        execToken = IERC404(_execToken);
        masterRegistry = MasterRegistry(_masterRegistry);
        
        // Set default thresholds
        defaultThreshold = ApprovalThreshold({
            minApproveVotes: 1000,
            minQuorum: 2000,
            approvalRatio: 60,
            timeWindow: 7 days
        });
    }
    
    /**
     * @notice Stake EXEC to participate in governance
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(execToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        Stake storage stake = stakes[msg.sender];
        stake.amount += amount;
        if (stake.stakedAt == 0) {
            stake.stakedAt = block.timestamp;
            firstStakeTime[msg.sender] = block.timestamp;
        }
        
        emit Staked(msg.sender, amount);
    }
    
    /**
     * @notice Unstake EXEC (with cooldown)
     */
    function unstake(uint256 amount) external nonReentrant {
        Stake storage stake = stakes[msg.sender];
        require(stake.amount >= amount, "Insufficient staked");
        require(
            block.timestamp >= stake.lastVoteTime + UNSTAKE_COOLDOWN,
            "Cooldown active"
        );
        
        stake.amount -= amount;
        require(execToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit Unstaked(msg.sender, amount);
    }
    
    /**
     * @notice Get voting power (quadratic)
     */
    function getVotingPower(address voter) public view returns (uint256) {
        Stake memory stake = stakes[voter];
        if (stake.amount < MIN_EXEC_TO_VOTE) return 0;
        
        uint256 baseVotes = sqrt(stake.amount);
        uint256 timeMultiplier = getTimeMultiplier(voter);
        uint256 streakBonus = getStreakBonus(voter);
        
        return (baseVotes * timeMultiplier * (100 + streakBonus)) / 10000;
    }
    
    /**
     * @notice Cast vote on factory application
     */
    function castVote(
        address factoryAddress,
        VoteType voteType,
        string memory reason
    ) external {
        require(
            masterRegistry.getApplicationStatus(factoryAddress) == ApplicationStatus.Pending,
            "Not pending"
        );
        require(votes[factoryAddress][msg.sender].voter == address(0), "Already voted");
        
        uint256 votingPower = getVotingPower(msg.sender);
        require(votingPower > 0, "No voting power");
        
        Vote memory vote = Vote({
            voter: msg.sender,
            voteType: voteType,
            votes: votingPower,
            timestamp: block.timestamp,
            reason: reason
        });
        
        votes[factoryAddress][msg.sender] = vote;
        factoryVotes[factoryAddress].push(vote);
        
        if (voteType == VoteType.Approve) {
            approveVotes[factoryAddress] += votingPower;
        } else if (voteType == VoteType.Reject) {
            rejectVotes[factoryAddress] += votingPower;
        }
        
        // Update staker info
        stakes[msg.sender].lastVoteTime = block.timestamp;
        stakes[msg.sender].totalVotesCast++;
        
        // Update reputation
        updateReputationOnVote(msg.sender);
        
        emit VoteCast(factoryAddress, msg.sender, voteType, votingPower);
        
        // Check thresholds
        checkApprovalThreshold(factoryAddress);
    }
    
    /**
     * @notice Check if application meets approval threshold
     */
    function checkApprovalThreshold(address factoryAddress) internal {
        ApprovalThreshold memory threshold = thresholds[factoryAddress];
        if (threshold.minApproveVotes == 0) {
            threshold = defaultThreshold;
        }
        
        uint256 totalVotes = approveVotes[factoryAddress] + rejectVotes[factoryAddress];
        
        if (totalVotes < threshold.minQuorum) {
            return;
        }
        
        uint256 approveRatio = totalVotes > 0 
            ? (approveVotes[factoryAddress] * 100) / totalVotes
            : 0;
        
        if (approveVotes[factoryAddress] >= threshold.minApproveVotes &&
            approveRatio >= threshold.approvalRatio) {
            // Auto-approve
            address[] memory reviewers = getReviewers(factoryAddress);
            masterRegistry.approveFactory(factoryAddress, reviewers);
        } else if (rejectVotes[factoryAddress] > approveVotes[factoryAddress] * 2) {
            // Auto-reject if 2:1 reject
            masterRegistry.rejectFactory(factoryAddress, "Community rejected", true);
        }
    }
    
    /**
     * @notice Get time-based multiplier
     */
    function getTimeMultiplier(address voter) public view returns (uint256) {
        if (firstStakeTime[voter] == 0) return 100;
        
        uint256 daysHeld = (block.timestamp - firstStakeTime[voter]) / 1 days;
        
        if (daysHeld >= 365) return 120; // 20% bonus
        if (daysHeld >= 180) return 110; // 10% bonus
        return 100; // Base
    }
    
    /**
     * @notice Get streak bonus
     */
    function getStreakBonus(address voter) public view returns (uint256) {
        Reputation memory rep = reputation[voter];
        if (rep.votingStreak >= 30) return 15; // 15% bonus
        if (rep.votingStreak >= 10) return 10; // 10% bonus
        if (rep.votingStreak >= 5) return 5;   // 5% bonus
        return 0;
    }
    
    /**
     * @notice Update reputation on vote
     */
    function updateReputationOnVote(address voter) internal {
        Reputation storage rep = reputation[voter];
        
        // Update streak
        if (rep.lastVoteBlock == block.number - 1) {
            rep.votingStreak++;
        } else {
            rep.votingStreak = 1;
        }
        
        rep.lastVoteBlock = block.number;
        rep.totalVotes++;
        
        // Check badges
        checkBadges(voter);
    }
    
    /**
     * @notice Update reputation after application resolved
     */
    function updateReputationAfterResolution(
        address factoryAddress,
        bool approved
    ) external {
        require(msg.sender == address(masterRegistry), "Not authorized");
        
        Vote[] memory factoryVotesList = factoryVotes[factoryAddress];
        
        for (uint256 i = 0; i < factoryVotesList.length; i++) {
            address voter = factoryVotesList[i].voter;
            VoteType voteType = factoryVotesList[i].voteType;
            
            bool correct = (approved && voteType == VoteType.Approve) ||
                          (!approved && voteType == VoteType.Reject);
            
            if (correct) {
                reputation[voter].correctPredictions++;
                reputation[voter].score += 10;
            }
            
            checkBadges(voter);
            emit ReputationUpdated(voter, reputation[voter].score);
        }
    }
    
    /**
     * @notice Check and award badges
     */
    function checkBadges(address voter) internal {
        Reputation memory rep = reputation[voter];
        
        // Emit badge events for frontend to track
        if (rep.totalVotes == 1) {
            emit BadgeEarned(voter, 1); // FirstVote
        }
        if (rep.totalVotes >= 10) {
            emit BadgeEarned(voter, 2); // ConsistentVoter
        }
        if (rep.totalVotes >= 5 && 
            (rep.correctPredictions * 100) / rep.totalVotes >= 80) {
            emit BadgeEarned(voter, 3); // QualityReviewer
        }
        if (rep.votingStreak >= 30) {
            emit BadgeEarned(voter, 6); // StreakMaster
        }
    }
    
    /**
     * @notice Get reviewers for an application
     */
    function getReviewers(address factoryAddress) internal view returns (address[] memory) {
        Vote[] memory factoryVotesList = factoryVotes[factoryAddress];
        address[] memory reviewers = new address[](factoryVotesList.length);
        
        for (uint256 i = 0; i < factoryVotesList.length; i++) {
            reviewers[i] = factoryVotesList[i].voter;
        }
        
        return reviewers;
    }
    
    /**
     * @notice Calculate square root
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
    
    /**
     * @notice Set custom threshold for factory
     */
    function setThreshold(
        address factoryAddress,
        ApprovalThreshold memory threshold
    ) external onlyOwner {
        thresholds[factoryAddress] = threshold;
    }
}
```

---

## Frontend Integration

### Voting UI Components

**Vote Card Component**:
```javascript
class VoteCard extends Component {
    render() {
        const { factory, userVote, userVotingPower } = this.props;
        
        return `
            <div class="vote-card">
                <h3>${factory.displayTitle}</h3>
                <p>${factory.description}</p>
                
                <div class="voting-power">
                    <span>Your Voting Power: ${userVotingPower} votes</span>
                    <span class="exec-balance">${userExecBalance} EXEC staked</span>
                </div>
                
                <div class="vote-buttons">
                    <button onclick="castVote('approve')" ${userVote ? 'disabled' : ''}>
                        ✅ Approve (${approveVotes} votes)
                    </button>
                    <button onclick="castVote('reject')" ${userVote ? 'disabled' : ''}>
                        ❌ Reject (${rejectVotes} votes)
                    </button>
                </div>
                
                ${userVote ? `
                    <div class="your-vote">
                        You voted: ${userVote.voteType}
                        <small>${userVote.votes} votes</small>
                    </div>
                ` : ''}
                
                <div class="progress-bar">
                    <div class="approve-bar" style="width: ${approvePercent}%"></div>
                    <div class="reject-bar" style="width: ${rejectPercent}%"></div>
                </div>
                
                <div class="threshold-info">
                    Need ${threshold.minApproveVotes} approve votes
                    (${approveVotes}/${threshold.minApproveVotes})
                </div>
            </div>
        `;
    }
}
```

### Reputation Display

```javascript
class ReputationDisplay extends Component {
    render() {
        const { reputation, badges } = this.props;
        
        return `
            <div class="reputation-card">
                <h3>Your Reputation</h3>
                <div class="score">${reputation.score} points</div>
                
                <div class="stats">
                    <div>Total Votes: ${reputation.totalVotes}</div>
                    <div>Accuracy: ${(reputation.correctPredictions / reputation.totalVotes * 100).toFixed(1)}%</div>
                    <div>Streak: ${reputation.votingStreak} days</div>
                </div>
                
                <div class="badges">
                    ${badges.map(badge => `
                        <div class="badge ${badge.earned ? 'earned' : 'locked'}">
                            ${badge.icon} ${badge.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
}
```

### Leaderboard

```javascript
class Leaderboard extends Component {
    async loadLeaderboard() {
        // Query events or use TheGraph for leaderboard
        const topVoters = await queryTopVoters(10);
        
        return topVoters.map((voter, index) => ({
            rank: index + 1,
            address: voter.address,
            score: voter.score,
            votesCast: voter.totalVotes,
            accuracy: voter.accuracy
        }));
    }
}
```

---

## Incentive Mechanisms

### 1. Voting Rewards

**Concept**: Reward voters for participation

```solidity
mapping(address => uint256) public votingRewards;
uint256 public rewardPerVote = 1 * 10**18; // 1 EXEC per vote

function distributeVotingRewards(address factoryAddress) external {
    require(
        masterRegistry.getApplicationStatus(factoryAddress) != ApplicationStatus.Pending,
        "Still pending"
    );
    
    Vote[] memory factoryVotesList = factoryVotes[factoryAddress];
    
    for (uint256 i = 0; i < factoryVotesList.length; i++) {
        address voter = factoryVotesList[i].voter;
        uint256 reward = factoryVotesList[i].votes * rewardPerVote;
        
        votingRewards[voter] += reward;
    }
}

function claimRewards() external {
    uint256 reward = votingRewards[msg.sender];
    require(reward > 0, "No rewards");
    
    votingRewards[msg.sender] = 0;
    execToken.transfer(msg.sender, reward);
}
```

### 2. Early Voter Bonuses

**Concept**: Reward early participation

```solidity
function getEarlyVoterBonus(address factoryAddress, address voter) public view returns (uint256) {
    Vote memory vote = votes[factoryAddress][voter];
    FactoryApplication memory app = masterRegistry.getApplication(factoryAddress);
    
    uint256 hoursSinceApplication = (vote.timestamp - app.appliedAt) / 1 hours;
    
    if (hoursSinceApplication <= 24) {
        return 20; // 20% bonus for voting within 24h
    } else if (hoursSinceApplication <= 72) {
        return 10; // 10% bonus for voting within 72h
    }
    
    return 0;
}
```

### 3. Quality Reviewer Rewards

**Concept**: Extra rewards for accurate reviewers

```solidity
function distributeQualityRewards() external {
    // Distribute to top 10% most accurate reviewers
    // Would need off-chain calculation or maintain sorted list
}
```

---

## Summary

### Key Features

1. **Quadratic Voting**: √(EXEC balance) = votes (prevents whale dominance)
2. **Staking System**: Must stake EXEC to vote (commitment)
3. **Time Multipliers**: Long-term holders get bonus votes
4. **Voting Streaks**: Consistent voters get bonuses
5. **Reputation System**: Track accuracy and participation
6. **Achievement Badges**: Gamify participation
7. **Voting Rewards**: Incentivize participation
8. **Early Voter Bonuses**: Reward quick decisions

### Benefits

- **Democratic**: Quadratic voting prevents whale dominance
- **Engaging**: Gamification elements make it fun
- **Rewarding**: Multiple incentive mechanisms
- **Transparent**: All votes on-chain
- **Self-Regulating**: Auto-approve/reject based on thresholds

### Implementation Priority

1. **Phase 1**: Basic quadratic voting + staking
2. **Phase 2**: Reputation system + badges
3. **Phase 3**: Rewards distribution + leaderboards
4. **Phase 4**: Advanced gamification + multipliers

This system makes EXEC tokens integral to the platform while creating an engaging, fun governance experience!

