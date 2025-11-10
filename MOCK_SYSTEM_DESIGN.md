# Mock System Design
## Simulating Master Contract, Factories, and Instances

**Purpose:** Design a mock system that simulates the on-chain master contract and factory system, allowing frontend development before contracts are deployed.

---

## Table of Contents

1. [Overview](#overview)
2. [Mock Data Structure](#mock-data-structure)
3. [Mock Master Contract](#mock-master-contract)
4. [Mock Factory Contracts](#mock-factory-contracts)
5. [Mock Instance Registry](#mock-instance-registry)
6. [Mock Service Layer](#mock-service-layer)
7. [Integration with Existing Code](#integration-with-existing-code)
8. [Migration Path](#migration-path)

---

## Overview

### Strategy

Instead of waiting for on-chain contracts, we'll build a **mock system** that:
1. Simulates master contract interface
2. Simulates factory contract interfaces
3. Stores mock project data
4. Provides same API as real services will have
5. Easy to swap for real contracts when ready

### Benefits

- ✅ Build frontend immediately
- ✅ Test UI/UX without contracts
- ✅ Understand contract interface requirements
- ✅ Design system based on frontend needs
- ✅ Working prototypes before deployment

### Implementation Approach

- **In-Memory Storage:** Fast, no persistence needed during development
- **localStorage Backup:** Optional persistence across sessions
- **Same Interface:** Mock services match real service interfaces
- **Feature Flag:** Easy switch between mock/real

---

## Mock Data Structure

### Core Data Model

```javascript
{
    // Master Contract State
    masterContract: {
        address: '0xMASTER...', // Mock address
        owner: '0xOWNER...',     // Mock owner
        factories: [
            {
                address: '0xFACTORY1...',
                type: 'ERC404',
                authorized: true,
                createdAt: timestamp,
                instanceCount: 5
            },
            {
                address: '0xFACTORY2...',
                type: 'ERC1155',
                authorized: true,
                createdAt: timestamp,
                instanceCount: 3
            }
        ]
    },
    
    // Factory Instances
    factories: {
        '0xFACTORY1...': {
            address: '0xFACTORY1...',
            type: 'ERC404',
            masterAddress: '0xMASTER...',
            instances: [
                '0xINSTANCE1...',
                '0xINSTANCE2...',
                // ...
            ],
            createdAt: timestamp
        },
        '0xFACTORY2...': {
            address: '0xFACTORY2...',
            type: 'ERC1155',
            masterAddress: '0xMASTER...',
            instances: [
                '0xINSTANCE3...',
                '0xINSTANCE4...',
                // ...
            ],
            createdAt: timestamp
        }
    },
    
    // Project Instances
    instances: {
        '0xINSTANCE1...': {
            id: 'project-1',
            address: '0xINSTANCE1...',
            factoryAddress: '0xFACTORY1...',
            contractType: 'ERC404',
            name: 'Example ERC404 Project',
            symbol: 'EXMP',
            description: 'An example ERC404 project',
            metadataURI: 'ipfs://...',
            creator: '0xCREATOR...',
            createdAt: timestamp,
            parameters: {
                // ERC404-specific parameters
                bondingCurveParams: {...},
                merkleRoot: '0x...',
                // ...
            },
            stats: {
                totalSupply: 1000000,
                holders: 150,
                volume: '50.5 ETH',
                // ...
            }
        },
        '0xINSTANCE3...': {
            id: 'project-2',
            address: '0xINSTANCE3...',
            factoryAddress: '0xFACTORY2...',
            contractType: 'ERC1155',
            name: 'Example ERC1155 Project',
            symbol: 'EXMP2',
            description: 'An example ERC1155 project',
            metadataURI: 'ipfs://...',
            creator: '0xCREATOR...',
            createdAt: timestamp,
            parameters: {
                // ERC1155-specific parameters
                maxEditions: 100,
                // ...
            },
            stats: {
                totalEditions: 10,
                totalMinted: 500,
                volume: '25.2 ETH',
                // ...
            }
        }
    },
    
    // Project Metadata Index
    projectIndex: {
        byType: {
            'ERC404': ['0xINSTANCE1...', '0xINSTANCE2...'],
            'ERC1155': ['0xINSTANCE3...', '0xINSTANCE4...']
        },
        byFactory: {
            '0xFACTORY1...': ['0xINSTANCE1...', '0xINSTANCE2...'],
            '0xFACTORY2...': ['0xINSTANCE3...', '0xINSTANCE4...']
        },
        byCreator: {
            '0xCREATOR...': ['0xINSTANCE1...', '0xINSTANCE3...']
        },
        all: ['0xINSTANCE1...', '0xINSTANCE2...', '0xINSTANCE3...', '0xINSTANCE4...']
    }
}
```

---

## Mock Master Contract

### Interface (IMasterRegistry)

```javascript
interface IMasterRegistry {
    // Factory Management
    registerFactory(address factory, string contractType): void
    isFactoryAuthorized(address factory): boolean
    getFactoryType(address factory): string
    revokeFactory(address factory): void
    
    // Factory Listing
    getAuthorizedFactories(): address[]
    getFactoriesByType(string contractType): address[]
    
    // Instance Tracking
    registerInstance(address factory, address instance, string metadataURI): void
    getInstancesByFactory(address factory): address[]
    getInstanceMetadata(address instance): string
    getAllInstances(): address[]
}
```

### Mock Implementation

**Location:** `src/services/mock/MockMasterService.js`

```javascript
class MockMasterService {
    constructor(mockData) {
        this.data = mockData;
        this.masterAddress = '0xMASTER0000000000000000000000000000000000';
    }
    
    // Factory Management
    async registerFactory(factoryAddress, contractType) {
        // Check if already registered
        if (this.data.masterContract.factories.find(f => f.address === factoryAddress)) {
            throw new Error('Factory already registered');
        }
        
        // Add factory
        this.data.masterContract.factories.push({
            address: factoryAddress,
            type: contractType,
            authorized: true,
            createdAt: Date.now(),
            instanceCount: 0
        });
        
        // Initialize factory entry
        this.data.factories[factoryAddress] = {
            address: factoryAddress,
            type: contractType,
            masterAddress: this.masterAddress,
            instances: [],
            createdAt: Date.now()
        };
        
        this._save();
    }
    
    async isFactoryAuthorized(factoryAddress) {
        const factory = this.data.masterContract.factories.find(
            f => f.address === factoryAddress
        );
        return factory ? factory.authorized : false;
    }
    
    async getFactoryType(factoryAddress) {
        const factory = this.data.masterContract.factories.find(
            f => f.address === factoryAddress
        );
        return factory ? factory.type : null;
    }
    
    async getAuthorizedFactories() {
        return this.data.masterContract.factories
            .filter(f => f.authorized)
            .map(f => f.address);
    }
    
    async getFactoriesByType(contractType) {
        return this.data.masterContract.factories
            .filter(f => f.type === contractType && f.authorized)
            .map(f => f.address);
    }
    
    // Instance Tracking
    async registerInstance(factoryAddress, instanceAddress, metadataURI) {
        // Verify factory is authorized
        if (!await this.isFactoryAuthorized(factoryAddress)) {
            throw new Error('Factory not authorized');
        }
        
        // Add instance to factory
        if (!this.data.factories[factoryAddress]) {
            throw new Error('Factory not found');
        }
        
        this.data.factories[factoryAddress].instances.push(instanceAddress);
        
        // Update factory instance count
        const factory = this.data.masterContract.factories.find(
            f => f.address === factoryAddress
        );
        if (factory) {
            factory.instanceCount++;
        }
        
        this._save();
    }
    
    async getInstancesByFactory(factoryAddress) {
        const factory = this.data.factories[factoryAddress];
        return factory ? factory.instances : [];
    }
    
    async getAllInstances() {
        const allInstances = [];
        for (const factory of Object.values(this.data.factories)) {
            allInstances.push(...factory.instances);
        }
        return allInstances;
    }
    
    // Persistence
    _save() {
        try {
            localStorage.setItem('mockMasterData', JSON.stringify(this.data));
        } catch (error) {
            console.warn('Failed to save mock data to localStorage:', error);
        }
    }
    
    _load() {
        try {
            const saved = localStorage.getItem('mockMasterData');
            if (saved) {
                this.data = JSON.parse(saved);
            }
        } catch (error) {
            console.warn('Failed to load mock data from localStorage:', error);
        }
    }
}
```

---

## Mock Factory Contracts

### Interface (IFactory)

```javascript
interface IFactory {
    // Instance Creation
    createInstance(
        string name,
        string symbol,
        bytes parameters
    ): address
    
    // Instance Management
    getInstances(): address[]
    getInstanceCount(): uint256
    getInstanceParameters(address instance): bytes
    
    // Factory Info
    getFactoryType(): string
    getMasterRegistry(): address
}
```

### Mock Implementation

**Location:** `src/services/mock/MockFactoryService.js`

```javascript
class MockFactoryService {
    constructor(mockData, masterService) {
        this.data = mockData;
        this.masterService = masterService;
    }
    
    async createInstance(factoryAddress, name, symbol, parameters) {
        // Verify factory exists
        if (!this.data.factories[factoryAddress]) {
            throw new Error('Factory not found');
        }
        
        // Generate mock instance address
        const instanceAddress = this._generateMockAddress();
        
        // Create instance entry
        const factory = this.data.factories[factoryAddress];
        const instance = {
            id: `project-${Date.now()}`,
            address: instanceAddress,
            factoryAddress: factoryAddress,
            contractType: factory.type,
            name: name,
            symbol: symbol,
            description: parameters.description || '',
            metadataURI: parameters.metadataURI || '',
            creator: parameters.creator || '0xCREATOR...',
            createdAt: Date.now(),
            parameters: parameters,
            stats: {
                totalSupply: 0,
                holders: 0,
                volume: '0 ETH'
            }
        };
        
        // Add to instances
        this.data.instances[instanceAddress] = instance;
        
        // Add to factory
        factory.instances.push(instanceAddress);
        
        // Register with master
        await this.masterService.registerInstance(
            factoryAddress,
            instanceAddress,
            instance.metadataURI
        );
        
        // Update index
        this._updateIndex(instance);
        
        this._save();
        
        return instanceAddress;
    }
    
    async getInstances(factoryAddress) {
        const factory = this.data.factories[factoryAddress];
        return factory ? factory.instances : [];
    }
    
    async getInstanceCount(factoryAddress) {
        const factory = this.data.factories[factoryAddress];
        return factory ? factory.instances.length : 0;
    }
    
    async getFactoryType(factoryAddress) {
        const factory = this.data.factories[factoryAddress];
        return factory ? factory.type : null;
    }
    
    _generateMockAddress() {
        // Generate a mock Ethereum address
        const random = Math.random().toString(16).substring(2, 42);
        return `0x${random.padStart(40, '0')}`;
    }
    
    _updateIndex(instance) {
        // Update project index
        const type = instance.contractType;
        if (!this.data.projectIndex.byType[type]) {
            this.data.projectIndex.byType[type] = [];
        }
        this.data.projectIndex.byType[type].push(instance.address);
        
        if (!this.data.projectIndex.byFactory[instance.factoryAddress]) {
            this.data.projectIndex.byFactory[instance.factoryAddress] = [];
        }
        this.data.projectIndex.byFactory[instance.factoryAddress].push(instance.address);
        
        if (!this.data.projectIndex.byCreator[instance.creator]) {
            this.data.projectIndex.byCreator[instance.creator] = [];
        }
        this.data.projectIndex.byCreator[instance.creator].push(instance.address);
        
        this.data.projectIndex.all.push(instance.address);
    }
    
    _save() {
        try {
            localStorage.setItem('mockFactoryData', JSON.stringify(this.data));
        } catch (error) {
            console.warn('Failed to save mock data:', error);
        }
    }
}
```

---

## Mock Instance Registry

### Purpose

Manages project metadata, indexing, and discovery.

### Implementation

**Location:** `src/services/mock/MockProjectRegistry.js`

```javascript
class MockProjectRegistry {
    constructor(mockData) {
        this.data = mockData;
        this.indexed = false;
    }
    
    // Indexing
    async indexFromMaster() {
        // Index all instances from master contract
        const allInstances = await this.masterService.getAllInstances();
        
        for (const instanceAddress of allInstances) {
            const instance = this.data.instances[instanceAddress];
            if (instance) {
                this._updateIndex(instance);
            }
        }
        
        this.indexed = true;
        this._save();
    }
    
    async indexFromFactory(factoryAddress) {
        const instances = await this.factoryService.getInstances(factoryAddress);
        
        for (const instanceAddress of instances) {
            const instance = this.data.instances[instanceAddress];
            if (instance) {
                this._updateIndex(instance);
            }
        }
        
        this._save();
    }
    
    // Project Discovery
    async searchProjects(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();
        
        for (const instance of Object.values(this.data.instances)) {
            if (
                instance.name.toLowerCase().includes(lowerQuery) ||
                instance.description.toLowerCase().includes(lowerQuery) ||
                instance.symbol.toLowerCase().includes(lowerQuery)
            ) {
                results.push(instance);
            }
        }
        
        return results;
    }
    
    async filterByType(contractType) {
        const addresses = this.data.projectIndex.byType[contractType] || [];
        return addresses.map(addr => this.data.instances[addr]).filter(Boolean);
    }
    
    async filterByFactory(factoryAddress) {
        const addresses = this.data.projectIndex.byFactory[factoryAddress] || [];
        return addresses.map(addr => this.data.instances[addr]).filter(Boolean);
    }
    
    async filterByCreator(creatorAddress) {
        const addresses = this.data.projectIndex.byCreator[creatorAddress] || [];
        return addresses.map(addr => this.data.instances[addr]).filter(Boolean);
    }
    
    async sortBy(sortKey, projects) {
        const sorted = [...projects];
        
        switch (sortKey) {
            case 'date':
                sorted.sort((a, b) => b.createdAt - a.createdAt);
                break;
            case 'volume':
                sorted.sort((a, b) => {
                    const volA = parseFloat(a.stats.volume) || 0;
                    const volB = parseFloat(b.stats.volume) || 0;
                    return volB - volA;
                });
                break;
            case 'name':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            default:
                // Default: by date
                sorted.sort((a, b) => b.createdAt - a.createdAt);
        }
        
        return sorted;
    }
    
    async getProject(instanceAddress) {
        return this.data.instances[instanceAddress] || null;
    }
    
    async getAllProjects() {
        return Object.values(this.data.instances);
    }
    
    _updateIndex(instance) {
        // Same as in MockFactoryService
        // ...
    }
    
    _save() {
        try {
            localStorage.setItem('mockRegistryData', JSON.stringify(this.data));
        } catch (error) {
            console.warn('Failed to save mock data:', error);
        }
    }
}
```

---

## Mock Service Layer

### Service Architecture

```
MockMasterService
    ├── Manages factory authorization
    ├── Tracks factory types
    └── Registers instances

MockFactoryService
    ├── Creates instances
    ├── Manages factory instances
    └── Returns instance lists

MockProjectRegistry
    ├── Indexes projects
    ├── Search and filter
    └── Project metadata management
```

### Initialization

**Location:** `src/services/mock/MockServiceManager.js`

```javascript
class MockServiceManager {
    constructor() {
        this.data = this._initializeMockData();
        this.masterService = new MockMasterService(this.data);
        this.factoryService = new MockFactoryService(this.data, this.masterService);
        this.projectRegistry = new MockProjectRegistry(this.data);
        
        // Seed with example data
        this._seedExampleData();
    }
    
    _initializeMockData() {
        return {
            masterContract: {
                address: '0xMASTER0000000000000000000000000000000000',
                owner: '0xOWNER0000000000000000000000000000000000',
                factories: []
            },
            factories: {},
            instances: {},
            projectIndex: {
                byType: {},
                byFactory: {},
                byCreator: {},
                all: []
            }
        };
    }
    
    _seedExampleData() {
        // Create example factories
        const erc404Factory = '0xFACTORY4040000000000000000000000000000000';
        const erc1155Factory = '0xFACTORY1155000000000000000000000000000000';
        
        // Register factories
        this.masterService.registerFactory(erc404Factory, 'ERC404');
        this.masterService.registerFactory(erc1155Factory, 'ERC1155');
        
        // Create example instances
        this.factoryService.createInstance(
            erc404Factory,
            'Example ERC404',
            'EXMP',
            {
                description: 'An example ERC404 project',
                metadataURI: 'ipfs://...',
                creator: '0xCREATOR...'
            }
        );
        
        this.factoryService.createInstance(
            erc1155Factory,
            'Example ERC1155',
            'EXMP2',
            {
                description: 'An example ERC1155 project',
                metadataURI: 'ipfs://...',
                creator: '0xCREATOR...'
            }
        );
        
        // Index projects
        this.projectRegistry.indexFromMaster();
    }
    
    getMasterService() {
        return this.masterService;
    }
    
    getFactoryService() {
        return this.factoryService;
    }
    
    getProjectRegistry() {
        return this.projectRegistry;
    }
}
```

---

## Integration with Existing Code

### Feature Flag

**Location:** `src/config.js` or environment variable

```javascript
export const USE_MOCK_SERVICES = true; // Set to false when contracts are ready
```

### Service Factory

**Location:** `src/services/ServiceFactory.js`

```javascript
import { MockServiceManager } from './mock/MockServiceManager.js';
import { MasterService } from './MasterService.js'; // Real service (future)
import { FactoryService } from './FactoryService.js'; // Real service (future)
import { ProjectRegistry } from './ProjectRegistry.js'; // Real service (future)

class ServiceFactory {
    constructor() {
        this.useMock = USE_MOCK_SERVICES;
        
        if (this.useMock) {
            this.mockManager = new MockServiceManager();
        }
    }
    
    getMasterService() {
        if (this.useMock) {
            return this.mockManager.getMasterService();
        } else {
            return new MasterService(); // Real service
        }
    }
    
    getFactoryService() {
        if (this.useMock) {
            return this.mockManager.getFactoryService();
        } else {
            return new FactoryService(); // Real service
        }
    }
    
    getProjectRegistry() {
        if (this.useMock) {
            return this.mockManager.getProjectRegistry();
        } else {
            return new ProjectRegistry(); // Real service
        }
    }
}

export const serviceFactory = new ServiceFactory();
```

### Usage in Components

```javascript
import { serviceFactory } from '../services/ServiceFactory.js';

// In component
const masterService = serviceFactory.getMasterService();
const factories = await masterService.getAuthorizedFactories();

const projectRegistry = serviceFactory.getProjectRegistry();
const projects = await projectRegistry.getAllProjects();
```

---

## Migration Path

### Phase 1: Mock System (Current)
- ✅ Use mock services
- ✅ Build frontend with mocks
- ✅ Test UI/UX

### Phase 2: Real Service Development
- Create real MasterService
- Create real FactoryService
- Create real ProjectRegistry
- Match mock interfaces

### Phase 3: Integration
- Add feature flag
- Test with real contracts
- Switch feature flag to false
- Remove mock services (optional)

### Migration Checklist

- [ ] Real contracts deployed
- [ ] Real services implemented
- [ ] Interfaces match mock services
- [ ] Feature flag added
- [ ] Tested with real contracts
- [ ] Feature flag switched to false
- [ ] Mock services removed (optional)

---

## Example Usage

### Creating a Project

```javascript
const factoryService = serviceFactory.getFactoryService();
const factoryAddress = '0xFACTORY404...';

const instanceAddress = await factoryService.createInstance(
    factoryAddress,
    'My Project',
    'MYPRJ',
    {
        description: 'My awesome project',
        metadataURI: 'ipfs://...',
        creator: userAddress,
        // ERC404-specific parameters
        bondingCurveParams: {...}
    }
);

console.log('Project created:', instanceAddress);
```

### Discovering Projects

```javascript
const projectRegistry = serviceFactory.getProjectRegistry();

// Get all projects
const allProjects = await projectRegistry.getAllProjects();

// Search
const results = await projectRegistry.searchProjects('example');

// Filter by type
const erc404Projects = await projectRegistry.filterByType('ERC404');

// Sort by volume
const sorted = await projectRegistry.sortBy('volume', allProjects);
```

### Getting Factory Information

```javascript
const masterService = serviceFactory.getMasterService();

// Get all factories
const factories = await masterService.getAuthorizedFactories();

// Get factories by type
const erc404Factories = await masterService.getFactoriesByType('ERC404');

// Get instances from factory
const factoryService = serviceFactory.getFactoryService();
const instances = await factoryService.getInstances(factoryAddress);
```

---

## Next Steps

1. ✅ **Design complete** (this document)
2. ⏭️ **Implement MockMasterService**
3. ⏭️ **Implement MockFactoryService**
4. ⏭️ **Implement MockProjectRegistry**
5. ⏭️ **Implement MockServiceManager**
6. ⏭️ **Create ServiceFactory**
7. ⏭️ **Seed with example data**
8. ⏭️ **Test mock system**

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Status:** Design Complete, Ready for Implementation

