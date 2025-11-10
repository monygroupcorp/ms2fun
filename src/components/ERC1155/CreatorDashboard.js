/**
 * CreatorDashboard Component
 * 
 * Dashboard for creators to view their editions, earnings, and stats.
 */

import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';

export class CreatorDashboard extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.state = {
            editions: [],
            earnings: {},
            loading: true
        };
    }

    async onMount() {
        await this.loadDashboardData();
    }

    async loadDashboardData() {
        try {
            this.setState({ loading: true });
            const editions = await this.adapter.getEditions();
            const address = walletService.getAddress();

            const earnings = {};
            for (const edition of editions) {
                if (edition.creator?.toLowerCase() === address?.toLowerCase()) {
                    try {
                        earnings[edition.id] = await this.adapter.getCreatorBalance(edition.id);
                    } catch (error) {
                        console.warn(`Failed to get earnings for edition ${edition.id}:`, error);
                        earnings[edition.id] = '0';
                    }
                }
            }

            this.setState({ editions, earnings, loading: false });
        } catch (error) {
            console.error('[CreatorDashboard] Failed to load dashboard data:', error);
            this.setState({ loading: false });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="creator-dashboard loading">
                    <div class="loading-spinner"></div>
                    <p>Loading dashboard...</p>
                </div>
            `;
        }

        const address = walletService.getAddress();
        const creatorEditions = this.state.editions.filter(e => 
            e.creator?.toLowerCase() === address?.toLowerCase()
        );

        if (creatorEditions.length === 0) {
            return `
                <div class="creator-dashboard empty">
                    <h2>Creator Dashboard</h2>
                    <p>You haven't created any editions yet.</p>
                </div>
            `;
        }

        return `
            <div class="creator-dashboard">
                <h2>Creator Dashboard</h2>
                <div class="dashboard-stats">
                    <div class="stat-card">
                        <span class="stat-label">Your Editions</span>
                        <span class="stat-value">${creatorEditions.length}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Total Earnings</span>
                        <span class="stat-value">${this.calculateTotalEarnings()} ETH</span>
                    </div>
                </div>
                <div class="creator-editions">
                    <h3>Your Editions</h3>
                    <div class="editions-list">
                        ${creatorEditions.map(edition => this.renderCreatorEdition(edition)).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    renderCreatorEdition(edition) {
        const earnings = this.state.earnings[edition.id] || '0';
        const earningsEth = this.formatEther(earnings);
        const name = edition.metadata?.name || `Edition #${edition.id}`;
        const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;

        return `
            <div class="creator-edition-card">
                <h4>${this.escapeHtml(name)}</h4>
                <div class="edition-details">
                    <p><strong>Supply:</strong> ${supply}</p>
                    <p><strong>Earnings:</strong> ${earningsEth} ETH</p>
                    <p><strong>Price:</strong> ${this.formatPrice(edition.price)} ETH</p>
                </div>
            </div>
        `;
    }

    calculateTotalEarnings() {
        try {
            const total = Object.values(this.state.earnings).reduce((sum, earnings) => {
                return sum + BigInt(earnings || '0');
            }, BigInt(0));
            return this.formatEther(total.toString());
        } catch (error) {
            return '0.0000';
        }
    }

    formatEther(wei) {
        try {
            if (typeof window !== 'undefined' && window.ethers) {
                return parseFloat(window.ethers.utils.formatEther(wei)).toFixed(4);
            }
            // Fallback
            const eth = parseFloat(wei) / 1e18;
            return eth.toFixed(4);
        } catch (error) {
            return '0.0000';
        }
    }

    formatPrice(priceWei) {
        return this.formatEther(priceWei);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

