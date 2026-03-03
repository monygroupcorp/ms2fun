/**
 * ActivityIndexer
 *
 * Indexes recent activity from GlobalMessageRegistry events and ERC404/ERC1155 transfers.
 * Provides formatted activity feed for the homepage.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { loadABI } from '../utils/abiLoader.js';

const RECENT_BLOCKS = 5000; // Look back 5000 blocks (~17 hours on mainnet, ~instant on Anvil)

export class ActivityIndexer {
    constructor(config, provider = null) {
        this.config = config;
        this.provider = provider;
    }

    /**
     * Initialize the indexer with a provider
     */
    async initialize() {
        // If provider not provided in constructor, create one
        if (!this.provider) {
            try {
                // Connect to local Anvil
                this.provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');

                // Test connection
                await this.provider.getBlockNumber();

                return true;
            } catch (error) {
                console.error('[ActivityIndexer] Failed to initialize:', error);
                return false;
            }
        }
        return true;
    }

    /**
     * Index recent activity from all sources
     * @returns {Promise<Array>} Formatted activity items
     */
    async indexRecentActivity() {
        if (!this.provider) {
            await this.initialize();
        }

        if (!this.provider || !this.config) {
            return [];
        }

        try {
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - RECENT_BLOCKS);

            // Query all activity sources in parallel
            const [messages, erc404Transfers, erc1155Transfers] = await Promise.all([
                this._indexMessages(fromBlock, currentBlock),
                this._indexERC404Transfers(fromBlock, currentBlock),
                this._indexERC1155Transfers(fromBlock, currentBlock)
            ]);

            // Combine and sort by timestamp (newest first)
            const allActivity = [...messages, ...erc404Transfers, ...erc1155Transfers]
                .sort((a, b) => b.timestamp - a.timestamp);

            return allActivity;
        } catch (error) {
            console.error('[ActivityIndexer] Error indexing activity:', error);
            return [];
        }
    }

    /**
     * Index MessageAdded events from GlobalMessageRegistry
     * @private
     */
    async _indexMessages(fromBlock, toBlock) {
        try {
            const messageRegistryAddress = this.config.contracts?.GlobalMessageRegistry;
            if (!messageRegistryAddress) {
                return [];
            }

            const abi = await loadABI('GlobalMessageRegistry');
            const contract = new ethers.Contract(messageRegistryAddress, abi, this.provider);

            // Query MessagePosted events
            const filter = contract.filters.MessagePosted();
            const events = await contract.queryFilter(filter, fromBlock, toBlock);

            // Get unique block numbers to fetch timestamps
            const blockNumbers = [...new Set(events.map(e => e.blockNumber))];
            const blockTimestamps = new Map();

            // Fetch block timestamps in parallel
            await Promise.all(
                blockNumbers.map(async (blockNum) => {
                    try {
                        const block = await this.provider.getBlock(blockNum);
                        blockTimestamps.set(blockNum, block.timestamp);
                    } catch (error) {
                        console.error(`[ActivityIndexer] Error fetching block ${blockNum}:`, error);
                        blockTimestamps.set(blockNum, Math.floor(Date.now() / 1000));
                    }
                })
            );

            return events.map(event => {
                    const {
                        messageId,
                        instance,
                        sender,
                        messageType,
                        refId,
                        actionRef,
                        metadata,
                        content
                    } = event.args;

                    // Find the project name from instances
                    const projectName = this._findProjectName(instance);

                    // Get timestamp from block
                    const timestamp = blockTimestamps.get(event.blockNumber) || Math.floor(Date.now() / 1000);

                    return {
                        type: 'message',
                        messageId: messageId.toNumber(),
                        project: projectName || this._truncateAddress(instance),
                        projectAddress: instance,
                        user: this._truncateAddress(sender),
                        userAddress: sender,
                        content: content,
                        timestamp: timestamp,
                        blockNumber: event.blockNumber,
                        // Fields from GlobalMessageRegistry
                        messageType: messageType,
                        refId: refId.toNumber(),
                        actionRef,
                        metadata,
                        // Generate display text
                        text: this._formatMessageText(sender, instance, projectName, content, messageType, refId)
                    };
                });
        } catch (error) {
            console.error('[ActivityIndexer] Error indexing messages:', error);
            return [];
        }
    }

    /**
     * Format message text based on message type
     * @private
     */
    _formatMessageText(sender, instance, projectName, content, messageType, refId) {
        const senderShort = this._truncateAddress(sender);
        const projectDisplay = projectName || this._truncateAddress(instance);

        // MessageType values (from contract):
        // 0 = STANDALONE
        // 1 = REACTION (filtered out before this point)
        // 2 = REPLY
        // 3 = QUOTE

        if (messageType === 2) {
            // Reply
            return `${senderShort} replied to message #${refId} on ${projectDisplay}: "${content}"`;
        } else if (messageType === 3) {
            // Quote
            return `${senderShort} quoted message #${refId} on ${projectDisplay}: "${content}"`;
        } else {
            // Standalone message (messageType = 0)
            return `${senderShort} posted on ${projectDisplay}: "${content}"`;
        }
    }

    /**
     * Get block timestamps for a list of events
     * @private
     */
    async _getBlockTimestamps(events) {
        const blockNumbers = [...new Set(events.map(e => e.blockNumber))];
        const blockTimestamps = new Map();

        await Promise.all(
            blockNumbers.map(async (blockNum) => {
                try {
                    const block = await this.provider.getBlock(blockNum);
                    blockTimestamps.set(blockNum, block.timestamp);
                } catch (error) {
                    blockTimestamps.set(blockNum, Math.floor(Date.now() / 1000));
                }
            })
        );

        return blockTimestamps;
    }

    /**
     * Index ERC404 Transfer events
     * @private
     */
    async _indexERC404Transfers(fromBlock, toBlock) {
        try {
            const instances = this.config.instances?.erc404 || [];
            if (instances.length === 0) {
                return [];
            }

            // Simple Transfer event ABI (ERC20-like transfers in ERC404)
            const transferAbi = ['event Transfer(address indexed from, address indexed to, uint256 value)'];

            const transferPromises = instances.map(async (instance) => {
                try {
                    const contract = new ethers.Contract(instance.address, transferAbi, this.provider);
                    const filter = contract.filters.Transfer();
                    const events = await contract.queryFilter(filter, fromBlock, toBlock);

                    const filtered = events
                        .filter(e => e.args.from !== ethers.constants.AddressZero) // Filter mints
                        .filter(e => e.args.to !== ethers.constants.AddressZero);   // Filter burns

                    // Get block timestamps
                    const blockTimestamps = await this._getBlockTimestamps(filtered);

                    return filtered.map(event => {
                        const { from, to, value } = event.args;
                        const amount = ethers.utils.formatEther(value);

                        return {
                            type: 'trade',
                            project: instance.name || this._truncateAddress(instance.address),
                            projectAddress: instance.address,
                            user: this._truncateAddress(to),
                            userAddress: to,
                            amount: `${parseFloat(amount).toFixed(2)} ${instance.symbol}`,
                            timestamp: blockTimestamps.get(event.blockNumber) || Math.floor(Date.now() / 1000),
                            blockNumber: event.blockNumber,
                            text: `${this._truncateAddress(to)} bought ${parseFloat(amount).toFixed(2)} ${instance.symbol}`
                        };
                    });
                } catch (error) {
                    return [];
                }
            });

            const results = await Promise.all(transferPromises);
            return results.flat();
        } catch (error) {
            console.error('[ActivityIndexer] Error indexing ERC404 transfers:', error);
            return [];
        }
    }

    /**
     * Index ERC1155 TransferSingle events
     * @private
     */
    async _indexERC1155Transfers(fromBlock, toBlock) {
        try {
            const instances = this.config.instances?.erc1155 || [];
            if (instances.length === 0) {
                return [];
            }

            // ERC1155 TransferSingle event ABI
            const transferAbi = ['event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'];

            const transferPromises = instances.map(async (instance) => {
                try {
                    const contract = new ethers.Contract(instance.address, transferAbi, this.provider);
                    const filter = contract.filters.TransferSingle();
                    const events = await contract.queryFilter(filter, fromBlock, toBlock);

                    const filtered = events
                        .filter(e => e.args.from === ethers.constants.AddressZero); // Only mints

                    // Get block timestamps
                    const blockTimestamps = await this._getBlockTimestamps(filtered);

                    return filtered.map(event => {
                        const { to, id, value } = event.args;

                        return {
                            type: 'mint',
                            project: instance.name || this._truncateAddress(instance.address),
                            projectAddress: instance.address,
                            user: this._truncateAddress(to),
                            userAddress: to,
                            amount: `${value.toString()} edition #${id.toString()}`,
                            timestamp: blockTimestamps.get(event.blockNumber) || Math.floor(Date.now() / 1000),
                            blockNumber: event.blockNumber,
                            text: `${this._truncateAddress(to)} minted ${value.toString()}x ${instance.name} #${id.toString()}`
                        };
                    });
                } catch (error) {
                    return [];
                }
            });

            const results = await Promise.all(transferPromises);
            return results.flat();
        } catch (error) {
            console.error('[ActivityIndexer] Error indexing ERC1155 transfers:', error);
            return [];
        }
    }

    /**
     * Find project name by address
     * @private
     */
    _findProjectName(address) {
        const allInstances = [
            ...(this.config.instances?.erc404 || []),
            ...(this.config.instances?.erc1155 || [])
        ];

        const project = allInstances.find(p => p.address.toLowerCase() === address.toLowerCase());
        return project?.name;
    }

    /**
     * Truncate address for display
     * @private
     */
    _truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
}

export default ActivityIndexer;
