/**
 * ProjectCommentFeed Component
 *
 * Displays user-written messages for a specific project in a comment-section style.
 * Only shows messages where users actually wrote something (filters out action-only entries).
 */

import { Component } from '../../core/Component.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { eventBus } from '../../core/EventBus.js';
import { generateAddressAvatar } from '../../utils/addressAvatar.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

const BATCH_SIZE = 20;      // Fetch this many from contract
const DISPLAY_SIZE = 10;    // Show this many initially

export class ProjectCommentFeed extends Component {
    constructor(projectAddress, adapter) {
        super();
        this.projectAddress = projectAddress;
        this.adapter = adapter;
        this.state = {
            comments: [],
            totalCount: 0,
            displayCount: DISPLAY_SIZE,
            loading: true,
            loadingMore: false,
            error: null,
            hasMore: false
        };
        this._allMessages = []; // Raw messages before filtering
    }

    async onMount() {
        // Load component styles
        stylesheetLoader.load('src/components/ProjectCommentFeed/ProjectCommentFeed.css', 'project-comment-feed-styles');

        await this.loadComments();

        // Listen for mint success to refresh comments
        this._mintSuccessHandler = this.handleMintSuccess.bind(this);
        eventBus.on('erc1155:mint:success', this._mintSuccessHandler);
    }

    onUnmount() {
        if (this._mintSuccessHandler) {
            eventBus.off('erc1155:mint:success', this._mintSuccessHandler);
        }
    }

    async handleMintSuccess() {
        // Refresh comments after a mint (might have new comment)
        await this.loadComments();
    }

    async loadComments() {
        try {
            this.setState({ loading: true, error: null });

            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
            if (!messageAdapter) {
                this.setState({ loading: false, comments: [], hasMore: false });
                return;
            }

            // Get total count for this instance
            const totalCount = await messageAdapter.getMessageCountForInstance(this.projectAddress);

            // Fetch initial batch
            const messages = await messageAdapter.getInstanceMessages(this.projectAddress, BATCH_SIZE);

            // Transform and filter to only messages with text
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

            // Fetch next batch
            const newMessages = await messageAdapter.getInstanceMessagesPaginated(
                this.projectAddress,
                currentOffset,
                BATCH_SIZE
            );

            if (newMessages.length === 0) {
                this.setState({ loadingMore: false, hasMore: false });
                return;
            }

            // Add to raw messages
            this._allMessages = [...this._allMessages, ...newMessages];

            // Transform and filter all messages
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

        // For mints, show edition info
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

    render() {
        const { comments, loading, loadingMore, error, hasMore, totalCount } = this.state;

        if (loading) {
            return `
                <div class="project-comment-feed loading">
                    <div class="loading-spinner"></div>
                </div>
            `;
        }

        if (error) {
            return `
                <div class="project-comment-feed error">
                    <p>${this.escapeHtml(error)}</p>
                </div>
            `;
        }

        // Empty state - inviting
        if (comments.length === 0) {
            return `
                <div class="project-comment-feed">
                    <div class="comment-feed-header">
                        <h3>Comments</h3>
                    </div>
                    <div class="comment-empty-state">
                        <span class="empty-icon">💬</span>
                        <p class="empty-title">Be the first to leave a comment</p>
                        <p class="empty-hint">Add a message when you mint an edition</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="project-comment-feed">
                <div class="comment-feed-header">
                    <h3>Comments <span class="comment-count">(${totalCount})</span></h3>
                </div>
                <div class="comment-list">
                    ${comments.map(comment => this.renderComment(comment)).join('')}
                </div>
                ${hasMore ? `
                    <div class="comment-load-more">
                        <button class="load-more-btn" data-ref="load-more" ${loadingMore ? 'disabled' : ''}>
                            ${loadingMore ? 'Loading...' : 'Load more'}
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderComment(comment) {
        const avatarSvg = generateAddressAvatar(comment.sender);

        return `
            <div class="comment-row">
                <div class="comment-avatar">
                    ${avatarSvg}
                </div>
                <div class="comment-content">
                    <div class="comment-header">
                        <span class="comment-address">${this.escapeHtml(this.truncateAddress(comment.sender))}</span>
                        <span class="comment-time">${this.escapeHtml(comment.formattedTime)}</span>
                    </div>
                    <p class="comment-message">${this.escapeHtml(comment.message)}</p>
                    <span class="comment-action">${this.escapeHtml(comment.actionText)}</span>
                </div>
            </div>
        `;
    }

    setupDOMEventListeners() {
        const loadMoreBtn = this.getRef('load-more', '.load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => this.loadMore());
        }
    }

    onStateUpdate(oldState, newState) {
        // Re-setup listeners when content changes
        if (oldState.loading !== newState.loading ||
            oldState.comments.length !== newState.comments.length) {
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
