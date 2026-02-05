/**
 * ProjectCommentFeed - Microact Version
 *
 * Displays user-written messages for a specific project in a comment-section style.
 * Only shows messages where users actually wrote something (filters out action-only entries).
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { generateAddressAvatar } from '../../utils/addressAvatar.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

const BATCH_SIZE = 20;
const DISPLAY_SIZE = 10;

export class ProjectCommentFeed extends Component {
    constructor(props = {}) {
        super(props);
        this._allMessages = [];
        this.state = {
            comments: [],
            totalCount: 0,
            displayCount: DISPLAY_SIZE,
            loading: true,
            loadingMore: false,
            error: null,
            hasMore: false
        };
    }

    get projectAddress() {
        return this.props.projectAddress;
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        stylesheetLoader.load('src/components/ProjectCommentFeed/ProjectCommentFeed.css', 'project-comment-feed-styles');

        await this.loadComments();

        const unsub1 = eventBus.on('erc1155:mint:success', () => this.loadComments());
        const unsub2 = eventBus.on('transaction:confirmed', () => this.loadComments());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            stylesheetLoader.unload('project-comment-feed-styles');
        });
    }

    async loadComments() {
        try {
            this.setState({ loading: true, error: null });

            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
            if (!messageAdapter) {
                this.setState({ loading: false, comments: [], hasMore: false });
                return;
            }

            const totalCount = await messageAdapter.getMessageCountForInstance(this.projectAddress);
            const messages = await messageAdapter.getInstanceMessages(this.projectAddress, BATCH_SIZE);

            const transformed = messages.map(msg => this.transformMessage(msg));
            const withComments = transformed.filter(msg => msg.message && msg.message.trim());

            this._allMessages = messages;

            this.setState({
                comments: withComments.slice(0, DISPLAY_SIZE),
                totalCount: withComments.length,
                loading: false,
                hasMore: withComments.length > DISPLAY_SIZE || messages.length < totalCount
            });
        } catch (error) {
            console.error('[ProjectCommentFeed] Failed to load comments:', error);
            this.setState({
                loading: false,
                error: 'Failed to load comments'
            });
        }
    }

    async loadMore() {
        if (this.state.loadingMore) return;

        try {
            this.setState({ loadingMore: true });

            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
            const currentOffset = this._allMessages.length;

            const newMessages = await messageAdapter.getInstanceMessagesPaginated(
                this.projectAddress,
                currentOffset,
                BATCH_SIZE
            );

            if (newMessages.length === 0) {
                this.setState({ loadingMore: false, hasMore: false });
                return;
            }

            this._allMessages = [...this._allMessages, ...newMessages];

            const transformed = this._allMessages.map(msg => this.transformMessage(msg));
            const withComments = transformed.filter(msg => msg.message && msg.message.trim());

            const newDisplayCount = this.state.displayCount + DISPLAY_SIZE;

            this.setState({
                comments: withComments.slice(0, newDisplayCount),
                displayCount: newDisplayCount,
                totalCount: withComments.length,
                loadingMore: false,
                hasMore: withComments.length > newDisplayCount || newMessages.length === BATCH_SIZE
            });
        } catch (error) {
            console.error('[ProjectCommentFeed] Failed to load more:', error);
            this.setState({ loadingMore: false });
        }
    }

    transformMessage(rawMsg) {
        const packedData = rawMsg.packedData || '0';
        const unpacked = this.unpackMessageData(packedData);

        return {
            sender: rawMsg.sender || '0x0',
            message: rawMsg.message || '',
            timestamp: unpacked.timestamp,
            actionType: unpacked.actionType,
            contextId: unpacked.contextId,
            amount: unpacked.amount,
            formattedTime: this.formatTimestamp(unpacked.timestamp),
            actionText: this.getActionText(unpacked.actionType, unpacked.contextId, unpacked.amount)
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
            return { timestamp: 0, factoryType: 0, actionType: 0, contextId: 0, amount: '0' };
        }
    }

    getActionText(actionType, contextId, amount) {
        const actionMap = {
            0: 'bought',
            1: 'sold',
            2: 'minted',
            3: 'withdrew',
            4: 'staked',
            5: 'unstaked',
            6: 'claimed',
            7: 'deployed'
        };

        const action = actionMap[actionType] || 'interacted';

        if (actionType === 2 && contextId) {
            const amountNum = parseInt(amount) || 1;
            const amountStr = amountNum > 1 ? `${amountNum}x ` : '';
            return `${action} ${amountStr}Edition #${contextId}`;
        }

        return action;
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return '';

        const now = Math.floor(Date.now() / 1000);
        const diff = now - timestamp;

        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return `${Math.floor(diff / 604800)}w ago`;
    }

    truncateAddress(address) {
        if (!address || address.length < 10) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    renderComment(comment) {
        const avatarSvg = generateAddressAvatar(comment.sender);

        return h('div', { key: `comment-${comment.timestamp}-${comment.sender}`, className: 'comment-row' },
            h('div', {
                className: 'comment-avatar',
                innerHTML: avatarSvg
            }),
            h('div', { className: 'comment-content' },
                h('div', { className: 'comment-header' },
                    h('span', { className: 'comment-address' }, this.truncateAddress(comment.sender)),
                    h('span', { className: 'comment-time' }, comment.formattedTime)
                ),
                h('p', { className: 'comment-message' }, comment.message),
                h('span', { className: 'comment-action' }, comment.actionText)
            )
        );
    }

    render() {
        const { comments, loading, loadingMore, error, hasMore, totalCount } = this.state;

        if (loading) {
            return h('div', { className: 'project-comment-feed loading' },
                h('div', { className: 'loading-spinner' })
            );
        }

        if (error) {
            return h('div', { className: 'project-comment-feed error' },
                h('p', null, error)
            );
        }

        if (comments.length === 0) {
            return h('div', { className: 'project-comment-feed' },
                h('div', { className: 'comment-feed-header' },
                    h('h3', null, 'Comments')
                ),
                h('div', { className: 'comment-empty-state' },
                    h('span', { className: 'empty-icon' }, '💬'),
                    h('p', { className: 'empty-title' }, 'Be the first to leave a comment'),
                    h('p', { className: 'empty-hint' }, 'Add a message when you mint an edition')
                )
            );
        }

        return h('div', { className: 'project-comment-feed' },
            h('div', { className: 'comment-feed-header' },
                h('h3', null, 'Comments ',
                    h('span', { className: 'comment-count' }, `(${totalCount})`)
                )
            ),
            h('div', { className: 'comment-list' },
                ...comments.map(comment => this.renderComment(comment))
            ),
            hasMore && h('div', { className: 'comment-load-more' },
                h('button', {
                    className: 'load-more-btn',
                    onClick: this.bind(this.loadMore),
                    disabled: loadingMore
                }, loadingMore ? 'Loading...' : 'Load more')
            )
        );
    }
}

export default ProjectCommentFeed;
