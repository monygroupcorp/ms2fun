import { Component } from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { eventBus } from '../../core/EventBus.js';

class ChatPanel extends Component {
    constructor(rootElement) {
        super(rootElement);
        this.state = {
            messages: [],
            totalMessages: 0,
            dataReady: false,
            currentPage: 0,
            isLoading: false,
            hasMore: true,
            initialMessagesLoaded: 0 // Track how many initial messages we've loaded
        };
        this.MESSAGES_PER_PAGE = 5; // Initial load
        this.LOAD_MORE_COUNT = 10; // Load 10 more messages each time
        this.unsubscribeEvents = [];
        this.contractDataUpdated = false;
    }

    onMount() {
        this.setupEventListeners();
        
        // Initial load attempt
        this.checkAndLoadMessages();
        
        // Make sure event handlers are bound
        const loadMoreBtn = this.element.querySelector('.load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!this.state.isLoading) {
                    await this.loadMoreMessages();
                }
            });
        } else {
            //console.warn('ChatPanel: Load more button not found');
        }
    }

    onUnmount() {
        // Cleanup event listeners
        this.unsubscribeEvents.forEach(unsubscribe => unsubscribe());
    }

    setupEventListeners() {
        this.unsubscribeEvents = [
            eventBus.on('contractData:updated', (data) => {
                this.contractDataUpdated = true;
                this.checkAndLoadMessages();
            })
        ];
        
        // Add scroll listener cleanup
        // this.unsubscribeEvents.push(() => {
        //     const messagesContainer = this.element.querySelector('.chat-messages');
        //     if (messagesContainer) {
        //         messagesContainer.removeEventListener('scroll', this.handleScroll);
        //     }
        // });
    }

    /**
     * Parses comma-separated message data
     * Note: If message content contains commas, they will be split incorrectly
     * This is a limitation of how messages are stored on the blockchain
     */
    parseMessageData(messageString) {
        if (!messageString || messageString === '') {
            return [];
        }
        
        // Split on commas - this is how the blockchain stores messages
        // Unfortunately, if a message contains a comma, it will be split incorrectly
        // This is a known limitation that would require changing the blockchain contract to fix
        const parts = messageString.split(',');
        
        // Filter out empty strings and trim whitespace
        return parts
            .map(part => part.trim())
            .filter(part => part !== '');
    }

    checkAndLoadMessages() {
        if (this.contractDataUpdated) {
            const contractData = tradingStore.selectContractData();
            this.totalMessages = contractData.totalMessages || 0;
            
            if (contractData.recentMessages && Array.isArray(contractData.recentMessages) && contractData.recentMessages.length >= 5) {
                try {
                    // Parse the comma-separated strings into arrays, handling commas in messages
                    const senders = this.parseMessageData(contractData.recentMessages[0]);
                    const timestamps = this.parseMessageData(contractData.recentMessages[1]).map(Number);
                    const amounts = this.parseMessageData(contractData.recentMessages[2]);
                    const isBuys = this.parseMessageData(contractData.recentMessages[3]).map(str => str === 'true');
                    const msgs = this.parseMessageData(contractData.recentMessages[4]);

                    // Validate that all arrays have the same length
                    const maxLength = Math.max(senders.length, timestamps.length, amounts.length, isBuys.length, msgs.length);
                    const minLength = Math.min(senders.length, timestamps.length, amounts.length, isBuys.length, msgs.length);
                    
                    if (maxLength !== minLength) {
                        console.warn('ChatPanel: Array length mismatch in message data', {
                            senders: senders.length,
                            timestamps: timestamps.length,
                            amounts: amounts.length,
                            isBuys: isBuys.length,
                            msgs: msgs.length
                        });
                    }

                    // Transform the batch data into message objects, using the minimum length to avoid undefined
                    const messages = Array.from({ length: minLength }, (_, index) => ({
                        address: senders[index] || '',
                        timestamp: timestamps[index] || 0,
                        content: msgs[index] || '',
                        amount: amounts[index] || '0',
                        isBuy: isBuys[index] || false
                    })).filter(msg => msg.address && msg.address !== '') // Filter out empty messages
                    .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp (oldest first)

                    this.setState({
                        messages,
                        totalMessages: contractData.totalMessages,
                        dataReady: true,
                        hasMore: messages.length < contractData.totalMessages,
                        initialMessagesLoaded: messages.length
                    });

                    // Setup load more button after state update
                    requestAnimationFrame(() => {
                        this.setupLoadMoreButton();
                    });
                } catch (error) {
                    console.error('ChatPanel: Error parsing messages:', error);
                    this.setState({
                        messages: [],
                        totalMessages: contractData.totalMessages || 0,
                        dataReady: true,
                        hasMore: false
                    });
                }
            } else {
                // Handle empty state
                this.setState({
                    messages: [],
                    totalMessages: 0,
                    dataReady: true,
                    hasMore: false
                });
            }
        } else {
            //console.log('ChatPanel: Waiting for contract data update');
        }
    }

    setupLoadMoreButton() {
        const loadMoreBtn = this.element.querySelector('.load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!this.state.isLoading) {
                    await this.loadMoreMessages();
                }
            });
        } else {
            //console.warn('ChatPanel: Load more button not found');
        }
    }

    formatTimestamp(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    }

    formatAddress(address) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    async loadMoreMessages() {
        const { totalMessages, initialMessagesLoaded, currentPage } = this.state;
        
        // Calculate how many messages we've already loaded
        const alreadyLoaded = initialMessagesLoaded + (currentPage * this.LOAD_MORE_COUNT);
        
        // Don't load if we've already loaded all messages
        if (alreadyLoaded >= totalMessages) {
            this.setState({ hasMore: false, isLoading: false });
            return;
        }
        
        this.setState({ isLoading: true });
        
        try {
            // Calculate indices for older messages (going backwards from the most recent)
            // We want to load 10 older messages
            // If we've loaded the last 5 initially, then 10 more, we want messages before that
            const endIndex = totalMessages - alreadyLoaded - 1; // End index (exclusive, so -1)
            const startIndex = Math.max(0, endIndex - this.LOAD_MORE_COUNT + 1); // Start index (inclusive)
            
            console.log('Loading more messages:', { startIndex, endIndex, alreadyLoaded, totalMessages });
            
            // Get blockchain service instance
            if (!window.blockchainServiceInstance) {
                throw new Error('BlockchainService not available');
            }
            
            // Load the new batch of older messages directly from blockchain
            const newBatch = await window.blockchainServiceInstance.getMessagesBatch(startIndex, endIndex);
            
            if (newBatch && Array.isArray(newBatch) && newBatch.length >= 5) {
                try {
                    // Parse the new batch
                    const senders = this.parseMessageData(newBatch[0]);
                    const timestamps = this.parseMessageData(newBatch[1]).map(Number);
                    const amounts = this.parseMessageData(newBatch[2]);
                    const isBuys = this.parseMessageData(newBatch[3]).map(str => str === 'true');
                    const msgs = this.parseMessageData(newBatch[4]);

                    // Validate array lengths
                    const minLength = Math.min(senders.length, timestamps.length, amounts.length, isBuys.length, msgs.length);

                    // Transform new messages into message objects
                    const newMessages = Array.from({ length: minLength }, (_, index) => ({
                        address: senders[index] || '',
                        timestamp: timestamps[index] || 0,
                        content: msgs[index] || '',
                        amount: amounts[index] || '0',
                        isBuy: isBuys[index] || false
                    })).filter(msg => msg.address && msg.address !== ''); // Filter out empty messages

                    // Create a Set of existing message addresses+timestamps to avoid duplicates
                    const existingKeys = new Set(
                        this.state.messages.map(msg => `${msg.address}-${msg.timestamp}`)
                    );

                    // Filter out messages that already exist
                    const uniqueNewMessages = newMessages.filter(msg => {
                        const key = `${msg.address}-${msg.timestamp}`;
                        return !existingKeys.has(key);
                    });

                    // Sort by timestamp (oldest first) and combine
                    // Older messages should appear first (at the top)
                    const allMessages = [...uniqueNewMessages, ...this.state.messages]
                        .sort((a, b) => a.timestamp - b.timestamp);
                    
                    const nextPage = currentPage + 1;
                    const newTotalLoaded = initialMessagesLoaded + (nextPage * this.LOAD_MORE_COUNT);
                    const hasMore = newTotalLoaded < totalMessages;
                    
                    console.log('Loaded messages:', { 
                        newCount: uniqueNewMessages.length, 
                        totalCount: allMessages.length,
                        hasMore 
                    });
                    
                    // Preserve scroll position before update
                    const messagesContainer = this.element?.querySelector('.chat-messages');
                    const scrollTop = messagesContainer?.scrollTop || 0;
                    const scrollHeight = messagesContainer?.scrollHeight || 0;
                    
                    this.setState({
                        messages: allMessages,
                        currentPage: nextPage,
                        hasMore,
                        isLoading: false
                    });

                    // Restore scroll position and setup load more button after render
                    requestAnimationFrame(() => {
                        if (messagesContainer) {
                            // Calculate new scroll position to maintain relative position
                            const newScrollHeight = messagesContainer.scrollHeight;
                            const scrollDifference = newScrollHeight - scrollHeight;
                            // Maintain scroll position relative to top, accounting for new content
                            messagesContainer.scrollTop = scrollTop + scrollDifference;
                        }
                        this.setupLoadMoreButton();
                    });
                } catch (error) {
                    console.error('ChatPanel: Error parsing new messages:', error);
                    this.setState({ isLoading: false });
                }
            } else {
                console.warn('ChatPanel: No messages returned from batch load');
                this.setState({ isLoading: false, hasMore: false });
            }
        } catch (error) {
            console.error('ChatPanel: Error loading more messages:', error);
            this.setState({ isLoading: false });
        }
    }

    render() {
        if (!this.state.dataReady) {
            return `
                <div class="chat-panel">
                    <div class="chat-header">
                        <h2>EXEC INSIDER BULLETIN</h2>
                    </div>
                    <div class="chat-messages" id="chatMessages">
                        <div class="loading-message">Loading messages...</div>
                    </div>
                </div>
            `;
        }

        const contractData = tradingStore.selectContractData();
        const isChatClosed = contractData.liquidityPool && contractData.liquidityPool !== '0x0000000000000000000000000000000000000000';

        return `
            <div class="chat-panel">
                <div class="chat-header">
                    <h2>EXEC INSIDER BULLETIN</h2>
                </div>
                <div class="chat-messages" id="chatMessages" style="height: 400px; overflow-y: auto; scroll-behavior: smooth;">
                    ${this.state.hasMore ? `
                        <div class="load-more">
                            <button class="load-more-btn" ${this.state.isLoading ? 'disabled' : ''}>
                                ${this.state.isLoading ? 'Loading...' : 'Load More Messages'}
                            </button>
                        </div>
                    ` : ''}
                    ${this.state.messages.map(msg => `
                        <div class="message">
                            <div class="message-header">
                                <span class="message-address">${this.formatAddress(msg.address)}</span>
                                <span class="message-time">${this.formatTimestamp(msg.timestamp)}</span>
                            </div>
                            <p class="message-content">${msg.content}</p>
                            <div class="message-footer">
                                <span class="transaction-type">${msg.isBuy ? 'BUY' : 'SELL'}</span>
                                <span class="amount">${msg.amount.toString()} EXEC</span>
                            </div>
                        </div>
                    `).join('')}
                    ${isChatClosed ? '<div class="chat-closed-notice">The chat is closed. No more messages are allowed.</div>' : ''}
                </div>
                <div class="chat-status">
                    <span>MESSAGES LOADED FROM CHAIN</span>
                    <span class="message-count">${this.state.messages.length}/${this.state.totalMessages}</span>
                </div>
            </div>
        `;
    }

    events() {
        return {
            'click .load-more-btn': async (e) => {
                e.preventDefault();
                if (!this.state.isLoading) {
                    await this.loadMoreMessages();
                }
            }
        };
    }

    // Create DOM element for bulletin view
    renderBulletin() {
        const element = document.createElement('div');
        element.className = 'chat-panel';
        element.innerHTML = this.render();
        return element;
    }

    // Create DOM element for stats view
    renderStats() {
        const element = document.createElement('div');
        element.className = 'panel stats-panel';
        // Add stats panel content here if needed
        element.innerHTML = `
            <h2>System Status</h2>
            <!-- Add stats content -->
        `;
        return element;
    }

    // Method to handle different render types
    renderView(type) {
        switch(type) {
            case 'stats':
                return this.renderStats();
            case 'bulletin':
                return this.renderBulletin();
            default:
                return this.render();
        }
    }

    /**
     * Override shouldUpdate to prevent unnecessary re-renders
     * Only update if messages actually changed or other important state changed
     */
    shouldUpdate(oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;
        
        // Always update if messages array reference changed (new messages loaded)
        if (oldState.messages !== newState.messages) return true;
        
        // Update if loading state changed (affects UI)
        if (oldState.isLoading !== newState.isLoading) return true;
        if (oldState.hasMore !== newState.hasMore) return true;
        if (oldState.dataReady !== newState.dataReady) return true;
        
        // Update if total messages changed
        if (oldState.totalMessages !== newState.totalMessages) return true;
        
        // Don't update for other state changes that don't affect render
        return false;
    }
}

export default ChatPanel; 