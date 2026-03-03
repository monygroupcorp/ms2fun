/**
 * Activity - Platform-wide activity feed
 *
 * Features:
 * - Real-time activity from all instances
 * - Filter by activity type (all, messages, transfers, mints)
 * - Load more pagination
 * - Timestamp formatting
 *
 * @example
 * h(Activity)
 */

import { h, Component } from '@monygroupcorp/microact';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { Layout } from '../components/Layout/Layout.js';
import DataAdapter from '../services/DataAdapter.js';
import { debug } from '../utils/debug.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';
import { loadABI } from '../utils/abiLoader.js';

// Message types (matching contract)
const MESSAGE_TYPE_STANDALONE = 0;
const MESSAGE_TYPE_REACTION = 1;
const MESSAGE_TYPE_REPLY = 2;
const MESSAGE_TYPE_QUOTE = 3;

export class Activity extends Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            error: null,
            activity: [],
            filter: 'message', // Default to messages - the main feature
            displayCount: 20, // Initial load

            // User's reactions (messageId -> emoji)
            userReactions: new Map(), // Track which messages user has reacted to

            // Interaction queue for multicall batching
            pendingInteractions: [], // { type, targetMessage, content, emoji }

            // Reply/quote form state
            replyingTo: null, // Message being replied to
            quotingMessage: null, // Message being quoted
            composeText: '', // Text for reply or quote

            // Indexing status
            currentBlock: 0,
            lastIndexedBlock: 0,
            blocksBehind: 0,
            syncing: false,

            // Advanced filters
            showAdvancedFilters: false,
            projectSearch: '', // Search by project name or address
            includeWords: '', // Only show messages containing these words
            excludeWords: ''  // Hide messages containing these words
        };
    }

    async didMount() {
        // Load route-specific CSS with layer ID
        await stylesheetLoader.load('/src/core/route-activity-v2.css', 'route:activity');

        // Web3 context provided by route handler as props
        const { mode, config, provider } = this.props;
        debug.log('[Activity] Loading data with mode:', mode);
        await this.loadData(mode, config, provider);
    }

    didUpdate(oldState) {
        // Guard: oldState can be undefined on first update
        if (!oldState) return;

        // Auto-focus compose textarea when form opens
        const formJustOpened = (
            (!oldState.replyingTo && this.state.replyingTo) ||
            (!oldState.quotingMessage && this.state.quotingMessage)
        );

        if (formJustOpened) {
            // Focus the textarea after a brief delay to ensure DOM is ready
            setTimeout(() => {
                const textarea = document.querySelector('.compose-form-textarea');
                if (textarea) {
                    textarea.focus();
                }
            }, 50);
        }
    }

    async loadData(mode, config, provider) {
        try {
            debug.log('[Activity] Starting data load...');
            const t0 = performance.now();

            // Get current block for status display
            const currentBlock = await provider.getBlockNumber();

            // Get activity data
            const dataAdapter = new DataAdapter(mode, config, provider);
            const activity = await dataAdapter.getActivity();
            const t1 = performance.now();
            debug.log(`[Activity] ✓ Activity loaded: ${activity.length} items (${(t1 - t0).toFixed(0)}ms)`);

            // Calculate last indexed block (from most recent activity)
            const lastIndexedBlock = activity.length > 0
                ? Math.max(...activity.map(a => a.blockNumber || 0))
                : currentBlock;
            const blocksBehind = currentBlock - lastIndexedBlock;

            // Load user's reactions
            const userReactions = await this.loadUserReactions(config, provider);
            debug.log(`[Activity] ✓ User reactions loaded: ${userReactions.size} reactions`);

            this.setState({
                loading: false,
                activity,
                userReactions,
                currentBlock,
                lastIndexedBlock,
                blocksBehind,
                syncing: false
            });

            debug.log(`[Activity] ✓ Total load time: ${(t1 - t0).toFixed(0)}ms`);
        } catch (error) {
            debug.error('[Activity] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message,
                syncing: false
            });
        }
    }

    async loadUserReactions(config, provider) {
        const userReactions = new Map();

        try {
            // Get current user address from wallet
            const signer = provider.getSigner ? provider.getSigner() : provider;
            const userAddress = await signer.getAddress();

            // Query MessagePosted events where sender = user and messageType = REACTION
            const messageRegistryAddress = config.contracts?.GlobalMessageRegistry;
            if (!messageRegistryAddress) return userReactions;

            const abi = await loadABI('GlobalMessageRegistry');
            const contract = new ethers.Contract(messageRegistryAddress, abi, provider);

            const filter = contract.filters.MessagePosted(null, null, userAddress);
            const events = await contract.queryFilter(filter, -5000, 'latest'); // Last 5000 blocks

            events.forEach(event => {
                const { messageType, refId, content } = event.args;
                // If it's a reaction (messageType = 1), store it
                if (messageType === MESSAGE_TYPE_REACTION && refId && refId.toNumber() > 0) {
                    userReactions.set(refId.toNumber(), content); // Store emoji
                }
            });
        } catch (error) {
            debug.error('[Activity] Error loading user reactions:', error);
        }

        return userReactions;
    }

    handleFilterChange = (filter) => {
        this.setState({ filter });
    }

    handleToggleAdvancedFilters = () => {
        this.setState({ showAdvancedFilters: !this.state.showAdvancedFilters });
    }

    handleProjectSearchChange = (e) => {
        this.setState({ projectSearch: e.target.value });
    }

    handleIncludeWordsChange = (e) => {
        this.setState({ includeWords: e.target.value });
    }

    handleExcludeWordsChange = (e) => {
        this.setState({ excludeWords: e.target.value });
    }

    handleClearAdvancedFilters = () => {
        this.setState({
            projectSearch: '',
            includeWords: '',
            excludeWords: ''
        });
    }

    handleRefresh = async () => {
        this.setState({ syncing: true });
        const { mode, config, provider } = this.props;
        await this.loadData(mode, config, provider);
    }

    handleLoadMore = () => {
        this.setState({
            displayCount: this.state.displayCount + 20
        });
    }

    getFilteredActivity() {
        const { activity, filter, projectSearch, includeWords, excludeWords } = this.state;
        let filtered = [...activity];

        // Filter out reactions - they're shown inline on messages, not as separate items
        filtered = filtered.filter(item => item.messageType !== 1);

        // Basic type filter (all, message, transfer, mint)
        if (filter !== 'all') {
            filtered = filtered.filter(item => item.type === filter);
        }

        // Advanced filters
        if (projectSearch.trim()) {
            const searchLower = projectSearch.toLowerCase();
            filtered = filtered.filter(item => {
                // Search in project name or project address
                const projectName = item.project?.toLowerCase() || '';
                const projectAddr = item.projectAddress?.toLowerCase() || '';
                return projectName.includes(searchLower) || projectAddr.includes(searchLower);
            });
        }

        if (includeWords.trim()) {
            // Split by comma or space and filter to only show items containing ANY of these words
            const words = includeWords.toLowerCase().split(/[,\s]+/).filter(w => w);
            filtered = filtered.filter(item => {
                const content = (item.content || item.text || '').toLowerCase();
                return words.some(word => content.includes(word));
            });
        }

        if (excludeWords.trim()) {
            // Split by comma or space and filter out items containing ANY of these words
            const words = excludeWords.toLowerCase().split(/[,\s]+/).filter(w => w);
            filtered = filtered.filter(item => {
                const content = (item.content || item.text || '').toLowerCase();
                return !words.some(word => content.includes(word));
            });
        }

        return filtered;
    }

    formatTimestamp(timestamp) {
        const now = Date.now() / 1000;
        const diff = now - timestamp;

        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    /**
     * Parse message content and render URLs as links/images
     * @param {string} content - Message text content
     * @returns {Array} Array of hyperscript elements
     */
    parseMessageContent(content) {
        if (!content) return [];

        // URL regex - matches http/https URLs
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = [];
        let lastIndex = 0;

        // Find all URLs in the content
        const matches = [...content.matchAll(urlRegex)];

        matches.forEach((match, i) => {
            const url = match[0];
            const index = match.index;

            // Add text before URL
            if (index > lastIndex) {
                parts.push(content.substring(lastIndex, index));
            }

            // Check if URL is an image
            const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;
            const hasImageExtension = imageExtensions.test(url);

            // Also check for image format in query params (Twitter, etc.)
            const hasImageFormat = /[?&]format=(jpg|jpeg|png|gif|webp|svg)/i.test(url);

            // Check for known image hosting domains
            const imageHosts = /^https?:\/\/(pbs\.twimg\.com|i\.imgur\.com|cdn\.discordapp\.com|media\.discordapp\.net)/i;
            const isImageHost = imageHosts.test(url);

            const isImage = hasImageExtension || hasImageFormat || isImageHost;

            if (isImage) {
                // Render as image
                parts.push(
                    h('a', {
                        href: url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        className: 'activity-image-link',
                        key: `img-${i}`
                    },
                        h('img', {
                            src: url,
                            className: 'activity-inline-image',
                            alt: 'Embedded image',
                            loading: 'lazy',
                            onerror: (e) => {
                                // Hide broken images
                                e.target.style.display = 'none';
                            }
                        })
                    )
                );
            } else {
                // Render as clickable link
                parts.push(
                    h('a', {
                        href: url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        className: 'activity-link',
                        key: `link-${i}`
                    }, url)
                );
            }

            lastIndex = index + url.length;
        });

        // Add remaining text after last URL
        if (lastIndex < content.length) {
            parts.push(content.substring(lastIndex));
        }

        // If no URLs found, return original content
        return parts.length > 0 ? parts : [content];
    }

    getActivityTypeLabel(type) {
        switch (type) {
            case 'message': return 'Message';
            case 'transfer': return 'Trade';
            case 'mint': return 'Mint';
            default: return 'Activity';
        }
    }

    handleReact = (item, emoji) => {
        debug.log('[Activity] React:', emoji, 'to message', item);

        // Add reaction to pending queue
        const reaction = {
            type: 'reaction',
            targetMessage: item,
            emoji,
            timestamp: Date.now()
        };

        this.setState({
            pendingInteractions: [...this.state.pendingInteractions, reaction]
        });
    }

    handleReply = (item) => {
        debug.log('[Activity] Reply to:', item);

        // Open reply form
        this.setState({
            replyingTo: item,
            composeText: ''
        });
    }

    handleQuote = (item) => {
        debug.log('[Activity] Quote:', item);

        // Open quote form
        this.setState({
            quotingMessage: item,
            composeText: ''
        });
    }

    handleComposeChange = (e) => {
        this.setState({ composeText: e.target.value });
    }

    handleSubmitReply = () => {
        const { replyingTo, composeText } = this.state;

        if (!composeText.trim()) {
            return; // Don't submit empty replies
        }

        // Add reply to pending queue
        const reply = {
            type: 'reply',
            targetMessage: replyingTo,
            content: composeText,
            timestamp: Date.now()
        };

        this.setState({
            pendingInteractions: [...this.state.pendingInteractions, reply],
            replyingTo: null,
            composeText: ''
        });
    }

    handleSubmitQuote = () => {
        const { quotingMessage, composeText } = this.state;

        if (!composeText.trim()) {
            return; // Don't submit empty quotes
        }

        // Add quote to pending queue
        const quote = {
            type: 'quote',
            targetMessage: quotingMessage,
            content: composeText,
            timestamp: Date.now()
        };

        this.setState({
            pendingInteractions: [...this.state.pendingInteractions, quote],
            quotingMessage: null,
            composeText: ''
        });
    }

    handleCancelCompose = () => {
        this.setState({
            replyingTo: null,
            quotingMessage: null,
            composeText: ''
        });
    }

    buildMulticallPayload = () => {
        const { pendingInteractions } = this.state;

        // Group interactions by type for efficient batching
        const reactions = [];
        const replies = [];
        const quotes = [];

        pendingInteractions.forEach(interaction => {
            switch (interaction.type) {
                case 'reaction':
                    reactions.push({
                        targetMessageId: interaction.targetMessage.messageId,
                        emoji: interaction.emoji,
                        timestamp: Math.floor(interaction.timestamp / 1000)
                    });
                    break;
                case 'reply':
                    replies.push({
                        targetMessageId: interaction.targetMessage.messageId,
                        content: interaction.content,
                        timestamp: Math.floor(interaction.timestamp / 1000)
                    });
                    break;
                case 'quote':
                    quotes.push({
                        targetMessageId: interaction.targetMessage.messageId,
                        quotedMessage: interaction.targetMessage.content,
                        content: interaction.content,
                        timestamp: Math.floor(interaction.timestamp / 1000)
                    });
                    break;
            }
        });

        debug.log('[Activity] Multicall payload:', {
            reactions: reactions.length,
            replies: replies.length,
            quotes: quotes.length
        });

        return { reactions, replies, quotes };
    }

    handlePostAll = async () => {
        const { pendingInteractions } = this.state;

        if (pendingInteractions.length === 0) {
            return;
        }

        try {
            debug.log('[Activity] Batching', pendingInteractions.length, 'interactions');

            const { config, provider } = this.props;
            const signer = provider.getSigner();
            const abi = await loadABI('GlobalMessageRegistry');
            const contract = new ethers.Contract(
                config.contracts.GlobalMessageRegistry,
                abi,
                signer
            );

            // Build array of PostParams structs for batch call
            const posts = pendingInteractions.map(interaction => {
                const instance = interaction.targetMessage.projectAddress;
                let messageType, refId, content;

                if (interaction.type === 'reaction') {
                    messageType = MESSAGE_TYPE_REACTION;
                    refId = interaction.targetMessage.messageId;
                    content = interaction.emoji;
                } else if (interaction.type === 'reply') {
                    messageType = MESSAGE_TYPE_REPLY;
                    refId = interaction.targetMessage.messageId;
                    content = interaction.content;
                } else if (interaction.type === 'quote') {
                    messageType = MESSAGE_TYPE_QUOTE;
                    refId = interaction.targetMessage.messageId;
                    content = interaction.content;
                }

                return {
                    instance,
                    messageType,
                    refId,
                    actionRef: ethers.constants.HashZero,
                    metadata: ethers.constants.HashZero,
                    content
                };
            });

            debug.log('[Activity] Calling postBatch with', posts.length, 'posts');

            // Call GlobalMessageRegistry.postBatch(posts)
            const tx = await contract.postBatch(posts);
            debug.log('[Activity] Batch transaction submitted:', tx.hash);

            await tx.wait();
            debug.log('[Activity] Batch transaction confirmed:', tx.hash);

            // Clear queue after successful post
            this.setState({
                pendingInteractions: []
            });

            // Reload data to show new interactions
            await this.loadData(this.props.mode, this.props.config, this.props.provider);

        } catch (error) {
            debug.error('[Activity] Error posting interactions:', error);
            alert(`Error posting interactions: ${error.message}`);
        }
    }

    handleClearQueue = () => {
        this.setState({
            pendingInteractions: []
        });
    }

    renderMessageItem(item, index) {
        // Extract first letter for avatar
        const firstLetter = item.userAddress ? item.userAddress[2].toUpperCase() : '?';

        // Check if user has already reacted to this message
        const hasUserReacted = this.state.userReactions.has(item.messageId);
        const userReactionEmoji = hasUserReacted ? this.state.userReactions.get(item.messageId) : null;

        // Get all reactions for this message
        const reactions = this.state.activity
            .filter(a => a.messageType === 1 && a.refId === item.messageId)
            .reduce((acc, reaction) => {
                const emoji = reaction.content;
                acc[emoji] = (acc[emoji] || 0) + 1;
                return acc;
            }, {});

        // Check if this is a quote or reply - find the referenced message
        const isQuote = item.messageType === 3;
        const isReply = item.messageType === 2;
        let referencedMessage = null;

        if ((isQuote || isReply) && item.refId) {
            // Find the original message in the activity array
            referencedMessage = this.state.activity.find(m => m.messageId === item.refId);
        }

        return h('div', {
            key: index,
            className: 'activity-item activity-item--message'
        },
            // Header with user info and timestamp
            h('div', { className: 'activity-header' },
                h('div', { className: 'activity-user' },
                    h('div', { className: 'activity-avatar' }, firstLetter),
                    h('div', { className: 'activity-user-info' },
                        h('div', { className: 'activity-user-line' },
                            h('span', { className: 'activity-address' }, item.user),
                            // Project context inline with address
                            item.project ? [
                                h('span', { className: 'activity-separator' }, '·'),
                                h('span', { className: 'activity-project' },
                                    'on ', h('span', { className: 'activity-project-name' }, item.project)
                                )
                            ] : null
                        ),
                        h('span', { className: 'activity-timestamp' }, this.formatTimestamp(item.timestamp))
                    )
                )
            ),

            // Show quoted/replied message if applicable
            referencedMessage ? h('div', { className: 'activity-quoted-message' },
                h('div', { className: 'activity-quoted-header' },
                    h('span', { className: 'activity-quoted-label' }, isQuote ? 'Quoting' : 'Replying to'),
                    h('span', { className: 'activity-quoted-user' }, referencedMessage.user)
                ),
                h('div', { className: 'activity-quoted-content' },
                    ...this.parseMessageContent(referencedMessage.content || referencedMessage.text)
                )
            ) : null,

            // Message content (parsed for URLs/images)
            h('div', { className: 'activity-message' },
                ...this.parseMessageContent(item.content || item.text)
            ),

            // Reactions display (if any)
            Object.keys(reactions).length > 0 ? h('div', { className: 'activity-reactions' },
                ...Object.entries(reactions).map(([emoji, count]) =>
                    h('span', { className: 'activity-reaction-badge', key: emoji },
                        h('span', { className: 'activity-reaction-emoji' }, emoji),
                        h('span', { className: 'activity-reaction-count' }, count)
                    )
                )
            ) : null,

            // Interaction buttons
            h('div', { className: 'activity-actions' },
                h('button', {
                    className: 'activity-action-btn',
                    onclick: () => this.handleReply(item),
                    title: 'Reply'
                },
                    h('span', { className: 'activity-action-icon' }, '↩'),
                    h('span', { className: 'activity-action-label' }, 'Reply')
                ),
                h('button', {
                    className: hasUserReacted ? 'activity-action-btn activity-action-btn--active' : 'activity-action-btn',
                    onclick: () => this.handleReact(item, '❤️'),
                    title: hasUserReacted ? `Already reacted with ${userReactionEmoji}` : 'React'
                },
                    h('span', { className: 'activity-action-icon' }, hasUserReacted ? userReactionEmoji : '❤'),
                    h('span', { className: 'activity-action-label' }, hasUserReacted ? 'Reacted' : 'React')
                ),
                h('button', {
                    className: 'activity-action-btn',
                    onclick: () => this.handleQuote(item),
                    title: 'Quote'
                },
                    h('span', { className: 'activity-action-icon' }, '⤴'),
                    h('span', { className: 'activity-action-label' }, 'Quote')
                )
            )
        );
    }

    renderScanningIndicator() {
        const { currentBlock } = this.state;
        const scanText = currentBlock > 0
            ? `Indexing Activity... Block ${currentBlock.toLocaleString()}`
            : 'Indexing Activity...';

        return h('div', { className: 'scanning-container' },
            h('div', { className: 'scanning-line' }),
            h('div', { className: 'scanning-text' }, scanText)
        );
    }

    renderActivityItem(item, index) {
        // Messages get special treatment (Twitter-like cards)
        if (item.type === 'message') {
            return this.renderMessageItem(item, index);
        }

        // Other activity types (transfers, mints) - simple display
        const firstLetter = item.userAddress ? item.userAddress[2].toUpperCase() : '?';

        return h('div', {
            key: index,
            className: 'activity-item'
        },
            h('div', { className: 'activity-header' },
                h('div', { className: 'activity-user' },
                    h('div', { className: 'activity-avatar' }, firstLetter),
                    h('span', { className: 'activity-address' }, item.user)
                ),
                h('div', { className: 'activity-header-meta' },
                    h('span', { className: 'activity-action-badge' }, this.getActivityTypeLabel(item.type)),
                    h('span', { className: 'activity-timestamp' }, this.formatTimestamp(item.timestamp))
                )
            ),
            h('div', { className: 'activity-text' }, item.text)
        );
    }

    renderComposeForm() {
        const { replyingTo, quotingMessage, composeText } = this.state;
        const isReply = !!replyingTo;
        const isQuote = !!quotingMessage;

        if (!isReply && !isQuote) {
            return null;
        }

        const targetMessage = isReply ? replyingTo : quotingMessage;
        const formType = isReply ? 'Reply' : 'Quote';

        return h('div', { className: 'compose-form-overlay' },
            h('div', { className: 'compose-form' },
                h('div', { className: 'compose-form-header' },
                    h('h3', { className: 'compose-form-title' }, `${formType} to ${targetMessage.user}`),
                    h('button', {
                        className: 'compose-form-close',
                        onclick: this.handleCancelCompose
                    }, '×')
                ),

                // Show quoted/replied message
                h('div', { className: 'compose-form-context' },
                    h('div', { className: 'compose-form-context-label' }, `Original message:`),
                    h('div', { className: 'compose-form-context-message' },
                        targetMessage.content || targetMessage.text
                    )
                ),

                // Compose textarea
                h('textarea', {
                    className: 'compose-form-textarea',
                    placeholder: `Write your ${formType.toLowerCase()}...`,
                    value: composeText,
                    oninput: this.handleComposeChange,
                    rows: 4
                }),

                // Actions
                h('div', { className: 'compose-form-actions' },
                    h('button', {
                        className: 'btn btn-ghost',
                        onclick: this.handleCancelCompose
                    }, 'Cancel'),
                    h('button', {
                        className: 'btn btn-primary',
                        onclick: isReply ? this.handleSubmitReply : this.handleSubmitQuote,
                        disabled: !composeText.trim()
                    }, `Add ${formType} to Queue`)
                )
            )
        );
    }

    render() {
        const { loading, error, filter, displayCount, pendingInteractions, replyingTo, quotingMessage, currentBlock, lastIndexedBlock, blocksBehind, syncing, showAdvancedFilters, projectSearch, includeWords, excludeWords } = this.state;
        const filteredActivity = this.getFilteredActivity();
        const visibleActivity = filteredActivity.slice(0, displayCount);
        const hasMore = filteredActivity.length > displayCount;
        const hasPending = pendingInteractions.length > 0;
        const hasAdvancedFilters = projectSearch || includeWords || excludeWords;

        return h(Layout, {
            currentPath: '/activity',
            children: h('div', {
                className: `activity-page ${hasPending ? 'has-pending-actions' : ''}`
            },
                // Compose form overlay (for replies/quotes)
                this.renderComposeForm(),

                h('div', { className: 'activity-content' },
                    // Page Header with pending interactions badge and refresh
                    h('div', { className: 'page-header' },
                        h('div', { className: 'page-header-left' },
                            h('h1', { className: 'page-title' }, 'Activity'),
                            hasPending ? h('div', { className: 'pending-badge' },
                                `${pendingInteractions.length} Pending`
                            ) : null
                        ),
                        h('div', { className: 'page-header-right' },
                            h('button', {
                                className: 'btn btn-secondary btn-sm',
                                onclick: this.handleRefresh,
                                disabled: syncing
                            }, syncing ? 'Syncing...' : 'Refresh')
                        )
                    ),

                    // Indexing Status
                    !loading && currentBlock > 0 ? h('div', { className: 'indexing-status' },
                        h('span', { className: 'indexing-status-item' },
                            h('span', { className: 'indexing-status-label' }, 'Current Block:'),
                            h('span', { className: 'indexing-status-value text-mono' }, currentBlock.toLocaleString())
                        ),
                        h('span', { className: 'indexing-status-item' },
                            h('span', { className: 'indexing-status-label' }, 'Last Indexed:'),
                            h('span', { className: 'indexing-status-value text-mono' }, lastIndexedBlock.toLocaleString())
                        ),
                        h('span', { className: 'indexing-status-item' },
                            h('span', { className: 'indexing-status-label' }, 'Blocks Behind:'),
                            h('span', {
                                className: `indexing-status-value text-mono ${blocksBehind > 10 ? 'text-warning' : 'text-success'}`
                            }, blocksBehind.toLocaleString())
                        )
                    ) : null,

                    // Filter Pills
                    h('div', { className: 'filter-bar' },
                        h('button', {
                            className: `filter-pill ${filter === 'all' ? 'active' : ''}`,
                            onclick: () => this.handleFilterChange('all')
                        }, 'All'),
                        h('button', {
                            className: `filter-pill ${filter === 'message' ? 'active' : ''}`,
                            onclick: () => this.handleFilterChange('message')
                        }, 'Messages'),
                        h('button', {
                            className: `filter-pill ${filter === 'transfer' ? 'active' : ''}`,
                            onclick: () => this.handleFilterChange('transfer')
                        }, 'Trades'),
                        h('button', {
                            className: `filter-pill ${filter === 'mint' ? 'active' : ''}`,
                            onclick: () => this.handleFilterChange('mint')
                        }, 'Mints'),
                        h('button', {
                            className: `filter-pill ${showAdvancedFilters ? 'active' : ''} ${hasAdvancedFilters ? 'has-filters' : ''}`,
                            onclick: this.handleToggleAdvancedFilters
                        }, showAdvancedFilters ? 'Hide Advanced ▲' : 'Advanced ▼')
                    ),

                    // Advanced Filters (collapsible)
                    showAdvancedFilters ? h('div', { className: 'advanced-filters' },
                        h('div', { className: 'advanced-filters-grid' },
                            // Project search
                            h('div', { className: 'advanced-filter-group' },
                                h('label', { className: 'advanced-filter-label' }, 'Project'),
                                h('input', {
                                    type: 'text',
                                    className: 'advanced-filter-input',
                                    placeholder: 'Search by name or address...',
                                    value: projectSearch,
                                    oninput: this.handleProjectSearchChange
                                })
                            ),
                            // Include words
                            h('div', { className: 'advanced-filter-group' },
                                h('label', { className: 'advanced-filter-label' }, 'Include Words'),
                                h('input', {
                                    type: 'text',
                                    className: 'advanced-filter-input',
                                    placeholder: 'Comma or space separated...',
                                    value: includeWords,
                                    oninput: this.handleIncludeWordsChange
                                })
                            ),
                            // Exclude words
                            h('div', { className: 'advanced-filter-group' },
                                h('label', { className: 'advanced-filter-label' }, 'Exclude Words'),
                                h('input', {
                                    type: 'text',
                                    className: 'advanced-filter-input',
                                    placeholder: 'Comma or space separated...',
                                    value: excludeWords,
                                    oninput: this.handleExcludeWordsChange
                                })
                            )
                        ),
                        hasAdvancedFilters ? h('div', { className: 'advanced-filters-actions' },
                            h('button', {
                                className: 'btn btn-ghost btn-sm',
                                onclick: this.handleClearAdvancedFilters
                            }, 'Clear Advanced Filters')
                        ) : null
                    ) : null,

                    // Error state
                    error ? h('div', { className: 'error-message' }, `Error: ${error}`) : null,

                    // Activity Feed (with scanning animation during loading/syncing)
                    !error ? [
                        (loading || syncing) ? this.renderScanningIndicator() : null,

                        h('div', { className: 'activity-feed' },
                            (loading || syncing) ? [] : visibleActivity.length > 0
                                ? visibleActivity.map((item, i) => this.renderActivityItem(item, i))
                                : h('div', { className: 'empty-state' },
                                    h('p', { className: 'text-secondary' },
                                        filter === 'all'
                                            ? 'No activity yet. Be the first!'
                                            : `No ${filter} activity found.`
                                    )
                                )
                        ),

                        // Load More
                        hasMore ? h('div', { className: 'load-more-section' },
                            h('button', {
                                className: 'btn btn-secondary',
                                onclick: this.handleLoadMore
                            }, 'Load More Activity')
                        ) : null
                    ] : null,

                    // Pending interactions action bar (sticky at bottom)
                    hasPending ? h('div', { className: 'pending-actions-bar' },
                        h('div', { className: 'pending-actions-content' },
                            h('div', { className: 'pending-actions-info' },
                                h('span', { className: 'pending-count' }, `${pendingInteractions.length}`),
                                h('div', { className: 'pending-breakdown' },
                                    h('span', { className: 'pending-label' },
                                        `interaction${pendingInteractions.length === 1 ? '' : 's'} queued`
                                    ),
                                    h('span', { className: 'pending-details' },
                                        [
                                            pendingInteractions.filter(i => i.type === 'reaction').length > 0 &&
                                                `${pendingInteractions.filter(i => i.type === 'reaction').length} reactions`,
                                            pendingInteractions.filter(i => i.type === 'reply').length > 0 &&
                                                `${pendingInteractions.filter(i => i.type === 'reply').length} replies`,
                                            pendingInteractions.filter(i => i.type === 'quote').length > 0 &&
                                                `${pendingInteractions.filter(i => i.type === 'quote').length} quotes`
                                        ].filter(Boolean).join(', ')
                                    )
                                )
                            ),
                            h('div', { className: 'pending-actions-buttons' },
                                h('button', {
                                    className: 'btn btn-ghost btn-sm',
                                    onclick: this.handleClearQueue
                                }, 'Clear Queue'),
                                h('button', {
                                    className: 'btn btn-primary',
                                    onclick: this.handlePostAll
                                }, 'Post All')
                            )
                        )
                    ) : null
                )
            )
        });
    }
}

export default Activity;
