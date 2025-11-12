/**
 * Mock Admin Service
 * 
 * Simulates admin function execution for mock contracts.
 * Stores admin state (metadata locked, style settings, etc.)
 */

import { loadMockData, saveMockData } from './mockData.js';

class MockAdminService {
    constructor() {
        this.data = null;
        this._loadData();
    }

    /**
     * Load mock data
     * @private
     */
    _loadData() {
        this.data = loadMockData();
        if (!this.data) {
            // Initialize if no data exists
            this.data = {
                adminStates: {}
            };
        }
        if (!this.data.adminStates) {
            this.data.adminStates = {};
        }
    }

    /**
     * Save mock data
     * @private
     */
    _save() {
        saveMockData(this.data);
    }

    /**
     * Get admin state for an instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Object} Admin state object
     */
    getAdminState(instanceAddress) {
        if (!instanceAddress) {
            return {};
        }

        this._loadData();
        return this.data.adminStates[instanceAddress] || {
            metadataLocked: false,
            style: null,
            metadata: null,
            paused: false,
            balance: '0'
        };
    }

    /**
     * Execute an admin function
     * @param {string} instanceAddress - Instance contract address
     * @param {string} functionName - Function name to execute
     * @param {Array} params - Function parameters
     * @returns {Promise<Object>} Execution result
     */
    async executeAdminFunction(instanceAddress, functionName, params = []) {
        if (!instanceAddress || !functionName) {
            throw new Error('Instance address and function name are required');
        }

        this._loadData();

        // Initialize admin state if it doesn't exist
        if (!this.data.adminStates[instanceAddress]) {
            this.data.adminStates[instanceAddress] = {
                metadataLocked: false,
                style: null,
                metadata: null,
                paused: false,
                balance: '0'
            };
        }

        const state = this.data.adminStates[instanceAddress];
        const result = {
            success: true,
            message: '',
            data: null
        };

        // Simulate function execution based on function name
        try {
            switch (functionName.toLowerCase()) {
                case 'setstyle':
                case 'setstyle':
                    if (params.length > 0) {
                        state.style = params[0];
                        result.message = 'Style updated successfully';
                        result.data = { style: params[0] };
                    } else {
                        throw new Error('Style value required');
                    }
                    break;

                case 'setmetadata':
                case 'updatemetadata':
                    if (state.metadataLocked) {
                        throw new Error('Metadata is locked and cannot be updated');
                    }
                    if (params.length > 0) {
                        state.metadata = params[0];
                        result.message = 'Metadata updated successfully';
                        result.data = { metadata: params[0] };
                    } else {
                        throw new Error('Metadata URI required');
                    }
                    break;

                case 'lockmetadata':
                    state.metadataLocked = true;
                    result.message = 'Metadata locked successfully';
                    result.data = { metadataLocked: true };
                    break;

                case 'unlockmetadata':
                    state.metadataLocked = false;
                    result.message = 'Metadata unlocked successfully';
                    result.data = { metadataLocked: false };
                    break;

                case 'withdraw':
                case 'withdrawfunds':
                    // Simulate withdrawal
                    const balance = state.balance || '0';
                    if (balance === '0' || BigInt(balance) === 0n) {
                        throw new Error('No funds available to withdraw');
                    }
                    // In real contract, this would transfer funds
                    // For mock, we just clear the balance
                    state.balance = '0';
                    result.message = 'Funds withdrawn successfully';
                    result.data = { withdrawn: balance };
                    break;

                case 'pause':
                    state.paused = true;
                    result.message = 'Contract paused successfully';
                    result.data = { paused: true };
                    break;

                case 'unpause':
                    state.paused = false;
                    result.message = 'Contract unpaused successfully';
                    result.data = { paused: false };
                    break;

                default:
                    // Generic admin function - just log it
                    result.message = `Admin function ${functionName} executed`;
                    result.data = { functionName, params };
            }

            // Save state
            this._save();

            // Simulate transaction delay
            await new Promise(resolve => setTimeout(resolve, 500));

            return result;
        } catch (error) {
            result.success = false;
            result.message = error.message || 'Function execution failed';
            return result;
        }
    }

    /**
     * Set contract balance (for testing withdrawals)
     * @param {string} instanceAddress - Instance contract address
     * @param {string} balance - Balance in wei (as string)
     */
    setContractBalance(instanceAddress, balance) {
        if (!instanceAddress) {
            return;
        }

        this._loadData();
        if (!this.data.adminStates[instanceAddress]) {
            this.data.adminStates[instanceAddress] = {};
        }
        this.data.adminStates[instanceAddress].balance = balance || '0';
        this._save();
    }

    /**
     * Get contract balance
     * @param {string} instanceAddress - Instance contract address
     * @returns {string} Balance in wei
     */
    getContractBalance(instanceAddress) {
        if (!instanceAddress) {
            return '0';
        }

        const state = this.getAdminState(instanceAddress);
        return state.balance || '0';
    }
}

// Create singleton instance
const mockAdminService = new MockAdminService();

export default mockAdminService;

