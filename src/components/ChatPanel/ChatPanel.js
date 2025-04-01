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
            hasMore: true
        };
        this.MESSAGES_PER_PAGE = 5;
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

    checkAndLoadMessages() {
        if (this.contractDataUpdated) {
            const contractData = tradingStore.selectContractData();
            this.totalMessages = contractData.totalMessages || 0;
            
            // Check if recentMessages exists and has data
            if (contractData.recentMessages && Array.isArray(contractData.recentMessages) && contractData.recentMessages.length >= 5) {
                // Split the comma-separated strings into arrays
                const senders = contractData.recentMessages[0].split(',');
                const timestamps = contractData.recentMessages[1].split(',').map(Number);
                const amounts = contractData.recentMessages[2].split(',');
                const isBuys = contractData.recentMessages[3].split(',').map(str => str === 'true');
                const msgs = contractData.recentMessages[4].split(',');

                // Transform the batch data into message objects
                const messages = senders.map((sender, index) => ({
                    address: sender,
                    timestamp: timestamps[index],
                    content: msgs[index],
                    amount: amounts[index],
                    isBuy: isBuys[index]
                }));

                this.setState({
                    messages,
                    totalMessages: contractData.totalMessages,
                    dataReady: true
                });

                // Setup load more button after state update
                requestAnimationFrame(() => {
                    this.setupLoadMoreButton();
                });
            } else {
                // Handle empty state
                this.setState({
                    messages: [],
                    totalMessages: 0,
                    dataReady: true
                });
            }
        } else {
            console.log('ChatPanel: Waiting for contract data update');
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
        
        const nextPage = this.state.currentPage + 1;
        const startIndex = nextPage * this.MESSAGES_PER_PAGE;
        const endIndex = startIndex + this.MESSAGES_PER_PAGE;
        
        this.setState({ isLoading: true });
        
        try {
            await tradingStore.loadMessageBatch(startIndex, endIndex);
            
            // Get updated contract data after loading new batch
            const contractData = tradingStore.selectContractData();
            
            if (contractData.recentMessages) {
                
                // Split the comma-separated strings into arrays
                const senders = contractData.recentMessages[0].split(',');
                const timestamps = contractData.recentMessages[1].split(',').map(Number);
                const amounts = contractData.recentMessages[2].split(',');
                const isBuys = contractData.recentMessages[3].split(',').map(str => str === 'true');
                const msgs = contractData.recentMessages[4].split(',');

                // Transform new messages into message objects
                // Don't slice here - we want all messages from the new batch
                const newMessages = senders.map((sender, index) => {
                    const messageObj = {
                        address: sender,
                        timestamp: timestamps[index],
                        content: msgs[index],
                        amount: amounts[index],
                        isBuy: isBuys[index]
                    };
                    return messageObj;
                });

                // Combine existing messages with new ones
                const allMessages = [...this.state.messages, ...newMessages];

                // Check if we got fewer messages than requested
                const hasMore = endIndex < contractData.totalMessages;
                
                this.setState({
                    messages: allMessages,
                    currentPage: nextPage,
                    hasMore,
                    isLoading: false,
                    totalMessages: contractData.totalMessages
                });

                // Setup load more button after new messages are loaded
                requestAnimationFrame(() => {
                    this.setupLoadMoreButton();
                });
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

        return `
            <div class="chat-panel">
                <div class="chat-header">
                    <h2>EXEC INSIDER BULLETIN</h2>
                </div>
                <div class="chat-messages" id="chatMessages" style="height: 400px; overflow-y: auto; scroll-behavior: smooth;">
                    ${this.state.totalMessages > this.state.messages.length ? `
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
}

export default ChatPanel; 