/**
 * HomePageDataProvider - Microact Version
 *
 * Fetches all home page data in a single batched call via QueryService.
 * Emits data via eventBus for child components to subscribe.
 *
 * Events emitted:
 * - homepage:data - Full data payload
 * - homepage:loading - Loading state change
 * - homepage:error - Error occurred
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';

export class HomePageDataProvider extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            error: null,
            lastFetchTime: null
        };
    }

    async didMount() {
        this.setupEventListeners();
        await this.fetchData();
    }

    setupEventListeners() {
        const unsub1 = eventBus.on('transaction:confirmed', () => {
            this.fetchData();
        });

        const unsub2 = eventBus.on('wallet:connected', () => {
            this.fetchData();
        });

        this.registerCleanup(() => {
            unsub1();
            unsub2();
        });
    }

    async fetchData() {
        try {
            this.setState({ loading: true, error: null });
            eventBus.emit('homepage:loading', true);

            console.log('[HomePageDataProvider] Fetching home page data...');
            const startTime = performance.now();

            let projects = [];
            let totalFeatured = 0;
            let topVaults = [];
            let recentActivity = [];

            // Check if we should even try to fetch blockchain data
            const { default: serviceFactory } = await import('../../services/ServiceFactory.js');
            await serviceFactory.ensureInitialized();

            if (!serviceFactory.isUsingMock()) {
                // Only try QueryService if we have real blockchain access
                try {
                    const queryService = (await import('../../services/QueryService.js')).default;
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout')), 5000)
                    );
                    const data = await Promise.race([
                        queryService.getHomePageData(0, 20),
                        timeoutPromise
                    ]);
                    projects = data.projects || [];
                    totalFeatured = data.totalFeatured || 0;
                    topVaults = data.topVaults || [];
                    recentActivity = data.recentActivity || [];
                } catch (err) {
                    console.log('[HomePageDataProvider] Failed to fetch blockchain data:', err.message);
                }
            } else {
                console.log('[HomePageDataProvider] No blockchain - CultExecs will show as default');
            }

            const fetchTime = performance.now() - startTime;
            console.log(`[HomePageDataProvider] Data fetched in ${fetchTime.toFixed(0)}ms`);
            console.log(`[HomePageDataProvider] Projects: ${projects.length} (${totalFeatured} featured), Vaults: ${topVaults.length}, Messages: ${recentActivity.length}`);

            this.setState({
                loading: false,
                lastFetchTime: Date.now()
            });

            // Emit data for subscribers
            eventBus.emit('homepage:data', {
                projects,
                topVaults,
                recentActivity,
                totalFeatured
            });

            eventBus.emit('homepage:loading', false);

        } catch (error) {
            console.error('[HomePageDataProvider] Error fetching data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load home page data'
            });
            eventBus.emit('homepage:error', error.message);
            eventBus.emit('homepage:loading', false);
        }
    }

    render() {
        return h('div', { class: 'home-page-data-provider', style: 'display: none;' });
    }
}

export default HomePageDataProvider;
