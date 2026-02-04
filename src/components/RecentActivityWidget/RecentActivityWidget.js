import { Component } from '../../core/Component.js';
import serviceFactory from '../../services/ServiceFactory.js';

/**
 * RecentActivityWidget component
 * Shows last 5 protocol-wide messages from GlobalMessageRegistry
 */
export class RecentActivityWidget extends Component {
    constructor(options = {}) {
        super();
        this.state = {
            messages: [],
            loading: true,
            error: null
        };
        // If true, wait for data from HomePageDataProvider instead of fetching
        this.useDataProvider = options.useDataProvider || false;
    }

    async onMount() {
        // Only fetch if not using data provider
        if (!this.useDataProvider) {
            try {
                await this.loadMessages();
            } catch (error) {
                console.error('[RecentActivityWidget] Error initializing:', error);
                this.setState({
                    loading: false,
                    error: 'Failed to load activity'
                });
            }
        }
    }

    /**
     * Set messages data from HomePageDataProvider
     * @param {Array} messages - Array of GlobalMessage objects from QueryService
     */
    setMessagesData(messages) {
        if (!Array.isArray(messages)) return;

        // Transform to display format
        const transformedMessages = messages.map(msg => this.transformMessage(msg));

        this.setState({
            messages: transformedMessages,
            loading: false,
            error: null
        });
    }

    async loadMessages() {
        try {
            this.setState({ loading: true, error: null });

            // Get GlobalMessageRegistry adapter
            const masterService = serviceFactory.getMasterService();
            const messageRegistryAddress = await masterService.getGlobalMessageRegistry();

            if (!messageRegistryAddress || messageRegistryAddress === '0x0000000000000000000000000000000000000000') {
                console.warn('[RecentActivityWidget] No message registry deployed');
                this.setState({
                    messages: [],
                    loading: false
                });
                return;
            }

            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();

            // Get recent messages (last 5)
            const rawMessages = await messageAdapter.getRecentMessages(5);

            // Transform messages to display format
            const messages = rawMessages.map(msg => this.transformMessage(msg));

            this.setState({
                messages,
                loading: false
            });
        } catch (error) {
            console.error('[RecentActivityWidget] Error loading messages:', error);
            // Show empty state instead of error for now
            this.setState({
                messages: [],
                loading: false
            });
        }
    }

    /**
     * Transform raw message from GlobalMessageRegistry to display format
     */
    transformMessage(rawMsg) {
        // Unpack the packed data
        const packedData = rawMsg.packedData || '0';
        const unpacked = this.unpackMessageData(packedData);

        // Debug logging (disabled)
        // console.log('[RecentActivityWidget] Packed data (hex):', packedData._hex || packedData);
        // console.log('[RecentActivityWidget] Unpacked:', unpacked);

        return {
            id: rawMsg.id || 0,
            instance: rawMsg.instance || '0x0',
            instanceName: this.shortenAddress(rawMsg.instance || '0x0'),
            user: rawMsg.sender || '0x0',
            messageType: this.getActionName(unpacked.actionType),
            message: rawMsg.message || '',
            timestamp: unpacked.timestamp || 0,
            formattedTime: this.formatTimestamp(unpacked.timestamp || 0),
            contextId: unpacked.contextId,
            amount: unpacked.amount
        };
    }

    /**
     * Unpack message data (simplified version - matches GlobalMessagePacking.sol)
     */
    unpackMessageData(packedData) {
        try {
            // Handle BigNumber objects from ethers.js
            let dataValue;
            if (packedData && packedData._hex) {
                // It's an ethers BigNumber
                dataValue = BigInt(packedData._hex);
            } else if (typeof packedData === 'string') {
                dataValue = BigInt(packedData);
            } else if (typeof packedData === 'number') {
                dataValue = BigInt(packedData);
            } else {
                dataValue = BigInt(packedData.toString());
            }

            const bn = dataValue;

            // Extract fields - matches GlobalMessagePacking.sol
            // Packing order: timestamp(0-31) | factoryType(32-39) | actionType(40-47) | contextId(48-79) | amount(80-175)
            const timestamp = bn & 0xFFFFFFFFn; // bits 0-31
            const factoryType = (bn >> 32n) & 0xFFn; // bits 32-39
            const actionType = (bn >> 40n) & 0xFFn; // bits 40-47
            const contextId = (bn >> 48n) & 0xFFFFFFFFn; // bits 48-79
            const amount = (bn >> 80n) & ((1n << 96n) - 1n); // bits 80-175

            return {
                timestamp: Number(timestamp),
                factoryType: Number(factoryType),
                actionType: Number(actionType),
                contextId: Number(contextId),
                amount: amount.toString()
            };
        } catch (error) {
            console.error('[RecentActivityWidget] Error unpacking message data:', error);
            return {
                timestamp: 0,
                factoryType: 0,
                actionType: 0,
                contextId: 0,
                amount: '0'
            };
        }
    }

    /**
     * Get action name from action type (matches GlobalMessageTypes.sol)
     */
    getActionName(actionType) {
        const actionMap = {
            0: 'buy',
            1: 'sell',
            2: 'mint',
            3: 'withdraw',
            4: 'stake',
            5: 'unstake',
            6: 'claim',
            7: 'deploy'
        };
        return actionMap[actionType] || 'activity';
    }

    /**
     * Shorten address for display
     */
    shortenAddress(address) {
        if (!address || address.length < 10) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    /**
     * Detect message type from message content
     */
    detectMessageType(message) {
        const lowerMessage = message.toLowerCase();

        if (lowerMessage.includes('mint')) return 'mint';
        if (lowerMessage.includes('bought') || lowerMessage.includes('buy')) return 'buy';
        if (lowerMessage.includes('sold') || lowerMessage.includes('sell')) return 'sell';
        if (lowerMessage.includes('stake')) return 'stake';
        if (lowerMessage.includes('unstake')) return 'unstake';
        if (lowerMessage.includes('claim')) return 'claim';

        return 'message';
    }

    /**
     * Get icon for message type
     */
    getMessageIcon(type) {
        const iconMap = {
            'mint': '🎨',
            'buy': '📈',
            'sell': '📉',
            'stake': '🎯',
            'unstake': '🔓',
            'claim': '💰',
            'message': '💬'
        };

        return iconMap[type] || '📝';
    }

    /**
     * Format timestamp to relative time (e.g., "2m ago")
     */
    formatTimestamp(timestamp) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const diff = now - timestamp;

            if (diff < 60) {
                return 'Just now';
            } else if (diff < 3600) {
                const minutes = Math.floor(diff / 60);
                return `${minutes}m ago`;
            } else if (diff < 86400) {
                const hours = Math.floor(diff / 3600);
                return `${hours}h ago`;
            } else {
                const days = Math.floor(diff / 86400);
                return `${days}d ago`;
            }
        } catch (error) {
            return '';
        }
    }

    /**
     * Truncate address for display
     */
    truncateAddress(address) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    /**
     * Format action type for display
     */
    formatAction(messageType) {
        const actionMap = {
            'mint': 'minted',
            'buy': 'bought',
            'sell': 'sold',
            'stake': 'staked',
            'unstake': 'unstaked',
            'claim': 'claimed rewards',
            'withdraw': 'withdrew',
            'deploy': 'deployed liquidity',
            'activity': 'did'
        };
        return actionMap[messageType] || messageType;
    }

    async handleRefresh() {
        await this.loadMessages();
    }

    async handleMessageClick(msg) {
        // Navigate to the project that generated this message using modern URL
        const { navigateToProject } = await import('../../utils/navigation.js');
        await navigateToProject(msg.instance);
    }

    handleViewAllClick() {
        if (window.router) {
            window.router.navigate('/messages');
        } else {
            window.location.href = '/messages';
        }
    }

    render() {
        const { messages, loading, error } = this.state;

        return `
            <div class="recent-activity-widget">
                <div class="widget-header">
                    <h3 class="widget-title">Recent Activity</h3>
                    <button class="refresh-btn" data-ref="refresh-btn" ${loading ? 'disabled' : ''}>
                        <svg class="refresh-icon ${loading ? 'spinning' : ''}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5M21 10V4M21 10H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>

                <div class="widget-content">
                    ${this.renderContent(messages, loading, error)}
                </div>

                ${!loading && !error && messages.length > 0 ? `
                    <div class="widget-footer">
                        <button class="view-all-btn" data-ref="view-all-btn">
                            View All Activity →
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderContent(messages, loading, error) {
        if (loading) {
            return `
                <div class="widget-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading activity...</p>
                </div>
            `;
        }

        if (error) {
            return `
                <div class="widget-error">
                    <p>${this.escapeHtml(error)}</p>
                </div>
            `;
        }

        if (messages.length === 0) {
            return `
                <div class="widget-empty">
                    <p>No recent activity</p>
                </div>
            `;
        }

        return `
            <div class="message-list">
                ${messages.map((msg, index) => {
                    // Build message display based on action type
                    let displayText = msg.message || '';

                    if (msg.messageType === 'mint' && msg.contextId && msg.amount) {
                        // Show edition info for mints
                        const amountStr = msg.amount > 1 ? `${msg.amount}x ` : '';
                        displayText = `${amountStr}Edition #${msg.contextId}${msg.message ? ` - ${msg.message}` : ''}`;
                    }

                    return `
                        <div class="message-row" data-index="${index}" data-ref="message-row">
                            <span class="message-wallet">${this.escapeHtml(this.truncateAddress(msg.user))}</span>
                            <span class="message-separator">·</span>
                            <span class="message-action">${this.escapeHtml(this.formatAction(msg.messageType))}</span>
                            <span class="message-separator">·</span>
                            <span class="message-text">${this.escapeHtml(displayText)}</span>
                            <span class="message-separator">·</span>
                            <span class="message-time">${this.escapeHtml(msg.formattedTime)}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Refresh button
        const refreshBtn = this.getRef('refresh-btn', '.refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.handleRefresh());
        }

        // Message row click handlers - use getRefs for multiple elements
        const messageRows = this.getRefs('.message-row');
        messageRows.forEach((row, index) => {
            row.addEventListener('click', () => {
                const msg = this.state.messages[index];
                if (msg) {
                    this.handleMessageClick(msg);
                }
            });
        });

        // View all button
        const viewAllBtn = this.getRef('view-all-btn', '.view-all-btn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => this.handleViewAllClick());
        }
    }

    onStateUpdate(oldState, newState) {
        // Re-setup DOM listeners when state changes
        if (oldState.loading !== newState.loading) {
            this.setTimeout(() => {
                this.setupDOMEventListeners();
            }, 0);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
