# Launchpad Transition: Planning Summary

**Status:** ✅ Planning Complete  
**Date:** 2024  
**Branch:** `launchpad-transition`

---

## Quick Reference

### Documents Created

1. **[LAUNCHPAD_ANALYSIS.md](./LAUNCHPAD_ANALYSIS.md)** - Comprehensive analysis of current state, reusable components, and gaps
2. **[MOCK_SYSTEM_DESIGN.md](./MOCK_SYSTEM_DESIGN.md)** - Detailed mock system architecture
3. **[CULT_EXEC_SHELTERING.md](./CULT_EXEC_SHELTERING.md)** - Strategy for preserving CULT EXEC
4. **[IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md)** - Phased implementation plan

### Key Insights

#### CULT EXEC is the Exception
- **NOT** part of factory/master contract system
- Standalone ERC404 contract (0x185485bF2e26e0Da48149aee0A8032c8c2060Db2)
- Loaded from static config (`/EXEC404/switch.json`)
- Flagship/sponsored project
- Reference implementation

#### Strategy: Mock-First Development
- Build frontend using mock services first
- Test UI/UX without contracts
- Swap mock → real when contracts ready
- Understand contract interface requirements

#### Backward Compatibility
- CULT EXEC MUST continue working
- No breaking changes
- Gradual migration
- Clear separation

---

## Current State

### ✅ What's Working

- **Routing System:** ✅ Implemented (`src/core/Router.js`)
- **Component System:** ✅ Optimized with cleanup
- **State Management:** ✅ Store with batching, transactions, selectors
- **CULT EXEC:** ✅ Fully functional trading interface
- **Services:** ✅ BlockchainService, WalletService, ContractCache, etc.

### ⚠️ What Needs Work

- **Multi-Project Support:** ❌ BlockchainService assumes single contract
- **Contract Type Abstraction:** ❌ Components assume ERC404
- **Project Discovery:** ❌ No browsing/search UI
- **Dynamic Routing:** ❌ Router doesn't support `/project/:id`
- **State Management:** ❌ tradingStore is single-project

---

## Architecture Overview

### Target Structure

```
Launchpad App
├── Project Discovery (Home)
│   ├── Browse Projects
│   ├── Search & Filter
│   └── Featured Projects
├── Project Detail
│   ├── Project Info
│   ├── Contract-Specific Interface
│   │   ├── ERC404: Trading Interface
│   │   └── ERC1155: Edition Gallery
│   └── Statistics
└── Project Creation
    ├── Factory Selection
    ├── Parameter Configuration
    └── Deployment
```

### Service Layer

```
ServiceFactory
├── Mock Services (Phase 1-5)
│   ├── MockMasterService
│   ├── MockFactoryService
│   └── MockProjectRegistry
└── Real Services (Phase 6)
    ├── MasterService
    ├── FactoryService
    └── ProjectRegistry
```

### State Management

```
ProjectStore
├── activeProjectId: 'exec404' | 'project-abc'
├── projects: {
│   'exec404': { ... },      // CULT EXEC (exception)
│   'project-abc': { ... }  // Factory-created
│ }
└── globalState: {
    wallet: {...},
    network: {...}
}
```

---

## Implementation Phases

### Phase 1: Mock System (Week 1-2)
**Goal:** Build mock services

- [ ] MockMasterService
- [ ] MockFactoryService
- [ ] MockProjectRegistry
- [ ] ServiceFactory with feature flag
- [ ] Example data seeding

**Deliverable:** Working mock system with example projects

---

### Phase 2: Frontend (Week 3-4)
**Goal:** Build UI with mocks

- [ ] Enhance Router (dynamic routes)
- [ ] ProjectDiscovery component
- [ ] ProjectDetail component
- [ ] Update HomePage
- [ ] ProjectDetail route
- [ ] FactoryDetail route
- [ ] ProjectCreation route (mock)

**Deliverable:** Working frontend with mock data

---

### Phase 3: Service Abstraction (Week 5-6)
**Goal:** Create ProjectService and adapters

- [ ] ContractTypeRegistry
- [ ] ContractAdapter base
- [ ] ERC404Adapter
- [ ] ProjectService
- [ ] Integration with mocks

**Deliverable:** Multi-project service layer

---

### Phase 4: State Management (Week 7-8)
**Goal:** Migrate to ProjectStore

- [ ] ProjectStore
- [ ] Project state management
- [ ] Project selectors
- [ ] CULT EXEC migration (or separate)
- [ ] Component updates

**Deliverable:** Multi-project state management

---

### Phase 5: ERC1155 (Week 9-10)
**Goal:** Add ERC1155 support

- [ ] ERC1155Adapter
- [ ] ERC1155 UI components
- [ ] Integration with ProjectDetail
- [ ] Edition creation flow

**Deliverable:** ERC1155 contract type support

---

### Phase 6: Factory Integration (Week 11-12)
**Goal:** Integrate real contracts

- [ ] Real MasterService
- [ ] Real FactoryService
- [ ] Real ProjectRegistry
- [ ] Service switching
- [ ] End-to-end testing
- [ ] Deploy

**Deliverable:** Production-ready launchpad

---

## Key Decisions

### 1. CULT EXEC Handling
**Decision:** Keep CULT EXEC separate via `/cultexecs` route

**Rationale:**
- Maintains unique status
- No breaking changes
- Clear separation from factory-created projects

### 2. Mock-First Approach
**Decision:** Build frontend with mocks before contracts

**Rationale:**
- Frontend development can start immediately
- UI/UX can be tested
- Contract requirements become clear
- Easy to swap when ready

### 3. Gradual Migration
**Decision:** Keep old code paths during transition

**Rationale:**
- No breaking changes
- Can roll back if issues
- CULT EXEC continues working
- Incremental risk

### 4. Service Abstraction
**Decision:** Create ProjectService parallel to BlockchainService

**Rationale:**
- Maintains backward compatibility
- Gradual migration possible
- Clear separation of concerns

---

## Component Reusability

### ✅ Fully Reusable
- WalletConnector
- ChatPanel
- PriceDisplay
- PortfolioModal
- ErrorBoundary
- MessagePopup
- BalanceDisplay
- SwapInterface (for ERC404)

### ⚠️ Needs Abstraction
- TradingInterface → ERC404TradingInterface
- BondingCurve → ERC404BondingCurve
- TransactionOptions (may need abstraction)

### ⏭️ Missing (For ERC1155)
- EditionGallery
- EditionCard
- EditionMintInterface
- CreatorDashboard
- CreateEditionModal

### ⏭️ Missing (For Launchpad)
- ProjectDiscovery
- ProjectCard
- ProjectDetail
- ProjectHeader
- ContractTypeRouter
- FactoryDetail
- ProjectCreation

---

## Service Reusability

### ✅ Fully Reusable
- WalletService
- ContractCache
- LayoutService
- BalanceService (mostly)

### ⚠️ Needs Abstraction
- BlockchainService → ProjectService
- PriceService (may need abstraction)

### ⏭️ Missing
- ProjectService (multi-project)
- ProjectRegistry (indexing)
- FactoryService (factory interaction)
- MasterService (master contract)
- ContractTypeRegistry (type detection)

---

## Route Structure

### Current
```
/          → HomePage
/cultexecs   → CultExecsPage
```

### Target
```
/                → HomePage (Project Discovery)
/cultexecs       → CultExecsPage (CULT EXEC - KEEP)
/project/:id     → ProjectDetail (factory-created)
/factory/:id     → FactoryDetail
/create          → ProjectCreation
```

---

## State Structure

### Current (tradingStore)
```javascript
{
    ca: '0x...',
    ethAmount: '',
    execAmount: '',
    price: { current: 0 },
    balances: { eth: '0', exec: '0' }
}
```

### Target (projectStore)
```javascript
{
    activeProjectId: 'exec404',
    projects: {
        'exec404': {
            id: 'exec404',
            contractAddress: '0x...',
            contractType: 'ERC404',
            name: 'CULT EXEC',
            isFactoryCreated: false,
            state: { ... }
        },
        'project-abc': {
            id: 'project-abc',
            contractAddress: '0x...',
            contractType: 'ERC1155',
            name: 'User Project',
            isFactoryCreated: true,
            state: { ... }
        }
    },
    globalState: {
        wallet: {...},
        network: {...}
    }
}
```

---

## Mock System Overview

### Data Structure
```javascript
{
    masterContract: {
        factories: [...]
    },
    factories: {
        '0xFACTORY...': {
            instances: [...]
        }
    },
    instances: {
        '0xINSTANCE...': {
            id: 'project-1',
            contractType: 'ERC404',
            // ...
        }
    },
    projectIndex: {
        byType: {...},
        byFactory: {...},
        all: [...]
    }
}
```

### Services
- **MockMasterService** - Factory authorization, instance tracking
- **MockFactoryService** - Instance creation, factory management
- **MockProjectRegistry** - Project indexing, search, filter

### Feature Flag
```javascript
export const USE_MOCK_SERVICES = true; // Switch to false when ready
```

---

## Critical Constraints

1. **CULT EXEC MUST continue working**
   - No breaking changes
   - `/cultexecs` route preserved
   - All features functional

2. **Backward compatibility**
   - Existing code paths work
   - Gradual migration
   - Can roll back

3. **Mock system**
   - Easy to swap for real contracts
   - Same interface as real services
   - Feature flag switching

4. **Code organization**
   - Clear separation
   - Easy to understand
   - Maintainable

---

## Success Criteria

### Phase 1: Mock System
- [ ] Mock services implemented
- [ ] Example data seeded
- [ ] Services switchable via feature flag

### Phase 2: Frontend
- [ ] ProjectDiscovery UI complete
- [ ] ProjectDetail UI complete
- [ ] Navigation works

### Phase 3: Service Abstraction
- [ ] ProjectService implemented
- [ ] Contract adapters working
- [ ] Projects loadable and switchable

### Phase 4: State Management
- [ ] ProjectStore implemented
- [ ] Multi-project state works
- [ ] CULT EXEC still works

### Phase 5: ERC1155
- [ ] ERC1155 adapter implemented
- [ ] ERC1155 UI complete
- [ ] ERC1155 projects display correctly

### Phase 6: Factory Integration
- [ ] Real services implemented
- [ ] Real contracts integrated
- [ ] Production deployment successful

### Overall
- [ ] CULT EXEC continues working
- [ ] Multiple projects supported
- [ ] Project discovery works
- [ ] Project creation works
- [ ] ERC404 and ERC1155 supported
- [ ] No breaking changes

---

## Next Steps

1. ✅ **Planning complete** (all documents created)
2. ⏭️ **Begin Phase 1: Mock System Foundation**
   - Create mock services
   - Seed example data
   - Test mock system

3. ⏭️ **Begin Phase 2: Frontend with Mocks**
   - Build ProjectDiscovery
   - Build ProjectDetail
   - Test UI/UX

4. ⏭️ **Continue with remaining phases**

---

## Document Index

- **[LAUNCHPAD_ANALYSIS.md](./LAUNCHPAD_ANALYSIS.md)** - Full analysis
- **[MOCK_SYSTEM_DESIGN.md](./MOCK_SYSTEM_DESIGN.md)** - Mock system details
- **[CULT_EXEC_SHELTERING.md](./CULT_EXEC_SHELTERING.md)** - CULT EXEC strategy
- **[IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md)** - Detailed roadmap
- **[LAUNCHPAD_TRANSITION.md](./LAUNCHPAD_TRANSITION.md)** - Original transition document

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Status:** ✅ Planning Complete, Ready for Implementation

