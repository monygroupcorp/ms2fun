import { Component } from '../../core/Component.js';
import serviceFactory from '../../services/ServiceFactory.js';

/**
 * GlobalActivityFeed component
 * Full page view of protocol-wide messages with pagination and filtering
 */
export class GlobalActivityFeed extends Component {
    constructor() {
        super();
        this.state = {
            messages: [],
            totalMessages: 0,
            loading: true,
            error: null,
            filter: 'all', // 'all', 'mint', 'buy', 'sell', 'stake', 'claim'
            page: 0,
            pageSize: 20,
            hasMore: true
        };
    }

    async onMount() {
        try {
            await this.loadMessages();
        } catch (error) {
            console.error('[GlobalActivityFeed] Error initializing:', error);
            this.setState({
                loading: false,
                error: 'Failed to load activity feed'
            });
        }
    }

    async loadMessages() {
        try {
            this.setState({ loading: true, error: null });

            // Get GlobalMessageRegistry adapter
            const masterService = serviceFactory.getMasterService();
            const messageRegistryAddress = await masterService.getGlobalMessageRegistry();

            if (!messageRegistryAddress || messageRegistryAddress === '0x0000000000000000000000000000000000000000') {
                console.warn('[GlobalActivityFeed] No message registry deployed');
                this.setState({
                    messages: [],
                    totalMessages: 0,
                    loading: false,
                    hasMore: false
                });
                return;
            }

            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();

            // Get total message count
            const totalMessages = await messageAdapter.getMessageCount();

            // Get paginated messages
            const { page, pageSize } = this.state;
            const offset = page * pageSize;

            let rawMessages;
            if (offset < totalMessages) {
                rawMessages = await messageAdapter.getRecentMessagesPaginated(offset, pageSize);
            } else {
                rawMessages = [];
            }

            // Transform messages to display format
            const messages = rawMessages.map((msg, index) => this.transformMessage(msg, totalMessages - offset - index));

            // Apply client-side filter
            const filteredMessages = this.applyFilter(messages);

            this.setState({
                messages: filteredMessages,
                totalMessages,
                loading: false,
                hasMore: offset + pageSize < totalMessages
            });
        } catch (error) {
            console.error('[GlobalActivityFeed] Error loading messages:', error);
            this.setState({
                messages: [],
                loading: false,
                error: error.message || 'Failed to load messages'
            });
        }
    }

    /**
     * Transform raw message from GlobalMessageRegistry to display format
     */
    transformMessage(rawMsg, messageId) {
        // Unpack the packed data
        const packedData = rawMsg.packedData || '0';
        const unpacked = this.unpackMessageData(packedData);

        return {
            id: messageId,
            instance: rawMsg.instance || '0x0',
            instanceName: this.shortenAddress(rawMsg.instance || '0x0'),
            user: rawMsg.sender || '0x0',
            messageType: this.getActionName(unpacked.actionType),
            message: rawMsg.message || '',
            timestamp: unpacked.timestamp || 0,
            formattedTime: this.formatTimestamp(unpacked.timestamp || 0),
            formattedDate: this.formatDate(unpacked.timestamp || 0),
            contextId: unpacked.contextId,
            amount: unpacked.amount
        };
    }

    /**
     * Unpack message data (matches GlobalMessagePacking.sol)
     */
    unpackMessageData(packedData) {
        try {
            let dataValue;
            if (packedData && packedData._hex) {
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
            const timestamp = bn & 0xFFFFFFFFn;
            const factoryType = (bn >> 32n) & 0xFFn;
            const actionType = (bn >> 40n) & 0xFFn;
            const contextId = (bn >> 48n) & 0xFFFFFFFFn;
            const amount = (bn >> 80n) & ((1n << 96n) - 1n);

            return {
                timestamp: Number(timestamp),
                factoryType: Number(factoryType),
                actionType: Number(actionType),
                contextId: Number(contextId),
                amount: amount.toString()
            };
        } catch (error) {
            console.error('[GlobalActivityFeed] Error unpacking message data:', error);
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
     * Apply client-side filter to messages
     */
    applyFilter(messages) {
        const { filter } = this.state;
        if (filter === 'all') {
            return messages;
        }
        return messages.filter(msg => msg.messageType === filter);
    }

    /**
     * Shorten address for display
     */
    shortenAddress(address) {
        if (!address || address.length < 10) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    /**
     * Format timestamp to relative time
     */
    formatTimestamp(timestamp) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const diff = now - timestamp;

            if (diff < 60) return 'Just now';
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
            return `${Math.floor(diff / 604800)}w ago`;
        } catch (error) {
            return '';
        }
    }

    /**
     * Format timestamp to date string
     */
    formatDate(timestamp) {
        try {
            return new Date(timestamp * 1000).toLocaleString();
        } catch (error) {
            return '';
        }
    }

    /**
     * Get icon for message type
     */
    getMessageIcon(type) {
        const iconMap = {
            'mint': '&#127912;',    // Artist palette
            'buy': '&#128200;',     // Chart up
            'sell': '&#128201;',    // Chart down
            'stake': '&#127919;',   // Target
            'unstake': '&#128275;', // Unlocked
            'claim': '&#128176;',   // Money bag
            'withdraw': '&#128181;', // Dollar
            'deploy': '&#128640;',  // Rocket
            'activity': '&#128221;' // Memo
        };
        return iconMap[type] || '&#128221;';
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
            'claim': 'claimed',
            'withdraw': 'withdrew',
            'deploy': 'deployed',
            'activity': 'activity'
        };
        return actionMap[messageType] || messageType;
    }

    async handleFilterChange(newFilter) {
        this.setState({ filter: newFilter, page: 0 });
        await this.loadMessages();
    }

    async handleNextPage() {
        const { page, hasMore } = this.state;
        if (hasMore) {
            this.setState({ page: page + 1 });
            await this.loadMessages();
        }
    }

    async handlePrevPage() {
        const { page } = this.state;
        if (page > 0) {
            this.setState({ page: page - 1 });
            await this.loadMessages();
        }
    }

    handleMessageClick(msg) {
        if (window.router) {
            window.router.navigate(`/project/${msg.instance}`);
        } else {
            window.location.href = `/project/${msg.instance}`;
        }
    }

    handleBackClick() {
        if (window.router) {
            window.router.navigate('/');
        } else {
            window.location.href = '/';
        }
    }

    render() {
        const { messages, totalMessages, loading, error, filter, page, pageSize, hasMore } = this.state;
        const startIndex = page * pageSize + 1;
        const endIndex = Math.min((page + 1) * pageSize, totalMessages);

        return `
            <div class="global-activity-feed">
                <header class="feed-header">
                    <button class="back-btn" data-ref="back-btn">
                        &#8592; Back to Home
                    </button>
                    <div class="header-content">
                        <h1 class="page-title">Global Activity Feed</h1>
                        <p class="page-subtitle">Protocol-wide messages and transactions</p>
                    </div>
                </header>

                <div class="feed-controls">
                    <div class="filter-section">
                        <span class="filter-label">Filter by Type:</span>
                        <div class="filter-buttons">
                            ${this.renderFilterButton('all', 'All', filter)}
                            ${this.renderFilterButton('mint', 'Mint', filter)}
                            ${this.renderFilterButton('buy', 'Buy', filter)}
                            ${this.renderFilterButton('sell', 'Sell', filter)}
                            ${this.renderFilterButton('stake', 'Stake', filter)}
                            ${this.renderFilterButton('claim', 'Claim', filter)}
                        </div>
                    </div>
                    <div class="message-count">
                        <strong>${totalMessages.toLocaleString()}</strong> total messages
                    </div>
                </div>

                <div class="feed-content">
                    ${this.renderContent(messages, loading, error)}
                </div>

                ${!loading && !error && messages.length > 0 ? `
                    <div class="feed-pagination">
                        <button class="page-btn ${page === 0 ? 'disabled' : ''}"
                                data-ref="prev-btn"
                                ${page === 0 ? 'disabled' : ''}>
                            &#8592; Previous
                        </button>
                        <span class="page-info">
                            Showing ${startIndex}-${endIndex} of ${totalMessages.toLocaleString()}
                        </span>
                        <button class="page-btn ${!hasMore ? 'disabled' : ''}"
                                data-ref="next-btn"
                                ${!hasMore ? 'disabled' : ''}>
                            Next &#8594;
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderFilterButton(value, label, currentFilter) {
        return `
            <button class="filter-btn ${currentFilter === value ? 'active' : ''}"
                    data-filter="${value}"
                    data-ref="filter-btn">
                ${label}
            </button>
        `;
    }

    renderContent(messages, loading, error) {
        if (loading) {
            return `
                <div class="feed-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading activity feed...</p>
                </div>
            `;
        }

        if (error) {
            return `
                <div class="feed-error">
                    <p>${this.escapeHtml(error)}</p>
                    <button class="retry-btn" data-ref="retry-btn">Try Again</button>
                </div>
            `;
        }

        if (messages.length === 0) {
            return `
                <div class="feed-empty">
                    <p>No activity found</p>
                </div>
            `;
        }

        return `
            <div class="message-table-container">
                <table class="message-table">
                    <thead>
                        <tr>
                            <th class="col-type">Type</th>
                            <th class="col-user">User</th>
                            <th class="col-action">Action</th>
                            <th class="col-message">Details</th>
                            <th class="col-project">Project</th>
                            <th class="col-time">Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${messages.map((msg, index) => this.renderMessageRow(msg, index)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderMessageRow(msg, index) {
        let displayText = msg.message || '';

        if (msg.messageType === 'mint' && msg.contextId) {
            const amountStr = msg.amount && msg.amount !== '0' && parseInt(msg.amount) > 1
                ? `${msg.amount}x ` : '';
            displayText = `${amountStr}Edition #${msg.contextId}${msg.message ? ` - ${msg.message}` : ''}`;
        }

        return `
            <tr class="message-row" data-index="${index}" data-ref="message-row">
                <td class="col-type">
                    <span class="type-icon" title="${this.escapeHtml(msg.messageType)}">
                        ${this.getMessageIcon(msg.messageType)}
                    </span>
                </td>
                <td class="col-user">
                    <span class="user-address">${this.escapeHtml(this.shortenAddress(msg.user))}</span>
                </td>
                <td class="col-action">
                    <span class="action-badge action-${msg.messageType}">
                        ${this.escapeHtml(this.formatAction(msg.messageType))}
                    </span>
                </td>
                <td class="col-message">
                    <span class="message-text">${this.escapeHtml(displayText) || '-'}</span>
                </td>
                <td class="col-project">
                    <span class="project-link">${this.escapeHtml(msg.instanceName)}</span>
                </td>
                <td class="col-time">
                    <span class="time-relative" title="${this.escapeHtml(msg.formattedDate)}">
                        ${this.escapeHtml(msg.formattedTime)}
                    </span>
                </td>
            </tr>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Back button
        const backBtn = this.getRef('back-btn', '.back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.handleBackClick());
        }

        // Filter buttons
        const filterBtns = this.getRefs('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const filterValue = btn.getAttribute('data-filter');
                if (filterValue) {
                    this.handleFilterChange(filterValue);
                }
            });
        });

        // Pagination buttons
        const prevBtn = this.getRef('prev-btn', '.page-btn[data-ref="prev-btn"]');
        const nextBtn = this.getRef('next-btn', '.page-btn[data-ref="next-btn"]');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.handlePrevPage());
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.handleNextPage());
        }

        // Message row click handlers
        const messageRows = this.getRefs('.message-row');
        messageRows.forEach((row, index) => {
            row.addEventListener('click', () => {
                const msg = this.state.messages[index];
                if (msg) {
                    this.handleMessageClick(msg);
                }
            });
        });

        // Retry button
        const retryBtn = this.getRef('retry-btn', '.retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.loadMessages());
        }
    }

    onStateUpdate(oldState, newState) {
        if (oldState.loading !== newState.loading ||
            oldState.filter !== newState.filter ||
            oldState.page !== newState.page) {
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
