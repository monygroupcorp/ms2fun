# Architecture Improvements Report
## ms2.fun Codebase Analysis & Refactoring Opportunities

**Generated:** 2024  
**Purpose:** Comprehensive analysis of architectural patterns, identified issues, and agent prompts for systematic improvements

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Component Architecture](#component-architecture)
3. [State Management](#state-management)
4. [Event Handling & Subscriptions](#event-handling--subscriptions)
5. [Wallet & Blockchain Integration](#wallet--blockchain-integration)
6. [DOM Manipulation & Performance](#dom-manipulation--performance)
7. [Error Handling & Resilience](#error-handling--resilience)
8. [Code Organization & Maintainability](#code-organization--maintainability)
9. [Testing & Quality Assurance](#testing--quality-assurance)

---

## Executive Summary

### Current Architecture Overview

The ms2.fun project implements a custom React-like component framework with:
- **Component Base Class**: Simple lifecycle with `mount()`, `update()`, `unmount()`
- **Global State Store**: Pub/sub pattern with validation
- **Event Bus**: Decoupled event communication
- **Blockchain Service**: Ethers.js abstraction layer
- **Wallet Service**: Multi-wallet provider support

### Critical Issues Identified

1. **Memory Leaks**: Event listeners not systematically cleaned up
2. **State Fragmentation**: Multiple sources of truth (component state + store)
3. **DOM Performance**: Full `innerHTML` replacement on every update
4. **Error Handling**: Inconsistent error boundaries and recovery
5. **Subscription Management**: Manual tracking prone to leaks
6. **Contract Read Redundancy**: No caching layer for blockchain calls

### Improvement Priority Matrix

| Priority | Area | Impact | Effort | Dependencies |
|----------|------|--------|--------|--------------|
| 🔴 **P0** | Event Listener Cleanup | High | Medium | Component Architecture |
| 🔴 **P0** | State Management Unification | High | High | Store Refactor |
| 🟡 **P1** | DOM Update Optimization | Medium | High | Component Architecture |
| 🟡 **P1** | Contract Read Caching | Medium | Low | Blockchain Service |
| 🟢 **P2** | Error Boundary System | Low | Medium | Component Architecture |
| 🟢 **P2** | Subscription Auto-cleanup | Low | Low | Event Bus |

---

## Component Architecture

### Current Implementation Analysis

**Location:** `src/core/Component.js`

**Strengths:**
- Simple, understandable lifecycle model
- Event delegation support via `events()` method
- Style injection for component-scoped CSS
- Shallow state comparison for update optimization

**Critical Issues:**

1. **No Automatic Cleanup Tracking**
   - Event listeners manually tracked in `boundEvents` Map
   - No cleanup for timers, intervals, or async operations
   - Child component references not tracked

2. **Full DOM Replacement**
   - `innerHTML` replacement on every update (line 160)
   - Loses focus state, scroll position, and form inputs
   - No diffing or granular updates

3. **No Component Tree Management**
   - Child components manually managed
   - No context propagation
   - No automatic child cleanup on unmount

4. **Lifecycle Hook Gaps**
   - `onStateUpdate` exists but not consistently used
   - No `shouldUpdate` override pattern documented
   - Missing `onError` boundary hook

### Agent Prompt: Component Lifecycle Cleanup System

```
TASK: Implement systematic cleanup tracking in Component base class

CONTEXT:
- Component.js currently tracks DOM event listeners in `boundEvents` Map
- Components create timers, intervals, async operations, and child components
- These resources are not automatically cleaned up on unmount

REQUIREMENTS:
1. Add a `_cleanupRegistry` Set to track all cleanup functions
2. Create `registerCleanup(fn)` method that returns a cleanup function
3. Modify `unmount()` to execute all registered cleanup functions
4. Update `bindEvents()` to register cleanup for event listeners
5. Add `setTimeout`/`setInterval` wrappers that auto-register cleanup
6. Track child component references and auto-unmount them

CONSTRAINTS:
- Must be backward compatible with existing components
- Cleanup should be idempotent (safe to call multiple times)
- Should not break existing `onUnmount()` overrides

FILES TO MODIFY:
- src/core/Component.js

TEST CASES:
- Component with timers should clean up on unmount
- Component with child components should unmount children
- Component with async operations should cancel pending work
- Multiple mount/unmount cycles should not leak memory
```

### Agent Prompt: Granular DOM Updates

```
TASK: Replace innerHTML replacement with granular DOM updates

CONTEXT:
- Current implementation replaces entire innerHTML on every state change
- This causes loss of focus, scroll position, and form input values
- Components like SwapInterface update inputs directly (lines 87-98) as workaround

REQUIREMENTS:
1. Create a `DOMUpdater` utility class for granular updates
2. Implement text content updates without replacing parent
3. Implement attribute updates (class, style, data-*)
4. Implement element insertion/removal with position tracking
5. Add `updateDOM()` method to Component that uses granular updates
6. Preserve focus state during updates
7. Preserve scroll position for scrollable containers

CONSTRAINTS:
- Must maintain existing `render()` method signature
- Should fall back to innerHTML for complex structural changes
- Performance should be equal or better than current implementation

FILES TO MODIFY:
- src/core/Component.js
- Create: src/utils/DOMUpdater.js

TEST CASES:
- Input field maintains focus during state update
- Scroll position preserved in scrollable lists
- Complex nested structures update correctly
- Performance benchmark vs current implementation
```

### Agent Prompt: Component Tree & Context System

```
TASK: Implement component tree management and context propagation

CONTEXT:
- TradingInterface manually manages child components (SwapInterface, BondingCurve)
- No way to pass data down component tree without props drilling
- Child components not automatically cleaned up

REQUIREMENTS:
1. Add `children` Map to track child component instances
2. Create `createChild(ComponentClass, container, props)` method
3. Implement `getContext(key)` and `provideContext(key, value)` for context API
4. Auto-unmount all children in `unmount()`
5. Add `findChild(predicate)` for child component lookup
6. Support nested component trees

CONSTRAINTS:
- Must not break existing manual child management
- Context should be scoped to component subtree
- Should work with current mount/unmount patterns

FILES TO MODIFY:
- src/core/Component.js

TEST CASES:
- Child components unmount when parent unmounts
- Context values propagate to descendants
- Multiple children of same type work correctly
- Deeply nested trees clean up properly
```

---

## State Management

### Current Implementation Analysis

**Location:** `src/store/Store.js`, `src/store/tradingStore.js`

**Strengths:**
- Clean pub/sub pattern
- Validation system for state updates
- Selector pattern for derived state access
- Debug logging support

**Critical Issues:**

1. **State Fragmentation**
   - Components maintain local `this.state` (TradingInterface line 53)
   - Store maintains global state (tradingStore)
   - No clear boundary between local vs global state
   - Duplicate state (e.g., `isPhase2` in both places)

2. **No State Batching**
   - Multiple `setState()` calls trigger multiple renders
   - No transaction-like updates
   - Race conditions possible with rapid updates

3. **Selector Performance**
   - Selectors recalculate on every access
   - No memoization or caching
   - Deep object access without optimization

4. **No Middleware System**
   - Cannot intercept state updates
   - No logging, persistence, or devtools integration
   - Hard to debug state changes

### Agent Prompt: State Management Unification

```
TASK: Unify component state and store state with clear boundaries

CONTEXT:
- Components use both `this.state` and `tradingStore.state`
- No clear pattern for when to use which
- State duplication causes sync issues (e.g., isPhase2 in TradingInterface and store)

REQUIREMENTS:
1. Define state ownership rules:
   - UI-only state (focus, hover, temporary) → component state
   - Shared/global state (balances, price, wallet) → store
   - Derived state → computed selectors
2. Create `useStore(selector)` hook pattern for components
3. Remove duplicate state (consolidate isPhase2 to single source)
4. Add state sync validation to catch desync issues
5. Document state ownership in component comments

CONSTRAINTS:
- Must maintain backward compatibility during migration
- Should provide migration path for existing components
- Clear error messages for state access violations

FILES TO MODIFY:
- src/core/Component.js (add useStore helper)
- src/store/tradingStore.js (consolidate state)
- src/components/TradingInterface/TradingInterface.js (remove duplicates)
- Create: src/utils/stateHelpers.js

TEST CASES:
- Component state changes don't affect store
- Store updates propagate to all subscribers
- No duplicate state values
- State sync validation catches desync
```

### Agent Prompt: State Update Batching & Transactions

```
TASK: Implement state update batching and transaction support

CONTEXT:
- Multiple setState() calls in sequence trigger multiple renders
- TradingInterface.updateBalances() calls multiple store updates (line 136-146)
- No way to group related updates atomically

REQUIREMENTS:
1. Add `batchUpdates(callback)` method to Store
2. Batch all setState calls within callback into single update
3. Add `transaction(callback)` for atomic updates with rollback
4. Implement update queue with debouncing
5. Add `setStateSync()` for immediate updates when needed
6. Emit single 'state:updated' event per batch

CONSTRAINTS:
- Must maintain current synchronous behavior by default
- Batching should be opt-in, not automatic
- Transaction rollback should handle nested transactions

FILES TO MODIFY:
- src/store/Store.js
- src/store/tradingStore.js

TEST CASES:
- Multiple setState calls in batch trigger single render
- Transaction rollback restores previous state
- Nested transactions work correctly
- Performance improvement measured
```

### Agent Prompt: Selector Memoization & Caching

```
TASK: Add memoization and caching to selectors

CONTEXT:
- Selectors like `selectFreeSituation()` recalculate on every call
- No caching of computed values
- Deep object access in selectors (line 361-368 in tradingStore.js)

REQUIREMENTS:
1. Create `createSelector(dependencies, computeFn)` utility
2. Memoize selector results based on dependency values
3. Cache results until dependencies change
4. Add selector performance logging in debug mode
5. Support nested/derived selectors

CONSTRAINTS:
- Should use shallow equality for dependency comparison
- Cache should be cleared on store reset
- Memory-efficient (LRU cache for large selectors)

FILES TO MODIFY:
- src/store/Store.js
- src/store/tradingStore.js
- Create: src/utils/selectors.js

TEST CASES:
- Selector returns cached value when dependencies unchanged
- Selector recalculates when dependencies change
- Nested selectors work correctly
- Memory usage stays bounded
```

---

## Event Handling & Subscriptions

### Current Implementation Analysis

**Location:** `src/core/EventBus.js`, component event handling

**Strengths:**
- Simple pub/sub API
- Debug mode for event tracing
- `once()` method for one-time listeners
- Unsubscribe functions returned

**Critical Issues:**

1. **Manual Subscription Tracking**
   - Components manually track unsubscribe functions (TradingInterface line 173)
   - Easy to forget cleanup
   - No automatic cleanup on unmount

2. **Event Name Collisions**
   - String-based event names (e.g., 'transaction:confirmed')
   - No namespace or type safety
   - Typos cause silent failures

3. **No Event Middleware**
   - Cannot intercept or transform events
   - No event logging or analytics hooks
   - Hard to debug event flow

4. **Memory Leaks**
   - EventBus listeners never cleaned up automatically
   - Components can leak if unmount not called
   - No weak references for cleanup

### Agent Prompt: Automatic Subscription Cleanup

```
TASK: Implement automatic event subscription cleanup for components

CONTEXT:
- Components manually track event subscriptions in arrays (TradingInterface line 173)
- Easy to forget cleanup, causing memory leaks
- EventBus has no knowledge of component lifecycle

REQUIREMENTS:
1. Add `subscribe(eventName, callback)` method to Component base class
2. Auto-track all subscriptions in component lifecycle
3. Auto-unsubscribe all events in `unmount()`
4. Add `subscribeOnce()` for one-time subscriptions
5. Add subscription debugging in Component (which events subscribed)
6. Create `EventBus.subscribeWithCleanup(component, eventName, callback)` helper

CONSTRAINTS:
- Must work with existing EventBus API
- Should not break manual subscription management
- Cleanup should be idempotent

FILES TO MODIFY:
- src/core/Component.js
- src/core/EventBus.js (optional helper)

TEST CASES:
- Component subscriptions cleaned up on unmount
- Multiple subscriptions to same event work
- subscribeOnce() auto-unsubscribes after first call
- No memory leaks after unmount cycles
```

### Agent Prompt: Typed Event System

```
TASK: Create type-safe event system with event schemas

CONTEXT:
- Events use string names ('transaction:confirmed', 'account:changed')
- No type checking or validation
- Typos cause silent failures
- No IDE autocomplete for event names

REQUIREMENTS:
1. Create event type definitions in `src/core/EventTypes.js`
2. Define event schemas with payload types
3. Add `EventBus.emitTyped(eventType, payload)` with validation
4. Add `EventBus.onTyped(eventType, callback)` with type checking
5. Generate TypeScript definitions (optional)
6. Add runtime validation for event payloads

CONSTRAINTS:
- Must maintain backward compatibility with string events
- Should provide migration path
- Validation should be opt-in for performance

FILES TO MODIFY:
- src/core/EventBus.js
- Create: src/core/EventTypes.js

TEST CASES:
- Typed events validate payload structure
- Invalid payloads throw descriptive errors
- String events still work for backward compatibility
- IDE autocomplete works for event types
```

### Agent Prompt: Event Middleware & Interceptors

```
TASK: Add middleware system for event interception and transformation

CONTEXT:
- No way to log all events for debugging
- Cannot transform events before delivery
- No analytics or monitoring hooks

REQUIREMENTS:
1. Add `EventBus.use(middleware)` for middleware registration
2. Middleware receives (eventName, payload, next) signature
3. Support async middleware
4. Add built-in logging middleware (opt-in)
5. Add built-in analytics middleware (opt-in)
6. Support middleware ordering/priority

CONSTRAINTS:
- Middleware should not break existing event flow
- Performance impact should be minimal
- Should work with both typed and string events

FILES TO MODIFY:
- src/core/EventBus.js

TEST CASES:
- Middleware intercepts events before listeners
- Multiple middleware execute in order
- Async middleware works correctly
- Middleware can modify event payload
- Middleware can prevent event delivery
```

---

## Wallet & Blockchain Integration

### Current Implementation Analysis

**Location:** `src/services/BlockchainService.js`, `src/services/WalletService.js`

**Strengths:**
- Clean abstraction over ethers.js
- Multi-wallet provider support
- Error handling with user-friendly messages
- Transaction tracking with unique IDs

**Critical Issues:**

1. **No Contract Read Caching**
   - Every price/balance call hits blockchain
   - Redundant calls for same data
   - No cache invalidation strategy

2. **Network Change Handling**
   - Network changes trigger full re-initialization (line 474-487)
   - No graceful degradation during network switch
   - Race conditions possible

3. **Error Recovery**
   - Errors throw but don't always recover
   - No retry mechanisms for failed reads
   - Transaction failures don't have retry UI

4. **Provider State Management**
   - Provider state scattered across services
   - No single source of truth for connection state
   - Wallet disconnection not always handled

### Agent Prompt: Contract Read Caching Layer

```
TASK: Implement caching layer for blockchain contract reads

CONTEXT:
- Every component calls getCurrentPrice(), getTokenBalance() independently
- Same data fetched multiple times in short period
- No cache invalidation on state changes

REQUIREMENTS:
1. Create `ContractCache` service with TTL-based caching
2. Cache contract read results with configurable TTL
3. Invalidate cache on:
   - Transaction confirmations
   - Account changes
   - Network changes
   - Manual invalidation calls
4. Add cache statistics (hit rate, miss rate)
5. Support cache warming for critical data
6. Add cache debugging in dev mode

CONSTRAINTS:
- Cache should be opt-in per method (some reads should never cache)
- TTL should be configurable per data type
- Must handle cache stampede (multiple simultaneous reads)

FILES TO MODIFY:
- src/services/BlockchainService.js
- Create: src/services/ContractCache.js

TEST CASES:
- Cached reads return immediately without blockchain call
- Cache invalidates on transaction confirmation
- Cache invalidates on account/network change
- Cache hit rate improves performance
- Stale cache doesn't serve outdated data
```

### Agent Prompt: Network Change Resilience

```
TASK: Improve network change handling with graceful degradation

CONTEXT:
- Network changes trigger full BlockchainService re-initialization
- Components can be in inconsistent state during switch
- No loading states or user feedback during network change

REQUIREMENTS:
1. Add network change state machine (switching → switched → error)
2. Emit clear events for each state transition
3. Show loading UI during network switch
4. Gracefully handle network switch failures
5. Preserve component state during network change
6. Add network switch timeout (30s) with fallback

CONSTRAINTS:
- Must not break existing network change handlers
- Should work with both automatic and manual network switches
- User should be able to cancel network switch

FILES TO MODIFY:
- src/services/BlockchainService.js
- src/services/WalletService.js
- src/components/TradingInterface/TradingInterface.js

TEST CASES:
- Network switch shows loading state
- Failed network switch shows error message
- Component state preserved during switch
- Timeout triggers if switch takes too long
- User can cancel pending network switch
```

### Agent Prompt: Transaction Retry & Recovery

```
TASK: Add retry mechanisms and recovery UI for failed transactions

CONTEXT:
- Transaction failures throw errors but don't offer retry
- Users must manually retry failed transactions
- No distinction between retryable and non-retryable errors

REQUIREMENTS:
1. Classify errors as retryable (network, timeout) vs non-retryable (revert, user rejection)
2. Add `retryTransaction(txHash, maxRetries)` method
3. Show retry UI for retryable transaction failures
4. Add exponential backoff for retries
5. Track retry attempts and show progress
6. Add "View on Explorer" link for failed transactions

CONSTRAINTS:
- Should not auto-retry without user consent
- Retry should use same transaction parameters
- Must handle gas price updates for retries

FILES TO MODIFY:
- src/services/BlockchainService.js
- src/components/MessagePopup/MessagePopup.js
- Create: src/utils/transactionRetry.js

TEST CASES:
- Retryable errors show retry button
- Non-retryable errors show appropriate message
- Retry uses exponential backoff
- Retry respects max retry limit
- User can cancel retry attempts
```

---

## DOM Manipulation & Performance

### Current Implementation Analysis

**Location:** Component update methods, direct DOM manipulation

**Strengths:**
- Direct DOM access for performance-critical updates
- Event delegation reduces listener count

**Critical Issues:**

1. **Full innerHTML Replacement**
   - Entire component HTML replaced on update
   - Loses focus, scroll position, form state
   - Performance impact on large components

2. **Direct querySelector Usage**
   - Components query DOM directly (SwapInterface line 87-98)
   - No element reference caching
   - Fragile to HTML structure changes

3. **No Update Batching**
   - Multiple state updates trigger multiple renders
   - No requestAnimationFrame batching
   - Synchronous updates block UI

4. **Memory Leaks from DOM References**
   - Components hold DOM element references
   - References not cleared on unmount
   - Can prevent garbage collection

### Agent Prompt: Element Reference Caching

```
TASK: Implement element reference caching system

CONTEXT:
- Components use querySelector repeatedly for same elements
- SwapInterface queries DOM on every update (line 87-98)
- No caching of frequently accessed elements

REQUIREMENTS:
1. Add `refs` Map to Component for element references
2. Create `getRef(name, selector)` method that caches elements
3. Auto-invalidate refs on DOM updates
4. Support ref updates via `updateRef(name, element)`
5. Clear all refs on unmount
6. Add ref debugging in dev mode

CONSTRAINTS:
- Must work with dynamic DOM (elements added/removed)
- Should not hold stale references
- Performance should improve noticeably

FILES TO MODIFY:
- src/core/Component.js
- src/components/SwapInterface/SwapInterface.js (migrate to refs)

TEST CASES:
- Refs cache elements correctly
- Refs invalidate on DOM structure change
- Refs cleared on unmount
- Performance improvement measured
```

### Agent Prompt: RequestAnimationFrame Batching

```
TASK: Batch DOM updates using requestAnimationFrame

CONTEXT:
- Multiple setState calls trigger multiple synchronous renders
- Blocks UI thread during updates
- No coordination between component updates

REQUIREMENTS:
1. Create `UpdateScheduler` utility for batching updates
2. Queue component updates in current frame
3. Execute all queued updates in single requestAnimationFrame
4. Add `scheduleUpdate(component)` method
5. Support priority updates (immediate vs batched)
6. Add update timing metrics in dev mode

CONSTRAINTS:
- Must maintain current synchronous behavior for critical updates
- Should be opt-in per component
- Performance should improve for rapid state changes

FILES TO MODIFY:
- src/core/Component.js
- Create: src/utils/UpdateScheduler.js

TEST CASES:
- Multiple updates in same frame batched together
- Critical updates execute immediately
- UI remains responsive during batched updates
- Performance improvement measured
```

---

## Error Handling & Resilience

### Current Implementation Analysis

**Location:** Error handling scattered across components and services

**Strengths:**
- User-friendly error messages in WalletService
- Error wrapping with context in BlockchainService

**Critical Issues:**

1. **No Error Boundaries**
   - Component errors crash entire app
   - No fallback UI for errors
   - Errors not logged consistently

2. **Inconsistent Error Handling**
   - Some errors caught, some not
   - Different error formats across services
   - No centralized error logging

3. **No Offline Handling**
   - App doesn't handle network disconnection
   - No offline state indication
   - Failed requests don't queue for retry

### Agent Prompt: Error Boundary System

```
TASK: Implement error boundary pattern for component error handling

CONTEXT:
- Component errors can crash entire application
- No fallback UI when components fail
- Errors not caught at component level

REQUIREMENTS:
1. Add `ErrorBoundary` component wrapper
2. Catch errors in component lifecycle methods
3. Show fallback UI with error details (dev) or generic message (prod)
4. Add `onError(error, errorInfo)` lifecycle hook
5. Log errors to error tracking service
6. Support error recovery (retry button)

CONSTRAINTS:
- Must not break existing error handling
- Should provide useful error context
- Should not expose sensitive data in production

FILES TO MODIFY:
- src/core/Component.js
- Create: src/components/ErrorBoundary/ErrorBoundary.js

TEST CASES:
- Component errors caught by boundary
- Fallback UI shown on error
- Error logged correctly
- Error recovery works
- Nested error boundaries work
```

### Agent Prompt: Centralized Error Handling

```
TASK: Create centralized error handling and logging system

CONTEXT:
- Errors handled inconsistently across codebase
- No centralized error logging
- Different error formats make debugging hard

REQUIREMENTS:
1. Create `ErrorHandler` service for centralized error processing
2. Normalize error formats across services
3. Add error categorization (network, contract, user, system)
4. Log errors to console (dev) and error service (prod)
5. Add error context (component, action, user state)
6. Support error reporting UI for users

CONSTRAINTS:
- Must not break existing error handling
- Should be opt-in for gradual migration
- Performance impact should be minimal

FILES TO MODIFY:
- Create: src/services/ErrorHandler.js
- Update error handling in BlockchainService, WalletService

TEST CASES:
- All errors normalized to common format
- Errors logged with proper context
- Error categories assigned correctly
- User-facing errors are user-friendly
```

---

## Code Organization & Maintainability

### Current Implementation Analysis

**Issues:**

1. **Large Component Files**
   - TradingInterface.js: 1129 lines
   - SwapInterface.js: 944 lines
   - Hard to navigate and maintain

2. **Mixed Concerns**
   - UI logic mixed with business logic
   - Blockchain calls in components
   - No clear separation of concerns

3. **No Type Safety**
   - JavaScript without JSDoc or TypeScript
   - No parameter validation
   - Runtime errors from type mismatches

### Agent Prompt: Component Decomposition

```
TASK: Break down large components into smaller, focused components

CONTEXT:
- TradingInterface.js is 1129 lines, too large to maintain
- SwapInterface.js is 944 lines with mixed concerns
- Hard to test and reason about

REQUIREMENTS:
1. Identify logical sub-components in TradingInterface:
   - TabNavigation
   - TradingViewContainer
   - PortfolioButton
2. Extract SwapInterface sub-components:
   - SwapInputs
   - SwapButton
   - BalanceDisplay
   - TransactionOptionsContainer
3. Create composition pattern for complex components
4. Maintain existing functionality during refactor
5. Add component documentation

CONSTRAINTS:
- Must maintain backward compatibility
- Should not break existing tests
- Performance should not degrade

FILES TO MODIFY:
- src/components/TradingInterface/TradingInterface.js
- src/components/SwapInterface/SwapInterface.js
- Create new sub-component files

TEST CASES:
- All existing functionality works after decomposition
- Components are smaller and more focused
- No performance regression
- Easier to test individual components
```

### Agent Prompt: Business Logic Extraction

```
TASK: Extract business logic from components into services/hooks

CONTEXT:
- Components contain blockchain calls and business logic
- Hard to test business logic in isolation
- Logic duplicated across components

REQUIREMENTS:
1. Create `useTrading()` hook for trading logic
2. Create `useWallet()` hook for wallet logic
3. Extract price calculation logic to PriceService
4. Extract balance fetching to BalanceService
5. Components should only handle UI concerns
6. Add unit tests for extracted logic

CONSTRAINTS:
- Must maintain existing functionality
- Should use existing service patterns
- Hooks should be composable

FILES TO MODIFY:
- Create: src/hooks/useTrading.js
- Create: src/hooks/useWallet.js
- Extract logic from TradingInterface, SwapInterface
- Update PriceService, create BalanceService

TEST CASES:
- Business logic works in isolation
- Components use hooks correctly
- No functionality broken
- Logic easier to test
```

---

## Testing & Quality Assurance

### Current State

- No visible test files in codebase
- No testing framework configured
- No CI/CD pipeline visible

### Agent Prompt: Testing Infrastructure Setup

```
TASK: Set up testing infrastructure and write initial tests

CONTEXT:
- No tests exist for critical components
- No way to verify refactoring doesn't break functionality
- No confidence in code changes

REQUIREMENTS:
1. Set up Jest testing framework
2. Add test utilities for Component testing
3. Add test utilities for Store testing
4. Add test utilities for EventBus testing
5. Write tests for:
   - Component lifecycle (mount, update, unmount)
   - Store state management
   - EventBus pub/sub
   - BlockchainService error handling
6. Add test coverage reporting
7. Set up CI to run tests

CONSTRAINTS:
- Tests should run in Node.js environment
- Mock blockchain calls for unit tests
- Tests should be fast and reliable

FILES TO CREATE:
- jest.config.js
- src/__tests__/Component.test.js
- src/__tests__/Store.test.js
- src/__tests__/EventBus.test.js
- src/__tests__/utils/testHelpers.js

TEST CASES:
- All tests pass
- Coverage > 80% for core modules
- Tests run in CI
- Tests are maintainable
```

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1-2)
1. ✅ Event Listener Cleanup System
2. ✅ State Management Unification
3. ✅ Contract Read Caching

### Phase 2: Performance (Week 3-4)
1. ✅ DOM Update Optimization
2. ✅ Element Reference Caching
3. ✅ RequestAnimationFrame Batching

### Phase 3: Resilience (Week 5-6)
1. ✅ Error Boundary System
2. ✅ Network Change Resilience
3. ✅ Transaction Retry & Recovery

### Phase 4: Architecture (Week 7-8)
1. ✅ Component Decomposition
2. ✅ Business Logic Extraction
3. ✅ Testing Infrastructure

---

## Success Metrics

### Performance
- [ ] Component update time: < 16ms (60fps)
- [ ] Contract read cache hit rate: > 80%
- [ ] Memory usage: No leaks after 100 mount/unmount cycles

### Code Quality
- [ ] Component file size: < 300 lines
- [ ] Test coverage: > 80%
- [ ] Type safety: JSDoc on all public APIs

### User Experience
- [ ] Error recovery: < 2s for retryable errors
- [ ] Network switch: < 5s with loading state
- [ ] Transaction feedback: Immediate UI response

---

## Notes for Agents

### Working with This Codebase

1. **Backward Compatibility**: Always maintain existing functionality during refactors
2. **Incremental Changes**: Break large tasks into smaller PRs
3. **Testing**: Write tests before refactoring, verify after
4. **Documentation**: Update comments and docs with changes
5. **Performance**: Measure before/after for performance changes

### Common Patterns

- **Components**: Extend `Component` base class, implement `render()`, use `setState()`
- **State**: Use `tradingStore` for shared state, `this.state` for local UI state
- **Events**: Use `eventBus.on()` for subscriptions, return unsubscribe function
- **Services**: Singleton pattern, async initialization, error wrapping

### Red Flags

- ⚠️ Direct `innerHTML` manipulation outside Component.update()
- ⚠️ Event listeners not cleaned up in `unmount()`
- ⚠️ Blockchain calls without caching
- ⚠️ State updates not batched
- ⚠️ Errors swallowed without logging

---

## Conclusion

This report identifies 20+ specific improvement opportunities with actionable agent prompts. Each prompt is designed to be:
- **Specific**: Clear requirements and constraints
- **Actionable**: Concrete files to modify and test cases
- **Measurable**: Success criteria and metrics
- **Incremental**: Can be tackled independently

Priority should be given to P0 items (Event Cleanup, State Unification) as they address memory leaks and architectural issues that compound over time.

**Next Steps:**
1. Review and prioritize prompts based on current needs
2. Assign prompts to agents or development team
3. Track progress using the implementation roadmap
4. Update this document as improvements are completed

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Maintainer:** Development Team

