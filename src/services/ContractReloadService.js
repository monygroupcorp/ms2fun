/**
 * Contract Reload Service
 *
 * Listens for contract config changes from the dev server and automatically
 * clears cached contract adapters to pick up new deployments.
 */

import { clearABICache } from '../utils/abiLoader.js';
import { eventBus } from '../core/EventBus.js';
import { detectNetwork } from '../config/network.js';

class ContractReloadService {
    constructor() {
        this.eventSource = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    /**
     * Start listening for contract config changes
     * Only runs in local development mode
     */
    start() {
        const network = detectNetwork();

        // Only enable in local mode
        if (network.mode !== 'local') {
            console.log('[ContractReload] Skipping - not in local mode');
            return;
        }

        if (this.eventSource) {
            console.log('[ContractReload] Already connected');
            return;
        }

        this.connect();
    }

    /**
     * Connect to SSE endpoint
     */
    connect() {
        try {
            console.log('[ContractReload] Connecting to contract reload events...');

            this.eventSource = new EventSource('/api/contract-reload-events');

            this.eventSource.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                console.log('✅ [ContractReload] Connected - watching for contract changes');
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('[ContractReload] Error parsing SSE message:', error);
                }
            };

            this.eventSource.onerror = () => {
                this.isConnected = false;
                this.eventSource.close();
                this.eventSource = null;

                // Attempt reconnect with backoff
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
                    console.log(`[ContractReload] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                    setTimeout(() => this.connect(), delay);
                } else {
                    console.warn('[ContractReload] Max reconnect attempts reached - contract hot reload disabled');
                }
            };
        } catch (error) {
            console.error('[ContractReload] Error connecting:', error);
        }
    }

    /**
     * Handle SSE message
     */
    handleMessage(data) {
        switch (data.type) {
            case 'connected':
                console.log('[ContractReload] Initial connection established');
                break;

            case 'contract-config-changed':
                console.log('🔄 [ContractReload] Contract config changed - reloading adapters...');
                this.reloadContracts();
                break;

            default:
                console.warn('[ContractReload] Unknown message type:', data.type);
        }
    }

    /**
     * Reload contracts by clearing caches
     */
    reloadContracts() {
        try {
            // Clear ABI cache
            clearABICache();
            console.log('  ✓ Cleared ABI cache');

            // Emit event to notify services
            eventBus.emit('contracts:reloaded');

            // Show user notification
            this.showReloadNotification();

            // Reload the page after a short delay to allow services to clean up
            setTimeout(() => {
                console.log('  ✓ Reloading page...');
                window.location.reload();
            }, 500);
        } catch (error) {
            console.error('[ContractReload] Error reloading contracts:', error);
        }
    }

    /**
     * Show user notification about contract reload
     */
    showReloadNotification() {
        // Create a simple toast notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 16px 24px;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            font-family: monospace;
            font-size: 14px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = '🔄 Contracts updated - reloading...';

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(notification);

        // Remove after reload
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 1000);
    }

    /**
     * Stop listening
     */
    stop() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            this.isConnected = false;
            console.log('[ContractReload] Disconnected');
        }
    }

    /**
     * Check if connected
     */
    isActive() {
        return this.isConnected;
    }
}

// Export singleton instance
const contractReloadService = new ContractReloadService();
export default contractReloadService;
