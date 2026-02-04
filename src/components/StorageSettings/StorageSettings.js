import { Component } from '../../core/Component.js';
import { projectIndex, INDEX_MODE } from '../../services/ProjectIndex.js';
import { eventBus } from '../../core/EventBus.js';
import serviceFactory from '../../services/ServiceFactory.js';

/**
 * StorageSettings component
 * Allows users to manage local project index storage
 * - View storage statistics
 * - Change index mode (full/minimal/off)
 * - Clear or re-sync index
 */
export class StorageSettings extends Component {
    constructor() {
        super();
        this.state = {
            stats: null,
            indexMode: INDEX_MODE.FULL,
            loading: true,
            syncing: false,
            syncProgress: null,
            error: null
        };
    }

    async onMount() {
        await this.loadStats();
        this._setupEventListeners();
    }

    _setupEventListeners() {
        // Listen for sync events
        this.subscribe('index:sync:start', () => {
            this.setState({ syncing: true, syncProgress: null });
        });

        this.subscribe('index:sync:progress', (progress) => {
            this.setState({ syncProgress: progress });
        });

        this.subscribe('index:sync:complete', (result) => {
            this.setState({ syncing: false, syncProgress: null });
            this.loadStats();
        });

        this.subscribe('index:sync:error', (error) => {
            this.setState({
                syncing: false,
                syncProgress: null,
                error: error.message || 'Sync failed'
            });
        });

        this.subscribe('index:cleared', () => {
            this.loadStats();
        });

        this.subscribe('index:mode:changed', (mode) => {
            this.setState({ indexMode: mode });
            this.loadStats();
        });
    }

    /**
     * Subscribe to eventBus with automatic cleanup
     */
    subscribe(event, handler) {
        eventBus.on(event, handler);
        this._subscriptions.add({ event, handler });
    }

    async loadStats() {
        try {
            this.setState({ loading: true, error: null });

            const stats = await projectIndex.getStorageStats();

            this.setState({
                stats,
                indexMode: stats.indexMode,
                loading: false
            });
        } catch (error) {
            console.error('[StorageSettings] Error loading stats:', error);
            this.setState({
                loading: false,
                error: 'Failed to load storage stats'
            });
        }
    }

    async handleModeChange(mode) {
        try {
            await projectIndex.setIndexMode(mode);
            this.setState({ indexMode: mode });
        } catch (error) {
            console.error('[StorageSettings] Error changing mode:', error);
            this.setState({ error: 'Failed to change index mode' });
        }
    }

    async handleClearIndex() {
        if (!confirm('Clear local project index? You will need to re-sync on next search.')) {
            return;
        }

        try {
            await projectIndex.clearIndex();
            await this.loadStats();
        } catch (error) {
            console.error('[StorageSettings] Error clearing index:', error);
            this.setState({ error: 'Failed to clear index' });
        }
    }

    async handleResync() {
        try {
            this.setState({ syncing: true, error: null });

            // Get MasterRegistry contract and provider
            const masterService = serviceFactory.getMasterService();

            // For now, we'll need the raw contract and provider
            // This will be wired up properly when deployment is ready
            const registry = await masterService.getContract();
            const provider = await masterService.getProvider();

            if (!registry || !provider) {
                throw new Error('Registry or provider not available');
            }

            // Clear and re-sync
            await projectIndex.clearIndex();
            await projectIndex.sync(registry, provider);

            await this.loadStats();
        } catch (error) {
            console.error('[StorageSettings] Error re-syncing:', error);
            this.setState({
                syncing: false,
                error: error.message || 'Failed to re-sync index'
            });
        }
    }

    formatBytes(bytes) {
        if (bytes === null || bytes === undefined) return 'Unknown';
        if (bytes === 0) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    render() {
        const { stats, indexMode, loading, syncing, syncProgress, error } = this.state;

        if (loading) {
            return `
                <div class="storage-settings">
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>Loading storage settings...</p>
                    </div>
                </div>
            `;
        }

        const sizeDisplay = stats?.estimatedSize !== null
            ? this.formatBytes(stats.estimatedSize)
            : 'Unknown';

        const quotaDisplay = stats?.quota !== null
            ? this.formatBytes(stats.quota)
            : 'Unknown';

        return `
            <div class="storage-settings">
                <div class="settings-header">
                    <h3>Local Data Settings</h3>
                    <p class="settings-description">
                        Project data is indexed locally for fast search and filtering.
                        This data is stored in your browser and can be cleared at any time.
                    </p>
                </div>

                ${error ? `
                    <div class="error-banner">
                        <span class="error-icon">!</span>
                        <span class="error-text">${this.escapeHtml(error)}</span>
                        <button class="dismiss-btn" data-ref="dismiss-error">Dismiss</button>
                    </div>
                ` : ''}

                ${!stats?.isSupported ? `
                    <div class="warning-banner">
                        <span class="warning-icon">!</span>
                        <span class="warning-text">
                            IndexedDB is not supported in this browser.
                            Search and filtering will be slower.
                        </span>
                    </div>
                ` : ''}

                <div class="stats-section">
                    <h4>Storage Statistics</h4>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">Projects Indexed</span>
                            <span class="stat-value">${(stats?.projectCount || 0).toLocaleString()}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Storage Used</span>
                            <span class="stat-value">${sizeDisplay}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Last Synced Block</span>
                            <span class="stat-value">${(stats?.lastIndexedBlock || 0).toLocaleString()}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Storage Quota</span>
                            <span class="stat-value">${quotaDisplay}</span>
                        </div>
                    </div>
                </div>

                <div class="mode-section">
                    <h4>Index Mode</h4>
                    <div class="mode-options">
                        <label class="mode-option ${indexMode === INDEX_MODE.FULL ? 'selected' : ''}">
                            <input type="radio" name="indexMode" value="${INDEX_MODE.FULL}"
                                ${indexMode === INDEX_MODE.FULL ? 'checked' : ''}
                                data-ref="mode-full">
                            <div class="mode-content">
                                <span class="mode-title">Full</span>
                                <span class="mode-description">Index all projects for fastest search (uses more storage)</span>
                            </div>
                        </label>
                        <label class="mode-option ${indexMode === INDEX_MODE.MINIMAL ? 'selected' : ''}">
                            <input type="radio" name="indexMode" value="${INDEX_MODE.MINIMAL}"
                                ${indexMode === INDEX_MODE.MINIMAL ? 'checked' : ''}
                                data-ref="mode-minimal">
                            <div class="mode-content">
                                <span class="mode-title">Minimal</span>
                                <span class="mode-description">Only index projects you interact with</span>
                            </div>
                        </label>
                        <label class="mode-option ${indexMode === INDEX_MODE.OFF ? 'selected' : ''}">
                            <input type="radio" name="indexMode" value="${INDEX_MODE.OFF}"
                                ${indexMode === INDEX_MODE.OFF ? 'checked' : ''}
                                data-ref="mode-off">
                            <div class="mode-content">
                                <span class="mode-title">Off</span>
                                <span class="mode-description">No local storage (slower search, always fetches from chain)</span>
                            </div>
                        </label>
                    </div>
                </div>

                ${syncing ? `
                    <div class="sync-progress">
                        <div class="spinner"></div>
                        <span class="sync-text">
                            ${syncProgress
                                ? `Syncing... ${syncProgress.added} / ${syncProgress.total} projects`
                                : 'Syncing...'}
                        </span>
                    </div>
                ` : ''}

                <div class="actions-section">
                    <button class="action-btn secondary" data-ref="clear-btn"
                        ${syncing || indexMode === INDEX_MODE.OFF ? 'disabled' : ''}>
                        Clear Index
                    </button>
                    <button class="action-btn primary" data-ref="resync-btn"
                        ${syncing || indexMode === INDEX_MODE.OFF ? 'disabled' : ''}>
                        Re-sync Now
                    </button>
                </div>

                <div class="info-section">
                    <p class="info-text">
                        This data is stored locally in your browser using IndexedDB.
                        Clearing it will require re-syncing from the blockchain on next visit.
                        No personal data is stored - only public project information.
                    </p>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Mode radio buttons
        const modeRadios = this.element.querySelectorAll('input[name="indexMode"]');
        modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.handleModeChange(e.target.value);
            });
        });

        // Clear button
        const clearBtn = this.element.querySelector('[data-ref="clear-btn"]');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.handleClearIndex());
        }

        // Re-sync button
        const resyncBtn = this.element.querySelector('[data-ref="resync-btn"]');
        if (resyncBtn) {
            resyncBtn.addEventListener('click', () => this.handleResync());
        }

        // Dismiss error button
        const dismissBtn = this.element.querySelector('[data-ref="dismiss-error"]');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                this.setState({ error: null });
            });
        }
    }

    onStateUpdate(oldState, newState) {
        // Re-setup DOM listeners when state changes affect the DOM structure
        if (oldState.loading !== newState.loading ||
            oldState.syncing !== newState.syncing ||
            oldState.error !== newState.error) {
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

export default StorageSettings;
