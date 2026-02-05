/**
 * ProjectCard - Microact Version
 *
 * Displays a single project card with stats, badges, and links.
 * Migrated from template literals to h() hyperscript.
 */

import { Component, h } from '../../core/microact-setup.js';
import { FACTORY_METADATA } from '../../utils/factoryMetadata.js';
import { generateProjectURL } from '../../utils/navigation.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { loadMockData } from '../../services/mock/mockData.js';
import { renderIcon } from '../../core/icons.js';

export class ProjectCard extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            hovered: false
        };
    }

    get project() {
        return this.props.project || {};
    }

    isMockProject() {
        if (!serviceFactory.isUsingMock()) return false;

        const address = this.project.address || '';

        if (address.startsWith('0xMOCK') ||
            address.includes('mock') ||
            address.startsWith('0xFACTORY')) {
            return true;
        }

        try {
            const mockData = loadMockData();
            if (mockData?.instances?.[address]) return true;
        } catch (error) {
            // Ignore
        }

        return false;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async handleViewProject() {
        const { onNavigate } = this.props;
        if (!onNavigate) return;

        const name = this.project.name;

        if (name === 'CULT EXECUTIVES' || name === 'CULT EXEC') {
            onNavigate('/cultexecs');
            return;
        }

        const projectName = name || this.project.displayName;
        if (!projectName) {
            console.error('[ProjectCard] Missing project name for address:', this.project.address);
            return;
        }

        try {
            const { detectNetwork } = await import('../../config/network.js');
            const network = detectNetwork();
            const chainId = network.chainId || 1;

            const projectURL = generateProjectURL(
                null,
                { name: projectName, address: this.project.address },
                null,
                chainId
            );

            if (projectURL) {
                onNavigate(projectURL);
            }
        } catch (error) {
            console.error('[ProjectCard] Error generating URL:', error);
        }
    }

    handleCardClick(e) {
        if (!e.target.closest('.view-project-button') && !e.target.closest('.card-link-icon')) {
            this.handleViewProject();
        }
    }

    render() {
        const project = this.project;
        const isFeatured = project.name === 'CULT EXECUTIVES' || project.name === 'CULT EXEC';
        const isMock = this.isMockProject();
        const contractType = project.contractType || 'Unknown';
        const volume = project.stats?.volume || '0 ETH';
        const holders = project.stats?.holders || 0;
        const supply = project.stats?.totalSupply || 0;
        const audited = project.audited || false;
        const creatorTwitter = project.creatorTwitter || null;
        const etherscanUrl = project.etherscanUrl || null;
        const githubUrl = project.githubUrl || null;
        const twitterUrl = project.twitterUrl || null;
        const address = project.address || '';

        const factoryMetadata = FACTORY_METADATA[contractType];
        const allegiance = factoryMetadata?.allegiance || null;
        const etherscanLink = etherscanUrl || (address ? `https://etherscan.io/address/${address}` : null);

        const projectImage = project.imageURI || project.image || null;
        const cardImage = isFeatured ? 'public/execs/695.jpeg' : projectImage;
        const hasImage = !!cardImage;

        const cardClassName = [
            'project-card',
            'marble-bg',
            'marble-stretch-sheer',
            isFeatured ? 'featured' : ''
        ].filter(Boolean).join(' ');

        return h('div', {
            className: cardClassName,
            'data-project-id': address,
            onClick: this.bind(this.handleCardClick)
        },
            // Top bar
            h('div', {
                className: `card-top-bar ${hasImage ? 'has-background-image' : ''}`,
                style: cardImage ? `background-image: url('${cardImage}'); background-size: cover; background-position: center;` : ''
            },
                h('div', { className: 'card-top-left' },
                    audited && h('div', { className: 'audit-badge-top', innerHTML: `${renderIcon('audited', 'icon-audited')} Audited` })
                ),
                h('div', { className: 'card-top-right' },
                    etherscanLink && this.renderExternalLink(etherscanLink, 'etherscan', 'View on Etherscan'),
                    githubUrl && this.renderExternalLink(githubUrl, 'github', 'View on GitHub'),
                    twitterUrl && this.renderExternalLink(twitterUrl, 'twitter', 'View on Twitter'),
                    creatorTwitter && this.renderExternalLink(
                        `https://twitter.com/${creatorTwitter.replace('@', '')}`,
                        'creator',
                        'Creator Twitter'
                    )
                )
            ),

            // Badges
            isFeatured && h('div', { className: 'featured-badge' }, 'FEATURED'),
            isMock && h('div', { className: 'mock-badge' }, 'For Demonstration Only'),

            // Header
            h('div', { className: 'card-header' },
                h('h3', { className: 'card-title' }, project.name),
                h('span', { className: `contract-type-badge ${contractType.toLowerCase()}` }, contractType)
            ),

            // Scrollable content
            h('div', { className: 'card-scrollable-content' },
                h('p', { className: 'card-description' }, project.description || 'No description available'),

                // Meta (allegiance)
                this.renderMeta(isFeatured, allegiance),

                // Stats
                h('div', { className: 'card-stats' },
                    h('div', { className: 'stat' },
                        h('span', { className: 'stat-label' }, 'Volume:'),
                        h('span', { className: 'stat-value' }, volume)
                    ),
                    h('div', { className: 'stat' },
                        h('span', { className: 'stat-label' }, 'Holders:'),
                        h('span', { className: 'stat-value' }, holders)
                    ),
                    supply > 0 && h('div', { className: 'stat' },
                        h('span', { className: 'stat-label' }, 'Supply:'),
                        h('span', { className: 'stat-value' }, supply)
                    )
                )
            ),

            // View button
            h('button', {
                className: 'view-project-button',
                onClick: this.bind(this.handleViewProject)
            }, isFeatured ? 'View CULT EXECUTIVES →' : 'View Project →')
        );
    }

    renderExternalLink(href, iconName, title) {
        return h('a', {
            href,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'card-link-icon',
            title,
            'aria-label': title,
            onClick: (e) => e.stopPropagation(),
            innerHTML: renderIcon(iconName, `icon-${iconName}`)
        });
    }

    renderMeta(isFeatured, allegiance) {
        if (isFeatured) {
            return h('div', { className: 'card-meta' },
                h('div', { className: 'meta-item allegiance' },
                    h('img', { src: 'public/remilia.gif', alt: 'Remilia', className: 'meta-icon-image' }),
                    h('span', { className: 'meta-text' }, 'Ultra-Aligned Dual Nature NFT')
                )
            );
        }

        if (allegiance) {
            return h('div', { className: 'card-meta' },
                h('div', { className: 'meta-item allegiance' },
                    h('span', { className: 'meta-icon' }, allegiance.icon),
                    h('span', { className: 'meta-text', title: allegiance.description }, allegiance.benefactor)
                )
            );
        }

        return null;
    }
}

export default ProjectCard;
