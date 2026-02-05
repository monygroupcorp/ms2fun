/**
 * GlobalActivityFeed - Microact Version
 *
 * Full page view of protocol-wide messages with pagination and filtering.
 * Uses GlobalMessageRegistry - candidate for EventIndexer migration.
 * See: docs/plans/2026-02-04-contract-event-migration.md
 */

import { Component, h } from '../../core/microact-setup.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { isPreLaunch } from '../../config/contractConfig.js';

export class GlobalActivityFeed extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            messages: [],
            totalMessages: 0,
            loading: true,
            error: null,
            filter: 'all',
            page: 0,
            pageSize: 20,
            hasMore: true
        };
    }

    async didMount() {
        try {
            await this.loadMessages();
        } catch (error) {
            console.error('[GlobalActivityFeed] Error initializing:', error);
            this.setState({ loading: false, error: 'Failed to load activity feed' });
        }
    }

    async loadMessages() {
        try {
            this.setState({ loading: true, error: null });

            const preLaunch = await isPreLaunch();
            if (preLaunch) {
                this.setState({ messages: [], totalMessages: 0, loading: false, hasMore: false });
                return;
            }

            const masterService = serviceFactory.getMasterService();
            const messageRegistryAddress = await masterService.getGlobalMessageRegistry();

            if (!messageRegistryAddress || messageRegistryAddress === '0x0000000000000000000000000000000000000000') {
                this.setState({ messages: [], totalMessages: 0, loading: false, hasMore: false });
                return;
            }

            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
            const totalMessages = await messageAdapter.getMessageCount();

            const { page, pageSize } = this.state;
            const offset = page * pageSize;

            let rawMessages = [];
            if (offset < totalMessages) {
                rawMessages = await messageAdapter.getRecentMessagesPaginated(offset, pageSize);
            }

            const messages = rawMessages.map((msg, index) =>
                this.transformMessage(msg, totalMessages - offset - index)
            );

            const filteredMessages = this.applyFilter(messages);

            this.setState({
                messages: filteredMessages,
                totalMessages,
                loading: false,
                hasMore: offset + pageSize < totalMessages
            });
        } catch (error) {
            console.error('[GlobalActivityFeed] Error loading messages:', error);
            this.setState({ messages: [], loading: false, error: error.message || 'Failed to load messages' });
        }
    }

    transformMessage(rawMsg, messageId) {
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

    unpackMessageData(packedData) {
        try {
            let dataValue;
            if (packedData?._hex) {
                dataValue = BigInt(packedData._hex);
            } else if (typeof packedData === 'string') {
                dataValue = BigInt(packedData);
            } else {
                dataValue = BigInt(packedData.toString());
            }

            const bn = dataValue;
            return {
                timestamp: Number(bn & 0xFFFFFFFFn),
                factoryType: Number((bn >> 32n) & 0xFFn),
                actionType: Number((bn >> 40n) & 0xFFn),
                contextId: Number((bn >> 48n) & 0xFFFFFFFFn),
                amount: ((bn >> 80n) & ((1n << 96n) - 1n)).toString()
            };
        } catch (error) {
            return { timestamp: 0, factoryType: 0, actionType: 0, contextId: 0, amount: '0' };
        }
    }

    getActionName(actionType) {
        const map = { 0: 'buy', 1: 'sell', 2: 'mint', 3: 'withdraw', 4: 'stake', 5: 'unstake', 6: 'claim', 7: 'deploy' };
        return map[actionType] || 'activity';
    }

    applyFilter(messages) {
        const { filter } = this.state;
        return filter === 'all' ? messages : messages.filter(m => m.messageType === filter);
    }

    shortenAddress(addr) {
        return addr?.length >= 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
    }

    formatTimestamp(ts) {
        const diff = Math.floor(Date.now() / 1000) - ts;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return `${Math.floor(diff / 604800)}w ago`;
    }

    formatDate(ts) {
        return new Date(ts * 1000).toLocaleString();
    }

    formatAction(type) {
        const map = { mint: 'minted', buy: 'bought', sell: 'sold', stake: 'staked', unstake: 'unstaked', claim: 'claimed', withdraw: 'withdrew', deploy: 'deployed' };
        return map[type] || type;
    }

    getMessageIcon(type) {
        const map = { mint: '🎨', buy: '📈', sell: '📉', stake: '🎯', unstake: '🔓', claim: '💰', withdraw: '💵', deploy: '🚀', activity: '📝' };
        return map[type] || '📝';
    }

    handleFilterChange(newFilter) {
        this.setState({ filter: newFilter, page: 0 });
        this.loadMessages();
    }

    handleNextPage() {
        if (this.state.hasMore) {
            this.setState({ page: this.state.page + 1 });
            this.loadMessages();
        }
    }

    handlePrevPage() {
        if (this.state.page > 0) {
            this.setState({ page: this.state.page - 1 });
            this.loadMessages();
        }
    }

    async handleMessageClick(msg) {
        const { navigateToProject } = await import('../../utils/navigation.js');
        await navigateToProject(msg.instance);
    }

    handleBackClick() {
        window.router?.navigate('/') || (window.location.href = '/');
    }

    render() {
        const { messages, totalMessages, loading, error, filter, page, pageSize, hasMore } = this.state;
        const startIndex = page * pageSize + 1;
        const endIndex = Math.min((page + 1) * pageSize, totalMessages);

        return h('div', { className: 'global-activity-feed' },
            // Header
            h('header', { className: 'feed-header' },
                h('button', { className: 'back-btn', onClick: this.bind(this.handleBackClick) }, '← Back to Home'),
                h('div', { className: 'header-content' },
                    h('h1', { className: 'page-title' }, 'Global Activity Feed'),
                    h('p', { className: 'page-subtitle' }, 'Protocol-wide messages and transactions')
                )
            ),

            // Controls
            h('div', { className: 'feed-controls' },
                h('div', { className: 'filter-section' },
                    h('span', { className: 'filter-label' }, 'Filter by Type:'),
                    h('div', { className: 'filter-buttons' },
                        ...['all', 'mint', 'buy', 'sell', 'stake', 'claim'].map(f =>
                            h('button', {
                                className: `filter-btn ${filter === f ? 'active' : ''}`,
                                onClick: () => this.handleFilterChange(f)
                            }, f.charAt(0).toUpperCase() + f.slice(1))
                        )
                    )
                ),
                h('div', { className: 'message-count' },
                    h('strong', null, totalMessages.toLocaleString()),
                    ' total messages'
                )
            ),

            // Content
            h('div', { className: 'feed-content' },
                this.renderContent(messages, loading, error)
            ),

            // Pagination
            !loading && !error && messages.length > 0 && h('div', { className: 'feed-pagination' },
                h('button', {
                    className: `page-btn ${page === 0 ? 'disabled' : ''}`,
                    disabled: page === 0,
                    onClick: this.bind(this.handlePrevPage)
                }, '← Previous'),
                h('span', { className: 'page-info' }, `Showing ${startIndex}-${endIndex} of ${totalMessages.toLocaleString()}`),
                h('button', {
                    className: `page-btn ${!hasMore ? 'disabled' : ''}`,
                    disabled: !hasMore,
                    onClick: this.bind(this.handleNextPage)
                }, 'Next →')
            )
        );
    }

    renderContent(messages, loading, error) {
        if (loading) {
            return h('div', { className: 'feed-loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading activity feed...')
            );
        }

        if (error) {
            return h('div', { className: 'feed-error' },
                h('p', null, error),
                h('button', { className: 'retry-btn', onClick: this.bind(this.loadMessages) }, 'Try Again')
            );
        }

        if (messages.length === 0) {
            return h('div', { className: 'feed-empty' }, h('p', null, 'No activity found'));
        }

        return h('div', { className: 'message-table-container' },
            h('table', { className: 'message-table' },
                h('thead', null,
                    h('tr', null,
                        h('th', { className: 'col-type' }, 'Type'),
                        h('th', { className: 'col-user' }, 'User'),
                        h('th', { className: 'col-action' }, 'Action'),
                        h('th', { className: 'col-message' }, 'Details'),
                        h('th', { className: 'col-project' }, 'Project'),
                        h('th', { className: 'col-time' }, 'Time')
                    )
                ),
                h('tbody', null, ...messages.map((msg, i) => this.renderMessageRow(msg, i)))
            )
        );
    }

    renderMessageRow(msg, index) {
        let displayText = msg.message || '';
        if (msg.messageType === 'mint' && msg.contextId) {
            const amountStr = msg.amount && parseInt(msg.amount) > 1 ? `${msg.amount}x ` : '';
            displayText = `${amountStr}Edition #${msg.contextId}${msg.message ? ` - ${msg.message}` : ''}`;
        }

        return h('tr', {
            className: 'message-row',
            key: `${msg.id}-${index}`,
            onClick: () => this.handleMessageClick(msg)
        },
            h('td', { className: 'col-type' },
                h('span', { className: 'type-icon', title: msg.messageType }, this.getMessageIcon(msg.messageType))
            ),
            h('td', { className: 'col-user' },
                h('span', { className: 'user-address' }, this.shortenAddress(msg.user))
            ),
            h('td', { className: 'col-action' },
                h('span', { className: `action-badge action-${msg.messageType}` }, this.formatAction(msg.messageType))
            ),
            h('td', { className: 'col-message' },
                h('span', { className: 'message-text' }, displayText || '-')
            ),
            h('td', { className: 'col-project' },
                h('span', { className: 'project-link' }, msg.instanceName)
            ),
            h('td', { className: 'col-time' },
                h('span', { className: 'time-relative', title: msg.formattedDate }, msg.formattedTime)
            )
        );
    }
}

export default GlobalActivityFeed;
