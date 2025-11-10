# Implementation Roadmap
## Phased Approach to Launchpad Transition

**Purpose:** Detailed phased implementation plan for transitioning ms2.fun to a multi-project launchpad.

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Mock System Foundation](#phase-1-mock-system-foundation)
3. [Phase 2: Frontend with Mocks](#phase-2-frontend-with-mocks)
4. [Phase 3: Service Abstraction](#phase-3-service-abstraction)
5. [Phase 4: State Management Migration](#phase-4-state-management-migration)
6. [Phase 5: ERC1155 Support](#phase-5-erc1155-support)
6. [Phase 6: Factory Integration](#phase-6-factory-integration)
7. [Testing Strategy](#testing-strategy)
8. [Success Criteria](#success-criteria)

---

## Overview

### Strategy: Mock-First Development

Build the frontend using mock services first, then integrate with real contracts when ready.

**Benefits:**
- ✅ Frontend development can start immediately
- ✅ UI/UX can be tested without contracts
- ✅ Contract interface requirements become clear
- ✅ Easy to swap mock → real when ready

### Phases Overview

```
Phase 1: Mock System (Week 1-2)
    └── Build mock services, seed data

Phase 2: Frontend (Week 3-4)
    └── Build UI with mocks, test UX

Phase 3: Service Abstraction (Week 5-6)
    └── Create ProjectService, adapters

Phase 4: State Management (Week 7-8)
    └── Migrate to ProjectStore

Phase 5: ERC1155 (Week 9-10)
    └── Add ERC1155 support

Phase 6: Factory Integration (Week 11-12)
    └── Integrate real contracts, deploy
```

---

## Phase 1: Mock System Foundation

**Duration:** Week 1-2  
**Goal:** Build mock system that simulates master contract and factories

### Tasks

#### 1.1 Create Mock Data Structure
- [ ] Design mock data schema
- [ ] Create initial mock data
- [ ] Add localStorage persistence
- [ ] Add data seeding utilities

**Files:**
- `src/services/mock/mockData.js`
- `src/services/mock/dataSeeder.js`

#### 1.2 Implement MockMasterService
- [ ] Create MockMasterService class
- [ ] Implement factory registration
- [ ] Implement factory authorization
- [ ] Implement instance tracking
- [ ] Add persistence

**Files:**
- `src/services/mock/MockMasterService.js`

**Interface:**
```javascript
class MockMasterService {
    async registerFactory(address, contractType)
    async isFactoryAuthorized(address)
    async getFactoryType(address)
    async getAuthorizedFactories()
    async getFactoriesByType(contractType)
    async registerInstance(factoryAddress, instanceAddress, metadataURI)
    async getInstancesByFactory(factoryAddress)
    async getAllInstances()
}
```

#### 1.3 Implement MockFactoryService
- [ ] Create MockFactoryService class
- [ ] Implement instance creation
- [ ] Implement instance listing
- [ ] Add factory type support
- [ ] Add persistence

**Files:**
- `src/services/mock/MockFactoryService.js`

**Interface:**
```javascript
class MockFactoryService {
    async createInstance(factoryAddress, name, symbol, parameters)
    async getInstances(factoryAddress)
    async getInstanceCount(factoryAddress)
    async getFactoryType(factoryAddress)
}
```

#### 1.4 Implement MockProjectRegistry
- [ ] Create MockProjectRegistry class
- [ ] Implement project indexing
- [ ] Implement search functionality
- [ ] Implement filtering
- [ ] Implement sorting
- [ ] Add persistence

**Files:**
- `src/services/mock/MockProjectRegistry.js`

**Interface:**
```javascript
class MockProjectRegistry {
    async indexFromMaster()
    async indexFromFactory(factoryAddress)
    async searchProjects(query)
    async filterByType(contractType)
    async filterByFactory(factoryAddress)
    async sortBy(sortKey, projects)
    async getProject(instanceAddress)
    async getAllProjects()
}
```

#### 1.5 Create MockServiceManager
- [ ] Create service manager
- [ ] Initialize all mock services
- [ ] Seed example data
- [ ] Add service getters

**Files:**
- `src/services/mock/MockServiceManager.js`

#### 1.6 Create ServiceFactory
- [ ] Create service factory pattern
- [ ] Add feature flag support
- [ ] Implement mock/real switching
- [ ] Add service getters

**Files:**
- `src/services/ServiceFactory.js`
- `src/config.js` (feature flags)

#### 1.7 Seed Example Data
- [ ] Create example factories (ERC404, ERC1155)
- [ ] Create example projects
- [ ] Add realistic metadata
- [ ] Test data structure

**Files:**
- `src/services/mock/exampleData.js`

### Deliverables

- ✅ Mock master contract service
- ✅ Mock factory services
- ✅ Mock project registry
- ✅ Service factory with feature flag
- ✅ Seeded example data
- ✅ localStorage persistence

### Testing

- [ ] Test factory registration
- [ ] Test instance creation
- [ ] Test project indexing
- [ ] Test search and filter
- [ ] Test data persistence
- [ ] Test service switching

---

## Phase 2: Frontend with Mocks

**Duration:** Week 3-4  
**Goal:** Build frontend UI using mock services

### Tasks

#### 2.1 Enhance Router
- [ ] Add dynamic route support (`/project/:id`)
- [ ] Add route parameter extraction
- [ ] Add route guards (optional)
- [ ] Test dynamic routing

**Files:**
- `src/core/Router.js`

**Enhancements:**
```javascript
router.on('/project/:id', renderProjectDetail);
router.on('/factory/:id', renderFactoryDetail);
router.on('/create', renderProjectCreation);
```

#### 2.2 Build ProjectDiscovery Component
- [ ] Create ProjectDiscovery component
- [ ] Add project grid/list view
- [ ] Add search bar
- [ ] Add filter sidebar
- [ ] Add sort dropdown
- [ ] Add pagination
- [ ] Add featured projects section

**Files:**
- `src/components/ProjectDiscovery/ProjectDiscovery.js`
- `src/components/ProjectDiscovery/ProjectCard.js`
- `src/components/ProjectDiscovery/ProjectFilters.js`
- `src/components/ProjectDiscovery/ProjectSearch.js`

#### 2.3 Build ProjectDetail Component
- [ ] Create ProjectDetail component
- [ ] Add project header (name, image, stats)
- [ ] Add contract type detection
- [ ] Add contract type router
- [ ] Add loading/error states
- [ ] Add project metadata display

**Files:**
- `src/components/ProjectDetail/ProjectDetail.js`
- `src/components/ProjectDetail/ProjectHeader.js`
- `src/components/ProjectDetail/ContractTypeRouter.js`

#### 2.4 Update HomePage
- [ ] Integrate ProjectDiscovery
- [ ] Add project browsing
- [ ] Add search functionality
- [ ] Add navigation to project detail

**Files:**
- `src/routes/HomePage.js`

#### 2.5 Create ProjectDetail Route
- [ ] Create ProjectDetail route handler
- [ ] Load project from registry
- [ ] Render appropriate interface
- [ ] Handle loading/error states

**Files:**
- `src/routes/ProjectDetail.js`

#### 2.6 Create FactoryDetail Route
- [ ] Create FactoryDetail route handler
- [ ] Display factory information
- [ ] List factory instances
- [ ] Add instance creation link

**Files:**
- `src/routes/FactoryDetail.js`

#### 2.7 Create ProjectCreation Route
- [ ] Create ProjectCreation route handler
- [ ] Add factory selection
- [ ] Add parameter form
- [ ] Add deployment flow (mock)

**Files:**
- `src/routes/ProjectCreation.js`

### Deliverables

- ✅ Enhanced router with dynamic routes
- ✅ ProjectDiscovery component
- ✅ ✅ ProjectDetail component
- ✅ Updated HomePage with discovery
- ✅ ProjectDetail route
- ✅ FactoryDetail route
- ✅ ProjectCreation route (mock)

### Testing

- [ ] Test project browsing
- [ ] Test search functionality
- [ ] Test filtering
- [ ] Test navigation to project detail
- [ ] Test project detail page
- [ ] Test factory detail page
- [ ] Test project creation flow (mock)

---

## Phase 3: Service Abstraction

**Duration:** Week 5-6  
**Goal:** Create ProjectService and contract type abstraction

### Tasks

#### 3.1 Create ContractTypeRegistry
- [ ] Create registry class
- [ ] Add contract type detection
- [ ] Add adapter registration
- [ ] Add adapter retrieval

**Files:**
- `src/services/contracts/ContractTypeRegistry.js`

**Interface:**
```javascript
class ContractTypeRegistry {
    registerType(type, adapterClass)
    detectContractType(address, abi)
    getAdapter(contractType)
}
```

#### 3.2 Create ContractAdapter Base
- [ ] Create base adapter interface
- [ ] Define common methods
- [ ] Add error handling
- [ ] Add caching support

**Files:**
- `src/services/contracts/ContractAdapter.js`

**Interface:**
```javascript
class ContractAdapter {
    async getBalance(address)
    async getPrice()
    async buy(params)
    async sell(params)
    async getMetadata()
}
```

#### 3.3 Create ERC404Adapter
- [ ] Create ERC404 adapter
- [ ] Implement adapter interface
- [ ] Wrap ERC404 contract calls
- [ ] Add bonding curve support
- [ ] Add merkle proof support

**Files:**
- `src/services/contracts/ERC404Adapter.js`

#### 3.4 Create ProjectService
- [ ] Create ProjectService class
- [ ] Add contract instance pool
- [ ] Add active project tracking
- [ ] Add project loading
- [ ] Add project switching
- [ ] Add contract type detection
- [ ] Integrate with adapters

**Files:**
- `src/services/ProjectService.js`

**Interface:**
```javascript
class ProjectService {
    async loadProject(projectId, contractAddress, contractType)
    async switchProject(projectId)
    getActiveProject()
    getProjectInstance(projectId)
    getAdapter(projectId)
}
```

#### 3.5 Create ProjectContract Wrapper
- [ ] Create unified wrapper
- [ ] Use appropriate adapter
- [ ] Provide consistent API
- [ ] Handle contract-specific errors

**Files:**
- `src/services/contracts/ProjectContract.js`

#### 3.6 Integrate with Mock Services
- [ ] Connect ProjectService to mock services
- [ ] Load projects from mock registry
- [ ] Create contract instances from mock data
- [ ] Test with mock projects

### Deliverables

- ✅ ContractTypeRegistry
- ✅ ContractAdapter base
- ✅ ERC404Adapter
- ✅ ProjectService
- ✅ ProjectContract wrapper
- ✅ Integration with mocks

### Testing

- [ ] Test contract type detection
- [ ] Test adapter registration
- [ ] Test ERC404 adapter
- [ ] Test ProjectService
- [ ] Test project loading
- [ ] Test project switching
- [ ] Test with mock data

---

## Phase 4: State Management Migration

**Duration:** Week 7-8  
**Goal:** Migrate from tradingStore to ProjectStore

### Tasks

#### 4.1 Create ProjectStore
- [ ] Create ProjectStore class
- [ ] Add multi-project state structure
- [ ] Add active project tracking
- [ ] Add project state isolation
- [ ] Add project switching logic
- [ ] Add global state management

**Files:**
- `src/store/projectStore.js`

**Structure:**
```javascript
{
    activeProjectId: 'exec404',
    projects: {
        'exec404': { ... },
        'project-abc': { ... }
    },
    globalState: {
        wallet: {...},
        network: {...}
    }
}
```

#### 4.2 Add Project State Management
- [ ] Add createProject method
- [ ] Add switchProject method
- [ ] Add getProjectState method
- [ ] Add updateProjectState method
- [ ] Add deleteProject method

**Files:**
- `src/store/projectStore.js`

#### 4.3 Add Project Selectors
- [ ] Add selectActiveProject selector
- [ ] Add selectProjectState selector
- [ ] Add selectAllProjects selector
- [ ] Add memoization

**Files:**
- `src/store/projectStore.js`

#### 4.4 Migrate CULT EXEC State
- [ ] Auto-create 'exec404' project
- [ ] Migrate tradingStore state
- [ ] Maintain backward compatibility
- [ ] Test CULT EXEC still works

**Files:**
- `src/store/projectStore.js`
- `src/routes/CultExecsPage.js` (optional migration)

#### 4.5 Update Components to Use ProjectStore
- [ ] Update ProjectDetail to use ProjectStore
- [ ] Update ProjectDiscovery to use ProjectStore
- [ ] Keep CULT EXEC using tradingStore (or migrate)
- [ ] Test component updates

**Files:**
- `src/components/ProjectDetail/ProjectDetail.js`
- `src/components/ProjectDiscovery/ProjectDiscovery.js`

#### 4.6 Add Dual-Write Support (Optional)
- [ ] Write to both stores during transition
- [ ] Sync state between stores
- [ ] Test dual-write

**Files:**
- `src/utils/stateSync.js` (optional)

### Deliverables

- ✅ ProjectStore with multi-project support
- ✅ Project state management methods
- ✅ Project selectors
- ✅ CULT EXEC state migration (or separate)
- ✅ Updated components
- ✅ Backward compatibility

### Testing

- [ ] Test project creation
- [ ] Test project switching
- [ ] Test state isolation
- [ ] Test CULT EXEC state (if migrated)
- [ ] Test component updates
- [ ] Test backward compatibility

---

## Phase 5: ERC1155 Support

**Duration:** Week 9-10  
**Goal:** Add ERC1155 contract type support

### Tasks

#### 5.1 Create ERC1155Adapter
- [ ] Create ERC1155 adapter
- [ ] Implement adapter interface
- [ ] Handle multiple editions
- [ ] Handle per-edition pricing
- [ ] Handle creator royalties

**Files:**
- `src/services/contracts/ERC1155Adapter.js`

**Interface:**
```javascript
class ERC1155Adapter {
    async getBalance(address, editionId)
    async getEditionPrice(editionId)
    async mint(editionId, quantity, payment)
    async getEditions()
    async getEditionMetadata(editionId)
}
```

#### 5.2 Register ERC1155 Type
- [ ] Register ERC1155 in ContractTypeRegistry
- [ ] Add contract type detection
- [ ] Test detection

**Files:**
- `src/services/contracts/ContractTypeRegistry.js`

#### 5.3 Create ERC1155 UI Components
- [ ] Create EditionGallery component
- [ ] Create EditionCard component
- [ ] Create EditionMintInterface component
- [ ] Create CreatorDashboard component
- [ ] Create CreateEditionModal component

**Files:**
- `src/components/ERC1155/EditionGallery.js`
- `src/components/ERC1155/EditionCard.js`
- `src/components/ERC1155/EditionMintInterface.js`
- `src/components/ERC1155/CreatorDashboard.js`
- `src/components/ERC1155/CreateEditionModal.js`

#### 5.4 Integrate ERC1155 with ProjectDetail
- [ ] Add ERC1155 support to ContractTypeRouter
- [ ] Render EditionGallery for ERC1155
- [ ] Test ERC1155 project display

**Files:**
- `src/components/ProjectDetail/ContractTypeRouter.js`

#### 5.5 Add Edition Creation Flow
- [ ] Create edition creation UI
- [ ] Add parameter configuration
- [ ] Add deployment (mock)
- [ ] Test creation flow

**Files:**
- `src/components/ERC1155/CreateEditionModal.js`

### Deliverables

- ✅ ERC1155Adapter
- ✅ ERC1155 type registration
- ✅ ERC1155 UI components
- ✅ Integration with ProjectDetail
- ✅ Edition creation flow

### Testing

- [ ] Test ERC1155 adapter
- [ ] Test contract type detection
- [ ] Test edition gallery
- [ ] Test minting interface
- [ ] Test creator dashboard
- [ ] Test edition creation

---

## Phase 6: Factory Integration

**Duration:** Week 11-12  
**Goal:** Integrate with real contracts and deploy

### Tasks

#### 6.1 Create Real MasterService
- [ ] Create MasterService class
- [ ] Implement IMasterRegistry interface
- [ ] Connect to real master contract
- [ ] Test with real contract

**Files:**
- `src/services/MasterService.js`

#### 6.2 Create Real FactoryService
- [ ] Create FactoryService class
- [ ] Implement IFactory interface
- [ ] Connect to real factory contracts
- [ ] Test with real contracts

**Files:**
- `src/services/FactoryService.js`

#### 6.3 Create Real ProjectRegistry
- [ ] Create ProjectRegistry class
- [ ] Index from real master contract
- [ ] Index from real factories
- [ ] Cache project metadata
- [ ] Test with real contracts

**Files:**
- `src/services/ProjectRegistry.js`

#### 6.4 Update ServiceFactory
- [ ] Add real service implementations
- [ ] Update feature flag
- [ ] Test service switching
- [ ] Remove mock services (optional)

**Files:**
- `src/services/ServiceFactory.js`
- `src/config.js`

#### 6.5 Test End-to-End
- [ ] Test project discovery with real contracts
- [ ] Test project detail with real contracts
- [ ] Test project creation with real factories
- [ ] Test ERC404 projects
- [ ] Test ERC1155 projects

#### 6.6 Deploy and Launch
- [ ] Deploy to production
- [ ] Monitor for issues
- [ ] Gather user feedback
- [ ] Iterate based on feedback

### Deliverables

- ✅ Real MasterService
- ✅ Real FactoryService
- ✅ Real ProjectRegistry
- ✅ Service switching
- ✅ End-to-end testing
- ✅ Production deployment

### Testing

- [ ] Test with real master contract
- [ ] Test with real factories
- [ ] Test project creation
- [ ] Test project discovery
- [ ] Test project detail
- [ ] Test ERC404 projects
- [ ] Test ERC1155 projects
- [ ] Test end-to-end flow

---

## Testing Strategy

### Unit Tests

- [ ] Mock services
- [ ] Contract adapters
- [ ] ProjectService
- [ ] ProjectStore
- [ ] Contract type detection

### Integration Tests

- [ ] Project loading and switching
- [ ] Factory deployment flow
- [ ] Multi-project state isolation
- [ ] Service switching

### E2E Tests

- [ ] Full project creation flow
- [ ] Project discovery and navigation
- [ ] Contract interactions
- [ ] CULT EXEC functionality

### Manual Testing

- [ ] UI/UX testing
- [ ] Performance testing
- [ ] Browser compatibility
- [ ] Mobile responsiveness

---

## Success Criteria

### Phase 1: Mock System
- [ ] Mock services implemented
- [ ] Example data seeded
- [ ] Services can be switched via feature flag

### Phase 2: Frontend
- [ ] ProjectDiscovery UI complete
- [ ] ProjectDetail UI complete
- [ ] Navigation works
- [ ] Search/filter works

### Phase 3: Service Abstraction
- [ ] ProjectService implemented
- [ ] Contract adapters working
- [ ] Contract type detection works
- [ ] Projects can be loaded and switched

### Phase 4: State Management
- [ ] ProjectStore implemented
- [ ] Multi-project state works
- [ ] CULT EXEC still works
- [ ] Components migrated

### Phase 5: ERC1155
- [ ] ERC1155 adapter implemented
- [ ] ERC1155 UI components complete
- [ ] ERC1155 projects display correctly

### Phase 6: Factory Integration
- [ ] Real services implemented
- [ ] Real contracts integrated
- [ ] End-to-end flow works
- [ ] Production deployment successful

### Overall Success
- [ ] CULT EXEC continues working
- [ ] Multiple projects supported
- [ ] Project discovery works
- [ ] Project creation works
- [ ] ERC404 and ERC1155 supported
- [ ] Performance acceptable
- [ ] No breaking changes

---

## Risk Mitigation

### Technical Risks

**Risk:** Breaking CULT EXEC functionality
- **Mitigation:** Keep separate code paths, gradual migration, extensive testing

**Risk:** Performance issues with many projects
- **Mitigation:** Lazy loading, caching, pagination, performance monitoring

**Risk:** Contract type detection failures
- **Mitigation:** Fallback to manual selection, clear error messages, testing

### Business Risks

**Risk:** Low adoption of project creation
- **Mitigation:** Clear UI, good documentation, featured projects, user feedback

**Risk:** Factory contract security issues
- **Mitigation:** Contract audits, permission system, testing

---

## Next Steps

1. ✅ **Planning complete** (this document)
2. ⏭️ **Begin Phase 1: Mock System Foundation**
3. ⏭️ **Implement mock services**
4. ⏭️ **Seed example data**
5. ⏭️ **Test mock system**

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Status:** Roadmap Complete, Ready to Begin Implementation

