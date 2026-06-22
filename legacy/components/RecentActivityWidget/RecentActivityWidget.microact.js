/**
 * RecentActivityWidget - Microact Version
 *
 * Shows last 5 protocol-wide messages from GlobalMessageRegistry.
 * Migrated from template literals to h() hyperscript.
 *
 * NOTE: This component fetches from GlobalMessageRegistry via adapters.
 * This is a candidate for EventIndexer migration - messages could be
 * derived from indexed events instead of contract storage.
 * See: docs/plans/2026-02-04-contract-event-migration.md
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { EmptyState } from '../EmptyState/EmptyState.microact.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class RecentActivityWidget extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            messages: [],
            loading: true,
            error: null
        };
    }

    async didMount() {
        if (this.props.useDataProvider) {
            // Subscribe to data provider events
            const unsub = eventBus.on('homepage:data', (data) => {
                if (data.recentActivity) {
                    this.handleMessagesData(data.recentActivity);
                }
            });
            this.registerCleanup(unsub);
        } else {
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

    handleMessagesData(messages) {
        if (!Array.isArray(messages)) return;

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

            const masterService = serviceFactory.getMasterService();
            const messageRegistryAddress = await masterService.getGlobalMessageRegistry();

            if (!messageRegistryAddress || messageRegistryAddress === '0x0000000000000000000000000000000000000000') {
                console.warn('[RecentActivityWidget] No message registry deployed');
                this.setState({ messages: [], loading: false });
                return;
            }

            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
            const rawMessages = await messageAdapter.getRecentMessages(5);
            const messages = rawMessages.map(msg => this.transformMessage(msg));

            this.setState({ messages, loading: false });
        } catch (error) {
            console.error('[RecentActivityWidget] Error loading messages:', error);
            this.setState({ messages: [], loading: false });
        }
    }

    transformMessage(rawMsg) {
        const packedData = rawMsg.packedData || '0';
        const unpacked = this.unpackMessageData(packedData);

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
            console.error('[RecentActivityWidget] Error unpacking message data:', error);
            return { timestamp: 0, factoryType: 0, actionType: 0, contextId: 0, amount: '0' };
        }
    }

    getActionName(actionType) {
        const actionMap = {
            0: 'buy', 1: 'sell', 2: 'mint', 3: 'withdraw',
            4: 'stake', 5: 'unstake', 6: 'claim', 7: 'deploy'
        };
        return actionMap[actionType] || 'activity';
    }

    shortenAddress(address) {
        if (!address || address.length < 10) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatTimestamp(timestamp) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const diff = now - timestamp;

            if (diff < 60) return 'Just now';
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            return `${Math.floor(diff / 86400)}d ago`;
        } catch (error) {
            return '';
        }
    }

    formatAction(messageType) {
        const actionMap = {
            'mint': 'minted', 'buy': 'bought', 'sell': 'sold',
            'stake': 'staked', 'unstake': 'unstaked', 'claim': 'claimed rewards',
            'withdraw': 'withdrew', 'deploy': 'deployed liquidity', 'activity': 'did'
        };
        return actionMap[messageType] || messageType;
    }

    handleRefresh() {
        this.loadMessages();
    }

    async handleMessageClick(msg) {
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

        return h('div', { className: 'recent-activity-widget' },
            // Header
            h('div', { className: 'widget-header' },
                h('h3', { className: 'widget-title' }, 'Recent Activity'),
                h('button', {
                    className: 'refresh-btn',
                    disabled: loading,
                    onClick: this.bind(this.handleRefresh)
                },
                    h('svg', {
                        className: `refresh-icon ${loading ? 'spinning' : ''}`,
                        viewBox: '0 0 24 24',
                        fill: 'none',
                        xmlns: 'http://www.w3.org/2000/svg'
                    },
                        h('path', {
                            d: 'M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5M21 10V4M21 10H15',
                            stroke: 'currentColor',
                            'stroke-width': '2',
                            'stroke-linecap': 'round',
                            'stroke-linejoin': 'round'
                        })
                    )
                )
            ),

            // Content
            h('div', { className: 'widget-content' },
                this.renderContent(messages, loading, error)
            ),

            // Footer
            !loading && !error && messages.length > 0 &&
                h('div', { className: 'widget-footer' },
                    h('button', {
                        className: 'view-all-btn',
                        onClick: this.bind(this.handleViewAllClick)
                    }, 'View All Activity →')
                )
        );
    }

    renderContent(messages, loading, error) {
        if (loading) {
            return h('div', { className: 'widget-loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading activity...')
            );
        }

        if (error) {
            return h('div', { className: 'widget-error' },
                h('p', null, error)
            );
        }

        if (messages.length === 0) {
            return h(EmptyState, {
                variant: 'activity',
                showCTA: false
            });
        }

        return h('div', { className: 'message-list' },
            ...messages.map((msg, index) => this.renderMessageRow(msg, index))
        );
    }

    renderMessageRow(msg, index) {
        let displayText = msg.message || '';

        if (msg.messageType === 'mint' && msg.contextId && msg.amount) {
            const amountStr = msg.amount > 1 ? `${msg.amount}x ` : '';
            displayText = `${amountStr}Edition #${msg.contextId}${msg.message ? ` - ${msg.message}` : ''}`;
        }

        return h('div', {
            className: 'message-row',
            key: `${msg.id}-${index}`,
            onClick: () => this.handleMessageClick(msg)
        },
            h('span', { className: 'message-wallet' }, this.shortenAddress(msg.user)),
            h('span', { className: 'message-separator' }, '·'),
            h('span', { className: 'message-action' }, this.formatAction(msg.messageType)),
            h('span', { className: 'message-separator' }, '·'),
            h('span', { className: 'message-text' }, displayText),
            h('span', { className: 'message-separator' }, '·'),
            h('span', { className: 'message-time' }, msg.formattedTime)
        );
    }
}

export default RecentActivityWidget;
