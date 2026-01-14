/**
 * GlobalMessageRegistry Adapter
 *
 * Wraps GlobalMessageRegistry contract functionality.
 * Handles global activity feed, instance messaging, and message queries.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

// Cache TTL - messages are realtime, minimal caching
const CACHE_TTL = {
    MESSAGE_COUNT: 10 * 1000,    // 10 seconds
    NO_CACHE: 0                   // No caching for messages (always fresh)
};

class GlobalMessageRegistryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'GlobalMessageRegistry', ethersProvider, signer);
        this.ethers = ethers;
    }

    /**
     * Initialize the adapter - load contract ABI and create contract instance
     */
    async initialize() {
        try {
            // Check if we have a mock provider
            const isMockProvider = this.provider && this.provider.isMock === true;

            if (isMockProvider) {
                this.initialized = true;
                this.isMock = true;
                eventBus.emit('contract:adapter:initialized', {
                    contractAddress: this.contractAddress,
                    contractType: this.contractType,
                    isMock: true
                });
                return true;
            }

            // Validate provider
            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available for contract initialization');
            }

            // Load contract ABI
            const abi = await loadABI('GlobalMessageRegistry');

            // Initialize main contract
            this.contract = new ethers.Contract(
                this.contractAddress,
                abi,
                this.signer || this.provider
            );

            this.initialized = true;
            eventBus.emit('contract:adapter:initialized', {
                contractAddress: this.contractAddress,
                contractType: this.contractType
            });

            return true;
        } catch (error) {
            throw this.wrapError(error, 'GlobalMessageRegistryAdapter initialization failed');
        }
    }

    // =========================
    // Global Activity Feed
    // =========================

    /**
     * Get total message count (protocol-wide)
     * @returns {Promise<number>} Total number of messages
     */
    async getMessageCount() {
        return await this.getCachedOrFetch('getMessageCount', [], async () => {
            const count = await this.executeContractCall('getMessageCount');
            return parseInt(count.toString());
        }, CACHE_TTL.MESSAGE_COUNT);
    }

    /**
     * Get recent messages (protocol-wide)
     * @param {number} count - Number of recent messages to retrieve
     * @returns {Promise<Array>} Array of message objects
     */
    async getRecentMessages(count) {
        const totalMessages = await this.getMessageCount();
        const messages = await this.executeContractCall('getRecentMessages', [count]);

        // Add message IDs based on their position in the array
        // Recent messages are: [totalMessages - count, ..., totalMessages - 1]
        const returnCount = Math.min(count, totalMessages);
        const startId = totalMessages - returnCount;

        return messages.map((msg, index) => ({
            ...this._parseMessage(msg),
            id: startId + index
        }));
    }

    /**
     * Get recent messages (paginated)
     * @param {number} offset - Offset from most recent
     * @param {number} limit - Number of messages to retrieve
     * @returns {Promise<Array>} Array of message objects
     */
    async getRecentMessagesPaginated(offset, limit) {
        const messages = await this.executeContractCall('getRecentMessagesPaginated', [offset, limit]);
        return messages.map(msg => this._parseMessage(msg));
    }

    /**
     * Get a single message by ID
     * @param {number} messageId - Message ID
     * @returns {Promise<Object>} Message object
     */
    async getMessage(messageId) {
        return await this.getCachedOrFetch('getMessage', [messageId], async () => {
            const msg = await this.executeContractCall('getMessage', [messageId]);
            return this._parseMessage(msg);
        }, CACHE_TTL.NO_CACHE); // Messages don't change, but keep fresh for now
    }

    // =========================
    // Instance Messaging
    // =========================

    /**
     * Get message count for specific instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<number>} Number of messages for this instance
     */
    async getMessageCountForInstance(instanceAddress) {
        return await this.getCachedOrFetch('getMessageCountForInstance', [instanceAddress], async () => {
            const count = await this.executeContractCall('getMessageCountForInstance', [instanceAddress]);
            return parseInt(count.toString());
        }, CACHE_TTL.MESSAGE_COUNT);
    }

    /**
     * Get messages for specific instance
     * @param {string} instanceAddress - Instance contract address
     * @param {number} count - Number of recent messages to retrieve
     * @returns {Promise<Array>} Array of message objects
     */
    async getInstanceMessages(instanceAddress, count) {
        const messages = await this.executeContractCall('getInstanceMessages', [instanceAddress, count]);
        return messages.map(msg => this._parseMessage(msg));
    }

    /**
     * Get instance messages (paginated)
     * @param {string} instanceAddress - Instance contract address
     * @param {number} offset - Offset from most recent
     * @param {number} limit - Number of messages to retrieve
     * @returns {Promise<Array>} Array of message objects
     */
    async getInstanceMessagesPaginated(instanceAddress, offset, limit) {
        const messages = await this.executeContractCall(
            'getInstanceMessagesPaginated',
            [instanceAddress, offset, limit]
        );
        return messages.map(msg => this._parseMessage(msg));
    }

    /**
     * Get message IDs for instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<Array<number>>} Array of message IDs
     */
    async getInstanceMessageIds(instanceAddress) {
        const ids = await this.executeContractCall('getInstanceMessageIds', [instanceAddress]);
        return ids.map(id => parseInt(id.toString()));
    }

    // =========================
    // Batch Operations
    // =========================

    /**
     * Get multiple messages by IDs (batch query)
     * @param {Array<number>} messageIds - Array of message IDs
     * @returns {Promise<Array>} Array of message objects
     */
    async getMessagesBatch(messageIds) {
        if (!Array.isArray(messageIds) || messageIds.length === 0) {
            return [];
        }

        const messages = await this.executeContractCall('getMessagesBatch', [messageIds]);
        return messages.map(msg => this._parseMessage(msg));
    }

    /**
     * Get messages for multiple instances
     * @param {Array<string>} instanceAddresses - Array of instance addresses
     * @param {number} limitPerInstance - Messages per instance
     * @returns {Promise<Object>} Map of instance address -> messages array
     */
    async getMessagesForInstances(instanceAddresses, limitPerInstance = 10) {
        const results = {};

        // Batch queries in parallel
        const messagePromises = instanceAddresses.map(async (instance) => {
            const messages = await this.getInstanceMessages(instance, limitPerInstance);
            return { instance, messages };
        });

        const settled = await Promise.allSettled(messagePromises);

        settled.forEach((result) => {
            if (result.status === 'fulfilled') {
                const { instance, messages } = result.value;
                results[instance] = messages;
            }
        });

        return results;
    }

    // =========================
    // Authorization Queries
    // =========================

    /**
     * Check if instance is authorized to post messages
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<boolean>} True if authorized
     */
    async isAuthorized(instanceAddress) {
        return await this.getCachedOrFetch('isAuthorized', [instanceAddress], async () => {
            return await this.executeContractCall('isAuthorized', [instanceAddress]);
        }, CACHE_TTL.MESSAGE_COUNT);
    }

    // =========================
    // Helper Methods
    // =========================

    /**
     * Parse message from contract response
     * @private
     * @param {Object|Array} msg - Message from contract
     * @returns {Object} Parsed message object
     */
    _parseMessage(msg) {
        // GlobalMessage struct: instance (0), sender (1), packedData (2), message (3)
        return {
            instance: msg.instance || msg[0],
            sender: msg.sender || msg[1],
            packedData: msg.packedData || msg[2] || '0',
            message: msg.message || msg[3] || ''
        };
    }

    /**
     * Format messages for display
     * Adds human-readable timestamps and formatting
     * @param {Array} messages - Array of parsed messages
     * @returns {Array} Formatted messages
     */
    formatMessagesForDisplay(messages) {
        return messages.map(msg => ({
            ...msg,
            timeAgo: this._getTimeAgo(msg.timestamp),
            formattedDate: new Date(msg.timestamp * 1000).toLocaleString()
        }));
    }

    /**
     * Get "time ago" string from timestamp
     * @private
     * @param {number} timestamp - Unix timestamp
     * @returns {string} Human-readable time ago (e.g., "5 minutes ago")
     */
    _getTimeAgo(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const diff = now - timestamp;

        if (diff < 60) return `${diff} seconds ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
        if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
        return `${Math.floor(diff / 2592000)} months ago`;
    }

    // =========================
    // Public State Variables & Additional View Functions
    // =========================

    /**
     * Get master registry address
     * @returns {Promise<string>} Master registry contract address
     */
    async masterRegistry() {
        return await this.getCachedOrFetch('masterRegistry', [], async () => {
            return await this.executeContractCall('masterRegistry');
        }, CACHE_TTL.MESSAGE_COUNT);
    }

    /**
     * Get message count (state variable accessor)
     * @returns {Promise<number>} Total message count
     */
    async messageCount() {
        return await this.getCachedOrFetch('messageCount', [], async () => {
            const count = await this.executeContractCall('messageCount');
            return parseInt(count.toString());
        }, CACHE_TTL.MESSAGE_COUNT);
    }

    /**
     * Get message by index (state variable array accessor)
     * @param {number} index - Message index
     * @returns {Promise<Object>} Message object
     */
    async messages(index) {
        return await this.getCachedOrFetch('messages', [index], async () => {
            const msg = await this.executeContractCall('messages', [index]);
            return this._parseMessage(msg);
        }, CACHE_TTL.NO_CACHE);
    }

    /**
     * Get messages range
     * @param {number} startIndex - Start message index
     * @param {number} endIndex - End message index
     * @returns {Promise<Array>} Array of messages
     */
    async getMessagesRange(startIndex, endIndex) {
        const messages = await this.executeContractCall('getMessagesRange', [startIndex, endIndex]);
        return messages.map(msg => this._parseMessage(msg));
    }

    /**
     * Get total message count (alternative getter)
     * @returns {Promise<number>} Total messages
     */
    async totalMessages() {
        return await this.getCachedOrFetch('totalMessages', [], async () => {
            const count = await this.executeContractCall('totalMessages');
            return parseInt(count.toString());
        }, CACHE_TTL.MESSAGE_COUNT);
    }

    // =========================
    // Contract Metadata
    // =========================

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            totalMessages: await this.getMessageCount()
        };
    }

    /**
     * Get balance (not applicable for message registry)
     * @returns {Promise<string>} Always returns '0'
     */
    async getBalance(address) {
        return '0';
    }

    /**
     * Get price (not applicable for message registry)
     * @returns {Promise<number>} Always returns 0
     */
    async getPrice() {
        return 0;
    }
}

export default GlobalMessageRegistryAdapter;
