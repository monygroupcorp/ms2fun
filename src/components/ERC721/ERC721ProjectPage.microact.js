/**
 * ERC721ProjectPage - Microact Version
 *
 * Full page-level component for ERC721 Auction projects.
 * Renders: header, stats bar, auction config, live auction hero(s),
 * previous works gallery, vault alignment, comment feed.
 * Matches docs/examples/project-erc721-drip-demo.html
 */

import { Component, h } from '../../core/microact-setup.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.microact.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';

export class ERC721ProjectPage extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            // Project info
            projectName: '',
            projectDescription: '',
            creator: '',
            contractAddress: '',
            // Auction config
            lines: 1,
            baseDuration: 86400,
            timeBuffer: 300,
            bidIncrement: null,
            // Active auctions
            activeAuctions: [],
            // Past auctions
            pastAuctions: [],
            // Stats
            released: 0,
            sold: 0,
            volume: '0',
            avgSale: '0',
            collectors: 0,
            vaultContributed: '0',
            // Vault
            vaultAddress: null,
            vaultName: '',
            vaultRevenueSplit: '80% Creator / 20% Vault',
            vaultTotalContributed: '0',
            // Bid state (per-auction)
            bidInputs: {},
            bidStatus: {},
            bidHistories: {}
        };
        this._countdownIntervals = [];
    }

    get projectId() { return this.props.projectId; }
    get adapter() { return this.props.adapter; }
    get project() { return this.props.project; }

    async didMount() {
        stylesheetLoader.load('src/components/ERC721/erc721.css', 'erc721-styles');

        this.registerCleanup(() => {
            stylesheetLoader.unload('erc721-styles');
            this._countdownIntervals.forEach(id => clearInterval(id));
        });

        await this.loadProjectData();
        this.loadAuctionConfig();
        this.loadActiveAuctions();
        this.loadPastAuctions();
        this.loadVaultData();
    }

    async loadProjectData() {
        try {
            const project = this.project || {};

            this.setState({
                loading: false,
                projectName: project.name || project.displayName || 'Untitled Project',
                projectDescription: project.description || '',
                creator: project.creator || project.creatorAddress || '',
                contractAddress: project.contractAddress || project.address || this.projectId,
                vaultAddress: project.vault || null
            });
        } catch (error) {
            console.error('[ERC721ProjectPage] Failed to load project data:', error);
            this.setState({ loading: false });
        }
    }

    async loadAuctionConfig() {
        if (!this.adapter) return;
        try {
            const config = await this.adapter.getConfig();
            this.updateConfigDOM(config);
        } catch (error) {
            console.warn('[ERC721ProjectPage] Failed to load auction config:', error);
        }
    }

    async loadActiveAuctions() {
        if (!this.adapter) return;
        try {
            const activeAuctions = await this.adapter.getAllActiveAuctions();

            // Load bid history for each active auction
            const bidHistories = {};
            for (const { tokenId } of activeAuctions) {
                try {
                    bidHistories[tokenId] = await this.adapter.getBidHistory(tokenId);
                } catch (e) {
                    bidHistories[tokenId] = [];
                }
            }

            // Direct DOM update for auctions
            this.setState({ activeAuctions, bidHistories });

            // Start countdown timers
            this.startCountdowns();

            // Enhance IPFS images
            if (this._element) {
                enhanceAllIpfsImages(this._element);
            }
        } catch (error) {
            console.warn('[ERC721ProjectPage] Failed to load active auctions:', error);
        }
    }

    async loadPastAuctions() {
        if (!this.adapter) return;
        try {
            const pastAuctions = await this.adapter.getPastAuctions();

            // Compute stats from past + active auctions
            const settlements = await this.adapter.getSettlementHistory();
            const sold = settlements.length;
            const nextId = await this.adapter.getNextTokenId();
            const released = nextId - 1;

            let totalVolume = BigInt(0);
            const collectorsSet = new Set();
            let vaultContributed = BigInt(0);

            for (const s of settlements) {
                totalVolume += BigInt(s.amount.toString());
                collectorsSet.add(s.winner.toLowerCase());
                // 19% goes to vault
                vaultContributed += (BigInt(s.amount.toString()) * BigInt(19)) / BigInt(100);
            }

            const volumeEth = Number(totalVolume) / 1e18;
            const avgSale = sold > 0 ? (volumeEth / sold) : 0;
            const vaultEth = Number(vaultContributed) / 1e18;

            this.updateStatsDOM({
                released,
                sold,
                volume: volumeEth.toFixed(2),
                avgSale: avgSale.toFixed(2),
                collectors: collectorsSet.size,
                vaultContributed: vaultEth.toFixed(2)
            });

            this.setState({ pastAuctions });

            if (this._element) {
                enhanceAllIpfsImages(this._element);
            }
        } catch (error) {
            console.warn('[ERC721ProjectPage] Failed to load past auctions:', error);
        }
    }

    async loadVaultData() {
        const vaultAddress = this.state.vaultAddress || this.project?.vault;
        if (!vaultAddress) return;

        try {
            const { loadABI } = await import('../../utils/abiLoader.js');
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            const abi = await loadABI('UltraAlignmentVault');
            const provider = this.adapter?.provider || this.adapter?.contract?.provider;
            if (!provider) return;

            const vaultContract = new ethers.Contract(vaultAddress, abi, provider);

            const [description, ownerAddr] = await Promise.allSettled([
                vaultContract.description().catch(() => ''),
                this.adapter.getOwner()
            ]);

            let contributed = '0';
            try {
                const contrib = await vaultContract.benefactorTotalETH(this.projectId);
                contributed = (Number(contrib) / 1e18).toFixed(4);
            } catch (e) { /* may not exist */ }

            this.updateVaultDOM({
                vaultName: description.status === 'fulfilled' ? description.value : '',
                vaultTotalContributed: contributed,
                creator: ownerAddr.status === 'fulfilled' ? ownerAddr.value : this.state.creator
            });
        } catch (error) {
            console.warn('[ERC721ProjectPage] Failed to load vault data:', error);
        }
    }

    // ── Countdown Timers ──

    startCountdowns() {
        this._countdownIntervals.forEach(id => clearInterval(id));
        this._countdownIntervals = [];

        const interval = setInterval(() => {
            if (!this._element) return;
            const countdownEls = this._element.querySelectorAll('[data-countdown]');
            const now = Math.floor(Date.now() / 1000);

            countdownEls.forEach(el => {
                const endTime = parseInt(el.dataset.countdown);
                const remaining = endTime - now;

                if (remaining <= 0) {
                    el.textContent = 'Ended';
                    el.classList.remove('urgent');
                    return;
                }

                el.textContent = this.formatCountdown(remaining);
                if (remaining < 900) {
                    el.classList.add('urgent');
                } else {
                    el.classList.remove('urgent');
                }
            });
        }, 1000);

        this._countdownIntervals.push(interval);
    }

    formatCountdown(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }

    // ── DOM Updates ──

    updateConfigDOM(config) {
        if (!this._element) {
            this.setState(config);
            return;
        }
        const el = this._element;
        const setValue = (sel, val) => {
            const node = el.querySelector(sel);
            if (node) node.textContent = val;
        };
        setValue('[data-config="lines"]', config.lines);
        setValue('[data-config="duration"]', this.adapter.formatDuration(config.baseDuration));
        setValue('[data-config="buffer"]', this.adapter.formatDuration(config.timeBuffer));
        if (config.bidIncrement) {
            const incEth = Number(config.bidIncrement) / 1e18;
            setValue('[data-config="increment"]', `${incEth} ETH`);
        }
    }

    updateStatsDOM(stats) {
        if (!this._element) {
            this.setState(stats);
            return;
        }
        const el = this._element;
        const setValue = (sel, val) => {
            const node = el.querySelector(sel);
            if (node) node.textContent = val;
        };
        setValue('[data-stat="released"]', stats.released);
        setValue('[data-stat="sold"]', stats.sold);
        setValue('[data-stat="volume"]', `${stats.volume} ETH`);
        setValue('[data-stat="avgSale"]', `${stats.avgSale} ETH`);
        setValue('[data-stat="collectors"]', stats.collectors);
        setValue('[data-stat="vaultContributed"]', `${stats.vaultContributed} ETH`);
    }

    updateVaultDOM(data) {
        if (!this._element) {
            this.setState(data);
            return;
        }
        const el = this._element;
        const setValue = (sel, val) => {
            const node = el.querySelector(sel);
            if (node) node.textContent = val;
        };
        if (data.vaultName) setValue('[data-vault="name"]', data.vaultName);
        if (data.creator) setValue('[data-vault="creator"]', this.formatAddress(data.creator));
        setValue('[data-vault="contributed"]', `${data.vaultTotalContributed} ETH`);
    }

    shouldUpdate(oldState, newState) {
        if (oldState.loading !== newState.loading) return true;
        if (oldState.activeAuctions !== newState.activeAuctions) return true;
        if (oldState.pastAuctions !== newState.pastAuctions) return true;
        return false;
    }

    // ── Bid Actions ──

    handleBidInputChange(tokenId, value) {
        const inputs = { ...this.state.bidInputs, [tokenId]: value };
        this.setState({ bidInputs: inputs });
    }

    async handlePlaceBid(tokenId) {
        const bidValue = this.state.bidInputs[tokenId];
        if (!bidValue || isNaN(parseFloat(bidValue))) {
            this.setBidStatus(tokenId, 'error', 'Enter a valid bid amount');
            return;
        }

        try {
            this.setBidStatus(tokenId, 'pending', 'Placing bid...');

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const bidAmountWei = ethers.utils.parseEther(bidValue).toString();

            await this.adapter.createBid(tokenId, bidAmountWei);
            this.setBidStatus(tokenId, 'success', 'Bid placed!');

            // Refresh auctions
            setTimeout(() => this.loadActiveAuctions(), 2000);
        } catch (error) {
            const msg = error.message || 'Bid failed';
            this.setBidStatus(tokenId, 'error', msg);
        }
    }

    async handleSettle(tokenId) {
        try {
            this.setBidStatus(tokenId, 'pending', 'Settling auction...');
            await this.adapter.settleAuction(tokenId);
            this.setBidStatus(tokenId, 'success', 'Auction settled!');
            setTimeout(() => {
                this.loadActiveAuctions();
                this.loadPastAuctions();
            }, 2000);
        } catch (error) {
            this.setBidStatus(tokenId, 'error', error.message || 'Settlement failed');
        }
    }

    setBidStatus(tokenId, type, message) {
        // Direct DOM update for bid status
        if (this._element) {
            const statusEl = this._element.querySelector(`[data-bid-status="${tokenId}"]`);
            if (statusEl) {
                statusEl.textContent = message;
                statusEl.className = `bid-status ${type}`;
                statusEl.style.display = 'block';
                if (type === 'success') {
                    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
                }
            }
        }
    }

    // ── Helpers ──

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatAddress(address) {
        if (!address || address.length < 10) return address || '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatEth(weiValue) {
        try {
            const eth = Number(weiValue) / 1e18;
            return eth.toFixed(eth < 0.01 ? 4 : 2);
        } catch {
            return '0';
        }
    }

    timeAgo(timestamp) {
        if (!timestamp) return '';
        const now = Math.floor(Date.now() / 1000);
        const diff = now - timestamp;
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    getProjectInitials() {
        const name = this.state.projectName || '';
        return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    }

    // ── Render ──

    render() {
        const { loading, activeAuctions, pastAuctions, vaultAddress } = this.state;

        if (loading) {
            return h('div', { className: 'erc721-project-page' },
                h('div', { className: 'loading-state' },
                    h('p', null, 'Loading project...')
                )
            );
        }

        return h('div', { className: 'erc721-project-page' },

            // ── Project Header ──
            this.renderHeader(),

            // ── Stats Bar ──
            this.renderStatsBar(),

            // ── Auction Config ──
            this.renderAuctionConfig(),

            // ── Live Auction Hero(s) ──
            ...this.renderLiveAuctions(activeAuctions),

            // ── Previous Works ──
            pastAuctions.length > 0 && this.renderPreviousWorks(pastAuctions),

            // ── Vault Info ──
            vaultAddress && this.renderVaultInfo(),

            // ── Activity (Comment Feed) ──
            h('div', { className: 'activity-section' },
                h('div', { className: 'section-title' }, 'Activity'),
                h(ProjectCommentFeed, {
                    projectAddress: this.projectId
                })
            ),

            h('div', { style: { height: '80px' } })
        );
    }

    renderHeader() {
        const { projectName, projectDescription, creator, contractAddress } = this.state;

        return h('div', { className: 'project-header' },
            h('div', { className: 'project-icon' }, this.getProjectInitials()),
            h('div', { className: 'project-header-content' },
                h('h1', { className: 'project-title' }, this.escapeHtml(projectName)),
                h('div', { className: 'project-meta' },
                    creator && h('span', null, `By ${this.formatAddress(creator)}`),
                    h('span', null, '\u2022'),
                    h('span', null, 'ERC721 Auction')
                ),
                projectDescription && h('p', { className: 'project-description' },
                    this.escapeHtml(projectDescription)
                ),
                h('div', { className: 'project-actions' },
                    h('button', {
                        className: 'action-btn',
                        onClick: () => navigator.clipboard?.writeText(contractAddress)
                    }, 'Copy Contract')
                )
            )
        );
    }

    renderStatsBar() {
        const { released, sold, volume, avgSale, collectors, vaultContributed } = this.state;

        return h('div', { className: 'stats-bar' },
            h('div', { className: 'stat-item' },
                h('div', { className: 'stat-label' }, 'Released'),
                h('div', { className: 'stat-value', 'data-stat': 'released' }, released || '\u2014')
            ),
            h('div', { className: 'stat-item' },
                h('div', { className: 'stat-label' }, 'Sold'),
                h('div', { className: 'stat-value', 'data-stat': 'sold' }, sold || '\u2014')
            ),
            h('div', { className: 'stat-item' },
                h('div', { className: 'stat-label' }, 'Volume'),
                h('div', { className: 'stat-value', 'data-stat': 'volume' },
                    volume !== '0' ? `${volume} ETH` : '\u2014'
                )
            ),
            h('div', { className: 'stat-item' },
                h('div', { className: 'stat-label' }, 'Avg Sale'),
                h('div', { className: 'stat-value', 'data-stat': 'avgSale' },
                    avgSale !== '0' ? `${avgSale} ETH` : '\u2014'
                )
            ),
            h('div', { className: 'stat-item' },
                h('div', { className: 'stat-label' }, 'Collectors'),
                h('div', { className: 'stat-value', 'data-stat': 'collectors' }, collectors || '\u2014')
            ),
            h('div', { className: 'stat-item' },
                h('div', { className: 'stat-label' }, 'Vault Contributed'),
                h('div', { className: 'stat-value', 'data-stat': 'vaultContributed' },
                    vaultContributed !== '0' ? `${vaultContributed} ETH` : '\u2014'
                )
            )
        );
    }

    renderAuctionConfig() {
        const { lines, baseDuration, timeBuffer, bidIncrement } = this.state;
        const incEth = bidIncrement ? this.formatEth(bidIncrement) : '—';

        return h('div', { className: 'auction-config' },
            h('div', { className: 'config-badge' },
                h('span', { className: 'config-badge-label' }, 'Lines'),
                h('span', { className: 'config-badge-value', 'data-config': 'lines' }, lines)
            ),
            h('div', { className: 'config-badge' },
                h('span', { className: 'config-badge-label' }, 'Duration'),
                h('span', { className: 'config-badge-value', 'data-config': 'duration' },
                    this.adapter ? this.adapter.formatDuration(baseDuration) : `${baseDuration / 3600}h`
                )
            ),
            h('div', { className: 'config-badge' },
                h('span', { className: 'config-badge-label' }, 'Anti-snipe'),
                h('span', { className: 'config-badge-value', 'data-config': 'buffer' },
                    this.adapter ? this.adapter.formatDuration(timeBuffer) : `${timeBuffer / 60}m`
                )
            ),
            h('div', { className: 'config-badge' },
                h('span', { className: 'config-badge-label' }, 'Min Increment'),
                h('span', { className: 'config-badge-value', 'data-config': 'increment' }, `${incEth} ETH`)
            )
        );
    }

    renderLiveAuctions(activeAuctions) {
        if (activeAuctions.length === 0) {
            return [h('div', { className: 'no-auction' },
                h('div', { className: 'no-auction-text' }, 'No active auctions')
            )];
        }

        return activeAuctions.map(({ line, tokenId, auction }) =>
            this.renderLiveAuction(line, tokenId, auction)
        );
    }

    renderLiveAuction(line, tokenId, auction) {
        const now = Math.floor(Date.now() / 1000);
        const isEnded = now >= auction.endTime;
        const hasBids = auction.highBidder && auction.highBidder !== '0x0000000000000000000000000000000000000000';
        const bidHistory = this.state.bidHistories[tokenId] || [];
        const currentBidInput = this.state.bidInputs[tokenId] || '';

        // Compute min next bid
        let minNextBid = '';
        if (hasBids && this.state.bidIncrement) {
            const nextBid = BigInt(auction.highBid.toString()) + BigInt(this.state.bidIncrement.toString());
            minNextBid = (Number(nextBid) / 1e18).toFixed(4);
        } else if (!hasBids) {
            minNextBid = this.formatEth(auction.minBid);
        }

        // Resolve image from tokenURI metadata
        const imageHtml = auction.tokenURI
            ? renderIpfsImage(auction.tokenURI, `Piece #${tokenId}`, 'live-auction-img')
            : null;

        return h('div', { className: 'live-auction', key: `auction-${tokenId}` },
            // Header bar
            isEnded
                ? h('div', { className: 'auction-ended-banner' },
                    hasBids ? 'Auction Ended \u2014 Ready to Settle' : 'Auction Ended \u2014 No Bids',
                    hasBids && h('button', {
                        className: 'btn btn-primary settle-btn',
                        onClick: () => this.handleSettle(tokenId)
                    }, 'Settle')
                )
                : h('div', { className: 'live-label' },
                    h('div', { className: 'live-dot' }),
                    'Live Auction'
                ),

            // Layout
            h('div', { className: 'live-auction-layout' },
                // Image
                h('div', { className: 'live-auction-image' },
                    imageHtml
                        ? h('div', { innerHTML: imageHtml })
                        : `#${tokenId}`
                ),

                // Body
                h('div', { className: 'live-auction-body' },
                    h('div', { className: 'live-piece-name' }, `Piece #${tokenId}`),
                    h('div', { className: 'live-piece-id' }, `Token #${tokenId}`),

                    // Bid grid
                    h('div', { className: 'live-bid-grid' },
                        h('div', { className: 'live-bid-item' },
                            h('div', { className: 'live-bid-label' }, 'Current Bid'),
                            h('div', { className: 'live-bid-value' },
                                hasBids ? `${this.formatEth(auction.highBid)} ETH` : 'No bids'
                            )
                        ),
                        h('div', { className: 'live-bid-item' },
                            h('div', { className: 'live-bid-label' }, 'Time Remaining'),
                            h('div', {
                                className: 'live-bid-value live-countdown',
                                'data-countdown': auction.endTime
                            }, isEnded ? 'Ended' : this.formatCountdown(auction.endTime - now))
                        ),
                        h('div', { className: 'live-bid-item' },
                            h('div', { className: 'live-bid-label' }, hasBids ? 'Min Next Bid' : 'Min Bid (Deposit)'),
                            h('div', { className: 'live-bid-value' }, `${minNextBid} ETH`)
                        ),
                        h('div', { className: 'live-bid-item' },
                            h('div', { className: 'live-bid-label' }, 'Total Bids'),
                            h('div', { className: 'live-bid-value' }, bidHistory.length)
                        )
                    ),

                    // Bid input (only if auction still active)
                    !isEnded && h('div', { className: 'live-bid-input' },
                        h('input', {
                            type: 'text',
                            placeholder: minNextBid,
                            value: currentBidInput,
                            onInput: (e) => this.handleBidInputChange(tokenId, e.target.value)
                        }),
                        h('span', { className: 'bid-unit' }, 'ETH')
                    ),

                    !isEnded && h('button', {
                        className: 'btn btn-primary bid-btn',
                        onClick: () => this.handlePlaceBid(tokenId)
                    }, 'Place Bid'),

                    // Bid status
                    h('div', {
                        className: 'bid-status',
                        'data-bid-status': tokenId,
                        style: { display: 'none' }
                    }),

                    // Bid history
                    bidHistory.length > 0 && h('div', { className: 'live-bid-history' },
                        h('div', { className: 'bid-history-title' }, 'Bid History'),
                        ...bidHistory.slice(0, 5).map(bid =>
                            h('div', { className: 'bid-entry', key: bid.transactionHash },
                                h('span', { className: 'bid-entry-address' },
                                    this.formatAddress(bid.bidder)
                                ),
                                h('span', { className: 'bid-entry-amount' },
                                    `${this.formatEth(bid.amount)} ETH`
                                ),
                                h('span', { className: 'bid-entry-time' },
                                    this.timeAgo(bid.timestamp)
                                )
                            )
                        )
                    )
                )
            )
        );
    }

    renderPreviousWorks(pastAuctions) {
        return h('div', null,
            h('div', { className: 'section-title' }, 'Previous Works'),
            h('div', { className: 'works-gallery' },
                ...pastAuctions.map(auction => this.renderWorkCard(auction))
            )
        );
    }

    renderWorkCard(auction) {
        const hasBids = auction.highBidder && auction.highBidder !== '0x0000000000000000000000000000000000000000';
        const imageHtml = auction.tokenURI
            ? renderIpfsImage(auction.tokenURI, `#${auction.tokenId}`, 'work-card-img')
            : null;

        return h('div', { className: 'work-card', key: `work-${auction.tokenId}` },
            h('div', { className: 'work-image' },
                imageHtml
                    ? h('div', { innerHTML: imageHtml })
                    : `#${auction.tokenId}`,
                h('div', { className: `work-badge ${hasBids ? '' : 'unsold'}` },
                    hasBids ? 'Sold' : 'Unsold'
                )
            ),
            h('div', { className: 'work-info' },
                h('div', { className: 'work-name' }, `Piece #${auction.tokenId}`),
                hasBids
                    ? [
                        h('div', { className: 'work-detail-row' },
                            h('span', { className: 'work-detail-label' }, 'Winning Bid'),
                            h('span', { className: 'work-detail-value' }, `${this.formatEth(auction.highBid)} ETH`)
                        ),
                        h('div', { className: 'work-detail-row' },
                            h('span', { className: 'work-detail-label' }, 'Winner'),
                            h('span', { className: 'work-detail-value' }, this.formatAddress(auction.highBidder))
                        )
                    ]
                    : [
                        h('div', { className: 'work-detail-row' },
                            h('span', { className: 'work-detail-label' }, 'Result'),
                            h('span', { className: 'work-detail-value' }, 'No Bids')
                        ),
                        h('div', { className: 'work-detail-row' },
                            h('span', { className: 'work-detail-label' }, 'Deposit'),
                            h('span', { className: 'work-detail-value' }, `${this.formatEth(auction.minBid)} ETH`)
                        )
                    ]
            )
        );
    }

    renderVaultInfo() {
        const { vaultAddress, vaultName, vaultRevenueSplit, vaultTotalContributed, creator } = this.state;

        return h('div', { className: 'vault-info' },
            h('div', { className: 'vault-info-title' }, 'Vault Alignment'),
            h('div', { className: 'vault-info-row' },
                h('span', { className: 'vault-info-label' }, 'Aligned To'),
                h('span', { className: 'vault-info-value', 'data-vault': 'name' },
                    vaultName || this.formatAddress(vaultAddress)
                )
            ),
            h('div', { className: 'vault-info-row' },
                h('span', { className: 'vault-info-label' }, 'Creator'),
                h('span', { className: 'vault-info-value', 'data-vault': 'creator' },
                    this.formatAddress(creator)
                )
            ),
            h('div', { className: 'vault-info-row' },
                h('span', { className: 'vault-info-label' }, 'Revenue Split'),
                h('span', { className: 'vault-info-value' }, vaultRevenueSplit)
            ),
            h('div', { className: 'vault-info-row' },
                h('span', { className: 'vault-info-label' }, 'Total to Vault'),
                h('span', { className: 'vault-info-value', 'data-vault': 'contributed' },
                    vaultTotalContributed !== '0' ? `${vaultTotalContributed} ETH` : '\u2014'
                )
            )
        );
    }
}

export default ERC721ProjectPage;
