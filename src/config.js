/**
 * Configuration
 *
 * Feature flags and configuration settings.
 */

import { isMockMode } from './config/network.js';

/**
 * Temporary flag: Force mock mode until real services are implemented
 * Set to false once ProjectRegistry, MasterService, and FactoryService are implemented
 *
 * Phase 1: Only core contracts deployed (MasterRegistry, GlobalMessageRegistry)
 * Phase 2: Deploy factories, vaults, seed test data → then implement real services
 *
 * STATUS: Real contracts now deployed to Anvil fork - mock mode disabled
 */
const FORCE_MOCK_MODE_UNTIL_SERVICES_READY = false;

/**
 * Feature flag: Use mock services instead of real contracts
 *
 * Behavior:
 * - If FORCE_MOCK_MODE_UNTIL_SERVICES_READY is true → always use mock services
 * - Otherwise auto-detects based on network mode:
 *   - localhost (without ?network=mock) → uses local Anvil contracts
 *   - localhost?network=mock → uses mock services
 *   - mainnet → uses real deployed contracts
 */
export const USE_MOCK_SERVICES = FORCE_MOCK_MODE_UNTIL_SERVICES_READY || isMockMode();

/**
 * Other feature flags can be added here as needed
 */

