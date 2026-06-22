/**
 * Microact/Micro-web3 Setup
 *
 * This module initializes the microact component system and micro-web3 services.
 * It provides a bridge between the new microact-based components and the existing
 * application infrastructure.
 */

// Import from npm packages - Vite resolves these
import { h, render, eventBus, Component, unmountRoot } from '@monygroupcorp/microact';
import {
    WalletService,
    EventIndexer,
    FloatingWalletButton,
    MessagePopup
} from '@monygroupcorp/micro-web3';

// Re-export microact core
export { h, render, eventBus, Component, unmountRoot };

/**
 * Application services singleton
 */
let services = null;

/**
 * Initialize all microact/micro-web3 services
 * @param {Object} options - Initialization options
 * @param {Object} options.walletIcons - Custom wallet icons (optional)
 * @returns {Object} Initialized services
 */
export async function initializeServices(options = {}) {
    if (services) {
        console.warn('[microact-setup] Services already initialized');
        return services;
    }

    // Initialize WalletService
    const walletService = new WalletService(eventBus);

    try {
        await walletService.initialize();

        if (options.walletIcons) {
            walletService.walletIcons = options.walletIcons;
        }

        console.log('[microact-setup] WalletService initialized');
    } catch (error) {
        console.error('[microact-setup] WalletService initialization failed:', error);
        // Continue - wallet is optional for read-only mode
    }

    // Store services
    services = {
        walletService,
        eventBus
    };

    // Set up global error handling for wallet events
    eventBus.on('wallet:error', (error) => {
        console.error('[microact-setup] Wallet error:', error);
    });

    return services;
}

/**
 * Get initialized services
 * @returns {Object|null} Services or null if not initialized
 */
export function getServices() {
    return services;
}

/**
 * Get WalletService instance
 * @returns {WalletService|null}
 */
export function getWalletService() {
    return services?.walletService || null;
}

/**
 * Create an EventIndexer for a contract
 * @param {Object} config - EventIndexer configuration
 * @param {Object} config.contract - Contract config (address, abi, deployBlock)
 * @param {Object} config.provider - Ethers provider (optional if using BlockchainService)
 * @param {Object} config.entities - Entity definitions (optional)
 * @param {Object} config.persistence - Storage config (optional)
 * @returns {EventIndexer}
 */
export function createEventIndexer(config) {
    return new EventIndexer(eventBus, config);
}

/**
 * Mount the FloatingWalletButton globally
 * @param {HTMLElement} container - Container element (optional, creates one if not provided)
 * @returns {HTMLElement} The container element
 */
export function mountFloatingWalletButton(container) {
    if (!services?.walletService) {
        console.error('[microact-setup] Cannot mount FloatingWalletButton - WalletService not initialized');
        return null;
    }

    if (!container) {
        container = document.createElement('div');
        container.id = 'floating-wallet-container';
        document.body.appendChild(container);
    }

    render(
        h(FloatingWalletButton, { walletService: services.walletService }),
        container
    );

    return container;
}

/**
 * Bridge: Convert legacy eventBus events to micro-web3 format
 * This allows gradual migration where old components can still work
 */
export function setupEventBridge(legacyEventBus) {
    // Forward wallet events from legacy to new
    const walletEvents = [
        'wallet:connected',
        'wallet:disconnected',
        'wallet:accountChanged',
        'wallet:chainChanged',
        'wallet:error'
    ];

    walletEvents.forEach(event => {
        legacyEventBus.on(event, (data) => {
            eventBus.emit(event, data);
        });

        eventBus.on(event, (data) => {
            // Avoid infinite loop - check if already from legacy
            if (!data?._fromLegacy) {
                legacyEventBus.emit(event, { ...data, _fromNew: true });
            }
        });
    });

    console.log('[microact-setup] Event bridge established');
}
