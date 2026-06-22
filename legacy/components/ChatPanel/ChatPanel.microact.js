/**
 * ChatPanel - Microact Version
 *
 * Displays transaction messages from the blockchain.
 * Shows sender, timestamp, content, and transaction type (buy/sell).
 *
 * NOTE: CANDIDATE FOR EventIndexer migration
 * This component fetches message data from contract storage (getMessagesBatch).
 * Could be replaced by indexing MessageSent or similar events, which would
 * eliminate the need for contract storage of message history.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export class ChatPanel extends Component {
    constructor(props = {}) {
        super(props);
        this.store = tradingStore;
        this.state = {
            messages: [],
            totalMessages: 0,
            dataReady: false,
            currentPage: 0,
            isLoading: false,
            hasMore: true,
            initialMessagesLoaded: 0
        };
        this.MESSAGES_PER_PAGE = 5;
        this.LOAD_MORE_COUNT = 10;
        this.contractDataUpdated = false;
    }

    didMount() {
        const unsub = eventBus.on('contractData:updated', () => {
            this.contractDataUpdated = true;
            this.checkAndLoadMessages();
        });

        this.registerCleanup(unsub);

        // Initial load attempt
        this.checkAndLoadMessages();
    }

    parseMessageData(messageString) {
        if (!messageString || messageString === '') {
            return [];
        }
        const parts = messageString.split(',');
        return parts.map(part => part.trim()).filter(part => part !== '');
    }

    checkAndLoadMessages() {
        if (this.contractDataUpdated) {
            const contractData = this.store.selectContractData();
            const totalMessages = contractData.totalMessages || 0;

            if (contractData.recentMessages && Array.isArray(contractData.recentMessages) && contractData.recentMessages.length >= 5) {
                try {
                    const senders = this.parseMessageData(contractData.recentMessages[0]);
                    const timestamps = this.parseMessageData(contractData.recentMessages[1]).map(Number);
                    const amounts = this.parseMessageData(contractData.recentMessages[2]);
                    const isBuys = this.parseMessageData(contractData.recentMessages[3]).map(str => str === 'true');
                    const msgs = this.parseMessageData(contractData.recentMessages[4]);

                    const minLength = Math.min(senders.length, timestamps.length, amounts.length, isBuys.length, msgs.length);

                    const messages = Array.from({ length: minLength }, (_, index) => ({
                        address: senders[index] || '',
                        timestamp: timestamps[index] || 0,
                        content: msgs[index] || '',
                        amount: amounts[index] || '0',
                        isBuy: isBuys[index] || false
                    })).filter(msg => msg.address && msg.address !== '')
                        .sort((a, b) => a.timestamp - b.timestamp);

                    this.setState({
                        messages,
                        totalMessages,
                        dataReady: true,
                        hasMore: messages.length < totalMessages,
                        initialMessagesLoaded: messages.length
                    });
                } catch (error) {
                    console.error('[ChatPanel] Error parsing messages:', error);
                    this.setState({
                        messages: [],
                        totalMessages,
                        dataReady: true,
                        hasMore: false
                    });
                }
            } else {
                this.setState({
                    messages: [],
                    totalMessages: 0,
                    dataReady: true,
                    hasMore: false
                });
            }
        }
    }

    formatTimestamp(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    }

    formatAddress(address) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    async handleLoadMore() {
        const { totalMessages, initialMessagesLoaded, currentPage, isLoading } = this.state;

        if (isLoading) return;

        const alreadyLoaded = initialMessagesLoaded + (currentPage * this.LOAD_MORE_COUNT);

        if (alreadyLoaded >= totalMessages) {
            this.setState({ hasMore: false, isLoading: false });
            return;
        }

        this.setState({ isLoading: true });

        try {
            const endIndex = totalMessages - alreadyLoaded - 1;
            const startIndex = Math.max(0, endIndex - this.LOAD_MORE_COUNT + 1);

            if (!window.blockchainServiceInstance) {
                throw new Error('BlockchainService not available');
            }

            const newBatch = await window.blockchainServiceInstance.getMessagesBatch(startIndex, endIndex);

            if (newBatch && Array.isArray(newBatch) && newBatch.length >= 5) {
                const senders = this.parseMessageData(newBatch[0]);
                const timestamps = this.parseMessageData(newBatch[1]).map(Number);
                const amounts = this.parseMessageData(newBatch[2]);
                const isBuys = this.parseMessageData(newBatch[3]).map(str => str === 'true');
                const msgs = this.parseMessageData(newBatch[4]);

                const minLength = Math.min(senders.length, timestamps.length, amounts.length, isBuys.length, msgs.length);

                const newMessages = Array.from({ length: minLength }, (_, index) => ({
                    address: senders[index] || '',
                    timestamp: timestamps[index] || 0,
                    content: msgs[index] || '',
                    amount: amounts[index] || '0',
                    isBuy: isBuys[index] || false
                })).filter(msg => msg.address && msg.address !== '');

                const existingKeys = new Set(
                    this.state.messages.map(msg => `${msg.address}-${msg.timestamp}`)
                );

                const uniqueNewMessages = newMessages.filter(msg => {
                    const key = `${msg.address}-${msg.timestamp}`;
                    return !existingKeys.has(key);
                });

                const allMessages = [...uniqueNewMessages, ...this.state.messages]
                    .sort((a, b) => a.timestamp - b.timestamp);

                const nextPage = currentPage + 1;
                const newTotalLoaded = initialMessagesLoaded + (nextPage * this.LOAD_MORE_COUNT);
                const hasMore = newTotalLoaded < totalMessages;

                this.setState({
                    messages: allMessages,
                    currentPage: nextPage,
                    hasMore,
                    isLoading: false
                });
            } else {
                this.setState({ isLoading: false, hasMore: false });
            }
        } catch (error) {
            console.error('[ChatPanel] Error loading more messages:', error);
            this.setState({ isLoading: false });
        }
    }

    render() {
        const { messages, totalMessages, dataReady, isLoading, hasMore } = this.state;

        if (!dataReady) {
            return h('div', { className: 'chat-panel' },
                h('div', { className: 'chat-header' },
                    h('h2', null, 'EXEC INSIDER BULLETIN')
                ),
                h('div', { className: 'chat-messages', id: 'chatMessages' },
                    h('div', { className: 'loading-message' }, 'Loading messages...')
                )
            );
        }

        const contractData = this.store.selectContractData();
        const isChatClosed = contractData.liquidityPool &&
            contractData.liquidityPool !== '0x0000000000000000000000000000000000000000';

        return h('div', { className: 'chat-panel' },
            h('div', { className: 'chat-header' },
                h('h2', null, 'EXEC INSIDER BULLETIN')
            ),
            h('div', {
                className: 'chat-messages',
                id: 'chatMessages',
                style: 'height: 400px; overflow-y: auto; scroll-behavior: smooth;'
            },
                hasMore && h('div', { className: 'load-more' },
                    h('button', {
                        className: 'load-more-btn',
                        disabled: isLoading,
                        onClick: this.bind(this.handleLoadMore)
                    }, isLoading ? 'Loading...' : 'Load More Messages')
                ),
                ...messages.map(msg =>
                    h('div', { className: 'message', key: `${msg.address}-${msg.timestamp}` },
                        h('div', { className: 'message-header' },
                            h('span', { className: 'message-address' }, this.formatAddress(msg.address)),
                            h('span', { className: 'message-time' }, this.formatTimestamp(msg.timestamp))
                        ),
                        h('p', { className: 'message-content' }, msg.content),
                        h('div', { className: 'message-footer' },
                            h('span', { className: 'transaction-type' }, msg.isBuy ? 'BUY' : 'SELL'),
                            h('span', { className: 'amount' }, `${msg.amount.toString()} EXEC`)
                        )
                    )
                ),
                isChatClosed && h('div', { className: 'chat-closed-notice' },
                    'The chat is closed. No more messages are allowed.'
                )
            ),
            h('div', { className: 'chat-status' },
                h('span', null, 'MESSAGES LOADED FROM CHAIN'),
                h('span', { className: 'message-count' }, `${messages.length}/${totalMessages}`)
            )
        );
    }
}

export default ChatPanel;
