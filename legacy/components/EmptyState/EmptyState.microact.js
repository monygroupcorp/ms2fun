/**
 * EmptyState - Placeholder when no projects/data available
 *
 * Shows a welcoming message with info about the platform
 * and calls to action for getting started.
 */

import { Component, h } from '../../core/microact-setup.js';

export class EmptyState extends Component {
    constructor(props = {}) {
        super(props);
        // props.variant: 'projects' | 'vaults' | 'activity' | 'general'
        // props.onAction: callback for CTA button
    }

    getContent() {
        const variant = this.props.variant || 'general';

        const content = {
            projects: {
                icon: '🏛️',
                title: 'No Projects Yet',
                description: 'Be the first to launch a project on MS2. Create ERC404 tokens with automatic NFT minting, or deploy ERC1155 editions.',
                cta: 'Create Project',
                ctaPath: '/create'
            },
            vaults: {
                icon: '🏦',
                title: 'No Vaults Active',
                description: 'Vaults collect fees from project trading. Once projects launch and trading begins, top vaults will appear here.',
                cta: 'Explore Projects',
                ctaPath: '/'
            },
            activity: {
                icon: '📊',
                title: 'No Recent Activity',
                description: 'Trading activity, mints, and transfers will appear here once projects go live.',
                cta: 'View Projects',
                ctaPath: '/'
            },
            general: {
                icon: '🚀',
                title: 'Welcome to MS2',
                description: 'A fully decentralized launchpad for Web3 projects. Browse, discover, and interact with multiple projects from a single interface.',
                cta: 'Get Started',
                ctaPath: '/'
            }
        };

        return content[variant] || content.general;
    }

    handleCTA() {
        const content = this.getContent();
        if (this.props.onAction) {
            this.props.onAction(content.ctaPath);
        } else if (window.router) {
            window.router.navigate(content.ctaPath);
        } else {
            window.location.href = content.ctaPath;
        }
    }

    render() {
        const content = this.getContent();
        const showCTA = this.props.showCTA !== false;

        return h('div', { class: 'empty-state-placeholder' },
            h('div', { class: 'empty-state-icon' }, content.icon),
            h('h3', { class: 'empty-state-title' }, content.title),
            h('p', { class: 'empty-state-description' }, content.description),
            showCTA ? h('button', {
                class: 'empty-state-cta',
                onclick: () => this.handleCTA()
            }, content.cta) : null,
            // Additional info section
            h('div', { class: 'empty-state-features' },
                h('div', { class: 'feature-item' },
                    h('span', { class: 'feature-icon' }, '⚡'),
                    h('span', { class: 'feature-text' }, 'Instant Trading')
                ),
                h('div', { class: 'feature-item' },
                    h('span', { class: 'feature-icon' }, '🎨'),
                    h('span', { class: 'feature-text' }, 'NFT Integration')
                ),
                h('div', { class: 'feature-item' },
                    h('span', { class: 'feature-icon' }, '🔒'),
                    h('span', { class: 'feature-text' }, 'Fully On-Chain')
                )
            )
        );
    }
}
