# CULT EXEC Sheltering Strategy
## Preserving CULT EXEC While Building the Launchpad

**Purpose:** Detailed plan for keeping CULT EXEC working while building the multi-project launchpad system.

---

## Table of Contents

1. [Overview](#overview)
2. [CULT EXEC's Unique Status](#cult-execs-unique-status)
3. [Route Structure](#route-structure)
4. [Code Organization](#code-organization)
5. [Component Abstraction Strategy](#component-abstraction-strategy)
6. [Service Abstraction Strategy](#service-abstraction-strategy)
7. [State Management Strategy](#state-management-strategy)
8. [Backward Compatibility](#backward-compatibility)
9. [Migration Checklist](#migration-checklist)

---

## Overview

### Goal

Keep CULT EXEC fully functional while building the launchpad system, ensuring:
- ✅ No breaking changes to CULT EXEC
- ✅ `/cultexecs` route continues to work
- ✅ All existing features preserved
- ✅ Gradual abstraction where needed
- ✅ Clear separation from new system

### Strategy

1. **Keep CULT EXEC Separate:**
   - Maintain dedicated `/cultexecs` route
   - Keep existing code paths intact
   - Don't force CULT EXEC into factory system

2. **Gradual Abstraction:**
   - Abstract components where reusable
   - Keep CULT EXEC-specific code separate
   - Build new system alongside, not replacing

3. **Backward Compatibility:**
   - Default to single-project mode
   - Auto-create 'exec404' project in new store
   - Support both old and new code paths

---

## CULT EXEC's Unique Status

### Characteristics

**CULT EXEC is NOT part of the factory/master contract system:**

- ✅ Standalone ERC404 contract (0x185485bF2e26e0Da48149aee0A8032c8c2060Db2)
- ✅ Loaded from static config (`/EXEC404/switch.json`)
- ✅ Not indexed by master contract
- ✅ Not created by factory
- ✅ Flagship/sponsored project
- ✅ Reference implementation

### How to Represent in New System

**Option 1: Special Project Entry**
```javascript
{
    id: 'exec404',
    contractAddress: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2',
    contractType: 'ERC404',
    name: 'CULT EXEC',
    isFactoryCreated: false,  // ← Key flag
    isSpecial: true,          // ← Special handling
    configPath: '/EXEC404/switch.json'  // ← Static config
}
```

**Option 2: Keep Completely Separate**
- Don't add to project store
- Keep in separate state
- Only link via route

**Recommendation:** **Option 1** - Add as special project entry for consistency, but mark clearly as exception.

---

## Route Structure

### Current Routes

```
/                    → HomePage (launchpad landing)
/cultexecs           → CultExecsPage (CULT EXEC interface)
```

### Target Routes

```
/                    → HomePage (project discovery)
/cultexecs           → CultExecsPage (CULT EXEC - KEEP AS-IS)
/project/:id         → ProjectDetail (factory-created projects)
/factory/:id         → FactoryDetail (factory information)
/create              → ProjectCreation (create new project)
```

### Route Handling

**CULT EXEC Route (`/cultexecs`):**
- ✅ Keep existing `CultExecsPage` handler
- ✅ No changes to route logic
- ✅ Maintain existing functionality
- ✅ Keep existing cleanup handlers

**New Project Routes:**
- Add dynamic route support to Router
- Extract route parameters (`:id`)
- Route to appropriate handler

### Router Enhancement

**Current Router:**
```javascript
router.on('/cultexecs', renderCultExecsPage);
router.on('/', renderHomePage);
```

**Enhanced Router (with dynamic routes):**
```javascript
router.on('/cultexecs', renderCultExecsPage);  // Keep as-is
router.on('/', renderHomePage);
router.on('/project/:id', renderProjectDetail);  // New
router.on('/factory/:id', renderFactoryDetail);  // New
router.on('/create', renderProjectCreation);     // New
```

---

## Code Organization

### Directory Structure

```
src/
├── routes/
│   ├── HomePage.js              ✅ Keep
│   ├── CultExecsPage.js         ✅ Keep (CULT EXEC-specific)
│   ├── ProjectDetail.js         ⏭️ New (generic)
│   ├── FactoryDetail.js         ⏭️ New
│   └── ProjectCreation.js       ⏭️ New
│
├── components/
│   ├── TradingInterface/        ⚠️ ERC404-specific, needs abstraction
│   │   └── TradingInterface.js
│   ├── SwapInterface/           ✅ Reusable for ERC404
│   ├── BondingCurve/            ⚠️ ERC404-specific
│   ├── ERC404/                  ⏭️ New (abstracted ERC404 components)
│   │   ├── ERC404TradingInterface.js
│   │   └── ERC404BondingCurve.js
│   ├── ERC1155/                 ⏭️ New (ERC1155 components)
│   └── ProjectDetail/           ⏭️ New (generic project components)
│
├── services/
│   ├── BlockchainService.js     ⚠️ Keep for CULT EXEC, create ProjectService
│   ├── ProjectService.js        ⏭️ New (multi-project)
│   └── mock/                    ⏭️ New (mock services)
│
└── store/
    ├── tradingStore.js          ⚠️ Keep for CULT EXEC during transition
    └── projectStore.js          ⏭️ New (multi-project)
```

### Code Separation Strategy

**CULT EXEC-Specific Code:**
- `src/routes/CultExecsPage.js` - Keep as-is
- `src/services/BlockchainService.js` - Keep for CULT EXEC
- `src/store/tradingStore.js` - Keep during transition
- Direct contract interaction code

**Reusable Code:**
- `src/components/SwapInterface/` - Reusable
- `src/components/ChatPanel/` - Reusable
- `src/components/WalletConnector/` - Reusable
- Most utility components

**New Generic Code:**
- `src/services/ProjectService.js` - New multi-project service
- `src/store/projectStore.js` - New multi-project store
- `src/routes/ProjectDetail.js` - New generic project page
- `src/components/ProjectDetail/` - New generic components

---

## Component Abstraction Strategy

### Current: TradingInterface

**Location:** `src/components/TradingInterface/TradingInterface.js`

**Current Usage:**
```javascript
// In CultExecsPage.js
const tradingInterface = new TradingInterface(
    address,
    blockchainService,
    ethers,
    walletConnection
);
```

**Abstraction Strategy:**

**Step 1: Create ERC404TradingInterface**
```javascript
// src/components/ERC404/ERC404TradingInterface.js
class ERC404TradingInterface extends Component {
    constructor(projectId, projectService) {
        // Use projectId instead of address
        // Use projectService instead of blockchainService
    }
}
```

**Step 2: Keep TradingInterface for CULT EXEC**
```javascript
// src/components/TradingInterface/TradingInterface.js
// Keep as-is for CULT EXEC
// Or wrap ERC404TradingInterface with CULT EXEC-specific config
```

**Step 3: Use in CultExecsPage**
```javascript
// Option A: Keep using TradingInterface directly
const tradingInterface = new TradingInterface(...);

// Option B: Use ERC404TradingInterface with CULT EXEC project
const tradingInterface = new ERC404TradingInterface('exec404', projectService);
```

**Recommendation:** **Option A** during transition, migrate to Option B later.

### Current: SwapInterface

**Status:** ✅ Already reusable

**Current Usage:**
```javascript
this.swapInterface = new SwapInterface(blockchainService, address);
```

**Abstraction:**
```javascript
// Keep as-is, works for any ERC404 project
this.swapInterface = new SwapInterface(projectService, projectId);
```

### Current: BondingCurve

**Status:** ⚠️ ERC404-specific

**Abstraction:**
```javascript
// Create ERC404BondingCurve
// src/components/ERC404/ERC404BondingCurve.js
class ERC404BondingCurve extends Component {
    constructor(projectId, projectService) {
        // Use projectId and projectService
    }
}
```

---

## Service Abstraction Strategy

### Current: BlockchainService

**Status:** ⚠️ Single contract, CULT EXEC-specific

**Strategy:**

**Step 1: Keep BlockchainService for CULT EXEC**
- Continue using for CULT EXEC
- No changes to existing code

**Step 2: Create ProjectService (parallel)**
```javascript
// src/services/ProjectService.js
class ProjectService {
    constructor() {
        this.instances = new Map(); // projectId → ContractInstance
        this.activeProjectId = null;
    }
    
    async loadProject(projectId, contractAddress, contractType) {
        // Load contract instance
    }
    
    async switchProject(projectId) {
        // Switch active project
    }
    
    getActiveProject() {
        // Get active project instance
    }
}
```

**Step 3: Support CULT EXEC in ProjectService**
```javascript
// Special handling for CULT EXEC
if (projectId === 'exec404') {
    // Load from static config
    const config = await fetch('/EXEC404/switch.json').then(r => r.json());
    return this.loadProject('exec404', config.address, 'ERC404');
}
```

**Step 4: Gradual Migration**
- New projects use ProjectService
- CULT EXEC continues using BlockchainService
- Migrate CULT EXEC later (optional)

### Service Factory Pattern

```javascript
// src/services/ServiceFactory.js
class ServiceFactory {
    getBlockchainService() {
        // Return singleton for CULT EXEC
        return blockchainService;
    }
    
    getProjectService() {
        // Return multi-project service
        return projectService;
    }
    
    getServiceForProject(projectId) {
        if (projectId === 'exec404') {
            return this.getBlockchainService();
        } else {
            return this.getProjectService();
        }
    }
}
```

---

## State Management Strategy

### Current: tradingStore

**Status:** ⚠️ Single project, global singleton

**Strategy:**

**Step 1: Create ProjectStore (parallel)**
```javascript
// src/store/projectStore.js
class ProjectStore extends Store {
    constructor() {
        super({
            activeProjectId: 'exec404',
            projects: {
                'exec404': {
                    // CULT EXEC state
                }
            },
            globalState: {
                wallet: {...},
                network: {...}
            }
        });
    }
}
```

**Step 2: Auto-Migrate CULT EXEC State**
```javascript
// On ProjectStore initialization
const exec404State = {
    id: 'exec404',
    contractAddress: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2',
    contractType: 'ERC404',
    name: 'CULT EXEC',
    isFactoryCreated: false,
    state: {
        // Migrate from tradingStore
        ...tradingStore.getState()
    }
};

projectStore.setState({
    projects: {
        'exec404': exec404State
    },
    activeProjectId: 'exec404'
});
```

**Step 3: Keep tradingStore During Transition**
- CULT EXEC continues using tradingStore
- New projects use ProjectStore
- Gradual migration

**Step 4: Dual-Write During Migration**
```javascript
// In components, write to both stores during transition
tradingStore.setState(updates);
projectStore.updateProjectState('exec404', updates);
```

---

## Backward Compatibility

### Principles

1. **No Breaking Changes:**
   - Existing code paths continue working
   - CULT EXEC route unchanged
   - All features preserved

2. **Default Behavior:**
   - App defaults to single-project mode
   - CULT EXEC is default project
   - Backward compatible by default

3. **Gradual Migration:**
   - New features work alongside old
   - Old code paths remain until fully migrated
   - Can roll back if issues found

### Compatibility Checklist

- [ ] `/cultexecs` route works
- [ ] CULT EXEC trading interface works
- [ ] All tabs functional
- [ ] Wallet connection works
- [ ] Transactions work
- [ ] Price updates work
- [ ] Balance updates work
- [ ] Chat panel works
- [ ] Portfolio modal works
- [ ] All existing features preserved

### Feature Flags

```javascript
// src/config.js
export const FEATURES = {
    USE_PROJECT_STORE: false,  // Start with false
    USE_PROJECT_SERVICE: false, // Start with false
    SHOW_PROJECT_DISCOVERY: false, // Start with false
};
```

**Migration Path:**
1. Build new system with flags disabled
2. Test new system alongside old
3. Enable flags one by one
4. Migrate components gradually
5. Remove old code when fully migrated

---

## Migration Checklist

### Phase 1: Foundation (No Changes to CULT EXEC)
- [ ] Create ProjectService (parallel to BlockchainService)
- [ ] Create ProjectStore (parallel to tradingStore)
- [ ] Create mock services
- [ ] Enhance Router for dynamic routes
- [ ] **CULT EXEC continues working unchanged**

### Phase 2: New System (Alongside CULT EXEC)
- [ ] Build ProjectDiscovery component
- [ ] Build ProjectDetail component
- [ ] Build project browsing
- [ ] Test with mock data
- [ ] **CULT EXEC continues working unchanged**

### Phase 3: Abstraction (Optional for CULT EXEC)
- [ ] Create ERC404TradingInterface
- [ ] Abstract SwapInterface (if needed)
- [ ] Abstract BondingCurve (if needed)
- [ ] **CULT EXEC can use abstractions or keep existing**

### Phase 4: Integration (Gradual)
- [ ] Add CULT EXEC to ProjectStore (optional)
- [ ] Migrate CULT EXEC to ProjectService (optional)
- [ ] Test CULT EXEC with new system
- [ ] **CULT EXEC continues working**

### Phase 5: Cleanup (After Full Migration)
- [ ] Remove old code paths (if migrated)
- [ ] Or keep CULT EXEC separate forever
- [ ] **CULT EXEC continues working**

---

## CULT EXEC in Project Discovery

### Option 1: Don't Include
- Keep CULT EXEC completely separate
- Only accessible via `/cultexecs`
- Not in project discovery

### Option 2: Featured Entry
- Show in "Featured Projects" section
- Mark as "Sponsored" or "Flagship"
- Link to `/cultexecs`
- Special styling

**Recommendation:** **Option 1** - Keep CULT EXEC separate to maintain unique status.

---

## Code Examples

### Keeping CULT EXEC Working

**CultExecsPage.js (No Changes):**
```javascript
export async function renderCultExecsPage() {
    // ... existing code ...
    
    // Continue using BlockchainService
    const blockchainService = new BlockchainService();
    await blockchainService.initialize();
    
    // Continue using TradingInterface
    const tradingInterface = new TradingInterface(
        address,
        blockchainService,
        ethers,
        walletConnection
    );
    
    // ... rest of existing code ...
}
```

### Adding New Projects

**ProjectDetail.js (New):**
```javascript
export async function renderProjectDetail(projectId) {
    // Use ProjectService for new projects
    const projectService = serviceFactory.getProjectService();
    await projectService.loadProject(projectId);
    
    // Use generic ProjectDetail component
    const projectDetail = new ProjectDetail(projectId, projectService);
    
    // ...
}
```

### Supporting Both

**ServiceFactory.js:**
```javascript
getServiceForProject(projectId) {
    if (projectId === 'exec404') {
        // CULT EXEC uses BlockchainService
        return this.getBlockchainService();
    } else {
        // New projects use ProjectService
        return this.getProjectService();
    }
}
```

---

## Summary

### Key Points

1. **CULT EXEC is the Exception:**
   - Not part of factory system
   - Keep separate route
   - Maintain unique status

2. **No Breaking Changes:**
   - Existing code paths work
   - Gradual migration
   - Backward compatible

3. **Clear Separation:**
   - CULT EXEC-specific code separate
   - New generic code separate
   - Easy to understand

4. **Flexible Migration:**
   - Can migrate CULT EXEC later (optional)
   - Or keep separate forever
   - Both options supported

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Status:** Strategy Complete, Ready for Implementation

