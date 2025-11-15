# Master Contract Design Recommendations

## Overview

This document provides comprehensive recommendations for designing and implementing the master contract that serves as the central hub for factory indexing and program applications. The master contract is the foundation of the ms2.fun launchpad ecosystem.

## Table of Contents

1. [Core Architecture](#core-architecture)
2. [Factory Application System](#factory-application-system)
3. [Factory Registry & Indexing](#factory-registry--indexing)
4. [Instance Tracking](#instance-tracking)
5. [Governance & Access Control](#governance--access-control)
6. [Metadata Management](#metadata-management)
7. [Gas Optimization](#gas-optimization)
8. [Security Considerations](#security-considerations)
9. [Implementation Phases](#implementation-phases)
10. [Contract Interface Specification](#contract-interface-specification)

---

## Core Architecture

### Design Principles

1. **Centralized Registry**: Single source of truth for all factories and instances
2. **Permissioned Factory Registration**: Application-based system with governance
3. **Efficient Indexing**: Optimized for enumeration and discovery
4. **Extensible**: Support for multiple contract types (ERC404, ERC1155, future types)
5. **Gas Efficient**: Minimize storage and operation costs
6. **Upgradeable**: Consider proxy pattern for future improvements

### Contract Structure

```solidity
contract MasterRegistry {
    // Core State
    mapping(uint256 => address) public factories;           // ID -> Factory address
    mapping(address => FactoryInfo) public factoryInfo;    // Factory -> Info
    mapping(address => FactoryApplication) public applications; // Factory -> Application
    mapping(address => address[]) public factoryInstances; // Factory -> Instances[]
    mapping(address => InstanceInfo) public instanceInfo;  // Instance -> Info
    
    // Indexes
    uint256 public factoryCount;
    address[] public pendingApplications;
    bytes32[] public registeredFactoryTitles; // For collision detection
    
    // Configuration
    uint256 public applicationFee;
    address public admin; // Or use AccessControl
    address public execToken; // EXEC404 token for governance
    
    // Events
    event FactoryApplicationSubmitted(...);
    event FactoryApplicationApproved(...);
    event FactoryApplicationRejected(...);
    event FactoryRegistered(...);
    event InstanceRegistered(...);
}
```

---

## Factory Application System

### Application Flow

```
1. Factory Creator deploys factory contract
   ↓
2. Creator calls applyForFactory() with ETH fee
   ↓
3. Application stored with Pending status
   ↓
4. EXEC holders/Admins review application
   ↓
5. Approve → Factory registered automatically
   Reject → Fee refunded (or kept as penalty)
```

### Application Struct Design

```solidity
enum ApplicationStatus {
    Pending,    // Awaiting review
    Approved,   // Approved and registered
    Rejected,   // Rejected by reviewers
    Withdrawn   // Applicant withdrew
}

struct FactoryApplication {
    address applicant;           // Factory creator
    address factoryAddress;      // Deployed factory contract
    string contractType;         // "ERC404" or "ERC1155"
    string title;                // URL-safe slug (e.g., "erc404-factory")
    string displayTitle;         // Display name (e.g., "ERC404 Factory")
    string metadataURI;          // IPFS/Arweave metadata URI
    bytes32[] features;          // Feature flags (e.g., keccak256("bonding-curve"))
    uint256 applicationFee;      // ETH fee paid
    uint256 appliedAt;           // Block timestamp
    ApplicationStatus status;     // Current status
    address[] reviewers;          // EXEC holders who reviewed
    string rejectionReason;       // Reason if rejected
    uint256 reviewDeadline;       // Optional: auto-reject after deadline
}
```

### Application Functions

```solidity
/**
 * @notice Submit factory application
 * @param factoryAddress Deployed factory contract address
 * @param contractType Contract type ("ERC404" or "ERC1155")
 * @param title URL-safe factory title (must be unique)
 * @param displayTitle Human-readable display title
 * @param metadataURI IPFS/Arweave URI for factory metadata
 * @param features Array of feature flags (bytes32)
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
    
    // Validate factory contract exists and implements required interface
    require(factoryAddress.code.length > 0, "Factory not deployed");
    require(_validateFactoryInterface(factoryAddress, contractType), "Invalid factory interface");
    
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
        reviewDeadline: block.timestamp + 30 days // Optional auto-reject
    });
    
    pendingApplications.push(factoryAddress);
    _markTitleTaken(title);
    
    emit FactoryApplicationSubmitted(msg.sender, factoryAddress, msg.value);
}

/**
 * @notice Approve factory application (admin or EXEC holders)
 * @param factoryAddress Factory address to approve
 * @param execReviewers Array of EXEC holder addresses who reviewed
 */
function approveFactory(
    address factoryAddress,
    address[] memory execReviewers
) external onlyAdminOrExec {
    FactoryApplication storage app = applications[factoryAddress];
    require(app.status == ApplicationStatus.Pending, "Not pending");
    require(block.timestamp <= app.reviewDeadline, "Review deadline passed");
    
    app.status = ApplicationStatus.Approved;
    app.reviewers = execReviewers;
    
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
    
    emit FactoryApplicationApproved(app.applicant, factoryAddress, execReviewers);
}

/**
 * @notice Reject factory application
 * @param factoryAddress Factory address to reject
 * @param reason Rejection reason
 * @param refundFee Whether to refund application fee
 */
function rejectFactory(
    address factoryAddress,
    string memory reason,
    bool refundFee
) external onlyAdminOrExec {
    FactoryApplication storage app = applications[factoryAddress];
    require(app.status == ApplicationStatus.Pending, "Not pending");
    
    app.status = ApplicationStatus.Rejected;
    app.rejectionReason = reason;
    
    // Refund fee if requested
    if (refundFee && app.applicationFee > 0) {
        payable(app.applicant).transfer(app.applicationFee);
    }
    
    // Free up title
    _freeTitle(app.title);
    
    _removeFromPending(factoryAddress);
    
    emit FactoryApplicationRejected(app.applicant, factoryAddress, reason);
}
```

### Application Fee Strategy

**Recommendations**:
- **Initial Fee**: 0.1 ETH (configurable)
- **Fee Purpose**: 
  - Deter spam applications
  - Generate revenue for platform
  - Cover review costs
- **Refund Policy**: 
  - Option 1: Always refund on rejection (encourages quality)
  - Option 2: Keep fee on rejection (penalty for low-quality)
  - Option 3: Partial refund based on review stage
- **Fee Distribution**:
  - Option 1: Platform treasury
  - Option 2: EXEC token holders (governance reward)
  - Option 3: Split between platform and reviewers

---

## Factory Registry & Indexing

### Factory Info Structure

```solidity
struct FactoryInfo {
    uint256 id;                 // Sequential factory ID
    address factoryAddress;      // Factory contract address
    string contractType;        // "ERC404" or "ERC1155"
    string title;               // URL-safe slug
    string displayTitle;        // Display name
    string metadataURI;         // Metadata URI
    bytes32[] features;         // Feature flags
    address creator;            // Factory creator
    uint256 registeredAt;       // Registration timestamp
    bool authorized;            // Active status
    uint256 instanceCount;      // Number of instances created
    uint256 totalVolume;       // Total volume across instances (optional)
}
```

### Indexing Strategy

**Option 1: Sequential ID Mapping (Recommended)**
```solidity
mapping(uint256 => address) public factories;  // ID -> Factory
uint256 public factoryCount;

function getFactory(uint256 id) external view returns (address) {
    require(id < factoryCount, "Invalid factory ID");
    return factories[id];
}

function getAllFactories() external view returns (address[] memory) {
    address[] memory result = new address[](factoryCount);
    for (uint256 i = 0; i < factoryCount; i++) {
        result[i] = factories[i];
    }
    return result;
}
```

**Option 2: Array-Based (Simpler but less gas efficient)**
```solidity
address[] public factories;

function getAllFactories() external view returns (address[] memory) {
    return factories;
}
```

**Recommendation**: Use Option 1 for gas efficiency in enumeration.

### Title Collision Prevention

```solidity
mapping(bytes32 => bool) public titleTaken;  // keccak256(title) -> bool

function _isTitleTaken(string memory title) internal view returns (bool) {
    return titleTaken[keccak256(bytes(title))];
}

function _markTitleTaken(string memory title) internal {
    titleTaken[keccak256(bytes(title))] = true;
}

function _freeTitle(string memory title) internal {
    titleTaken[keccak256(bytes(title))] = false;
}
```

### Factory Registration

```solidity
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
        instanceCount: 0,
        totalVolume: 0
    });
    
    emit FactoryRegistered(factoryId, factoryAddress, contractType);
}
```

### Factory Query Functions

```solidity
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
 * @notice Get factories by contract type
 */
function getFactoriesByType(string memory contractType) external view returns (address[] memory) {
    address[] memory result = new address[](factoryCount);
    uint256 count = 0;
    
    for (uint256 i = 0; i < factoryCount; i++) {
        FactoryInfo memory info = factoryInfo[factories[i]];
        if (keccak256(bytes(info.contractType)) == keccak256(bytes(contractType)) && info.authorized) {
            result[count++] = factories[i];
        }
    }
    
    // Resize array
    assembly {
        mstore(result, count)
    }
    
    return result;
}

/**
 * @notice Get factory by title
 */
function getFactoryByTitle(string memory title) external view returns (address) {
    for (uint256 i = 0; i < factoryCount; i++) {
        FactoryInfo memory info = factoryInfo[factories[i]];
        if (keccak256(bytes(info.title)) == keccak256(bytes(title))) {
            return factories[i];
        }
    }
    return address(0);
}
```

---

## Instance Tracking

### Instance Registration

**Called by Factory Contracts**:
```solidity
/**
 * @notice Register a new instance (called by factory contract)
 * @param instanceAddress New instance contract address
 * @param name Instance name (URL-safe slug)
 * @param displayName Display name
 * @param metadataURI Instance metadata URI
 * @param creator Creator address
 */
function registerInstance(
    address instanceAddress,
    string memory name,
    string memory displayName,
    string memory metadataURI,
    address creator
) external {
    address factory = msg.sender;
    
    // Verify factory is authorized
    require(isFactoryAuthorized(factory), "Factory not authorized");
    
    // Verify instance doesn't already exist
    require(instanceInfo[instanceAddress].instanceAddress == address(0), "Instance exists");
    
    // Get factory info
    FactoryInfo storage factoryInfo = factoryInfo[factory];
    
    // Register instance
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
    
    // Add to factory's instance list
    factoryInstances[factory].push(instanceAddress);
    factoryInfo.instanceCount++;
    
    emit InstanceRegistered(factory, instanceAddress, creator);
}
```

### Instance Info Structure

```solidity
struct InstanceInfo {
    address instanceAddress;     // Instance contract address
    address factoryAddress;      // Factory that created it
    string contractType;         // Contract type
    string name;                 // URL-safe name
    string displayName;          // Display name
    string metadataURI;         // Metadata URI
    address creator;             // Creator address
    uint256 createdAt;          // Creation timestamp
    bool featured;               // Featured flag
}
```

### Instance Query Functions

```solidity
/**
 * @notice Get instance info
 */
function getInstanceInfo(address instance) external view returns (InstanceInfo memory) {
    return instanceInfo[instance];
}

/**
 * @notice Get all instances for a factory
 */
function getInstancesByFactory(address factory) external view returns (address[] memory) {
    return factoryInstances[factory];
}

/**
 * @notice Get instance count for a factory
 */
function getInstanceCount(address factory) external view returns (uint256) {
    return factoryInfo[factory].instanceCount;
}

/**
 * @notice Get all instances (across all factories)
 */
function getAllInstances() external view returns (address[] memory) {
    uint256 totalCount = 0;
    
    // Count total instances
    for (uint256 i = 0; i < factoryCount; i++) {
        totalCount += factoryInfo[factories[i]].instanceCount;
    }
    
    // Collect all instances
    address[] memory result = new address[](totalCount);
    uint256 index = 0;
    
    for (uint256 i = 0; i < factoryCount; i++) {
        address[] memory instances = factoryInstances[factories[i]];
        for (uint256 j = 0; j < instances.length; j++) {
            result[index++] = instances[j];
        }
    }
    
    return result;
}
```

---

## Governance & Access Control

### Access Control Options

**Option 1: Simple Admin (Recommended for MVP)**
```solidity
address public admin;

modifier onlyAdmin() {
    require(msg.sender == admin, "Not admin");
    _;
}

function setAdmin(address newAdmin) external onlyAdmin {
    admin = newAdmin;
}
```

**Option 2: EXEC Token-Based Governance**
```solidity
IERC404 public execToken;
uint256 public minExecForReview; // Minimum EXEC balance to review

modifier onlyAdminOrExec() {
    require(
        msg.sender == admin || execToken.balanceOf(msg.sender) >= minExecForReview,
        "Not authorized"
    );
    _;
}
```

**Option 3: OpenZeppelin AccessControl**
```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";

bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

modifier onlyRole(bytes32 role) {
    require(hasRole(role, msg.sender), "Not authorized");
    _;
}
```

**Recommendation**: Start with Option 1, upgrade to Option 2 for EXEC governance.

### Governance Functions

```solidity
/**
 * @notice Revoke factory authorization
 */
function revokeFactory(address factory) external onlyAdmin {
    require(factoryInfo[factory].authorized, "Not authorized");
    factoryInfo[factory].authorized = false;
    emit FactoryRevoked(factory);
}

/**
 * @notice Re-authorize factory
 */
function reauthorizeFactory(address factory) external onlyAdmin {
    require(!factoryInfo[factory].authorized, "Already authorized");
    factoryInfo[factory].authorized = true;
    emit FactoryReauthorized(factory);
}

/**
 * @notice Update application fee
 */
function setApplicationFee(uint256 newFee) external onlyAdmin {
    applicationFee = newFee;
    emit ApplicationFeeUpdated(newFee);
}

/**
 * @notice Set featured instance
 */
function setFeatured(address instance, bool featured) external onlyAdmin {
    instanceInfo[instance].featured = featured;
    emit InstanceFeatured(instance, featured);
}
```

---

## Metadata Management

### Metadata URI Structure

**Factory Metadata** (IPFS/Arweave):
```json
{
  "name": "ERC404 Factory",
  "description": "Factory for creating ERC404 projects",
  "image": "ipfs://...",
  "contractType": "ERC404",
  "features": ["bonding-curve", "nft-minting", "whitelist"],
  "version": "1.0.0",
  "website": "https://...",
  "github": "https://..."
}
```

**Instance Metadata** (IPFS/Arweave):
```json
{
  "name": "My Project",
  "description": "Project description",
  "image": "ipfs://...",
  "symbol": "PROJ",
  "creator": "0x...",
  "website": "https://...",
  "twitter": "https://..."
}
```

### Metadata Validation

```solidity
/**
 * @notice Validate metadata URI format
 */
function _isValidMetadataURI(string memory uri) internal pure returns (bool) {
    bytes memory uriBytes = bytes(uri);
    if (uriBytes.length == 0) return false;
    
    // Check for IPFS or HTTP(S) prefix
    string memory ipfsPrefix = "ipfs://";
    string memory httpPrefix = "http://";
    string memory httpsPrefix = "https://";
    
    if (uriBytes.length >= bytes(ipfsPrefix).length) {
        bytes memory prefix = new bytes(bytes(ipfsPrefix).length);
        for (uint256 i = 0; i < bytes(ipfsPrefix).length; i++) {
            prefix[i] = uriBytes[i];
        }
        if (keccak256(prefix) == keccak256(bytes(ipfsPrefix))) {
            return true;
        }
    }
    
    // Similar checks for HTTP(S)
    // ...
    
    return false;
}
```

---

## Gas Optimization

### Storage Optimization

1. **Pack Structs**: Order struct fields to minimize storage slots
```solidity
struct FactoryInfo {
    uint256 id;                 // Slot 1
    address factoryAddress;      // Slot 2 (20 bytes, can pack with bool)
    bool authorized;             // Slot 2 (packed with address)
    uint256 registeredAt;        // Slot 3
    uint256 instanceCount;      // Slot 4
    // Strings stored separately (keccak256 hash)
}
```

2. **Use Events for Historical Data**: Store minimal on-chain, emit events
```solidity
event FactoryRegistered(
    uint256 indexed id,
    address indexed factory,
    string contractType,
    string title,
    string metadataURI
);
```

3. **Batch Operations**: Allow batch registration/approval
```solidity
function batchApproveFactories(address[] memory factories) external onlyAdmin {
    for (uint256 i = 0; i < factories.length; i++) {
        approveFactory(factories[i], new address[](0));
    }
}
```

### Read Optimization

1. **View Functions**: Use `view` for read-only operations
2. **Pagination**: Support pagination for large lists
```solidity
function getFactoriesPaginated(
    uint256 offset,
    uint256 limit
) external view returns (address[] memory) {
    require(offset < factoryCount, "Invalid offset");
    
    uint256 end = offset + limit;
    if (end > factoryCount) {
        end = factoryCount;
    }
    
    address[] memory result = new address[](end - offset);
    for (uint256 i = offset; i < end; i++) {
        result[i - offset] = factories[i];
    }
    
    return result;
}
```

---

## Security Considerations

### Input Validation

```solidity
/**
 * @notice Validate contract type
 */
function _isValidContractType(string memory contractType) internal pure returns (bool) {
    bytes32 typeHash = keccak256(bytes(contractType));
    return typeHash == keccak256(bytes("ERC404")) || 
           typeHash == keccak256(bytes("ERC1155"));
}

/**
 * @notice Validate factory interface
 */
function _validateFactoryInterface(address factory, string memory contractType) internal view returns (bool) {
    // Check if contract implements required interface
    // This would require interface detection logic
    // Could use EIP-165 for standard interfaces
    return true; // Placeholder
}
```

### Reentrancy Protection

```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract MasterRegistry is ReentrancyGuard {
    function approveFactory(...) external nonReentrant {
        // ...
    }
}
```

### Title Validation

```solidity
/**
 * @notice Validate title format (URL-safe)
 */
function _isValidTitle(string memory title) internal pure returns (bool) {
    bytes memory titleBytes = bytes(title);
    if (titleBytes.length == 0 || titleBytes.length > 64) {
        return false;
    }
    
    // Check for valid characters (a-z, 0-9, -)
    for (uint256 i = 0; i < titleBytes.length; i++) {
        uint8 char = uint8(titleBytes[i]);
        if (!(char >= 48 && char <= 57) &&  // 0-9
            !(char >= 97 && char <= 122) && // a-z
            char != 45) {                    // -
            return false;
        }
    }
    
    return true;
}
```

### Factory Contract Verification

```solidity
/**
 * @notice Verify factory contract implements required interface
 */
function _validateFactoryInterface(address factory, string memory contractType) internal view returns (bool) {
    // Attempt to call a required function
    // If it reverts, factory doesn't implement interface
    
    if (keccak256(bytes(contractType)) == keccak256(bytes("ERC404"))) {
        // Check for createInstance function
        (bool success, ) = factory.staticcall(
            abi.encodeWithSignature("createInstance(string,string,bytes)")
        );
        return success;
    }
    
    // Similar checks for ERC1155
    return false;
}
```

---

## Implementation Phases

### Phase 1: MVP (Minimum Viable Product)

**Core Features**:
- Factory application system
- Basic factory registry
- Instance registration
- Admin access control
- Simple indexing

**Functions**:
- `applyForFactory()`
- `approveFactory()` / `rejectFactory()`
- `registerInstance()` (called by factories)
- `getFactory()`, `getFactoryInfo()`
- `getInstancesByFactory()`

### Phase 2: Enhanced Features

**Additional Features**:
- EXEC token governance
- Featured instances
- Factory statistics
- Batch operations
- Pagination support

**Functions**:
- `setFeatured()`
- `getFactoriesPaginated()`
- `batchApproveFactories()`
- EXEC-based review system

### Phase 3: Advanced Features

**Advanced Features**:
- Factory versioning
- Upgrade mechanisms
- Advanced statistics
- Search functionality (off-chain indexing)
- Factory categories/tags

---

## Contract Interface Specification

### Complete Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMasterRegistry {
    // Application System
    function applyForFactory(
        address factoryAddress,
        string memory contractType,
        string memory title,
        string memory displayTitle,
        string memory metadataURI,
        bytes32[] memory features
    ) external payable;
    
    function approveFactory(
        address factoryAddress,
        address[] memory execReviewers
    ) external;
    
    function rejectFactory(
        address factoryAddress,
        string memory reason,
        bool refundFee
    ) external;
    
    // Factory Registry
    function getFactory(uint256 id) external view returns (address);
    function getFactoryInfo(address factory) external view returns (FactoryInfo memory);
    function isFactoryAuthorized(address factory) external view returns (bool);
    function getFactoriesByType(string memory contractType) external view returns (address[] memory);
    function getFactoryByTitle(string memory title) external view returns (address);
    function getFactoryCount() external view returns (uint256);
    
    // Instance Registration (called by factories)
    function registerInstance(
        address instanceAddress,
        string memory name,
        string memory displayName,
        string memory metadataURI,
        address creator
    ) external;
    
    // Instance Queries
    function getInstanceInfo(address instance) external view returns (InstanceInfo memory);
    function getInstancesByFactory(address factory) external view returns (address[] memory);
    function getInstanceCount(address factory) external view returns (uint256);
    function getAllInstances() external view returns (address[] memory);
    
    // Governance
    function revokeFactory(address factory) external;
    function reauthorizeFactory(address factory) external;
    function setApplicationFee(uint256 newFee) external;
    function setFeatured(address instance, bool featured) external;
    
    // Events
    event FactoryApplicationSubmitted(
        address indexed applicant,
        address indexed factoryAddress,
        uint256 fee
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
}
```

---

## Recommendations Summary

### Critical Design Decisions

1. **Application Fee**: Start with 0.1 ETH, make refundable on rejection
2. **Access Control**: Start with simple admin, upgrade to EXEC governance
3. **Indexing**: Use sequential ID mapping for gas efficiency
4. **Metadata**: Store URIs on-chain, full metadata off-chain (IPFS/Arweave)
5. **Upgradeability**: Consider proxy pattern for future improvements

### Implementation Priority

1. **P0 (Critical)**:
   - Factory application system
   - Factory registry
   - Instance registration
   - Basic access control

2. **P1 (High)**:
   - EXEC governance integration
   - Featured instances
   - Pagination support
   - Batch operations

3. **P2 (Medium)**:
   - Advanced statistics
   - Factory versioning
   - Search functionality
   - Categories/tags

### Testing Strategy

1. **Unit Tests**: Test each function individually
2. **Integration Tests**: Test factory → master → instance flow
3. **Gas Tests**: Measure and optimize gas costs
4. **Security Tests**: Audit for vulnerabilities
5. **Governance Tests**: Test EXEC-based review system

---

## Conclusion

The master contract serves as the foundation of the ms2.fun launchpad. Key recommendations:

1. **Start Simple**: MVP with basic application and registry system
2. **Plan for Growth**: Design for scalability and extensibility
3. **Gas Efficient**: Optimize storage and operations
4. **Secure**: Validate inputs, protect against reentrancy
5. **Governance Ready**: Design for EXEC token integration

The contract should balance decentralization with quality control, enabling permissionless factory applications while maintaining curation through governance.

