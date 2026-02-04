# ERC404 Project Page Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the stacked-panel ERC404 project page with a pump.fun-style two-column layout featuring trading sidebar, tabbed content (Token/NFT), and portfolio modal.

**Architecture:** New ERC404ProjectPage component replaces ContractTypeRouter for ERC404 contracts. Sidebar contains trading interface and token info. Main content has tabs for Token (bonding + staking) and NFT (gallery preview). Comments appear on both tabs. Modals for share and portfolio functionality.

**Tech Stack:** microact Component framework, stylesheetLoader for CSS, eventBus for events, localStorage for favorites, existing adapter methods.

---

## Task 1: Create FavoritesService

**Files:**
- Create: `src/services/FavoritesService.js`

**Step 1: Create the service**

```javascript
/**
 * FavoritesService
 * Manages user's favorite/starred projects in localStorage
 */

const STORAGE_KEY = 'ms2fun_favorites';

class FavoritesService {
    constructor() {
        this._favorites = this._load();
    }

    _load() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.warn('[FavoritesService] Failed to load favorites:', e);
            return [];
        }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._favorites));
        } catch (e) {
            console.warn('[FavoritesService] Failed to save favorites:', e);
        }
    }

    isFavorite(projectId) {
        return this._favorites.includes(projectId.toLowerCase());
    }

    addFavorite(projectId) {
        const id = projectId.toLowerCase();
        if (!this._favorites.includes(id)) {
            this._favorites.push(id);
            this._save();
        }
    }

    removeFavorite(projectId) {
        const id = projectId.toLowerCase();
        this._favorites = this._favorites.filter(f => f !== id);
        this._save();
    }

    toggleFavorite(projectId) {
        if (this.isFavorite(projectId)) {
            this.removeFavorite(projectId);
            return false;
        } else {
            this.addFavorite(projectId);
            return true;
        }
    }

    getFavorites() {
        return [...this._favorites];
    }
}

export const favoritesService = new FavoritesService();
export default favoritesService;
```

**Step 2: Verify file created**

Check that the file exists and has no syntax errors by importing it in browser console or reviewing.

**Step 3: Commit**

```bash
git add src/services/FavoritesService.js
git commit -m "feat: add FavoritesService for localStorage favorites"
```

---

## Task 2: Create ShareModal Component

**Files:**
- Create: `src/components/ShareModal/ShareModal.js`
- Create: `src/components/ShareModal/ShareModal.css`

**Step 1: Create ShareModal.js**

```javascript
/**
 * ShareModal Component
 * Shows share preview, copy link, and share on X buttons
 */

import { Component } from '../../core/Component.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ShareModal extends Component {
    constructor(projectData) {
        super();
        this.projectData = projectData;
        this.state = {
            isOpen: false,
            copied: false
        };
    }

    open() {
        this.setState({ isOpen: true, copied: false });
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.setState({ isOpen: false });
        document.body.style.overflow = '';
    }

    getShareUrl() {
        return `${window.location.origin}/project/${this.projectData.address}`;
    }

    getShareText() {
        const { name, symbol } = this.projectData;
        return `Check out ${name} ($${symbol}) on MS2`;
    }

    async handleCopyLink() {
        try {
            await navigator.clipboard.writeText(this.getShareUrl());
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 2000);
        } catch (e) {
            console.error('[ShareModal] Failed to copy:', e);
        }
    }

    handleShareX() {
        const text = encodeURIComponent(this.getShareText());
        const url = encodeURIComponent(this.getShareUrl());
        window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
    }

    onMount() {
        stylesheetLoader.load('src/components/ShareModal/ShareModal.css', 'share-modal-styles');
        this.setupEventDelegation();
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const target = e.target;

            if (target.closest('[data-action="close"]') || target.classList.contains('share-modal-overlay')) {
                this.close();
            } else if (target.closest('[data-action="copy"]')) {
                this.handleCopyLink();
            } else if (target.closest('[data-action="share-x"]')) {
                this.handleShareX();
            }
        });
    }

    render() {
        if (!this.state.isOpen) return '';

        const { name, symbol, image } = this.projectData;
        const shareUrl = this.getShareUrl();

        return `
            <div class="share-modal-overlay">
                <div class="share-modal">
                    <div class="share-modal-header">
                        <h3>Share Project</h3>
                        <button class="close-btn" data-action="close">&times;</button>
                    </div>

                    <div class="share-preview-card">
                        <div class="preview-image">
                            ${image ? `<img src="${image}" alt="${name}">` : '<div class="placeholder-image"></div>'}
                        </div>
                        <div class="preview-info">
                            <div class="preview-name">${name}</div>
                            <div class="preview-symbol">$${symbol}</div>
                        </div>
                    </div>

                    <div class="share-actions">
                        <button class="share-btn copy-btn" data-action="copy">
                            ${this.state.copied ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button class="share-btn x-btn" data-action="share-x">
                            Share on X
                        </button>
                    </div>

                    <div class="share-url">${shareUrl}</div>
                </div>
            </div>
        `;
    }

    unmount() {
        stylesheetLoader.unload('share-modal-styles');
        super.unmount();
    }
}
```

**Step 2: Create ShareModal.css**

```css
.share-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.share-modal {
    background: var(--surface-color, #1a1a2e);
    border-radius: 12px;
    padding: 24px;
    width: 90%;
    max-width: 400px;
    border: 1px solid var(--border-color, #333);
}

.share-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.share-modal-header h3 {
    margin: 0;
    color: var(--text-color, #fff);
}

.share-modal-header .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
}

.share-preview-card {
    background: var(--background-color, #0f0f1a);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    gap: 16px;
    margin-bottom: 20px;
}

.preview-image {
    width: 64px;
    height: 64px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
}

.preview-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.placeholder-image {
    width: 100%;
    height: 100%;
    background: var(--border-color, #333);
}

.preview-info {
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.preview-name {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color, #fff);
}

.preview-symbol {
    font-size: 14px;
    color: var(--text-muted, #888);
}

.share-actions {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
}

.share-btn {
    flex: 1;
    padding: 12px 16px;
    border-radius: 8px;
    border: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
}

.share-btn:hover {
    opacity: 0.9;
}

.copy-btn {
    background: var(--primary-color, #6366f1);
    color: white;
}

.x-btn {
    background: #000;
    color: white;
}

.share-url {
    font-size: 12px;
    color: var(--text-muted, #888);
    word-break: break-all;
    text-align: center;
}
```

**Step 3: Commit**

```bash
git add src/components/ShareModal/ShareModal.js src/components/ShareModal/ShareModal.css
git commit -m "feat: add ShareModal component for project sharing"
```

---

## Task 3: Create ProjectHeaderCompact Component

**Files:**
- Create: `src/components/ERC404/ProjectHeaderCompact.js`

**Step 1: Create the component**

```javascript
/**
 * ProjectHeaderCompact Component
 * Displays project identity (name, ticker, icon, creator, date) and actions (share, copy, star)
 */

import { Component } from '../../core/Component.js';
import { ShareModal } from '../ShareModal/ShareModal.js';
import favoritesService from '../../services/FavoritesService.js';

export class ProjectHeaderCompact extends Component {
    constructor(projectData) {
        super();
        this.projectData = projectData;
        this.shareModal = null;
        this.state = {
            isFavorite: favoritesService.isFavorite(projectData.address),
            copied: false
        };
    }

    async handleCopyAddress() {
        try {
            await navigator.clipboard.writeText(this.projectData.address);
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 2000);
        } catch (e) {
            console.error('[ProjectHeaderCompact] Failed to copy:', e);
        }
    }

    handleToggleFavorite() {
        const isFavorite = favoritesService.toggleFavorite(this.projectData.address);
        this.setState({ isFavorite });
    }

    handleOpenShare() {
        if (!this.shareModal) {
            this.shareModal = new ShareModal(this.projectData);
            const container = document.createElement('div');
            container.id = 'share-modal-container';
            document.body.appendChild(container);
            this.shareModal.mount(container);
        }
        this.shareModal.open();
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatDate(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    onMount() {
        this.setupEventDelegation();
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const target = e.target;

            if (target.closest('[data-action="share"]')) {
                this.handleOpenShare();
            } else if (target.closest('[data-action="copy"]')) {
                this.handleCopyAddress();
            } else if (target.closest('[data-action="favorite"]')) {
                this.handleToggleFavorite();
            }
        });
    }

    render() {
        const { name, symbol, image, creator, createdAt, address } = this.projectData;
        const { isFavorite, copied } = this.state;

        return `
            <div class="project-header-compact">
                <div class="header-left">
                    <div class="project-icon">
                        ${image ? `<img src="${image}" alt="${name}">` : '<div class="icon-placeholder"></div>'}
                    </div>
                    <div class="project-identity">
                        <h1 class="project-name">${name} <span class="project-ticker">($${symbol})</span></h1>
                        <div class="project-meta">
                            <span class="creator">
                                Created by
                                <a href="https://etherscan.io/address/${creator}" target="_blank" rel="noopener">
                                    ${this.truncateAddress(creator)}
                                </a>
                            </span>
                            ${createdAt ? `<span class="date">${this.formatDate(createdAt)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="header-actions">
                    <button class="action-btn" data-action="share" title="Share">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                            <polyline points="16 6 12 2 8 6"/>
                            <line x1="12" y1="2" x2="12" y2="15"/>
                        </svg>
                    </button>
                    <button class="action-btn address-btn" data-action="copy" title="Copy address">
                        <span class="address-text">${this.truncateAddress(address)}</span>
                        <span class="copy-icon">${copied ? '✓' : '📋'}</span>
                    </button>
                    <button class="action-btn favorite-btn ${isFavorite ? 'is-favorite' : ''}" data-action="favorite" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                        ${isFavorite ? '★' : '☆'}
                    </button>
                </div>
            </div>
        `;
    }

    unmount() {
        if (this.shareModal) {
            this.shareModal.close();
            const container = document.getElementById('share-modal-container');
            if (container) container.remove();
        }
        super.unmount();
    }
}
```

**Step 2: Commit**

```bash
git add src/components/ERC404/ProjectHeaderCompact.js
git commit -m "feat: add ProjectHeaderCompact component with share/copy/favorite"
```

---

## Task 4: Create BondingProgressSection Component

**Files:**
- Create: `src/components/ERC404/BondingProgressSection.js`

**Step 1: Create the component**

```javascript
/**
 * BondingProgressSection Component
 * Shows bonding curve visualization, progress bar, and stats during bonding phase.
 * Shows Dextools iframe after liquidity deployment.
 */

import { Component } from '../../core/Component.js';
import BondingCurve from '../BondingCurve/BondingCurve.js';

export class BondingProgressSection extends Component {
    constructor(adapter, projectId) {
        super();
        this.adapter = adapter;
        this.projectId = projectId;
        this.bondingCurve = null;
        this.state = {
            loading: true,
            hasLiquidity: false,
            liquidityPool: null,
            bondingStatus: null,
            supplyInfo: null,
            phase: 'pre-open'
        };
    }

    async onMount() {
        await this.loadData();
        this.setTimeout(() => this.setupBondingCurve(), 100);
    }

    async loadData() {
        try {
            this.setState({ loading: true });

            const [bondingStatus, supplyInfo, liquidityPool] = await Promise.all([
                this.adapter.getBondingStatus().catch(() => null),
                this.adapter.getSupplyInfo().catch(() => null),
                this.adapter.liquidityPool().catch(() => null)
            ]);

            const hasLiquidity = liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000';
            const phase = this.calculatePhase(bondingStatus, hasLiquidity);

            this.setState({
                loading: false,
                bondingStatus,
                supplyInfo,
                liquidityPool,
                hasLiquidity,
                phase
            });
        } catch (error) {
            console.error('[BondingProgressSection] Error loading data:', error);
            this.setState({ loading: false });
        }
    }

    calculatePhase(status, hasLiquidity) {
        if (hasLiquidity) return 'deployed';
        if (!status) return 'pre-open';

        const now = Math.floor(Date.now() / 1000);
        if (status.maturityTime && now >= status.maturityTime) return 'matured';
        if (status.isActive && status.openTime && now >= status.openTime) return 'bonding';
        if (status.isActive) return 'pre-open';
        return 'pre-open';
    }

    setupBondingCurve() {
        if (this.state.hasLiquidity) return;

        const container = this.element?.querySelector('[data-ref="bonding-curve"]');
        if (container && !this.bondingCurve) {
            this.bondingCurve = new BondingCurve(this.adapter);
            this.bondingCurve.mount(container);
        }
    }

    getProgressPercent() {
        const { supplyInfo } = this.state;
        if (!supplyInfo) return 0;
        const current = parseFloat(supplyInfo.currentBondingSupply) || 0;
        const max = parseFloat(supplyInfo.maxBondingSupply) || 1;
        return Math.min((current / max) * 100, 100);
    }

    formatNumber(num) {
        const n = parseFloat(num) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
        return n.toFixed(2);
    }

    getPhaseBadge() {
        const badges = {
            'pre-open': { text: 'Pre-Open', class: 'phase-pre-open' },
            'bonding': { text: 'Bonding Active', class: 'phase-bonding' },
            'matured': { text: 'Matured', class: 'phase-matured' },
            'deployed': { text: 'Liquidity Deployed', class: 'phase-deployed' }
        };
        return badges[this.state.phase] || badges['pre-open'];
    }

    render() {
        if (this.state.loading) {
            return `<div class="bonding-progress-section loading"><div class="spinner"></div></div>`;
        }

        const { hasLiquidity, liquidityPool, bondingStatus, supplyInfo } = this.state;

        if (hasLiquidity) {
            return this.renderDextools(liquidityPool);
        }

        return this.renderBondingProgress(bondingStatus, supplyInfo);
    }

    renderDextools(poolAddress) {
        // Dextools embed URL format
        const dextoolsUrl = `https://www.dextools.io/widget-chart/en/ether/pe-light/${poolAddress}?theme=dark&chartType=1&chartResolution=30&drawingToolbars=false`;

        return `
            <div class="bonding-progress-section dextools-view">
                <div class="dextools-container">
                    <iframe
                        src="${dextoolsUrl}"
                        frameborder="0"
                        allow="clipboard-write"
                        allowfullscreen
                    ></iframe>
                </div>
                <div class="dextools-fallback">
                    <a href="https://www.dextools.io/app/en/ether/pair-explorer/${poolAddress}" target="_blank" rel="noopener">
                        View on Dextools →
                    </a>
                </div>
            </div>
        `;
    }

    renderBondingProgress(status, supply) {
        const progress = this.getProgressPercent();
        const badge = this.getPhaseBadge();
        const currentSupply = supply?.currentBondingSupply || '0';
        const maxSupply = supply?.maxBondingSupply || '0';
        const reserve = status?.currentReserve || '0';

        return `
            <div class="bonding-progress-section">
                <div class="phase-badge ${badge.class}">${badge.text}</div>

                <div class="bonding-curve-container" data-ref="bonding-curve">
                    <!-- BondingCurve component mounts here -->
                </div>

                <div class="progress-bar-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="progress-label">${progress.toFixed(1)}% filled</div>
                </div>

                <div class="bonding-stats">
                    <div class="stat">
                        <span class="stat-value">${parseFloat(reserve).toFixed(4)} ETH</span>
                        <span class="stat-label">Raised</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">${this.formatNumber(currentSupply)} / ${this.formatNumber(maxSupply)}</span>
                        <span class="stat-label">Tokens</span>
                    </div>
                </div>
            </div>
        `;
    }

    unmount() {
        if (this.bondingCurve) {
            this.bondingCurve.unmount();
            this.bondingCurve = null;
        }
        super.unmount();
    }
}
```

**Step 2: Commit**

```bash
git add src/components/ERC404/BondingProgressSection.js
git commit -m "feat: add BondingProgressSection with curve viz and dextools embed"
```

---

## Task 5: Create StakingSection Component

**Files:**
- Create: `src/components/ERC404/StakingSection.js`

**Step 1: Create the component**

```javascript
/**
 * StakingSection Component
 * Simplified staking UI for the Token tab
 */

import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import { eventBus } from '../../core/EventBus.js';

export class StakingSection extends Component {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this._formValues = { stakeAmount: '', unstakeAmount: '' };
        this.state = {
            loading: true,
            stakingEnabled: false,
            userStaked: '0',
            claimableRewards: '0',
            totalStaked: '0',
            txPending: false,
            error: null,
            success: null
        };
    }

    async onMount() {
        await this.loadData();
        this.setupEventDelegation();

        this._walletHandler = () => this.loadData();
        eventBus.on('wallet:connected', this._walletHandler);
        eventBus.on('wallet:changed', this._walletHandler);
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const stakingStats = await this.adapter.getStakingStats().catch(() => null);
            const userAddress = walletService.getAddress();

            let userStaked = '0';
            let claimableRewards = '0';

            if (userAddress && stakingStats?.enabled) {
                const userInfo = await this.adapter.getUserStakingInfo(userAddress).catch(() => null);
                if (userInfo) {
                    userStaked = userInfo.stakedBalance || '0';
                    claimableRewards = userInfo.pendingRewards || '0';
                }
            }

            this.setState({
                loading: false,
                stakingEnabled: stakingStats?.enabled || false,
                totalStaked: stakingStats?.globalTotalStaked || '0',
                userStaked,
                claimableRewards
            });
        } catch (error) {
            console.error('[StakingSection] Error:', error);
            this.setState({ loading: false, error: error.message });
        }
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', async (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (!action || this.state.txPending) return;

            if (action === 'stake') await this.handleStake();
            else if (action === 'unstake') await this.handleUnstake();
            else if (action === 'claim') await this.handleClaim();
        });

        this.element.addEventListener('input', (e) => {
            if (e.target.name === 'stakeAmount') this._formValues.stakeAmount = e.target.value;
            if (e.target.name === 'unstakeAmount') this._formValues.unstakeAmount = e.target.value;
        });
    }

    async handleStake() {
        const amount = this._formValues.stakeAmount;
        if (!amount || parseFloat(amount) <= 0) return;

        try {
            this.setState({ txPending: true, error: null, success: null });
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(amount, 18);
            await this.adapter.stake(amountWei.toString());
            this._formValues.stakeAmount = '';
            this.setState({ txPending: false, success: 'Staked successfully!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message });
        }
    }

    async handleUnstake() {
        const amount = this._formValues.unstakeAmount;
        if (!amount || parseFloat(amount) <= 0) return;

        try {
            this.setState({ txPending: true, error: null, success: null });
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(amount, 18);
            await this.adapter.unstake(amountWei.toString());
            this._formValues.unstakeAmount = '';
            this.setState({ txPending: false, success: 'Unstaked successfully!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message });
        }
    }

    async handleClaim() {
        try {
            this.setState({ txPending: true, error: null, success: null });
            await this.adapter.claimStakingRewards();
            this.setState({ txPending: false, success: 'Rewards claimed!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message });
        }
    }

    isConnected() {
        return walletService.isConnected();
    }

    render() {
        if (this.state.loading) {
            return `<div class="staking-section loading"><div class="spinner"></div></div>`;
        }

        const { stakingEnabled, userStaked, claimableRewards, totalStaked, txPending, error, success } = this.state;
        const connected = this.isConnected();

        return `
            <div class="staking-section">
                <div class="section-header">
                    <h3>Staking</h3>
                    <span class="status-badge ${stakingEnabled ? 'enabled' : 'disabled'}">
                        ${stakingEnabled ? 'Enabled' : 'Not Enabled'}
                    </span>
                </div>

                ${!stakingEnabled ? `
                    <div class="staking-disabled-message">
                        Staking has not been enabled for this project yet.
                    </div>
                ` : !connected ? `
                    <div class="connect-prompt">
                        <p>Connect wallet to stake</p>
                        <div class="staking-stat">Total Staked: ${parseFloat(totalStaked).toFixed(2)} tokens</div>
                    </div>
                ` : `
                    <div class="staking-info">
                        <div class="info-row">
                            <span>Your Staked:</span>
                            <span class="value">${parseFloat(userStaked).toFixed(4)} tokens</span>
                        </div>
                        <div class="info-row">
                            <span>Claimable Rewards:</span>
                            <span class="value">${parseFloat(claimableRewards).toFixed(6)} ETH</span>
                        </div>
                    </div>

                    <div class="staking-actions">
                        <div class="action-group">
                            <input type="number" name="stakeAmount" placeholder="Amount to stake" value="${this._formValues.stakeAmount}" ${txPending ? 'disabled' : ''}>
                            <button data-action="stake" ${txPending ? 'disabled' : ''}>Stake</button>
                        </div>
                        <div class="action-group">
                            <input type="number" name="unstakeAmount" placeholder="Amount to unstake" value="${this._formValues.unstakeAmount}" ${txPending ? 'disabled' : ''}>
                            <button data-action="unstake" ${txPending ? 'disabled' : ''}>Unstake</button>
                        </div>
                    </div>

                    <button class="claim-btn" data-action="claim" ${txPending || parseFloat(claimableRewards) <= 0 ? 'disabled' : ''}>
                        Claim Rewards
                    </button>

                    ${error ? `<div class="message error">${error}</div>` : ''}
                    ${success ? `<div class="message success">${success}</div>` : ''}
                `}
            </div>
        `;
    }

    unmount() {
        if (this._walletHandler) {
            eventBus.off('wallet:connected', this._walletHandler);
            eventBus.off('wallet:changed', this._walletHandler);
        }
        super.unmount();
    }
}
```

**Step 2: Commit**

```bash
git add src/components/ERC404/StakingSection.js
git commit -m "feat: add StakingSection component for Token tab"
```

---

## Task 6: Create NFTGalleryPreview Component

**Files:**
- Create: `src/components/ERC404/NFTGalleryPreview.js`

**Step 1: Create the component**

```javascript
/**
 * NFTGalleryPreview Component
 * Shows limited NFT grid for NFT tab with link to full gallery
 */

import { Component } from '../../core/Component.js';
import { renderIpfsImage } from '../../utils/ipfsImageHelper.js';

const PREVIEW_LIMIT = 12;

export class NFTGalleryPreview extends Component {
    constructor(adapter, projectId) {
        super();
        this.adapter = adapter;
        this.projectId = projectId;
        this.state = {
            loading: true,
            nfts: [],
            totalCount: 0,
            error: null
        };
    }

    async onMount() {
        await this.loadNFTs();
    }

    async loadNFTs() {
        try {
            this.setState({ loading: true, error: null });

            // Get total NFT count
            const totalSupply = await this.adapter.totalNFTSupply().catch(() => 0);

            // Load first N NFTs
            const nfts = [];
            const limit = Math.min(PREVIEW_LIMIT, parseInt(totalSupply) || 0);

            for (let i = 0; i < limit; i++) {
                try {
                    const tokenId = await this.adapter.tokenByIndex(i).catch(() => null);
                    if (tokenId) {
                        const metadata = await this.adapter.getTokenMetadata(tokenId).catch(() => null);
                        nfts.push({
                            tokenId: tokenId.toString(),
                            image: metadata?.image || null,
                            name: metadata?.name || `#${tokenId}`
                        });
                    }
                } catch (e) {
                    console.warn('[NFTGalleryPreview] Error loading NFT:', e);
                }
            }

            this.setState({
                loading: false,
                nfts,
                totalCount: parseInt(totalSupply) || 0
            });
        } catch (error) {
            console.error('[NFTGalleryPreview] Error:', error);
            this.setState({ loading: false, error: error.message });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="nft-gallery-preview loading">
                    <div class="spinner"></div>
                    <p>Loading NFTs...</p>
                </div>
            `;
        }

        const { nfts, totalCount, error } = this.state;

        if (error) {
            return `
                <div class="nft-gallery-preview error">
                    <p>Failed to load NFTs</p>
                </div>
            `;
        }

        if (nfts.length === 0) {
            return `
                <div class="nft-gallery-preview empty">
                    <p>No NFTs minted yet</p>
                    <p class="subtext">NFTs are minted when token holders convert their balance</p>
                </div>
            `;
        }

        return `
            <div class="nft-gallery-preview">
                <div class="nft-grid">
                    ${nfts.map(nft => `
                        <div class="nft-card" data-token-id="${nft.tokenId}">
                            <div class="nft-image">
                                ${nft.image ? renderIpfsImage(nft.image, nft.name) : '<div class="placeholder"></div>'}
                            </div>
                            <div class="nft-name">${nft.name}</div>
                        </div>
                    `).join('')}
                </div>

                ${totalCount > PREVIEW_LIMIT ? `
                    <div class="gallery-link">
                        <a href="/project/${this.projectId}/gallery">
                            View Full Gallery (${totalCount} NFTs) →
                        </a>
                    </div>
                ` : ''}
            </div>
        `;
    }
}
```

**Step 2: Commit**

```bash
git add src/components/ERC404/NFTGalleryPreview.js
git commit -m "feat: add NFTGalleryPreview component for NFT tab"
```

---

## Task 7: Create ERC404TradingSidebar Component

**Files:**
- Create: `src/components/ERC404/ERC404TradingSidebar.js`

**Step 1: Create the component**

```javascript
/**
 * ERC404TradingSidebar Component
 * Trading interface sidebar with buy/sell, token info, and portfolio button
 */

import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import { ERC404PortfolioModal } from './ERC404PortfolioModal.js';

export class ERC404TradingSidebar extends Component {
    constructor(adapter, projectData) {
        super();
        this.adapter = adapter;
        this.projectData = projectData;
        this.portfolioModal = null;
        this._formValues = { amount: '' };
        this.state = {
            loading: true,
            isBuying: true,
            price: '0',
            userBalance: '0',
            userNFTCount: 0,
            txPending: false,
            error: null
        };
    }

    async onMount() {
        await this.loadData();
        this.setupEventDelegation();

        this._walletHandler = () => this.loadData();
        eventBus.on('wallet:connected', this._walletHandler);
        eventBus.on('wallet:changed', this._walletHandler);
    }

    async loadData() {
        try {
            this.setState({ loading: true });

            const price = await this.adapter.getCurrentPrice().catch(() => '0');
            const userAddress = walletService.getAddress();

            let userBalance = '0';
            let userNFTCount = 0;

            if (userAddress) {
                const balance = await this.adapter.balanceOf(userAddress).catch(() => '0');
                userBalance = balance;

                const nftBalance = await this.adapter.nftBalanceOf(userAddress).catch(() => 0);
                userNFTCount = parseInt(nftBalance) || 0;
            }

            this.setState({
                loading: false,
                price,
                userBalance,
                userNFTCount
            });
        } catch (error) {
            console.error('[ERC404TradingSidebar] Error:', error);
            this.setState({ loading: false });
        }
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', async (e) => {
            const target = e.target;

            if (target.closest('[data-action="toggle-buy"]')) {
                this.setState({ isBuying: true });
            } else if (target.closest('[data-action="toggle-sell"]')) {
                this.setState({ isBuying: false });
            } else if (target.closest('[data-action="quick-pick"]')) {
                const value = target.closest('[data-action="quick-pick"]').dataset.value;
                this.handleQuickPick(value);
            } else if (target.closest('[data-action="execute"]')) {
                await this.handleExecuteTrade();
            } else if (target.closest('[data-action="connect"]')) {
                eventBus.emit('wallet:request-connect');
            } else if (target.closest('[data-action="portfolio"]')) {
                this.openPortfolioModal();
            }
        });

        this.element.addEventListener('input', (e) => {
            if (e.target.name === 'amount') {
                this._formValues.amount = e.target.value;
            }
        });
    }

    handleQuickPick(value) {
        if (this.state.isBuying) {
            // ETH amounts for buying
            this._formValues.amount = value;
        } else {
            // Percentages for selling
            const balance = parseFloat(this.state.userBalance) || 0;
            const percent = value === 'max' ? 100 : parseFloat(value);
            this._formValues.amount = ((balance * percent) / 100).toString();
        }
        this.update();
    }

    async handleExecuteTrade() {
        const amount = this._formValues.amount;
        if (!amount || parseFloat(amount) <= 0) return;

        try {
            this.setState({ txPending: true, error: null });
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            if (this.state.isBuying) {
                const ethAmount = ethers.utils.parseEther(amount);
                await this.adapter.buy({ value: ethAmount });
            } else {
                const tokenAmount = ethers.utils.parseUnits(amount, 18);
                await this.adapter.sell(tokenAmount);
            }

            this._formValues.amount = '';
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message });
        }
    }

    openPortfolioModal() {
        if (!this.portfolioModal) {
            this.portfolioModal = new ERC404PortfolioModal(this.adapter, this.projectData);
            const container = document.createElement('div');
            container.id = 'portfolio-modal-container';
            document.body.appendChild(container);
            this.portfolioModal.mount(container);
        }
        this.portfolioModal.open();
    }

    isConnected() {
        return walletService.isConnected();
    }

    render() {
        const { loading, isBuying, price, userBalance, userNFTCount, txPending, error } = this.state;
        const connected = this.isConnected();
        const symbol = this.projectData.symbol || 'TOKEN';

        const quickPicks = isBuying
            ? ['.1', '.5', '1', 'max']
            : ['25', '50', '75', 'max'];

        return `
            <div class="erc404-trading-sidebar">
                <div class="trading-controls">
                    <div class="buy-sell-toggle">
                        <button class="toggle-btn ${isBuying ? 'active' : ''}" data-action="toggle-buy">Buy</button>
                        <button class="toggle-btn ${!isBuying ? 'active' : ''}" data-action="toggle-sell">Sell</button>
                    </div>

                    <div class="amount-input-container">
                        <input
                            type="number"
                            name="amount"
                            placeholder="${isBuying ? 'ETH amount' : 'Token amount'}"
                            value="${this._formValues.amount}"
                            ${txPending ? 'disabled' : ''}
                        >
                        <span class="currency-label">${isBuying ? 'ETH' : symbol}</span>
                    </div>

                    <div class="quick-picks">
                        ${quickPicks.map(val => `
                            <button class="quick-pick-btn" data-action="quick-pick" data-value="${val}" ${txPending ? 'disabled' : ''}>
                                ${val === 'max' ? 'max' : (isBuying ? val : val + '%')}
                            </button>
                        `).join('')}
                    </div>

                    ${!connected ? `
                        <button class="execute-btn connect" data-action="connect">
                            Connect Wallet
                        </button>
                    ` : `
                        <button class="execute-btn ${isBuying ? 'buy' : 'sell'}" data-action="execute" ${txPending ? 'disabled' : ''}>
                            ${txPending ? 'Confirming...' : (isBuying ? `Buy $${symbol}` : `Sell $${symbol}`)}
                        </button>
                    `}

                    ${error ? `<div class="error-message">${error}</div>` : ''}
                </div>

                <div class="token-info">
                    <div class="info-row">
                        <span>Price</span>
                        <span class="value">${loading ? '...' : parseFloat(price).toFixed(6)} ETH</span>
                    </div>
                    ${connected ? `
                        <div class="info-row">
                            <span>Your Balance</span>
                            <span class="value">${parseFloat(userBalance).toFixed(4)} ${symbol}</span>
                        </div>
                        <div class="info-row">
                            <span>Your NFTs</span>
                            <span class="value">${userNFTCount}</span>
                        </div>
                        <button class="portfolio-btn" data-action="portfolio">
                            My Portfolio
                        </button>
                    ` : ''}
                </div>

                <div class="creator-info">
                    <h4>Creator</h4>
                    <a href="https://etherscan.io/address/${this.projectData.creator}" target="_blank" rel="noopener">
                        ${this.projectData.creator?.slice(0, 6)}...${this.projectData.creator?.slice(-4)}
                    </a>
                    ${this.projectData.vault ? `
                        <div class="vault-info">
                            <span>Vault:</span>
                            <a href="https://etherscan.io/address/${this.projectData.vault}" target="_blank" rel="noopener">
                                ${this.projectData.vault.slice(0, 6)}...${this.projectData.vault.slice(-4)}
                            </a>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    unmount() {
        if (this._walletHandler) {
            eventBus.off('wallet:connected', this._walletHandler);
            eventBus.off('wallet:changed', this._walletHandler);
        }
        if (this.portfolioModal) {
            this.portfolioModal.close();
            const container = document.getElementById('portfolio-modal-container');
            if (container) container.remove();
        }
        super.unmount();
    }
}
```

**Step 2: Commit**

```bash
git add src/components/ERC404/ERC404TradingSidebar.js
git commit -m "feat: add ERC404TradingSidebar with trading controls and portfolio"
```

---

## Task 8: Create ERC404PortfolioModal Component

**Files:**
- Create: `src/components/ERC404/ERC404PortfolioModal.js`

**Step 1: Create the component**

```javascript
/**
 * ERC404PortfolioModal Component
 * User's portfolio: token balance, NFTs, mint, and reroll controls
 */

import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import { renderIpfsImage } from '../../utils/ipfsImageHelper.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC404PortfolioModal extends Component {
    constructor(adapter, projectData) {
        super();
        this.adapter = adapter;
        this.projectData = projectData;
        this.state = {
            isOpen: false,
            loading: true,
            tokenBalance: '0',
            nfts: [],
            selectedNFT: null,
            txPending: false,
            error: null,
            success: null
        };
    }

    open() {
        this.setState({ isOpen: true, loading: true, error: null, success: null });
        document.body.style.overflow = 'hidden';
        this.loadPortfolio();
    }

    close() {
        this.setState({ isOpen: false, selectedNFT: null });
        document.body.style.overflow = '';
    }

    async loadPortfolio() {
        try {
            const userAddress = walletService.getAddress();
            if (!userAddress) {
                this.setState({ loading: false, error: 'Wallet not connected' });
                return;
            }

            const [balance, nftBalance] = await Promise.all([
                this.adapter.balanceOf(userAddress).catch(() => '0'),
                this.adapter.nftBalanceOf(userAddress).catch(() => 0)
            ]);

            // Load user's NFTs
            const nfts = [];
            const nftCount = parseInt(nftBalance) || 0;

            for (let i = 0; i < nftCount; i++) {
                try {
                    const tokenId = await this.adapter.tokenOfOwnerByIndex(userAddress, i).catch(() => null);
                    if (tokenId) {
                        const metadata = await this.adapter.getTokenMetadata(tokenId).catch(() => null);
                        nfts.push({
                            tokenId: tokenId.toString(),
                            image: metadata?.image || null,
                            name: metadata?.name || `#${tokenId}`,
                            tier: metadata?.attributes?.find(a => a.trait_type === 'Tier')?.value || 'Unknown'
                        });
                    }
                } catch (e) {
                    console.warn('[ERC404PortfolioModal] Error loading NFT:', e);
                }
            }

            this.setState({
                loading: false,
                tokenBalance: balance,
                nfts
            });
        } catch (error) {
            console.error('[ERC404PortfolioModal] Error:', error);
            this.setState({ loading: false, error: error.message });
        }
    }

    async handleMint() {
        try {
            this.setState({ txPending: true, error: null, success: null });
            await this.adapter.mintNFT();
            this.setState({ txPending: false, success: 'NFT minted!' });
            await this.loadPortfolio();
        } catch (error) {
            this.setState({ txPending: false, error: error.message });
        }
    }

    async handleReroll(tokenId) {
        try {
            this.setState({ txPending: true, error: null, success: null });
            await this.adapter.reroll(tokenId);
            this.setState({ txPending: false, success: 'NFT rerolled!' });
            await this.loadPortfolio();
        } catch (error) {
            this.setState({ txPending: false, error: error.message });
        }
    }

    onMount() {
        stylesheetLoader.load('src/components/ERC404/erc404-portfolio.css', 'erc404-portfolio-styles');
        this.setupEventDelegation();
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', async (e) => {
            const target = e.target;

            if (target.closest('[data-action="close"]') || target.classList.contains('portfolio-modal-overlay')) {
                this.close();
            } else if (target.closest('[data-action="mint"]')) {
                await this.handleMint();
            } else if (target.closest('[data-action="reroll"]')) {
                const tokenId = target.closest('[data-action="reroll"]').dataset.tokenId;
                await this.handleReroll(tokenId);
            } else if (target.closest('[data-action="select-nft"]')) {
                const tokenId = target.closest('[data-action="select-nft"]').dataset.tokenId;
                this.setState({ selectedNFT: tokenId });
            }
        });
    }

    render() {
        if (!this.state.isOpen) return '';

        const { loading, tokenBalance, nfts, selectedNFT, txPending, error, success } = this.state;
        const symbol = this.projectData.symbol || 'TOKEN';

        return `
            <div class="portfolio-modal-overlay">
                <div class="portfolio-modal">
                    <div class="modal-header">
                        <h2>My Portfolio</h2>
                        <button class="close-btn" data-action="close">&times;</button>
                    </div>

                    ${loading ? `
                        <div class="loading-state">
                            <div class="spinner"></div>
                            <p>Loading portfolio...</p>
                        </div>
                    ` : `
                        <div class="portfolio-content">
                            <div class="balance-section">
                                <div class="balance-card">
                                    <span class="label">Token Balance</span>
                                    <span class="value">${parseFloat(tokenBalance).toFixed(4)} ${symbol}</span>
                                </div>
                                <button class="mint-btn" data-action="mint" ${txPending ? 'disabled' : ''}>
                                    ${txPending ? 'Processing...' : 'Mint NFT'}
                                </button>
                            </div>

                            <div class="nfts-section">
                                <h3>Your NFTs (${nfts.length})</h3>
                                ${nfts.length === 0 ? `
                                    <p class="empty-message">You don't have any NFTs yet. Mint one from your token balance!</p>
                                ` : `
                                    <div class="nft-grid">
                                        ${nfts.map(nft => `
                                            <div class="nft-card ${selectedNFT === nft.tokenId ? 'selected' : ''}" data-action="select-nft" data-token-id="${nft.tokenId}">
                                                <div class="nft-image">
                                                    ${nft.image ? renderIpfsImage(nft.image, nft.name) : '<div class="placeholder"></div>'}
                                                </div>
                                                <div class="nft-info">
                                                    <div class="nft-name">${nft.name}</div>
                                                    <div class="nft-tier">${nft.tier}</div>
                                                </div>
                                                <button class="reroll-btn" data-action="reroll" data-token-id="${nft.tokenId}" ${txPending ? 'disabled' : ''}>
                                                    Reroll
                                                </button>
                                            </div>
                                        `).join('')}
                                    </div>
                                `}
                            </div>

                            ${error ? `<div class="message error">${error}</div>` : ''}
                            ${success ? `<div class="message success">${success}</div>` : ''}
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    unmount() {
        stylesheetLoader.unload('erc404-portfolio-styles');
        super.unmount();
    }
}
```

**Step 2: Create erc404-portfolio.css**

```css
/* src/components/ERC404/erc404-portfolio.css */

.portfolio-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.portfolio-modal {
    background: var(--surface-color, #1a1a2e);
    border-radius: 16px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.portfolio-modal .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-color, #333);
}

.portfolio-modal .modal-header h2 {
    margin: 0;
    color: var(--text-color, #fff);
}

.portfolio-modal .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 28px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
}

.portfolio-content {
    padding: 24px;
    overflow-y: auto;
}

.balance-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding: 16px;
    background: var(--background-color, #0f0f1a);
    border-radius: 12px;
}

.balance-card .label {
    display: block;
    font-size: 12px;
    color: var(--text-muted, #888);
    margin-bottom: 4px;
}

.balance-card .value {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-color, #fff);
}

.mint-btn {
    padding: 12px 24px;
    background: var(--primary-color, #6366f1);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
}

.mint-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.nfts-section h3 {
    margin: 0 0 16px 0;
    color: var(--text-color, #fff);
}

.nfts-section .nft-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 16px;
}

.nfts-section .nft-card {
    background: var(--background-color, #0f0f1a);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
}

.nfts-section .nft-card:hover {
    transform: translateY(-2px);
}

.nfts-section .nft-card.selected {
    box-shadow: 0 0 0 2px var(--primary-color, #6366f1);
}

.nfts-section .nft-image {
    aspect-ratio: 1;
    background: var(--border-color, #333);
}

.nfts-section .nft-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.nfts-section .nft-info {
    padding: 12px;
}

.nfts-section .nft-name {
    font-weight: 600;
    color: var(--text-color, #fff);
    font-size: 14px;
}

.nfts-section .nft-tier {
    font-size: 12px;
    color: var(--text-muted, #888);
}

.nfts-section .reroll-btn {
    width: 100%;
    padding: 8px;
    background: var(--surface-color, #1a1a2e);
    color: var(--text-color, #fff);
    border: 1px solid var(--border-color, #333);
    cursor: pointer;
    font-size: 12px;
}

.nfts-section .reroll-btn:hover {
    background: var(--border-color, #333);
}

.portfolio-modal .message {
    padding: 12px;
    border-radius: 8px;
    margin-top: 16px;
    text-align: center;
}

.portfolio-modal .message.error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
}

.portfolio-modal .message.success {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
}

.empty-message {
    text-align: center;
    color: var(--text-muted, #888);
    padding: 32px;
}

.loading-state {
    padding: 48px;
    text-align: center;
    color: var(--text-muted, #888);
}
```

**Step 3: Commit**

```bash
git add src/components/ERC404/ERC404PortfolioModal.js src/components/ERC404/erc404-portfolio.css
git commit -m "feat: add ERC404PortfolioModal for user's tokens and NFTs"
```

---

## Task 9: Create ERC404ProjectPage Main Component

**Files:**
- Create: `src/components/ERC404/ERC404ProjectPage.js`
- Create: `src/components/ERC404/erc404-project-page.css`

**Step 1: Create ERC404ProjectPage.js**

```javascript
/**
 * ERC404ProjectPage Component
 * Main two-column layout with trading sidebar and tabbed content
 */

import { Component } from '../../core/Component.js';
import { ProjectHeaderCompact } from './ProjectHeaderCompact.js';
import { ERC404TradingSidebar } from './ERC404TradingSidebar.js';
import { BondingProgressSection } from './BondingProgressSection.js';
import { StakingSection } from './StakingSection.js';
import { NFTGalleryPreview } from './NFTGalleryPreview.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.js';
import { AdminButton } from '../AdminButton/AdminButton.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC404ProjectPage extends Component {
    constructor(projectId, adapter, projectData) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.projectData = projectData;
        this.state = {
            activeTab: 'token',
            loading: false
        };

        // Child components
        this.header = null;
        this.sidebar = null;
        this.bondingSection = null;
        this.stakingSection = null;
        this.galleryPreview = null;
        this.commentFeed = null;
        this.adminButton = null;
    }

    onMount() {
        stylesheetLoader.load('src/components/ERC404/erc404-project-page.css', 'erc404-project-page-styles');
        this.setupEventDelegation();
        this.setTimeout(() => this.mountChildComponents(), 50);
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                const tab = tabBtn.dataset.tab;
                if (tab !== this.state.activeTab) {
                    this.setState({ activeTab: tab });
                    this.setTimeout(() => this.mountTabContent(), 50);
                }
            }
        });
    }

    mountChildComponents() {
        // Header
        const headerContainer = this.element?.querySelector('[data-ref="header"]');
        if (headerContainer && !this.header) {
            this.header = new ProjectHeaderCompact(this.projectData);
            this.header.mount(headerContainer);
        }

        // Sidebar
        const sidebarContainer = this.element?.querySelector('[data-ref="sidebar"]');
        if (sidebarContainer && !this.sidebar) {
            this.sidebar = new ERC404TradingSidebar(this.adapter, this.projectData);
            this.sidebar.mount(sidebarContainer);
        }

        // Admin button
        const adminContainer = this.element?.querySelector('[data-ref="admin-button"]');
        if (adminContainer && !this.adminButton) {
            this.adminButton = new AdminButton(
                this.projectData.address,
                'ERC404',
                this.adapter,
                this.projectData
            );
            this.adminButton.mount(adminContainer);
        }

        // Tab content
        this.mountTabContent();

        // Comments (always present)
        const commentsContainer = this.element?.querySelector('[data-ref="comments"]');
        if (commentsContainer && !this.commentFeed) {
            this.commentFeed = new ProjectCommentFeed(this.projectData.address, this.adapter);
            this.commentFeed.mount(commentsContainer);
        }
    }

    mountTabContent() {
        const { activeTab } = this.state;

        // Unmount inactive tab components
        if (activeTab !== 'token') {
            if (this.bondingSection) {
                this.bondingSection.unmount();
                this.bondingSection = null;
            }
            if (this.stakingSection) {
                this.stakingSection.unmount();
                this.stakingSection = null;
            }
        }
        if (activeTab !== 'nft') {
            if (this.galleryPreview) {
                this.galleryPreview.unmount();
                this.galleryPreview = null;
            }
        }

        // Mount active tab components
        if (activeTab === 'token') {
            const bondingContainer = this.element?.querySelector('[data-ref="bonding"]');
            if (bondingContainer && !this.bondingSection) {
                this.bondingSection = new BondingProgressSection(this.adapter, this.projectId);
                this.bondingSection.mount(bondingContainer);
            }

            const stakingContainer = this.element?.querySelector('[data-ref="staking"]');
            if (stakingContainer && !this.stakingSection) {
                this.stakingSection = new StakingSection(this.adapter);
                this.stakingSection.mount(stakingContainer);
            }
        } else if (activeTab === 'nft') {
            const galleryContainer = this.element?.querySelector('[data-ref="gallery"]');
            if (galleryContainer && !this.galleryPreview) {
                this.galleryPreview = new NFTGalleryPreview(this.adapter, this.projectId);
                this.galleryPreview.mount(galleryContainer);
            }
        }
    }

    render() {
        const { activeTab } = this.state;

        return `
            <div class="erc404-project-page">
                <div class="page-main">
                    <div data-ref="header"></div>
                    <div data-ref="admin-button" class="admin-button-container"></div>

                    <div class="tab-bar">
                        <button class="tab-btn ${activeTab === 'token' ? 'active' : ''}" data-tab="token">Token</button>
                        <button class="tab-btn ${activeTab === 'nft' ? 'active' : ''}" data-tab="nft">NFT</button>
                    </div>

                    <div class="tab-content">
                        ${activeTab === 'token' ? `
                            <div data-ref="bonding"></div>
                            <div data-ref="staking"></div>
                        ` : `
                            <div data-ref="gallery"></div>
                        `}
                    </div>

                    <div class="comments-section">
                        <div data-ref="comments"></div>
                    </div>
                </div>

                <div class="page-sidebar">
                    <div data-ref="sidebar"></div>
                </div>
            </div>
        `;
    }

    unmount() {
        // Unmount all child components
        [this.header, this.sidebar, this.bondingSection, this.stakingSection,
         this.galleryPreview, this.commentFeed, this.adminButton].forEach(component => {
            if (component && typeof component.unmount === 'function') {
                component.unmount();
            }
        });

        stylesheetLoader.unload('erc404-project-page-styles');
        super.unmount();
    }
}
```

**Step 2: Create erc404-project-page.css**

```css
/* src/components/ERC404/erc404-project-page.css */

.erc404-project-page {
    display: flex;
    gap: 24px;
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px;
}

.page-main {
    flex: 1;
    min-width: 0;
}

.page-sidebar {
    width: 360px;
    flex-shrink: 0;
}

/* Header styles */
.project-header-compact {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
}

.header-left {
    display: flex;
    gap: 16px;
    align-items: center;
}

.project-icon {
    width: 64px;
    height: 64px;
    border-radius: 12px;
    overflow: hidden;
    flex-shrink: 0;
}

.project-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.icon-placeholder {
    width: 100%;
    height: 100%;
    background: var(--border-color, #333);
}

.project-name {
    margin: 0;
    font-size: 28px;
    color: var(--text-color, #fff);
}

.project-ticker {
    color: var(--text-muted, #888);
    font-weight: 400;
}

.project-meta {
    display: flex;
    gap: 16px;
    font-size: 14px;
    color: var(--text-muted, #888);
}

.project-meta a {
    color: var(--primary-color, #6366f1);
    text-decoration: none;
}

.header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.action-btn {
    background: var(--surface-color, #1a1a2e);
    border: 1px solid var(--border-color, #333);
    color: var(--text-color, #fff);
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
}

.action-btn:hover {
    background: var(--border-color, #333);
}

.action-btn.favorite-btn.is-favorite {
    color: #fbbf24;
}

.address-btn .address-text {
    font-family: monospace;
    font-size: 13px;
}

/* Admin button container */
.admin-button-container {
    margin-bottom: 16px;
}

/* Tab bar */
.tab-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border-color, #333);
}

.tab-btn {
    padding: 12px 24px;
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    position: relative;
}

.tab-btn.active {
    color: var(--text-color, #fff);
}

.tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--primary-color, #6366f1);
}

/* Tab content */
.tab-content {
    margin-bottom: 32px;
}

/* Comments section */
.comments-section {
    border-top: 1px solid var(--border-color, #333);
    padding-top: 24px;
}

/* Sidebar styles */
.erc404-trading-sidebar {
    background: var(--surface-color, #1a1a2e);
    border-radius: 16px;
    padding: 20px;
    position: sticky;
    top: 24px;
}

.trading-controls {
    margin-bottom: 24px;
}

.buy-sell-toggle {
    display: flex;
    background: var(--background-color, #0f0f1a);
    border-radius: 8px;
    padding: 4px;
    margin-bottom: 16px;
}

.toggle-btn {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-weight: 600;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.2s;
}

.toggle-btn.active {
    background: var(--primary-color, #6366f1);
    color: white;
}

.amount-input-container {
    position: relative;
    margin-bottom: 12px;
}

.amount-input-container input {
    width: 100%;
    padding: 14px;
    padding-right: 60px;
    background: var(--background-color, #0f0f1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    color: var(--text-color, #fff);
    font-size: 16px;
}

.amount-input-container input:focus {
    outline: none;
    border-color: var(--primary-color, #6366f1);
}

.currency-label {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted, #888);
    font-size: 14px;
}

.quick-picks {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
}

.quick-pick-btn {
    flex: 1;
    padding: 8px;
    background: var(--background-color, #0f0f1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 6px;
    color: var(--text-muted, #888);
    font-size: 13px;
    cursor: pointer;
}

.quick-pick-btn:hover {
    border-color: var(--primary-color, #6366f1);
    color: var(--text-color, #fff);
}

.execute-btn {
    width: 100%;
    padding: 14px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
}

.execute-btn.connect {
    background: var(--primary-color, #6366f1);
    color: white;
}

.execute-btn.buy {
    background: #22c55e;
    color: white;
}

.execute-btn.sell {
    background: #ef4444;
    color: white;
}

.execute-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.error-message {
    color: #ef4444;
    font-size: 13px;
    margin-top: 8px;
    text-align: center;
}

.token-info {
    padding: 16px 0;
    border-top: 1px solid var(--border-color, #333);
}

.token-info .info-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 14px;
}

.token-info .info-row span:first-child {
    color: var(--text-muted, #888);
}

.token-info .value {
    color: var(--text-color, #fff);
    font-weight: 500;
}

.portfolio-btn {
    width: 100%;
    padding: 12px;
    margin-top: 12px;
    background: var(--background-color, #0f0f1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    color: var(--text-color, #fff);
    cursor: pointer;
    font-weight: 500;
}

.portfolio-btn:hover {
    background: var(--border-color, #333);
}

.creator-info {
    padding-top: 16px;
    border-top: 1px solid var(--border-color, #333);
    font-size: 14px;
}

.creator-info h4 {
    margin: 0 0 8px 0;
    color: var(--text-muted, #888);
    font-size: 12px;
    text-transform: uppercase;
}

.creator-info a {
    color: var(--primary-color, #6366f1);
    text-decoration: none;
}

.vault-info {
    margin-top: 8px;
    color: var(--text-muted, #888);
}

/* Bonding progress styles */
.bonding-progress-section {
    background: var(--surface-color, #1a1a2e);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 24px;
}

.phase-badge {
    display: inline-block;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
}

.phase-badge.phase-pre-open {
    background: rgba(156, 163, 175, 0.2);
    color: #9ca3af;
}

.phase-badge.phase-bonding {
    background: rgba(250, 204, 21, 0.2);
    color: #facc15;
}

.phase-badge.phase-matured {
    background: rgba(168, 85, 247, 0.2);
    color: #a855f7;
}

.phase-badge.phase-deployed {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
}

.bonding-curve-container {
    margin-bottom: 20px;
    min-height: 200px;
}

.progress-bar-container {
    margin-bottom: 16px;
}

.progress-bar {
    height: 8px;
    background: var(--background-color, #0f0f1a);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--primary-color, #6366f1), #a855f7);
    border-radius: 4px;
    transition: width 0.3s;
}

.progress-label {
    font-size: 14px;
    color: var(--text-muted, #888);
    text-align: right;
}

.bonding-stats {
    display: flex;
    gap: 24px;
}

.bonding-stats .stat {
    text-align: center;
}

.bonding-stats .stat-value {
    display: block;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-color, #fff);
}

.bonding-stats .stat-label {
    font-size: 12px;
    color: var(--text-muted, #888);
}

/* Dextools embed */
.dextools-view .dextools-container {
    aspect-ratio: 16/9;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 12px;
}

.dextools-container iframe {
    width: 100%;
    height: 100%;
}

.dextools-fallback {
    text-align: center;
}

.dextools-fallback a {
    color: var(--primary-color, #6366f1);
}

/* Staking section */
.staking-section {
    background: var(--surface-color, #1a1a2e);
    border-radius: 16px;
    padding: 24px;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.section-header h3 {
    margin: 0;
    color: var(--text-color, #fff);
}

.status-badge {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
}

.status-badge.enabled {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
}

.status-badge.disabled {
    background: rgba(156, 163, 175, 0.2);
    color: #9ca3af;
}

.staking-info .info-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    color: var(--text-muted, #888);
}

.staking-info .value {
    color: var(--text-color, #fff);
    font-weight: 500;
}

.staking-actions {
    display: flex;
    gap: 12px;
    margin: 16px 0;
}

.action-group {
    flex: 1;
    display: flex;
    gap: 8px;
}

.action-group input {
    flex: 1;
    padding: 10px;
    background: var(--background-color, #0f0f1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 6px;
    color: var(--text-color, #fff);
}

.action-group button {
    padding: 10px 16px;
    background: var(--primary-color, #6366f1);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
}

.claim-btn {
    width: 100%;
    padding: 12px;
    background: #22c55e;
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
}

.claim-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.staking-section .message {
    padding: 10px;
    border-radius: 6px;
    margin-top: 12px;
    text-align: center;
    font-size: 14px;
}

.staking-section .message.error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
}

.staking-section .message.success {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
}

/* NFT Gallery Preview */
.nft-gallery-preview {
    background: var(--surface-color, #1a1a2e);
    border-radius: 16px;
    padding: 24px;
}

.nft-gallery-preview .nft-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
}

.nft-gallery-preview .nft-card {
    background: var(--background-color, #0f0f1a);
    border-radius: 10px;
    overflow: hidden;
}

.nft-gallery-preview .nft-image {
    aspect-ratio: 1;
}

.nft-gallery-preview .nft-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.nft-gallery-preview .nft-name {
    padding: 8px;
    font-size: 12px;
    color: var(--text-color, #fff);
    text-align: center;
}

.gallery-link {
    text-align: center;
    padding-top: 16px;
    border-top: 1px solid var(--border-color, #333);
}

.gallery-link a {
    color: var(--primary-color, #6366f1);
    text-decoration: none;
    font-weight: 500;
}

.nft-gallery-preview.empty {
    text-align: center;
    padding: 48px 24px;
    color: var(--text-muted, #888);
}

.nft-gallery-preview .subtext {
    font-size: 13px;
    margin-top: 8px;
}

/* Mobile responsive */
@media (max-width: 900px) {
    .erc404-project-page {
        flex-direction: column-reverse;
    }

    .page-sidebar {
        width: 100%;
    }

    .erc404-trading-sidebar {
        position: static;
    }

    .project-header-compact {
        flex-direction: column;
    }

    .header-actions {
        width: 100%;
        justify-content: flex-start;
    }

    .staking-actions {
        flex-direction: column;
    }
}
```

**Step 3: Commit**

```bash
git add src/components/ERC404/ERC404ProjectPage.js src/components/ERC404/erc404-project-page.css
git commit -m "feat: add ERC404ProjectPage main component with two-column layout"
```

---

## Task 10: Create NFTGalleryPage Route

**Files:**
- Create: `src/routes/NFTGalleryPage.js`

**Step 1: Create the route**

```javascript
/**
 * NFT Gallery Page
 * Full gallery view for ERC404 project NFTs
 */

import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import { renderIpfsImage } from '../utils/ipfsImageHelper.js';

export async function renderNFTGalleryPage(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer) {
        console.error('App container not found');
        return;
    }

    // Clear containers
    if (appTopContainer) appTopContainer.innerHTML = '';
    if (appBottomContainer) appBottomContainer.innerHTML = '';

    const projectId = params?.id;
    if (!projectId) {
        appContainer.innerHTML = '<div class="error-page"><h1>Project ID required</h1></div>';
        return;
    }

    // Load styles
    stylesheetLoader.load('src/routes/nft-gallery.css', 'nft-gallery-styles');

    // Show loading
    appContainer.innerHTML = `
        <div class="nft-gallery-page">
            <div class="gallery-header">
                <a href="/project/${projectId}" class="back-link">← Back to Project</a>
                <h1>NFT Gallery</h1>
            </div>
            <div class="gallery-loading">
                <div class="spinner"></div>
                <p>Loading NFTs...</p>
            </div>
        </div>
    `;

    try {
        // Get adapter
        const projectService = serviceFactory.getProjectService();
        const projectRegistry = serviceFactory.getProjectRegistry();

        const project = await projectRegistry.getProject(projectId);
        if (!project) {
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>Project Not Found</h1>
                    <a href="/">Go Home</a>
                </div>
            `;
            return;
        }

        // Load project to get adapter
        if (!projectService.isProjectLoaded(projectId)) {
            await projectService.loadProject(
                projectId,
                project.contractAddress || project.address || projectId,
                project.contractType
            );
        }

        const adapter = projectService.getAdapter(projectId);
        if (!adapter) {
            throw new Error('Could not load contract adapter');
        }

        // Load all NFTs
        const totalSupply = await adapter.totalNFTSupply().catch(() => 0);
        const nfts = [];

        for (let i = 0; i < parseInt(totalSupply); i++) {
            try {
                const tokenId = await adapter.tokenByIndex(i).catch(() => null);
                if (tokenId) {
                    const metadata = await adapter.getTokenMetadata(tokenId).catch(() => null);
                    nfts.push({
                        tokenId: tokenId.toString(),
                        image: metadata?.image || null,
                        name: metadata?.name || `#${tokenId}`,
                        tier: metadata?.attributes?.find(a => a.trait_type === 'Tier')?.value || null
                    });
                }
            } catch (e) {
                console.warn('[NFTGalleryPage] Error loading NFT:', e);
            }
        }

        // Render gallery
        appContainer.innerHTML = `
            <div class="nft-gallery-page">
                <div class="gallery-header">
                    <a href="/project/${projectId}" class="back-link">← Back to Project</a>
                    <h1>${project.name || 'NFT Gallery'}</h1>
                    <p class="nft-count">${nfts.length} NFTs</p>
                </div>

                ${nfts.length === 0 ? `
                    <div class="gallery-empty">
                        <p>No NFTs have been minted yet.</p>
                    </div>
                ` : `
                    <div class="gallery-grid">
                        ${nfts.map(nft => `
                            <div class="gallery-nft-card">
                                <div class="nft-image">
                                    ${nft.image ? renderIpfsImage(nft.image, nft.name) : '<div class="placeholder"></div>'}
                                </div>
                                <div class="nft-details">
                                    <div class="nft-name">${nft.name}</div>
                                    ${nft.tier ? `<div class="nft-tier">${nft.tier}</div>` : ''}
                                    <div class="nft-id">#${nft.tokenId}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;

    } catch (error) {
        console.error('[NFTGalleryPage] Error:', error);
        appContainer.innerHTML = `
            <div class="nft-gallery-page">
                <div class="gallery-header">
                    <a href="/project/${projectId}" class="back-link">← Back to Project</a>
                </div>
                <div class="gallery-error">
                    <p>Failed to load NFTs: ${error.message}</p>
                </div>
            </div>
        `;
    }

    return {
        cleanup: () => {
            stylesheetLoader.unload('nft-gallery-styles');
        }
    };
}
```

**Step 2: Create nft-gallery.css**

```css
/* src/routes/nft-gallery.css */

.nft-gallery-page {
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px;
}

.gallery-header {
    margin-bottom: 32px;
}

.gallery-header .back-link {
    color: var(--primary-color, #6366f1);
    text-decoration: none;
    font-size: 14px;
    margin-bottom: 8px;
    display: inline-block;
}

.gallery-header h1 {
    margin: 8px 0;
    color: var(--text-color, #fff);
}

.gallery-header .nft-count {
    color: var(--text-muted, #888);
    margin: 0;
}

.gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 20px;
}

.gallery-nft-card {
    background: var(--surface-color, #1a1a2e);
    border-radius: 12px;
    overflow: hidden;
    transition: transform 0.2s;
}

.gallery-nft-card:hover {
    transform: translateY(-4px);
}

.gallery-nft-card .nft-image {
    aspect-ratio: 1;
    background: var(--background-color, #0f0f1a);
}

.gallery-nft-card .nft-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.gallery-nft-card .placeholder {
    width: 100%;
    height: 100%;
    background: var(--border-color, #333);
}

.gallery-nft-card .nft-details {
    padding: 16px;
}

.gallery-nft-card .nft-name {
    font-weight: 600;
    color: var(--text-color, #fff);
    margin-bottom: 4px;
}

.gallery-nft-card .nft-tier {
    font-size: 13px;
    color: var(--primary-color, #6366f1);
    margin-bottom: 4px;
}

.gallery-nft-card .nft-id {
    font-size: 12px;
    color: var(--text-muted, #888);
    font-family: monospace;
}

.gallery-empty,
.gallery-error {
    text-align: center;
    padding: 64px 24px;
    color: var(--text-muted, #888);
}

.gallery-loading {
    text-align: center;
    padding: 64px 24px;
    color: var(--text-muted, #888);
}
```

**Step 3: Commit**

```bash
git add src/routes/NFTGalleryPage.js src/routes/nft-gallery.css
git commit -m "feat: add NFTGalleryPage for full NFT gallery view"
```

---

## Task 11: Update Routing to Use New ERC404ProjectPage

**Files:**
- Modify: `src/components/ProjectDetail/ContractTypeRouter.js`

**Step 1: Import and use ERC404ProjectPage**

In `ContractTypeRouter.js`, add import at top:

```javascript
import { ERC404ProjectPage } from '../ERC404/ERC404ProjectPage.js';
```

**Step 2: Replace ERC404 rendering logic**

Find the ERC404 case in the `render()` method and replace the entire ERC404 section:

```javascript
if (type === 'ERC404' || type === 'ERC404BONDING') {
    if (!this.state.adapter) {
        return `
            <div class="contract-type-router erc404 error marble-bg">
                <p>Failed to load contract adapter</p>
            </div>
        `;
    }

    // Use new ERC404ProjectPage - mount it in onStateUpdate
    return `
        <div class="contract-type-router erc404" data-ref="erc404-page">
            <!-- ERC404ProjectPage will be mounted here -->
        </div>
    `;
}
```

**Step 3: Update setupChildComponents to mount ERC404ProjectPage**

In the `setupChildComponents()` method, add handling for ERC404:

```javascript
setupChildComponents() {
    const type = this.contractType?.toUpperCase();

    if (type === 'ERC404' || type === 'ERC404BONDING') {
        const container = this.element?.querySelector('[data-ref="erc404-page"]');
        if (container && !this._erc404Page) {
            // Build projectData from available info
            const projectData = {
                address: this.state.project?.contractAddress || this.state.project?.address || this.projectId,
                name: this.state.project?.name || 'Unknown',
                symbol: this.state.project?.symbol || 'TOKEN',
                image: this.state.project?.image || this.state.project?.styleUri || null,
                creator: this.state.project?.creator || this.state.project?.owner || null,
                createdAt: this.state.project?.createdAt || null,
                vault: this.state.project?.vault || null
            };

            this._erc404Page = new ERC404ProjectPage(
                this.projectId,
                this.state.adapter,
                projectData
            );
            this._erc404Page.mount(container);
        }
        return;
    }

    // ... existing ERC1155 setup code ...
}
```

**Step 4: Update unmount to cleanup ERC404ProjectPage**

In the `unmount()` method, add:

```javascript
if (this._erc404Page) {
    this._erc404Page.unmount();
    this._erc404Page = null;
}
```

**Step 5: Commit**

```bash
git add src/components/ProjectDetail/ContractTypeRouter.js
git commit -m "feat: integrate ERC404ProjectPage into ContractTypeRouter"
```

---

## Task 12: Add Gallery Route to Router

**Files:**
- Modify: `src/index.js` (or wherever routes are defined)

**Step 1: Add import for NFTGalleryPage**

```javascript
import { renderNFTGalleryPage } from './routes/NFTGalleryPage.js';
```

**Step 2: Add route**

Find where routes are defined and add:

```javascript
{ path: '/project/:id/gallery', handler: renderNFTGalleryPage }
```

**Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: add /project/:id/gallery route for NFT gallery"
```

---

## Task 13: Final Testing and Cleanup

**Step 1: Test ERC404 project page**

1. Navigate to an ERC404 project
2. Verify two-column layout renders
3. Verify Token tab shows bonding progress and staking
4. Verify NFT tab shows gallery preview
5. Verify comments appear on both tabs
6. Test trading controls (buy/sell toggle, quick picks)
7. Test share modal
8. Test copy address
9. Test star/favorite functionality
10. Test portfolio modal

**Step 2: Test gallery page**

1. Navigate to `/project/{id}/gallery`
2. Verify full NFT grid renders
3. Verify back link works

**Step 3: Test mobile responsiveness**

1. Resize browser to mobile width
2. Verify sidebar stacks above content
3. Verify all controls are usable

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete ERC404 project page redesign"
```

---

## Summary

This plan creates a pump.fun-style ERC404 project page with:

- **FavoritesService** - localStorage favorites management
- **ShareModal** - Share preview, copy link, share on X
- **ProjectHeaderCompact** - Project identity and actions
- **BondingProgressSection** - Curve viz + progress + dextools embed
- **StakingSection** - Simplified staking UI
- **NFTGalleryPreview** - Limited NFT grid for tab
- **ERC404TradingSidebar** - Trading controls + token info + portfolio
- **ERC404PortfolioModal** - User's tokens/NFTs with mint/reroll
- **ERC404ProjectPage** - Main two-column layout with tabs
- **NFTGalleryPage** - Full gallery route

Total: 13 tasks with clear file paths and complete code.
