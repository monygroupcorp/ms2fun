# Master Contract Requirements
## On-Chain Requirements for ms2.fun Launchpad

**Purpose:** Track contract requirements discovered during frontend development. This document serves as a living specification that evolves as we build the mock system and identify what the master contract needs to support.

**Status:** Active Development  
**Last Updated:** 2024

---

## Table of Contents

1. [Overview](#overview)
2. [Factory Registry Requirements](#factory-registry-requirements)
3. [Factory Metadata Requirements](#factory-metadata-requirements)
4. [Instance Metadata Requirements](#instance-metadata-requirements)
5. [Feature Matrix System](#feature-matrix-system)
6. [Navigation & Discovery Requirements](#navigation--discovery-requirements)
7. [Metadata & Content Requirements](#metadata--content-requirements)
8. [Statistics & Analytics Requirements](#statistics--analytics-requirements)
9. [Discovery & Search Requirements](#discovery--search-requirements)
10. [Validation & Safety Requirements](#validation--safety-requirements)
11. [Feature Matrix Extensions](#feature-matrix-extensions)
12. [Factory Capabilities](#factory-capabilities)
13. [Instance Lifecycle Requirements](#instance-lifecycle-requirements)
14. [Social & External Links Requirements](#social--external-links-requirements)
15. [Search & Indexing Requirements](#search--indexing-requirements)
16. [Admin Dashboard Requirements](#admin-dashboard-requirements)
17. [Future Requirements](#future-requirements)

---

## Overview

The master contract serves as the central registry for the launchpad ecosystem. It must support:

- Factory authorization and indexing
- Factory metadata (titles, names, features)
- Instance tracking and metadata
- Feature matrix for website rendering
- Navigation and discovery

This document tracks requirements discovered during frontend development with the mock system.

---

## Factory Registry Requirements

### 1. Factory Application System

**Requirement:** Master contract must have an application system for new factory creators to apply for inclusion.

**Purpose:**
- Control factory quality and curation
- Enable EXEC governance participation
- Prevent spam and low-quality factories
- Generate revenue through application fees
- Ensure proper review process

**Specification:**
```solidity
enum ApplicationStatus {
    Pending,    // Application submitted, awaiting review
    Approved,   // Application approved by admins/EXEC
    Rejected,   // Application rejected
    Withdrawn   // Applicant withdrew application
}

struct FactoryApplication {
    address applicant;           // Factory creator address
    address factoryAddress;      // Proposed factory contract address
    string contractType;         // Contract type (ERC404, ERC1155, etc.)
    string title;                // Proposed factory title
    string displayTitle;         // Display title
    string metadataURI;          // Factory metadata URI
    bytes32[] features;          // Requested features
    uint256 applicationFee;      // ETH fee paid
    uint256 appliedAt;           // Application timestamp
    ApplicationStatus status;     // Current status
    address[] reviewers;          // EXEC holders who reviewed
    string rejectionReason;      // Reason if rejected
}

mapping(address => FactoryApplication) public factoryApplications;
address[] public pendingApplications;

// Application fee (configurable)
uint256 public applicationFee = 0.1 ether;

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

// Functions
function applyForFactory(
    address factoryAddress,
    string memory contractType,
    string memory title,
    string memory displayTitle,
    string memory metadataURI,
    bytes32[] memory features
) external payable {
    require(msg.value >= applicationFee, "Insufficient application fee");
    require(factoryApplications[factoryAddress].applicant == address(0), "Application already exists");
    
    // Create application
    factoryApplications[factoryAddress] = FactoryApplication({
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
        rejectionReason: ""
    });
    
    pendingApplications.push(factoryAddress);
    
    emit FactoryApplicationSubmitted(msg.sender, factoryAddress, msg.value);
}

function approveFactory(
    address factoryAddress,
    address[] memory execReviewers  // EXEC holders who reviewed
) external onlyAdmin {
    FactoryApplication storage app = factoryApplications[factoryAddress];
    require(app.status == ApplicationStatus.Pending, "Application not pending");
    
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

function rejectFactory(
    address factoryAddress,
    string memory reason
) external onlyAdmin {
    FactoryApplication storage app = factoryApplications[factoryAddress];
    require(app.status == ApplicationStatus.Pending, "Application not pending");
    
    app.status = ApplicationStatus.Rejected;
    app.rejectionReason = reason;
    
    // Refund application fee (optional, or keep as penalty)
    // payable(app.applicant).transfer(app.applicationFee);
    
    _removeFromPending(factoryAddress);
    
    emit FactoryApplicationRejected(app.applicant, factoryAddress, reason);
}
```

**Use Cases:**
- Factory creators submit applications with ETH fee
- Admins/EXEC holders review applications
- Approved factories are automatically registered
- Rejected applications can be refunded or fee kept as penalty
- Track application history

**Implementation Notes:**
- Application fee can be refunded on rejection or kept as penalty
- EXEC holders can participate in review process
- Applications must include all required metadata
- Factory contract must be deployed before application

**Mock Implementation:**
- Currently: No application system
- Needs: Application workflow, fee handling, review process

**Priority:** P0 (Critical)

---

### 2. Factory Index Mapping

**Requirement:** Index of factories with integer ID to address mapping.

**Purpose:** 
- Efficient factory enumeration
- Sequential factory IDs for discovery
- Easy pagination and listing

**Specification:**
```solidity
// Factory index: int -> address mapping
mapping(uint256 => address) public factories;
uint256 public factoryCount;
```

**Use Cases:**
- List all factories: iterate from 0 to factoryCount
- Get factory by ID: factories[id]
- Pagination: get factories in range [start, end]

**Mock Implementation:**
- Currently: Array of factory objects
- Needs: Integer ID assignment and mapping

---

### 3. Factory Name Collision Resistance

**Requirement:** Factory name collision detection using bytes32 -> bool mapping.

**Purpose:**
- Prevent duplicate factory titles/names
- Ensure unique URLs (/:factoryTitle)
- Maintain clean navigation structure

**Specification:**
```solidity
// Name collision check: bytes32(nameHash) -> bool taken
mapping(bytes32 => bool) public factoryNamesTaken;

function isFactoryNameAvailable(string memory name) public view returns (bool) {
    bytes32 nameHash = keccak256(abi.encodePacked(name));
    return !factoryNamesTaken[nameHash];
}

function registerFactoryName(string memory name) internal {
    bytes32 nameHash = keccak256(abi.encodePacked(name));
    require(!factoryNamesTaken[nameHash], "Factory name already taken");
    factoryNamesTaken[nameHash] = true;
}
```

**Use Cases:**
- Check if factory name is available before registration
- Prevent duplicate factory titles
- Ensure unique navigation paths

**Mock Implementation:**
- Currently: No collision checking
- Needs: Name hash tracking and validation

**Notes:**
- Name should be URL-safe (slug format)
- Consider case-insensitive comparison
- May need name normalization (lowercase, trim, etc.)

---

## Factory Metadata Requirements

### 4. Factory Title/Name Storage

**Requirement:** Factory must store a title/name for navigation.

**Purpose:**
- Human-readable factory identification
- URL generation (/:factoryTitle)
- Display in UI

**Specification:**
```solidity
struct FactoryInfo {
    address factoryAddress;
    string title;           // URL-safe title (slug)
    string displayTitle;    // Display title
    string contractType;    // "ERC404", "ERC1155", etc.
    bool authorized;
    uint256 createdAt;
    uint256 instanceCount;
}

mapping(address => FactoryInfo) public factoryInfo;
```

**Use Cases:**
- Generate navigation URLs
- Display factory name in UI
- Search and filter by factory name

**Mock Implementation:**
- Currently: title and displayTitle fields added
- Needs: On-chain storage equivalent

---

## Instance Metadata Requirements

### 5. Instance Name Storage

**Requirement:** Factory instances must store names for navigation.

**Purpose:**
- Human-readable instance identification
- URL generation (/:factoryTitle/:instanceName)
- Display in UI

**Specification:**
```solidity
// In factory contract
struct InstanceInfo {
    address instanceAddress;
    string name;           // URL-safe name (slug)
    string displayName;     // Display name
    string metadataURI;
    address creator;
    uint256 createdAt;
}

mapping(address => InstanceInfo) public instances;
```

**Use Cases:**
- Generate navigation URLs
- Display instance name in UI
- Search and filter by instance name

**Mock Implementation:**
- Currently: name and displayName fields added
- Needs: On-chain storage in factory contracts

---

### 6. ERC1155 Piece Titles

**Requirement:** ERC1155 instances must store piece/edition titles.

**Purpose:**
- Human-readable piece identification
- URL generation (/:factoryTitle/:instanceName/:pieceTitle)
- Display individual pieces in UI

**Specification:**
```solidity
// In ERC1155 instance contract
struct PieceInfo {
    uint256 editionId;
    string title;          // URL-safe title (slug)
    string displayTitle;   // Display title
    uint256 price;
    uint256 supply;
    uint256 minted;
    string metadataURI;
}

mapping(uint256 => PieceInfo) public pieces;
```

**Use Cases:**
- Generate navigation URLs for pieces
- Display piece information
- Individual piece detail pages

**Mock Implementation:**
- Currently: pieces array with titles
- Needs: On-chain storage in ERC1155 contracts

---

## Feature Matrix System

### 7. Website Feature Matrix

**Requirement:** Contracts must be able to specify required features, and the website must know how to render them.

**Purpose:**
- Contracts declare required features
- Website renders appropriate UI components
- Ensures feature compatibility between contract and frontend

**Current Features Identified:**

**CULT EXEC Features:**
- ✅ Bonding Curve
- ✅ Liquidity Pool (Secondary)
- ✅ Chat Feature
- ✅ Balance Mint Portfolio

**Feature Specification:**
```solidity
// Feature flags as bytes32 constants
bytes32 public constant FEATURE_BONDING_CURVE = keccak256("BONDING_CURVE");
bytes32 public constant FEATURE_LIQUIDITY_POOL = keccak256("LIQUIDITY_POOL");
bytes32 public constant FEATURE_CHAT = keccak256("CHAT");
bytes32 public constant FEATURE_BALANCE_MINT = keccak256("BALANCE_MINT");
bytes32 public constant FEATURE_PORTFOLIO = keccak256("PORTFOLIO");

// Feature matrix: contract address -> feature set
mapping(address => bytes32[]) public contractFeatures;

// Or use bitmask for efficiency
mapping(address => uint256) public contractFeatureMask;

// Feature bit positions
uint256 public constant BIT_BONDING_CURVE = 1 << 0;
uint256 public constant BIT_LIQUIDITY_POOL = 1 << 1;
uint256 public constant BIT_CHAT = 1 << 2;
uint256 public constant BIT_BALANCE_MINT = 1 << 3;
uint256 public constant BIT_PORTFOLIO = 1 << 4;
```

**Use Cases:**
- Factory declares features it supports
- Instance inherits features from factory
- Website checks features and renders appropriate UI
- Feature compatibility validation

**Website Integration:**
```javascript
// Frontend checks features
const features = await masterContract.getContractFeatures(instanceAddress);
if (features.includes(FEATURE_BONDING_CURVE)) {
    // Render bonding curve component
}
if (features.includes(FEATURE_CHAT)) {
    // Render chat panel
}
```

**Mock Implementation:**
- Currently: No feature tracking
- Needs: Feature array/bitmask in mock data
- Needs: Feature checking in components

**Future Features to Consider:**
- Merkle Whitelist
- Phase Transitions (Presale → Live)
- NFT Minting
- Staking
- Governance
- Royalties
- Batch Operations
- etc.

---

### 8. Expandable Feature System

**Requirement:** Feature matrix system must support dynamic feature registration for new factories.

**Purpose:**
- Allow new factories to request new features
- Enable launchpad to evolve and grow
- Support custom UI components for new features
- Future-proof the system
- Accommodate innovative factory designs

**Specification:**
```solidity
// Dynamic feature registration
mapping(bytes32 => bool) public registeredFeatures;
mapping(bytes32 => FeatureInfo) public featureRegistry;

struct FeatureInfo {
    bytes32 featureHash;         // Feature identifier
    string featureName;          // Human-readable name
    string description;           // Feature description
    address registrant;           // Who registered it
    uint256 registeredAt;        // Registration timestamp
    bool requiresApproval;        // Whether feature needs admin approval
    bool approved;               // Approval status
    string uiComponentURI;        // URI to UI component (optional)
}

// Register new feature
function registerFeature(
    string memory featureName,
    string memory description,
    string memory uiComponentURI
) external returns (bytes32) {
    bytes32 featureHash = keccak256(abi.encodePacked(featureName));
    
    require(!registeredFeatures[featureHash], "Feature already registered");
    
    registeredFeatures[featureHash] = true;
    featureRegistry[featureHash] = FeatureInfo({
        featureHash: featureHash,
        featureName: featureName,
        description: description,
        registrant: msg.sender,
        registeredAt: block.timestamp,
        requiresApproval: true,  // New features require approval
        approved: false,
        uiComponentURI: uiComponentURI
    });
    
    emit FeatureRegistered(featureHash, featureName, msg.sender);
    
    return featureHash;
}

// Approve new feature
function approveFeature(bytes32 featureHash) external onlyAdmin {
    FeatureInfo storage feature = featureRegistry[featureHash];
    require(feature.requiresApproval && !feature.approved, "Feature not pending approval");
    
    feature.approved = true;
    
    emit FeatureApproved(featureHash);
}

// Check if feature is available
function isFeatureAvailable(bytes32 featureHash) external view returns (bool) {
    FeatureInfo memory feature = featureRegistry[featureHash];
    return registeredFeatures[featureHash] && (!feature.requiresApproval || feature.approved);
}

event FeatureRegistered(bytes32 indexed featureHash, string featureName, address registrant);
event FeatureApproved(bytes32 indexed featureHash);
```

**Use Cases:**
- New factories request custom features
- Features are registered and reviewed
- Approved features become available for use
- UI components can be linked to features
- System evolves with new capabilities

**Implementation Notes:**
- New features require admin/EXEC approval
- Features can include UI component URIs
- Frontend can dynamically load feature components
- Feature registry enables discovery of available features

**Mock Implementation:**
- Currently: Static feature list
- Needs: Dynamic feature registration system

**Priority:** P1 (High)

---

## Navigation & Discovery Requirements

### 9. Title-Based Navigation Support (Multi-Chain)

**Requirement:** Master contract must support title-based navigation structure with chain ID support.

**Navigation Structure:**
- `/:chainId/:factoryTitle` - Factory detail (chain-specific)
- `/:chainId/:factoryTitle/:instanceName` - Instance detail
- `/:chainId/:factoryTitle/:instanceName/:pieceTitle` - ERC1155 piece detail

**Note:** Chain ID is required for multi-chain support. Default chain (e.g., Ethereum mainnet) can use chainId = 1 or omit for backward compatibility.

**Specification:**
```solidity
// Multi-chain support: chainId -> title -> address
mapping(uint256 => mapping(bytes32 => address)) public factoryByTitle; // chainId -> title -> factory
mapping(uint256 => mapping(address => mapping(bytes32 => address))) public instanceByName; // chainId -> factory -> name -> instance
mapping(uint256 => mapping(address => mapping(uint256 => bytes32))) public pieceByTitle; // chainId -> instance -> editionId -> title

// Default chain (for backward compatibility)
uint256 public constant DEFAULT_CHAIN_ID = 1; // Ethereum mainnet

// Helper functions
function getFactoryByTitle(uint256 chainId, string memory title) external view returns (address) {
    bytes32 titleHash = keccak256(abi.encodePacked(title));
    return factoryByTitle[chainId][titleHash];
}

function getInstanceByName(
    uint256 chainId,
    address factory,
    string memory name
) external view returns (address) {
    bytes32 nameHash = keccak256(abi.encodePacked(name));
    return instanceByName[chainId][factory][nameHash];
}
```

**Use Cases:**
- Resolve URL paths to contract addresses
- Generate URLs from contract data
- Navigation and routing

**Mock Implementation:**
- Currently: Title-based navigation implemented
- Needs: On-chain reverse lookup support

---

## Metadata & Content Requirements

### 10. Factory Metadata URI

**Requirement:** Factory must store a metadata URI for off-chain content.

**Purpose:**
- Store factory description, logo, documentation
- Enable rich factory display in UI
- Support IPFS or HTTP URIs for metadata
- Support even stylesheets, javascript files, other integrations off chain

**Specification:**
```solidity
struct FactoryInfo {
    // ... existing fields ...
    string metadataURI;        // IPFS or HTTP URI
    string description;         // Short description (optional, can be in metadata)
    string logoURI;            // Logo image URI (optional)
    string documentationURI;   // Documentation link (optional)
    string customCSSURI;       // Custom CSS stylesheet URI (optional, opt-in)
    string customJSURI;        // Custom JavaScript file URI (optional, opt-in)
    bool allowCustomAssets;    // Whether custom CSS/JS is enabled
}

mapping(address => FactoryInfo) public factoryInfo;
```

**Use Cases:**
- Display factory description in FactoryDetail page
- Show factory logo in FactoryCard
- Link to factory documentation
- Rich metadata for discovery
- Custom styling and functionality (opt-in only)

**Security Considerations:**
- Custom CSS/JS must be opt-in (user must explicitly enable)
- Factory must set `allowCustomAssets = true` to enable
- Frontend must warn users before loading custom assets
- Custom assets should be loaded in sandboxed iframe or isolated context
- Users should be able to disable custom assets at any time

**Mock Implementation:**
- Currently: metadataURI field exists
- Needs: Full metadata structure with description, logo, docs, custom CSS/JS

**Priority:** P1 (High)

---

### 11. Instance Metadata URI

**Requirement:** Instance must store a metadata URI for off-chain content.

**Purpose:**
- Store project description, images, social links
- Enable rich project display in UI
- Support IPFS or HTTP URIs for metadata
- CSS and extra javascript 

**Specification:**
```solidity
struct InstanceInfo {
    // ... existing fields ...
    string metadataURI;        // IPFS or HTTP URI
    string description;         // Project description
    string imageURI;            // Project image/logo
    string websiteURI;          // Project website
    string twitterURI;          // Twitter/X link
    string githubURI;           // GitHub link
    string etherscanURI;         // Etherscan link (optional, can be generated)
    string customCSSURI;        // Custom CSS stylesheet URI (optional, opt-in)
    string customJSURI;         // Custom JavaScript file URI (optional, opt-in)
    bool allowCustomAssets;     // Whether custom CSS/JS is enabled
}

mapping(address => InstanceInfo) public instances;
```

**Use Cases:**
- Display project description in ProjectHeader
- Show project image in ProjectCard
- Link to social media and external resources
- Rich metadata for discovery and search
- Custom styling and functionality (opt-in only)

**Security Considerations:**
- Custom CSS/JS must be opt-in (user must explicitly enable)
- Instance must set `allowCustomAssets = true` to enable
- Frontend must warn users before loading custom assets
- Custom assets should be loaded in sandboxed iframe or isolated context
- Users should be able to disable custom assets at any time

**Mock Implementation:**
- Currently: metadataURI field exists
- Needs: Full metadata structure with all social links, custom CSS/JS

**Priority:** P0 (Critical)

---

### 12. Creator Information Storage

**Requirement:** Instance must store creator address and optional creator metadata.

**Purpose:**
- Track project creator
- Display creator information
- Enable creator-based filtering and discovery
- Support creator verification

**Specification:**
```solidity
struct InstanceInfo {
    // ... existing fields ...
    address creator;            // Creator address
    string creatorName;         // Optional creator display name
    string creatorTwitter;      // Optional creator Twitter handle
    bool creatorVerified;       // Creator verification status
}

mapping(address => InstanceInfo) public instances;

// Creator index for discovery
mapping(address => address[]) public creatorProjects; // creator -> instance addresses
```

**Use Cases:**
- Display creator in ProjectHeader
- Filter projects by creator
- Show creator's other projects
- Creator verification badge

**Mock Implementation:**
- Currently: creator field exists
- Needs: Creator metadata and indexing

**Priority:** P1 (High)

---

## Statistics & Analytics Requirements

### 13. Instance Statistics Tracking

**Requirement:** Instance statistics must be tracked and queryable.

**Purpose:**
- Display volume, holders, supply in UI
- Enable sorting and filtering by stats
- Provide analytics for users
- Support trending/popular projects

**Specification:**
```solidity
struct InstanceStats {
    uint256 totalVolume;        // Total trading volume (varies by factory type)
    uint256 holderCount;        // Number of unique holders
    uint256 totalSupply;        // Total supply (if applicable)
    uint256 freeSupply;        // Free supply (for ERC404)
    uint256 lastUpdated;        // Timestamp of last update
    string metricType;          // Type of metric: "volume", "mint_completion", "purchases", etc.
}

mapping(address => InstanceStats) public instanceStats;

// Factory-specific metric definitions
mapping(address => string) public factoryMetricType; // factory -> metric type

// Events for stat updates
event StatsUpdated(
    address indexed instance,
    uint256 volume,
    uint256 holders,
    uint256 supply,
    string metricType
);
```

**Use Cases:**
- Display stats in ProjectCard and ProjectHeader
- Sort projects by volume, holders, etc.
- Filter by minimum volume/holders
- Calculate trending projects
- Factory-specific metrics (ERC404 volume, ERC721 mint completion, open edition purchases)

**Implementation Notes:**
- **Metrics vary by factory type:**
  - **ERC404 with allegiance:** Secondary market volume tracked via allegiance mechanism
  - **ERC721:** Mint completion percentage
  - **Open Editions:** Number of purchases/mints
  - **ERC1155:** Per-edition sales
- Stats can be updated on-chain via events
- Or aggregated off-chain from transaction history
- Consider gas costs for on-chain updates
- May need periodic aggregation service
- Factory allegiance mechanism required for accurate secondary market volume

**Mock Implementation:**
- Currently: stats object in mock data
- Needs: Stat update events and aggregation

**Priority:** P0 (Critical)

---

### 14. Factory Statistics Tracking

**Requirement:** Factory statistics must be tracked for display and discovery.

**Purpose:**
- Display factory instance count
- Show factory activity metrics
- Enable factory comparison
- Support factory ranking

**Specification:**
```solidity
struct FactoryStats {
    uint256 instanceCount;      // Number of instances created
    uint256 totalVolume;        // Total volume across all instances
    uint256 totalHolders;       // Total holders across all instances
    uint256 lastInstanceCreated; // Timestamp of last instance creation
}

mapping(address => FactoryStats) public factoryStats;
```

**Use Cases:**
- Display in FactoryCard
- Sort factories by activity
- Show factory health metrics

**Priority:** P2 (Medium)

---

## Discovery & Search Requirements

### 15. Featured Projects Flag

**Requirement:** Instances must support a featured/promoted flag.

**Purpose:**
- Highlight important projects
- Support sponsored/featured sections
- Enable curation
- Improve discovery

**Specification:**
```solidity
struct InstanceInfo {
    // ... existing fields ...
    bool featured;              // Featured project flag
    uint256 featuredUntil;      // Optional: featured until timestamp
    uint256 featuredPriority;   // Optional: priority for sorting
}

mapping(address => InstanceInfo) public instances;

// Featured projects index
address[] public featuredInstances;
```

**Use Cases:**
- Display in "Featured Projects" section
- Show featured badge in ProjectCard
- Sort featured projects first
- Curation by platform admins

**Mock Implementation:**
- Currently: Featured projects filtered by name
- Needs: Explicit featured flag

**Priority:** P1 (High)

---

### 16. Factory Categories/Tags

**Requirement:** Factories must support categorization and tagging.

**Purpose:**
- Organize factories by type/category
- Enable category-based filtering
- Improve discovery
- Support factory grouping

**Specification:**
```solidity
struct FactoryInfo {
    // ... existing fields ...
    string category;            // Primary category (e.g., "ERC404", "ERC1155")
    string[] tags;              // Additional tags
}

mapping(address => FactoryInfo) public factoryInfo;

// Category index
mapping(string => address[]) public factoriesByCategory;
```

**Use Cases:**
- Filter factories by category
- Display category badges
- Group factories in UI
- Category-based navigation

**Priority:** P2 (Medium)

---

### 17. Instance Tags/Categories

**Requirement:** Instances must support tagging for improved discovery.

**Purpose:**
- Enable tag-based search
- Support project categorization
- Improve filtering
- Enable related projects

**Specification:**
```solidity
struct InstanceInfo {
    // ... existing fields ...
    string[] tags;              // Project tags
    string category;            // Primary category
}

mapping(address => InstanceInfo) public instances;

// Tag index for search
mapping(string => address[]) public instancesByTag;
```

**Use Cases:**
- Tag-based search
- Filter by tags
- Show related projects
- Category navigation

**Priority:** P2 (Medium)

---

## Validation & Safety Requirements

### 18. Audit Status Tracking

**Requirement:** Factories and instances must support audit status tracking.

**Purpose:**
- Display audit badges in UI
- Warn users about unaudited contracts
- Build trust and safety
- Enable quality filtering

**Specification:**
```solidity
struct AuditInfo {
    bool audited;               // Audit status
    string auditReportURI;      // Link to audit report
    address auditor;            // Auditor address (optional)
    uint256 auditDate;          // Audit date timestamp
}

struct FactoryInfo {
    // ... existing fields ...
    AuditInfo audit;
}

struct InstanceInfo {
    // ... existing fields ...
    AuditInfo audit;
}
```

**Use Cases:**
- Display audit badge in ProjectCard
- Show audit warning for unaudited projects
- Filter by audit status
- Link to audit reports

**Mock Implementation:**
- Currently: audited boolean in mock data
- Needs: Full audit info structure

**Priority:** P1 (High)

---

### 19. Contract Verification Status (Mandatory)

**Requirement:** Contracts MUST be verified on Etherscan before acceptance into master contract.

**Purpose:**
- Ensure contract transparency and security
- Build trust with users
- Enable code review
- Prevent unverified contracts from being listed

**Specification:**
```solidity
struct InstanceInfo {
    // ... existing fields ...
    bool verified;              // Etherscan verification status (MANDATORY)
    string verificationURI;     // Etherscan verification link
}

// Validation in registration
function registerInstance(
    address factory,
    address instance,
    string memory name,
    string memory displayName,
    string memory metadataURI,
    address creator
) external {
    // ... existing code ...
    
    // MANDATORY: Contract must be verified
    require(instanceInfo.verified == true, "Contract must be verified on Etherscan");
    
    // ... rest of registration ...
}
```

**Use Cases:**
- Show verification badge (required)
- Link to Etherscan
- Filter by verification status
- Block unverified contracts from registration

**Implementation Notes:**
- Verification status must be checked before factory/instance registration
- Application system must verify contracts before approval
- Unverified contracts cannot be accepted into master contract

**Priority:** P0 (Critical)

---

### 20. Instance Creation Fees

**Requirement:** Instance creation must include fees paid to master contract owners (EXEC holders).

**Purpose:**
- Generate revenue for EXEC holders
- Prevent spam through economic disincentive
- Align incentives (spam is -EV)
- Support platform sustainability

**Specification:**
```solidity
// Instance creation fee (configurable per factory or global)
mapping(address => uint256) public factoryInstanceFees; // factory -> fee amount
uint256 public defaultInstanceFee = 0.01 ether;

// Fee distribution (see Requirement #31 for configurable distribution)
address public execTreasury; // EXEC holder treasury address
address public creator;      // Platform creator address

// Events
event InstanceCreated(
    address indexed factory,
    address indexed instance,
    address indexed creator,
    uint256 feePaid
);

function createInstance(
    address factory,
    string memory name,
    string memory displayName,
    string memory metadataURI,
    // ... other parameters
) external payable {
    uint256 requiredFee = factoryInstanceFees[factory] > 0 
        ? factoryInstanceFees[factory] 
        : defaultInstanceFee;
    
    require(msg.value >= requiredFee, "Insufficient instance creation fee");
    
    // Deploy instance
    address instance = _deployInstance(factory, name, displayName, metadataURI, msg.sender);
    
    // Distribute fee according to configurable distribution (Requirement #31)
    distributeFees(FeeType.InstanceCreationFee, requiredFee);
    
    // Refund excess
    if (msg.value > requiredFee) {
        payable(msg.sender).transfer(msg.value - requiredFee);
    }
    
    emit InstanceCreated(factory, instance, msg.sender, requiredFee);
}
```

**Use Cases:**
- Collect fees on instance creation
- Distribute fees to EXEC holders
- Economic disincentive for spam
- Platform revenue generation

**Implementation Notes:**
- Fees can be per-factory or global default
- Fees are paid to EXEC treasury
- Excess payment is refunded
- Fee amount can be adjusted by governance
- Spam becomes economically unviable (-EV)

**Mock Implementation:**
- Currently: No fee system
- Needs: Fee collection and distribution

**Priority:** P0 (Critical)

---

## Feature Matrix Extensions

### 21. Additional Feature Declarations

**Requirement:** Extend feature matrix with additional UI features.

**Purpose:**
- Declare all possible contract features
- Enable feature-based UI rendering
- Support feature combinations
- Future-proof the system

**Additional Features:**
```solidity
// Existing features
bytes32 public constant FEATURE_BONDING_CURVE = keccak256("BONDING_CURVE");
bytes32 public constant FEATURE_LIQUIDITY_POOL = keccak256("LIQUIDITY_POOL");
bytes32 public constant FEATURE_CHAT = keccak256("CHAT");
bytes32 public constant FEATURE_BALANCE_MINT = keccak256("BALANCE_MINT");
bytes32 public constant FEATURE_PORTFOLIO = keccak256("PORTFOLIO");

// Additional features
bytes32 public constant FEATURE_MERKLE_WHITELIST = keccak256("MERKLE_WHITELIST");
bytes32 public constant FEATURE_PHASE_TRANSITIONS = keccak256("PHASE_TRANSITIONS");
bytes32 public constant FEATURE_STAKING = keccak256("STAKING");
bytes32 public constant FEATURE_GOVERNANCE = keccak256("GOVERNANCE");
bytes32 public constant FEATURE_ROYALTIES = keccak256("ROYALTIES");
bytes32 public constant FEATURE_BATCH_OPERATIONS = keccak256("BATCH_OPERATIONS");
bytes32 public constant FEATURE_TIME_LOCK = keccak256("TIME_LOCK");
bytes32 public constant FEATURE_VESTING = keccak256("VESTING");
bytes32 public constant FEATURE_MULTI_SIG = keccak256("MULTI_SIG");
bytes32 public constant FEATURE_UPGRADEABLE = keccak256("UPGRADEABLE");
```

**Use Cases:**
- Declare contract capabilities
- Render appropriate UI components
- Validate feature compatibility
- Support feature combinations

**Priority:** P1 (High)

---

### 22. Feature Dependencies

**Requirement:** Support feature dependencies and requirements.

**Purpose:**
- Ensure feature compatibility
- Validate feature combinations
- Prevent invalid configurations
- Document feature relationships

**Specification:**
```solidity
// Feature dependencies: feature -> required features
mapping(bytes32 => bytes32[]) public featureDependencies;

// Example: PHASE_TRANSITIONS requires BONDING_CURVE
featureDependencies[FEATURE_PHASE_TRANSITIONS] = [FEATURE_BONDING_CURVE];
```

**Use Cases:**
- Validate feature combinations
- Check feature requirements
- Prevent invalid configurations
- Document relationships

**Priority:** P2 (Medium)

---

## Factory Capabilities

### 23. Factory Versioning

**Requirement:** Factories must support version tracking.

**Purpose:**
   - Track factory contract versions
   - Support factory upgrades
- Enable version-based filtering
- Document factory evolution

**Specification:**
```solidity
struct FactoryInfo {
    // ... existing fields ...
    string version;             // Factory version (e.g., "1.0.0")
    address implementation;     // Implementation address (for proxies)
    bool upgradeable;           // Whether factory is upgradeable
}
```

**Use Cases:**
- Display factory version
- Filter by version
- Support factory upgrades
- Version compatibility checks

**Priority:** P2 (Medium)

---

### 24. Factory Permissions

**Requirement:** Factories must support permission and access control.

**Purpose:**
- Control who can create instances
- Support permissionless or permissioned factories
- Enable access control
- Support role-based permissions

**Specification:**
```solidity
struct FactoryPermissions {
    bool permissionless;         // Anyone can create instances
    address[] allowedCreators;  // Allowed creator addresses
    mapping(address => bool) isCreatorAllowed;
    address owner;              // Factory owner
    address[] admins;           // Factory admins
}

mapping(address => FactoryPermissions) public factoryPermissions;
```

**Use Cases:**
- Restrict instance creation
- Support permissionless factories
- Enable admin controls
- Role-based access

**Priority:** P2 (Medium)

---

## Instance Lifecycle Requirements

### 25. Instance Status/State

**Requirement:** Instances must support status tracking (active, paused, archived, etc.).

**Purpose:**
- Track instance lifecycle
- Support paused/archived instances
- Enable status-based filtering
- Display status in UI

**Specification:**
```solidity
enum InstanceStatus {
    Active,     // Normal operation
    Paused,     // Temporarily paused
    Archived,   // Archived/retired
    Suspended   // Suspended (e.g., for violations)
}

struct InstanceInfo {
    // ... existing fields ...
    InstanceStatus status;
    uint256 statusChangedAt;   // When status was last changed
    string statusReason;        // Optional reason for status change
}
```

**Use Cases:**
- Display instance status
- Filter by status
- Hide archived instances
- Show status warnings

**Priority:** P1 (High)

---

### 26. Instance Creation Timestamp

**Requirement:** Instances must store creation timestamp.

**Purpose:**
- Display creation date
- Sort by creation date
- Filter by date range
- Show project age

**Specification:**
```solidity
struct InstanceInfo {
    // ... existing fields ...
    uint256 createdAt;          // Creation timestamp
}
```

**Use Cases:**
- Display "Created: [date]" in ProjectHeader
- Sort by newest/oldest
- Filter by date range
- Show project timeline

**Mock Implementation:**
- Currently: createdAt field exists
- Needs: On-chain storage

**Priority:** P0 (Critical)

---

## Social & External Links Requirements

### 27. Social Media Links

**Requirement:** Instances must support social media link storage.

**Purpose:**
- Link to Twitter, GitHub, website
- Display social icons in UI
- Enable external navigation
- Support project promotion

**Specification:**
```solidity
struct InstanceInfo {
    // ... existing fields ...
    string websiteURI;          // Project website
    string twitterURI;           // Twitter/X link
    string githubURI;            // GitHub link
    string discordURI;          // Discord link (optional)
    string telegramURI;          // Telegram link (optional)
}
```

**Use Cases:**
- Display social icons in ProjectCard
- Link to external resources
- Social media integration
- Project promotion

**Mock Implementation:**
- Currently: Some social links in mock data
- Needs: Complete social link structure

**Priority:** P1 (High)

---

## Search & Indexing Requirements

### 28. Search Index Support

**Requirement:** Support efficient search indexing for projects.

**Purpose:**
- Enable fast project search
- Support text search
- Enable filtering
- Improve discovery

**Specification:**
```solidity
// Search index: search term hash -> instance addresses
mapping(bytes32 => address[]) public searchIndex;

// Index instance for search
function indexInstanceForSearch(address instance, string memory searchText) internal {
    // Index by name, description, tags, etc.
    bytes32 searchHash = keccak256(abi.encodePacked(searchText.toLowerCase()));
    searchIndex[searchHash].push(instance);
}
```

**Implementation Notes:**
- Search can be done off-chain for better performance
- On-chain index for critical search terms
- Consider using events for off-chain indexing
- Support full-text search off-chain

**Priority:** P2 (Medium)

---

## Revenue & Multi-Chain Requirements

### 29. Factory Revenue Sharing

**Requirement:** Factories must support revenue sharing with master contract and EXEC holders.

**Purpose:**
- Enable factory monetization
- Generate revenue for platform
- Support EXEC holder value accrual
- Align incentives between factories and platform

**Specification:**
```solidity
struct RevenueShare {
    uint256 factoryShare;       // Percentage to factory (basis points, e.g., 500 = 5%)
    uint256 platformShare;      // Percentage to platform/EXEC (basis points)
    uint256 totalRevenue;        // Total revenue collected
    uint256 lastDistribution;   // Last distribution timestamp
}

mapping(address => RevenueShare) public factoryRevenueShare;

// Default revenue split (configurable)
uint256 public constant DEFAULT_FACTORY_SHARE = 8000; // 80% to factory
uint256 public constant DEFAULT_PLATFORM_SHARE = 2000; // 20% to platform

// Revenue collection
function collectRevenue(
    address factory,
    address instance
) external payable {
    RevenueShare storage share = factoryRevenueShare[factory];
    
    uint256 factoryAmount = (msg.value * share.factoryShare) / 10000;
    uint256 platformAmount = (msg.value * share.platformShare) / 10000;
    
    // Distribute to factory
    payable(factory).transfer(factoryAmount);
    
    // Distribute platform share according to configurable distribution (Requirement #31)
    // Platform share is split between creator and EXEC holders
    distributeFees(FeeType.RevenueShare, platformAmount);
    
    share.totalRevenue += msg.value;
    share.lastDistribution = block.timestamp;
    
    emit RevenueDistributed(factory, instance, factoryAmount, platformAmount);
}

event RevenueDistributed(
    address indexed factory,
    address indexed instance,
    uint256 factoryAmount,
    uint256 platformAmount
);
```

**Use Cases:**
- Collect revenue from instance operations
- Distribute revenue to factories and platform
- Support EXEC holder value accrual
- Enable factory monetization

**Priority:** P0 (Critical)

---

### 30. Multi-Chain Support

**Requirement:** Master contract must support multiple chains with chain-specific tracking.

**Purpose:**
- Support deployments across multiple chains
- Enable cross-chain instance tracking
- Support chain-specific metadata
- Expand platform reach

**Specification:**
```solidity
// Chain-specific registries
mapping(uint256 => mapping(address => FactoryInfo)) public factoriesByChain; // chainId -> factory -> info
mapping(uint256 => mapping(address => InstanceInfo)) public instancesByChain; // chainId -> instance -> info

// Cross-chain instance tracking
struct CrossChainInstance {
    address instanceAddress;
    uint256 chainId;
    address masterContract;     // Master contract address on that chain
}

mapping(address => CrossChainInstance[]) public crossChainInstances; // instance -> chains

// Register instance on multiple chains
function registerCrossChainInstance(
    address instance,
    uint256 chainId,
    address masterContract
) external {
    crossChainInstances[instance].push(CrossChainInstance({
        instanceAddress: instance,
        chainId: chainId,
        masterContract: masterContract
    }));
    
    emit CrossChainInstanceRegistered(instance, chainId, masterContract);
}

event CrossChainInstanceRegistered(
    address indexed instance,
    uint256 chainId,
    address masterContract
);
```

**Use Cases:**
- Track instances across multiple chains
- Display chain-specific information
- Support multi-chain navigation
- Enable cross-chain discovery

**Implementation Notes:**
- Each chain has its own master contract
- Instances can exist on multiple chains
- Navigation includes chain ID
- Chain-specific metadata supported

**Priority:** P0 (Critical)

---

### 31. Configurable Fee Distribution & Governance

**Requirement:** Master contract must support configurable fee distribution between creator and EXEC holders, with governance controls to adjust the balance.

**Purpose:**
- Balance creator incentives with EXEC holder value accrual
- Enable dynamic adjustment of fee splits
- Protect against governance attacks on CULT EXEC
- Maintain flexibility to respond to market conditions
- Ensure CULT EXEC remains integral while preventing cheap takeovers

**Specification:**
```solidity
struct FeeDistribution {
    uint256 creatorShare;        // Percentage to creator (basis points, e.g., 5000 = 50%)
    uint256 execShare;           // Percentage to EXEC holders (basis points)
    uint256 lastUpdated;          // Timestamp of last update
    address updatedBy;            // Who last updated
    uint256 minExecShare;         // Minimum EXEC share (attack resistance)
    uint256 maxCreatorShare;      // Maximum creator share (attack resistance)
}

// Global fee distribution (configurable)
FeeDistribution public feeDistribution;

// Per-factory fee distribution overrides (optional)
mapping(address => FeeDistribution) public factoryFeeDistribution;

// Fee types
enum FeeType {
    ApplicationFee,      // Factory application fees
    InstanceCreationFee, // Instance creation fees
    RevenueShare         // Revenue sharing fees
}

// Different distributions for different fee types
mapping(FeeType => FeeDistribution) public feeTypeDistribution;

// Governance controls
address public creator;           // Platform creator address
address public execTreasury;      // EXEC treasury address
uint256 public minExecShareBps = 1000;  // Minimum 10% to EXEC (attack resistance)
uint256 public maxCreatorShareBps = 9000; // Maximum 90% to creator

// Time lock for fee distribution changes (attack resistance)
uint256 public constant FEE_CHANGE_TIMELOCK = 7 days;
mapping(address => uint256) public pendingFeeChanges; // address -> unlock timestamp

// Events
event FeeDistributionUpdated(
    FeeType feeType,
    uint256 creatorShare,
    uint256 execShare,
    address updatedBy
);

event FeeDistributionChangeProposed(
    FeeType feeType,
    uint256 newCreatorShare,
    uint256 newExecShare,
    uint256 unlockTimestamp
);

// Update fee distribution (with timelock)
function proposeFeeDistributionChange(
    FeeType feeType,
    uint256 newCreatorShare,
    uint256 newExecShare
) external onlyCreator {
    require(newCreatorShare + newExecShare == 10000, "Shares must sum to 100%");
    require(newExecShare >= minExecShareBps, "EXEC share below minimum");
    require(newCreatorShare <= maxCreatorShareBps, "Creator share above maximum");
    
    // Set timelock
    pendingFeeChanges[msg.sender] = block.timestamp + FEE_CHANGE_TIMELOCK;
    
    emit FeeDistributionChangeProposed(feeType, newCreatorShare, newExecShare, pendingFeeChanges[msg.sender]);
}

// Execute fee distribution change (after timelock)
function executeFeeDistributionChange(
    FeeType feeType,
    uint256 newCreatorShare,
    uint256 newExecShare
) external onlyCreator {
    require(block.timestamp >= pendingFeeChanges[msg.sender], "Timelock not expired");
    require(newCreatorShare + newExecShare == 10000, "Shares must sum to 100%");
    require(newExecShare >= minExecShareBps, "EXEC share below minimum");
    require(newCreatorShare <= maxCreatorShareBps, "Creator share above maximum");
    
    FeeDistribution storage dist = feeTypeDistribution[feeType];
    dist.creatorShare = newCreatorShare;
    dist.execShare = newExecShare;
    dist.lastUpdated = block.timestamp;
    dist.updatedBy = msg.sender;
    dist.minExecShare = minExecShareBps;
    dist.maxCreatorShare = maxCreatorShareBps;
    
    // Clear timelock
    pendingFeeChanges[msg.sender] = 0;
    
    emit FeeDistributionUpdated(feeType, newCreatorShare, newExecShare, msg.sender);
}

// Distribute fees based on current distribution
function distributeFees(
    FeeType feeType,
    uint256 totalAmount
) internal {
    FeeDistribution memory dist = feeTypeDistribution[feeType];
    
    uint256 creatorAmount = (totalAmount * dist.creatorShare) / 10000;
    uint256 execAmount = (totalAmount * dist.execShare) / 10000;
    
    // Distribute to creator
    if (creator != address(0) && creatorAmount > 0) {
        payable(creator).transfer(creatorAmount);
    }
    
    // Distribute to EXEC treasury
    if (execTreasury != address(0) && execAmount > 0) {
        payable(execTreasury).transfer(execAmount);
    }
}

// Update minimum/maximum thresholds (governance)
function updateFeeThresholds(
    uint256 newMinExecShare,
    uint256 newMaxCreatorShare
) external onlyCreator {
    require(newMinExecShare <= 5000, "Min EXEC share too high"); // Max 50%
    require(newMaxCreatorShare >= 5000, "Max creator share too low"); // Min 50%
    require(newMinExecShare + newMaxCreatorShare >= 10000, "Invalid thresholds");
    
    minExecShareBps = newMinExecShare;
    maxCreatorShareBps = newMaxCreatorShare;
    
    // Update all existing distributions to respect new thresholds
    for (uint256 i = 0; i < 3; i++) {
        FeeDistribution storage dist = feeTypeDistribution[FeeType(i)];
        if (dist.execShare < newMinExecShare) {
            dist.execShare = newMinExecShare;
            dist.creatorShare = 10000 - newMinExecShare;
        }
        if (dist.creatorShare > newMaxCreatorShare) {
            dist.creatorShare = newMaxCreatorShare;
            dist.execShare = 10000 - newMaxCreatorShare;
        }
        dist.minExecShare = newMinExecShare;
        dist.maxCreatorShare = newMaxCreatorShare;
    }
}
```

**Use Cases:**
- Adjust fee distribution based on platform needs
- Balance creator incentives with EXEC holder value
- Respond to market conditions
- Protect against governance attacks
- Maintain CULT EXEC integrality

**Implementation Notes:**
- **Attack Resistance Considerations:**
  - Minimum EXEC share prevents complete takeover
  - Maximum creator share prevents excessive centralization
  - Timelock on changes prevents sudden attacks
  - Thresholds can be adjusted but with constraints
- **CULT EXEC Protection:**
  - Minimum EXEC share ensures EXEC holders always receive value
  - Prevents cheap takeover by requiring minimum stake
  - Timelock gives EXEC holders time to respond to changes
- **Flexibility:**
  - Different fee types can have different distributions
  - Per-factory overrides allow customization
  - Governance can adjust thresholds over time
- **Balance:**
  - Creator needs incentives to build and maintain platform
  - EXEC holders need value accrual to remain integral
  - System must balance both to prevent attacks

**Security Considerations:**
- Timelock prevents sudden changes
- Minimum/maximum thresholds prevent extreme distributions
- Creator address should be multi-sig or time-locked
- Consider EXEC holder voting for major changes
- Monitor for governance attacks

**Mock Implementation:**
- Currently: No fee distribution system
- Needs: Fee distribution logic, governance controls, timelock mechanism

**Priority:** P0 (Critical)

---

## Future Requirements

### Additional Potential Requirements (To Be Confirmed)

1. **Instance Analytics Events**
   - Emit events for analytics
   - Support off-chain analytics
   - Enable data aggregation

2. **Instance Templates**
   - Pre-configured instance templates
   - Template marketplace
   - Quick instance creation

3. **Instance Collaboration**
   - Multi-creator support
   - Revenue sharing between creators
   - Collaborative projects

---

## Implementation Notes

### Mock System Alignment

The mock system should mirror these requirements:

1. ✅ Factory index (array with IDs)
2. ⚠️ Factory name collision (needs implementation)
3. ✅ Factory titles (implemented)
4. ✅ Instance names (implemented)
5. ✅ ERC1155 piece titles (implemented)
6. ⚠️ Feature matrix (needs implementation)
7. ✅ Title-based navigation (implemented)

### Contract Interface Draft

```solidity
interface IMasterRegistry {
    // Factory Management
    function registerFactory(
        address factory,
        string memory contractType,
        string memory title,
        string memory displayTitle,
        bytes32[] memory features,
        string memory metadataURI
    ) external;
    
    function getFactory(uint256 id) external view returns (address);
    function getFactoryByTitle(string memory title) external view returns (address);
    function isFactoryNameAvailable(string memory name) external view returns (bool);
    function getFactoryCount() external view returns (uint256);
    function getFactoryInfo(address factory) external view returns (FactoryInfo memory);
    
    // Feature Matrix
    function getContractFeatures(address contractAddress) external view returns (bytes32[] memory);
    function hasFeature(address contractAddress, bytes32 feature) external view returns (bool);
    function getFeatureDependencies(bytes32 feature) external view returns (bytes32[] memory);
    
    // Instance Tracking
    function registerInstance(
        address factory,
        address instance,
        string memory name,
        string memory displayName,
        string memory metadataURI,
        address creator
    ) external;
    
    function getInstanceByName(
        address factory,
        string memory name
    ) external view returns (address);
    
    function getInstanceInfo(address instance) external view returns (InstanceInfo memory);
    
    // Statistics
    function getInstanceStats(address instance) external view returns (InstanceStats memory);
    function updateInstanceStats(
        address instance,
        uint256 volume,
        uint256 holders,
        uint256 supply
    ) external;
    
    // Discovery
    function getFeaturedInstances() external view returns (address[] memory);
    function setFeatured(address instance, bool featured) external;
    
    // Creator Index
    function getCreatorProjects(address creator) external view returns (address[] memory);
    
    // Search & Filtering
    function getInstancesByTag(string memory tag) external view returns (address[] memory);
    function getInstancesByCategory(string memory category) external view returns (address[] memory);
}

// Data Structures
struct FactoryInfo {
    address factoryAddress;
    string title;
    string displayTitle;
    string contractType;
    string metadataURI;
    string description;
    string category;
    string[] tags;
    bool authorized;
    uint256 createdAt;
    uint256 instanceCount;
    string version;
    bool upgradeable;
    AuditInfo audit;
}

struct InstanceInfo {
    address instanceAddress;
    address factoryAddress;
    string name;
    string displayName;
    string metadataURI;
    string description;
    string imageURI;
    address creator;
    string creatorName;
    bool creatorVerified;
    uint256 createdAt;
    InstanceStatus status;
    bool featured;
    string[] tags;
    string category;
    string websiteURI;
    string twitterURI;
    string githubURI;
    AuditInfo audit;
    bool verified;
}

struct InstanceStats {
    uint256 totalVolume;
    uint256 holderCount;
    uint256 totalSupply;
    uint256 freeSupply;
    uint256 lastUpdated;
}

struct AuditInfo {
    bool audited;
    string auditReportURI;
    address auditor;
    uint256 auditDate;
}

enum InstanceStatus {
    Active,
    Paused,
    Archived,
    Suspended
}
```

---

## Admin Dashboard Requirements

### 32. Admin Function Discovery & Execution

**Requirement:** Instance contracts must support admin function discovery and execution through the frontend admin dashboard.

**Purpose:**
- Enable project owners to manage their contracts through a user-friendly interface
- Provide consistent admin functionality across different factory types
- Support dynamic discovery of admin functions from contract ABIs
- Allow owners to execute admin functions without using Etherscan

**Lessons Learned from Implementation:**

1. **Function Discovery:**
   - Admin functions are discovered via pattern matching on function names
   - Common patterns: `set*`, `withdraw*`, `lock*`, `unlock*`, `pause*`, `unpause*`, `update*`, `configure*`, `collect*`
   - Functions must be non-view/non-pure (state-changing)
   - ABI must be accessible for discovery

2. **Ownership Detection:**
   - Standard: `owner()` function that returns `address`
   - Edge cases: NFT ownership (e.g., cultexecs uses OPERATOR_NFT token 598)
   - Contracts should support at least one ownership detection method
   - Ownership checks should be efficient (cached when possible)

3. **Function Categories:**
   - **Settings:** `set*`, `update*`, `configure*` - Configuration changes
   - **Withdrawals:** `withdraw*`, `collect*` - Fund management
   - **Metadata:** `setMetadata*`, `updateMetadata*`, `lockMetadata*`, `unlockMetadata*` - Metadata management
   - **Access Control:** `pause*`, `unpause*`, `addAdmin*`, `removeAdmin*` - Contract state control
   - **Ownership:** `transferOwnership*`, `renounceOwnership*` - Ownership management

4. **User Experience Requirements:**
   - Current values should be readable for configuration functions (e.g., `configure` should expose `uri()`, `unrevealedUri()`, `revealed()`)
   - Forms should pre-fill with current values when possible
   - Boolean parameters should use dropdowns, not text inputs
   - Payable functions need ETH value input
   - Clear error messages for failed executions

**Specification:**

```solidity
// Standard ownership function (recommended)
function owner() external view returns (address);

// Example: Configuration function with readable current values
function configure(
    string memory _uri,
    string memory _unrevealedUri,
    bool _revealed
) external onlyOwner;

// Readable current values (for UX)
function uri() external view returns (string memory);
function unrevealedUri() external view returns (string memory);
function revealed() external view returns (bool);

// Example: Withdrawal function
function withdraw() external onlyOwner;

// Example: Metadata management
function setMetadata(string memory _metadataURI) external onlyOwner;
function lockMetadata() external onlyOwner;
function unlockMetadata() external onlyOwner;

// Example: Access control
function pause() external onlyOwner;
function unpause() external onlyOwner;
```

**Contract Requirements:**

1. **ABI Accessibility:**
   - Contract ABI must be available (via verification or static file)
   - Functions must have clear, descriptive names
   - Function parameters should have meaningful names (not just `param1`, `param2`)

2. **Function Naming Conventions:**
   - Use standard prefixes: `set*`, `update*`, `configure*`, `withdraw*`, `collect*`, `lock*`, `unlock*`, `pause*`, `unpause*`
   - Avoid generic names like `adminFunction()` or `doSomething()`
   - Use descriptive names: `setStyle()`, `withdrawFunds()`, `lockMetadata()`

3. **Readable State Functions:**
   - For configuration functions, provide view functions to read current values
   - Example: If you have `configure(uri, unrevealedUri, revealed)`, also provide:
     - `uri() view returns (string)`
     - `unrevealedUri() view returns (string)`
     - `revealed() view returns (bool)`

4. **Ownership Detection:**
   - **Standard (Recommended):** Implement `owner() external view returns (address)`
   - **Alternative:** Document NFT ownership pattern if used (e.g., "Ownership determined by OPERATOR_NFT token 598")
   - Ownership checks should be gas-efficient

5. **Function Documentation:**
   - Use NatSpec comments (`/// @notice`, `/// @dev`, `/// @param`)
   - Document which functions are admin-only
   - Document parameter types and expected values

6. **Error Handling:**
   - Use descriptive error messages (e.g., `"Not oper"` → `"Caller is not the operator"`)
   - Revert with clear reasons for failures

**Mock System Requirements:**

1. **Mock Admin Functions:**
   - Mock contracts should simulate common admin functions:
     - `setStyle(string)`
     - `setMetadata(string)`
     - `updateMetadata(string)`
     - `lockMetadata()`
     - `unlockMetadata()`
     - `withdraw()`
     - `pause()`
     - `unpause()`

2. **Mock Ownership:**
   - Mock instances should have an `owner` field
   - Default owner: `0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6` (for testing)
   - Ownership should be checkable via `owner()` function simulation

3. **Mock Admin State:**
   - Store admin state per instance:
     - `metadataLocked: bool`
     - `style: string`
     - `metadata: string`
     - `paused: bool`
     - `balance: string` (for withdrawal testing)

**Frontend Requirements:**

1. **Admin Button Visibility:**
   - Only visible to contract owners
   - Should appear on project detail pages and edition pages (ERC1155)
   - Should be styled consistently with the design system

2. **Function Discovery:**
   - Load ABI from contract or static file
   - Pattern match function names against admin patterns
   - Group functions by category
   - Display functions in organized list

3. **Function Execution:**
   - Parse parameters based on ABI types
   - Convert string inputs to proper types (uint256, bool, address, etc.)
   - Handle payable functions with ETH value
   - Show transaction status and results
   - Handle errors gracefully

4. **Special Function UIs:**
   - Configuration functions: Show current values before editing
   - Withdrawal functions: Show available balance
   - Boolean parameters: Use dropdowns (True/False)
   - String parameters: Use text inputs with current value hints

**Priority:** P0 (Critical)

**Status:** Implemented in frontend, requirements documented for contract development

---

### 33. Admin Function Parameter Types & Validation

**Requirement:** Admin functions must use standard Solidity types that can be easily parsed and validated by the frontend.

**Purpose:**
- Ensure frontend can properly convert user input to contract parameters
- Prevent execution errors due to type mismatches
- Provide clear validation feedback to users

**Supported Types:**
- `uint256`, `uint128`, `uint64`, `uint32`, `uint8` - Integer types
- `int256`, `int128`, etc. - Signed integers
- `bool` - Boolean values
- `address` - Ethereum addresses
- `string` - String values
- `bytes` - Byte arrays
- Arrays of above types

**Validation Requirements:**
- Integer inputs must be valid numbers
- Address inputs must be valid Ethereum addresses (checksummed)
- Boolean inputs should use dropdowns, not free text
- String inputs should have length limits where appropriate
- Array inputs should support comma-separated or multi-line input

**Priority:** P1 (High)

---

## Update Log

**2024 - Initial Requirements:**
- Factory index mapping (int -> address)
- Factory name collision resistance
- Website feature matrix system
- Factory and instance title/name storage
- ERC1155 piece titles
- Title-based navigation support

**2024 - Comprehensive Feature Brainstorming:**
- Added 19 new requirements across 8 categories:
  - **Metadata & Content (3):** Factory/Instance metadata URIs, creator information
  - **Statistics & Analytics (2):** Instance and factory statistics tracking
  - **Discovery & Search (3):** Featured projects, categories/tags
  - **Validation & Safety (3):** Audit status, verification, creation limits
  - **Feature Matrix Extensions (2):** Additional features, feature dependencies
  - **Factory Capabilities (2):** Versioning, permissions
  - **Instance Lifecycle (2):** Status tracking, creation timestamps
  - **Social & External Links (1):** Social media links
  - **Search & Indexing (1):** Search index support

**2024 - Core Platform Features:**
- Added 6 critical requirements:
  - **Factory Application System (#1):** Application workflow with EXEC participation and fees
  - **Expandable Feature System (#8):** Dynamic feature registration for new factories
  - **Multi-Chain Navigation (#9):** Chain ID in navigation paths
  - **Custom CSS/JS Support:** Factory and instance custom assets (opt-in only)
  - **Factory Revenue Sharing (#29):** Revenue distribution to factories and platform
  - **Multi-Chain Support (#30):** Cross-chain instance tracking
  - **Configurable Fee Distribution (#31):** Creator vs EXEC fee splits with governance and attack resistance

**2024 - Admin Dashboard Implementation:**
- Added 2 new requirements:
  - **Admin Function Discovery & Execution (#32):** Complete admin dashboard system with function discovery, ownership detection, and execution
  - **Admin Function Parameter Types & Validation (#33):** Standard parameter types and validation requirements
- Key learnings documented:
  - Function discovery via pattern matching (set*, withdraw*, configure*, etc.)
  - Ownership detection methods (standard owner() vs NFT ownership edge cases)
  - Function categorization (settings, withdrawals, metadata, access control, ownership)
  - UX requirements (current value display, pre-filled forms, boolean dropdowns)
  - Contract requirements (ABI accessibility, naming conventions, readable state functions)
  - Mock system requirements (simulated admin functions, ownership, state management)
- Updated existing requirements:
  - **Statistics (#13):** Clarified per-factory metrics (volume, mint completion, purchases)
  - **Verification (#19):** Made mandatory for contract acceptance
  - **Instance Creation (#20):** Changed from limits to fees (spam prevention via economics)

**Priority Breakdown:**
- **P0 (Critical - 10):** Factory application system, instance metadata URI, instance statistics, creation timestamp, contract verification (mandatory), instance creation fees, factory revenue sharing, multi-chain support, configurable fee distribution, admin function discovery & execution
- **P1 (High - 10):** Expandable features, factory metadata, creator info, featured projects, audit status, instance status, social links, additional features, custom CSS/JS, admin function parameter types & validation
- **P2 (Medium - 8):** Factory stats, categories/tags, feature dependencies, versioning, permissions, search index

**Next Steps:**
- ✅ Admin dashboard implemented in frontend
- ✅ Admin function discovery system working
- ✅ Mock admin functions implemented
- ✅ Ownership detection system in place
- Implement feature matrix in mock system
- Add feature checking to components
- Implement statistics tracking
- Add metadata structures to mock data
- Update mock services with new requirements
- Refine contract interface based on frontend needs
- **Contract Development:** Implement admin functions following requirements #32 and #33
- **Testing:** Test admin dashboard with real contracts (cultexecs is working example)
- Prioritize P0 requirements for MVP

---

**Document Version:** 1.0  
**Status:** Active - Continuously Updated  
**Maintainer:** Development Team

