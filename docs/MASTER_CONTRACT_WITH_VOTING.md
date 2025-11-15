# Master Contract with Integrated Quadratic Voting

## Architecture Overview

The quadratic voting system is **integrated directly into the Master Contract**, not the Factory Contracts. This makes sense because:

1. **Voting is for Factory Approvals**: EXEC holders vote on whether to approve factory applications
2. **Centralized Governance**: Master contract is the governance hub
3. **Single Source of Truth**: All voting state lives in one place
4. **Gas Efficiency**: No cross-contract calls for voting

## Contract Structure

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

contract MasterRegistry is ReentrancyGuard, Ownable {
    // ============ EXEC Token & Staking ============
    IERC404 public execToken;
    
    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastVoteTime;
        uint256 totalVotesCast;
    }
    
    mapping(address => Stake) public stakes;
    mapping(address => uint256) public firstStakeTime;
    uint256 public constant MIN_EXEC_TO_VOTE = 100 * 10**18;
    uint256 public constant UNSTAKE_COOLDOWN = 7 days;
    
    // ============ Factory Application System ============
    enum ApplicationStatus {
        Pending,
        Approved,
        Rejected,
        Withdrawn
    }
    
    struct FactoryApplication {
        address applicant;
        address factoryAddress;
        string contractType;
        string title;
        string displayTitle;
        string metadataURI;
        bytes32[] features;
        uint256 applicationFee;
        uint256 appliedAt;
        ApplicationStatus status;
        address[] reviewers;
        string rejectionReason;
        uint256 reviewDeadline;
    }
    
    mapping(address => FactoryApplication) public applications;
    address[] public pendingApplications;
    
    // ============ Voting System ============
    enum VoteType { Approve, Reject, Abstain }
    
    struct Vote {
        address voter;
        VoteType voteType;
        uint256 votes;          // Quadratic votes
        uint256 timestamp;
        string reason;
    }
    
    mapping(address => mapping(address => Vote)) public votes; // factory => voter => vote
    mapping(address => Vote[]) public factoryVotes;
    mapping(address => uint256) public approveVotes;
    mapping(address => uint256) public rejectVotes;
    
    // ============ Reputation System ============
    struct Reputation {
        uint256 score;
        uint256 correctPredictions;
        uint256 totalVotes;
        uint256 votingStreak;
        uint256 lastVoteBlock;
    }
    
    mapping(address => Reputation) public reputation;
    
    // ============ Approval Thresholds ============
    struct ApprovalThreshold {
        uint256 minApproveVotes;
        uint256 minQuorum;
        uint256 approvalRatio;
        uint256 timeWindow;
    }
    
    ApprovalThreshold public defaultThreshold;
    mapping(address => ApprovalThreshold) public customThresholds;
    
    // ============ Factory Registry ============
    struct FactoryInfo {
        uint256 id;
        address factoryAddress;
        string contractType;
        string title;
        string displayTitle;
        string metadataURI;
        bytes32[] features;
        address creator;
        uint256 registeredAt;
        bool authorized;
        uint256 instanceCount;
    }
    
    mapping(uint256 => address) public factories;
    mapping(address => FactoryInfo) public factoryInfo;
    mapping(bytes32 => bool) public titleTaken;
    uint256 public factoryCount;
    
    // ============ Instance Tracking ============
    struct InstanceInfo {
        address instanceAddress;
        address factoryAddress;
        string contractType;
        string name;
        string displayName;
        string metadataURI;
        address creator;
        uint256 createdAt;
        bool featured;
    }
    
    mapping(address => InstanceInfo) public instanceInfo;
    mapping(address => address[]) public factoryInstances;
    
    // ============ Configuration ============
    uint256 public applicationFee = 0.1 ether;
    
    // ============ Events ============
    event Staked(address indexed voter, uint256 amount);
    event Unstaked(address indexed voter, uint256 amount);
    event FactoryApplicationSubmitted(
        address indexed applicant,
        address indexed factoryAddress,
        uint256 fee
    );
    event VoteCast(
        address indexed factory,
        address indexed voter,
        VoteType voteType,
        uint256 votes
    );
    event FactoryApplicationApproved(
        address indexed applicant,
        address indexed factoryAddress,
        address[] reviewers
    );
    event FactoryApplicationRejected(
        address indexed applicant,
        address indexed factoryAddress,
        string reason
    );
    event FactoryRegistered(
        uint256 indexed id,
        address indexed factory,
        string contractType
    );
    event InstanceRegistered(
        address indexed factory,
        address indexed instance,
        address indexed creator
    );
    event BadgeEarned(address indexed voter, uint256 badgeId);
    event ReputationUpdated(address indexed voter, uint256 newScore);
    
    // ============ Constructor ============
    constructor(address _execToken) {
        execToken = IERC404(_execToken);
        
        defaultThreshold = ApprovalThreshold({
            minApproveVotes: 1000,
            minQuorum: 2000,
            approvalRatio: 60,
            timeWindow: 7 days
        });
    }
    
    // ============ EXEC Staking Functions ============
    
    /**
     * @notice Stake EXEC to participate in governance
     */
    function stakeExec(uint256 amount) external nonReentrant {
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
    function unstakeExec(uint256 amount) external nonReentrant {
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
    
    // ============ Factory Application Functions ============
    
    /**
     * @notice Submit factory application
     */
    function applyForFactory(
        address factoryAddress,
        string memory contractType,
        string memory title,
        string memory displayTitle,
        string memory metadataURI,
        bytes32[] memory features
    ) external payable {
        require(msg.value >= applicationFee, "Insufficient fee");
        require(applications[factoryAddress].applicant == address(0), "Application exists");
        require(!_isTitleTaken(title), "Title already taken");
        require(_isValidContractType(contractType), "Invalid contract type");
        require(factoryAddress.code.length > 0, "Factory not deployed");
        
        applications[factoryAddress] = FactoryApplication({
            applicant: msg.sender,
            factoryAddress: factoryAddress,
            contractType: contractType,
            title: title,
            displayTitle: displayTitle,
            metadataURI: metadataURI,
            features: features,
            applicationFee: msg.value,
            appliedAt: block.timestamp,
            status: ApplicationStatus.Pending,
            reviewers: new address[](0),
            rejectionReason: "",
            reviewDeadline: block.timestamp + defaultThreshold.timeWindow
        });
        
        pendingApplications.push(factoryAddress);
        _markTitleTaken(title);
        
        emit FactoryApplicationSubmitted(msg.sender, factoryAddress, msg.value);
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
            applications[factoryAddress].status == ApplicationStatus.Pending,
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
        _updateReputationOnVote(msg.sender);
        
        emit VoteCast(factoryAddress, msg.sender, voteType, votingPower);
        
        // Check thresholds (auto-approve/reject)
        _checkApprovalThreshold(factoryAddress);
    }
    
    /**
     * @notice Check if application meets approval threshold
     */
    function _checkApprovalThreshold(address factoryAddress) internal {
        ApprovalThreshold memory threshold = customThresholds[factoryAddress];
        if (threshold.minApproveVotes == 0) {
            threshold = defaultThreshold;
        }
        
        uint256 totalVotes = approveVotes[factoryAddress] + rejectVotes[factoryAddress];
        
        if (totalVotes < threshold.minQuorum) {
            return; // Not enough votes yet
        }
        
        uint256 approveRatio = totalVotes > 0 
            ? (approveVotes[factoryAddress] * 100) / totalVotes
            : 0;
        
        if (approveVotes[factoryAddress] >= threshold.minApproveVotes &&
            approveRatio >= threshold.approvalRatio) {
            // Auto-approve
            _approveFactory(factoryAddress);
        } else if (rejectVotes[factoryAddress] > approveVotes[factoryAddress] * 2) {
            // Auto-reject if 2:1 reject ratio
            _rejectFactory(factoryAddress, "Community rejected", true);
        }
    }
    
    /**
     * @notice Approve factory (internal, called by threshold check or admin)
     */
    function _approveFactory(address factoryAddress) internal {
        FactoryApplication storage app = applications[factoryAddress];
        require(app.status == ApplicationStatus.Pending, "Not pending");
        
        app.status = ApplicationStatus.Approved;
        app.reviewers = _getReviewers(factoryAddress);
        
        // Register factory
        _registerFactory(
            app.factoryAddress,
            app.contractType,
            app.title,
            app.displayTitle,
            app.metadataURI,
            app.features
        );
        
        // Remove from pending
        _removeFromPending(factoryAddress);
        
        // Update reputation for all voters
        _updateReputationAfterResolution(factoryAddress, true);
        
        emit FactoryApplicationApproved(app.applicant, factoryAddress, app.reviewers);
    }
    
    /**
     * @notice Reject factory (internal or admin override)
     */
    function _rejectFactory(
        address factoryAddress,
        string memory reason,
        bool refundFee
    ) internal {
        FactoryApplication storage app = applications[factoryAddress];
        require(app.status == ApplicationStatus.Pending, "Not pending");
        
        app.status = ApplicationStatus.Rejected;
        app.rejectionReason = reason;
        
        if (refundFee && app.applicationFee > 0) {
            payable(app.applicant).transfer(app.applicationFee);
        }
        
        _freeTitle(app.title);
        _removeFromPending(factoryAddress);
        
        // Update reputation for all voters
        _updateReputationAfterResolution(factoryAddress, false);
        
        emit FactoryApplicationRejected(app.applicant, factoryAddress, reason);
    }
    
    /**
     * @notice Admin override: Approve factory manually
     */
    function adminApproveFactory(
        address factoryAddress,
        address[] memory execReviewers
    ) external onlyOwner {
        FactoryApplication storage app = applications[factoryAddress];
        require(app.status == ApplicationStatus.Pending, "Not pending");
        
        app.reviewers = execReviewers;
        _approveFactory(factoryAddress);
    }
    
    /**
     * @notice Admin override: Reject factory manually
     */
    function adminRejectFactory(
        address factoryAddress,
        string memory reason,
        bool refundFee
    ) external onlyOwner {
        _rejectFactory(factoryAddress, reason, refundFee);
    }
    
    // ============ Factory Registration ============
    
    /**
     * @notice Register factory (internal)
     */
    function _registerFactory(
        address factoryAddress,
        string memory contractType,
        string memory title,
        string memory displayTitle,
        string memory metadataURI,
        bytes32[] memory features
    ) internal {
        uint256 factoryId = factoryCount++;
        
        factories[factoryId] = factoryAddress;
        
        factoryInfo[factoryAddress] = FactoryInfo({
            id: factoryId,
            factoryAddress: factoryAddress,
            contractType: contractType,
            title: title,
            displayTitle: displayTitle,
            metadataURI: metadataURI,
            features: features,
            creator: applications[factoryAddress].applicant,
            registeredAt: block.timestamp,
            authorized: true,
            instanceCount: 0
        });
        
        emit FactoryRegistered(factoryId, factoryAddress, contractType);
    }
    
    // ============ Instance Registration ============
    
    /**
     * @notice Register instance (called by factory contracts)
     */
    function registerInstance(
        address instanceAddress,
        string memory name,
        string memory displayName,
        string memory metadataURI,
        address creator
    ) external {
        address factory = msg.sender;
        
        require(factoryInfo[factory].authorized, "Factory not authorized");
        require(instanceInfo[instanceAddress].instanceAddress == address(0), "Instance exists");
        
        FactoryInfo storage factoryInfo = factoryInfo[factory];
        
        instanceInfo[instanceAddress] = InstanceInfo({
            instanceAddress: instanceAddress,
            factoryAddress: factory,
            contractType: factoryInfo.contractType,
            name: name,
            displayName: displayName,
            metadataURI: metadataURI,
            creator: creator,
            createdAt: block.timestamp,
            featured: false
        });
        
        factoryInstances[factory].push(instanceAddress);
        factoryInfo.instanceCount++;
        
        emit InstanceRegistered(factory, instanceAddress, creator);
    }
    
    // ============ Reputation System ============
    
    /**
     * @notice Update reputation on vote
     */
    function _updateReputationOnVote(address voter) internal {
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
        _checkBadges(voter);
    }
    
    /**
     * @notice Update reputation after resolution
     */
    function _updateReputationAfterResolution(
        address factoryAddress,
        bool approved
    ) internal {
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
            
            _checkBadges(voter);
            emit ReputationUpdated(voter, reputation[voter].score);
        }
    }
    
    /**
     * @notice Check and award badges
     */
    function _checkBadges(address voter) internal {
        Reputation memory rep = reputation[voter];
        
        // Emit badge events (frontend tracks which badges are earned)
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
    
    // ============ Helper Functions ============
    
    /**
     * @notice Get reviewers for an application
     */
    function _getReviewers(address factoryAddress) internal view returns (address[] memory) {
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
     * @notice Check if title is taken
     */
    function _isTitleTaken(string memory title) internal view returns (bool) {
        return titleTaken[keccak256(bytes(title))];
    }
    
    /**
     * @notice Mark title as taken
     */
    function _markTitleTaken(string memory title) internal {
        titleTaken[keccak256(bytes(title))] = true;
    }
    
    /**
     * @notice Free title
     */
    function _freeTitle(string memory title) internal {
        titleTaken[keccak256(bytes(title))] = false;
    }
    
    /**
     * @notice Remove from pending applications
     */
    function _removeFromPending(address factoryAddress) internal {
        for (uint256 i = 0; i < pendingApplications.length; i++) {
            if (pendingApplications[i] == factoryAddress) {
                pendingApplications[i] = pendingApplications[pendingApplications.length - 1];
                pendingApplications.pop();
                break;
            }
        }
    }
    
    /**
     * @notice Validate contract type
     */
    function _isValidContractType(string memory contractType) internal pure returns (bool) {
        bytes32 typeHash = keccak256(bytes(contractType));
        return typeHash == keccak256(bytes("ERC404")) || 
               typeHash == keccak256(bytes("ERC1155"));
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get factory by ID
     */
    function getFactory(uint256 id) external view returns (address) {
        require(id < factoryCount, "Invalid ID");
        return factories[id];
    }
    
    /**
     * @notice Get factory info
     */
    function getFactoryInfo(address factory) external view returns (FactoryInfo memory) {
        return factoryInfo[factory];
    }
    
    /**
     * @notice Check if factory is authorized
     */
    function isFactoryAuthorized(address factory) external view returns (bool) {
        FactoryInfo memory info = factoryInfo[factory];
        return info.authorized && info.factoryAddress != address(0);
    }
    
    /**
     * @notice Get application status
     */
    function getApplicationStatus(address factoryAddress) external view returns (ApplicationStatus) {
        return applications[factoryAddress].status;
    }
    
    /**
     * @notice Get voting stats for factory
     */
    function getVotingStats(address factoryAddress) external view returns (
        uint256 approveVotes_,
        uint256 rejectVotes_,
        uint256 totalVoters_
    ) {
        return (
            approveVotes[factoryAddress],
            rejectVotes[factoryAddress],
            factoryVotes[factoryAddress].length
        );
    }
    
    /**
     * @notice Get user's vote on factory
     */
    function getUserVote(address factoryAddress, address voter) external view returns (Vote memory) {
        return votes[factoryAddress][voter];
    }
    
    /**
     * @notice Get all votes for factory
     */
    function getFactoryVotes(address factoryAddress) external view returns (Vote[] memory) {
        return factoryVotes[factoryAddress];
    }
    
    /**
     * @notice Get reputation for voter
     */
    function getReputation(address voter) external view returns (Reputation memory) {
        return reputation[voter];
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Set application fee
     */
    function setApplicationFee(uint256 newFee) external onlyOwner {
        applicationFee = newFee;
    }
    
    /**
     * @notice Set default threshold
     */
    function setDefaultThreshold(ApprovalThreshold memory threshold) external onlyOwner {
        defaultThreshold = threshold;
    }
    
    /**
     * @notice Set custom threshold for factory
     */
    function setCustomThreshold(
        address factoryAddress,
        ApprovalThreshold memory threshold
    ) external onlyOwner {
        customThresholds[factoryAddress] = threshold;
    }
    
    /**
     * @notice Revoke factory authorization
     */
    function revokeFactory(address factory) external onlyOwner {
        require(factoryInfo[factory].authorized, "Not authorized");
        factoryInfo[factory].authorized = false;
    }
    
    /**
     * @notice Re-authorize factory
     */
    function reauthorizeFactory(address factory) external onlyOwner {
        require(!factoryInfo[factory].authorized, "Already authorized");
        factoryInfo[factory].authorized = true;
    }
    
    /**
     * @notice Set featured instance
     */
    function setFeatured(address instance, bool featured) external onlyOwner {
        instanceInfo[instance].featured = featured;
    }
}
```

## Key Integration Points

### 1. **Single Contract Design**
- All voting logic in Master Contract
- No separate voting contract needed
- Factory contracts only call `registerInstance()`

### 2. **Gas Optimization**
- Packed structs minimize storage
- Events for off-chain indexing
- View functions for frontend queries

### 3. **Factory Contract Requirements**
Factory contracts only need to:
```solidity
// Factory contract calls this when creating instance
masterRegistry.registerInstance(
    instanceAddress,
    name,
    displayName,
    metadataURI,
    msg.sender // creator
);
```

### 4. **Frontend Integration**
```javascript
// Frontend calls Master Contract directly
const masterContract = new ethers.Contract(masterAddress, masterABI, signer);

// Stake EXEC
await masterContract.stakeExec(amount);

// Cast vote
await masterContract.castVote(factoryAddress, voteType, reason);

// Get voting stats
const stats = await masterContract.getVotingStats(factoryAddress);
```

## Contract Size Considerations

**Estimated Size**: ~25-30KB (within Solidity limit of 24KB for deployment)

**Optimization Strategies**:
1. **Use Libraries**: Move sqrt() and other pure functions to library
2. **Events Over Storage**: Store minimal on-chain, emit events
3. **Proxy Pattern**: Use upgradeable proxy if needed
4. **Split Functions**: Separate staking/voting into modules if size becomes issue

## Summary

✅ **Yes, it fits!** The quadratic voting system is integrated directly into the Master Contract:
- Single contract for all governance
- Factory contracts stay simple (just create instances)
- Gas efficient (no cross-contract calls)
- All voting state in one place
- Easy frontend integration

The factory contracts remain focused on their core function: creating project instances. All governance happens in the Master Contract.

