/**
 * StorageSettings - Microact Version
 *
 * Manages local project index storage settings.
 * - View storage statistics
 * - Change index mode (full/minimal/off)
 * - Clear or re-sync index
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { projectIndex, INDEX_MODE } from '../../services/ProjectIndex.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class StorageSettings extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            stats: null,
            indexMode: INDEX_MODE.FULL,
            loading: true,
            syncing: false,
            syncProgress: null,
            error: null
        };
    }

    async didMount() {
        await this.loadStats();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const unsub1 = eventBus.on('index:sync:start', () => {
            this.setState({ syncing: true, syncProgress: null });
        });

        const unsub2 = eventBus.on('index:sync:progress', (progress) => {
            this.setState({ syncProgress: progress });
        });

        const unsub3 = eventBus.on('index:sync:complete', () => {
            this.setState({ syncing: false, syncProgress: null });
            this.loadStats();
        });

        const unsub4 = eventBus.on('index:sync:error', (error) => {
            this.setState({
                syncing: false,
                syncProgress: null,
                error: error.message || 'Sync failed'
            });
        });

        const unsub5 = eventBus.on('index:cleared', () => {
            this.loadStats();
        });

        const unsub6 = eventBus.on('index:mode:changed', (mode) => {
            this.setState({ indexMode: mode });
            this.loadStats();
        });

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
            unsub5();
            unsub6();
        });
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

            const masterService = serviceFactory.getMasterService();
            const registry = await masterService.getContract();
            const provider = await masterService.getProvider();

            if (!registry || !provider) {
                throw new Error('Registry or provider not available');
            }

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

    handleDismissError() {
        this.setState({ error: null });
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
            return h('div', { className: 'storage-settings' },
                h('div', { className: 'loading-state' },
                    h('div', { className: 'spinner' }),
                    h('p', null, 'Loading storage settings...')
                )
            );
        }

        const sizeDisplay = stats?.estimatedSize !== null
            ? this.formatBytes(stats.estimatedSize)
            : 'Unknown';

        const quotaDisplay = stats?.quota !== null
            ? this.formatBytes(stats.quota)
            : 'Unknown';

        return h('div', { className: 'storage-settings' },
            h('div', { className: 'settings-header' },
                h('h3', null, 'Local Data Settings'),
                h('p', { className: 'settings-description' },
                    'Project data is indexed locally for fast search and filtering. This data is stored in your browser and can be cleared at any time.'
                )
            ),

            error && h('div', { className: 'error-banner' },
                h('span', { className: 'error-icon' }, '!'),
                h('span', { className: 'error-text' }, error),
                h('button', {
                    className: 'dismiss-btn',
                    onClick: this.bind(this.handleDismissError)
                }, 'Dismiss')
            ),

            !stats?.isSupported && h('div', { className: 'warning-banner' },
                h('span', { className: 'warning-icon' }, '!'),
                h('span', { className: 'warning-text' },
                    'IndexedDB is not supported in this browser. Search and filtering will be slower.'
                )
            ),

            h('div', { className: 'stats-section' },
                h('h4', null, 'Storage Statistics'),
                h('div', { className: 'stats-grid' },
                    h('div', { className: 'stat-item' },
                        h('span', { className: 'stat-label' }, 'Projects Indexed'),
                        h('span', { className: 'stat-value' }, (stats?.projectCount || 0).toLocaleString())
                    ),
                    h('div', { className: 'stat-item' },
                        h('span', { className: 'stat-label' }, 'Storage Used'),
                        h('span', { className: 'stat-value' }, sizeDisplay)
                    ),
                    h('div', { className: 'stat-item' },
                        h('span', { className: 'stat-label' }, 'Last Synced Block'),
                        h('span', { className: 'stat-value' }, (stats?.lastIndexedBlock || 0).toLocaleString())
                    ),
                    h('div', { className: 'stat-item' },
                        h('span', { className: 'stat-label' }, 'Storage Quota'),
                        h('span', { className: 'stat-value' }, quotaDisplay)
                    )
                )
            ),

            h('div', { className: 'mode-section' },
                h('h4', null, 'Index Mode'),
                h('div', { className: 'mode-options' },
                    h('label', { className: `mode-option ${indexMode === INDEX_MODE.FULL ? 'selected' : ''}` },
                        h('input', {
                            type: 'radio',
                            name: 'indexMode',
                            value: INDEX_MODE.FULL,
                            checked: indexMode === INDEX_MODE.FULL,
                            onChange: () => this.handleModeChange(INDEX_MODE.FULL)
                        }),
                        h('div', { className: 'mode-content' },
                            h('span', { className: 'mode-title' }, 'Full'),
                            h('span', { className: 'mode-description' }, 'Index all projects for fastest search (uses more storage)')
                        )
                    ),
                    h('label', { className: `mode-option ${indexMode === INDEX_MODE.MINIMAL ? 'selected' : ''}` },
                        h('input', {
                            type: 'radio',
                            name: 'indexMode',
                            value: INDEX_MODE.MINIMAL,
                            checked: indexMode === INDEX_MODE.MINIMAL,
                            onChange: () => this.handleModeChange(INDEX_MODE.MINIMAL)
                        }),
                        h('div', { className: 'mode-content' },
                            h('span', { className: 'mode-title' }, 'Minimal'),
                            h('span', { className: 'mode-description' }, 'Only index projects you interact with')
                        )
                    ),
                    h('label', { className: `mode-option ${indexMode === INDEX_MODE.OFF ? 'selected' : ''}` },
                        h('input', {
                            type: 'radio',
                            name: 'indexMode',
                            value: INDEX_MODE.OFF,
                            checked: indexMode === INDEX_MODE.OFF,
                            onChange: () => this.handleModeChange(INDEX_MODE.OFF)
                        }),
                        h('div', { className: 'mode-content' },
                            h('span', { className: 'mode-title' }, 'Off'),
                            h('span', { className: 'mode-description' }, 'No local storage (slower search, always fetches from chain)')
                        )
                    )
                )
            ),

            syncing && h('div', { className: 'sync-progress' },
                h('div', { className: 'spinner' }),
                h('span', { className: 'sync-text' },
                    syncProgress
                        ? `Syncing... ${syncProgress.added} / ${syncProgress.total} projects`
                        : 'Syncing...'
                )
            ),

            h('div', { className: 'actions-section' },
                h('button', {
                    className: 'action-btn secondary',
                    disabled: syncing || indexMode === INDEX_MODE.OFF,
                    onClick: this.bind(this.handleClearIndex)
                }, 'Clear Index'),
                h('button', {
                    className: 'action-btn primary',
                    disabled: syncing || indexMode === INDEX_MODE.OFF,
                    onClick: this.bind(this.handleResync)
                }, 'Re-sync Now')
            ),

            h('div', { className: 'info-section' },
                h('p', { className: 'info-text' },
                    'This data is stored locally in your browser using IndexedDB. Clearing it will require re-syncing from the blockchain on next visit. No personal data is stored - only public project information.'
                )
            )
        );
    }
}

export default StorageSettings;
