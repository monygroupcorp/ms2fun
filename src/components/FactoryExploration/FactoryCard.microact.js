/**
 * FactoryCard - Microact Version
 *
 * Displays a single factory card with information, links, and CTA.
 */

import { Component, h } from '../../core/microact-setup.js';
import { renderIcon } from '../../core/icons.js';

export class FactoryCard extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            copiedAddress: false
        };
    }

    get factory() {
        return this.props.factory || {};
    }

    async handleCopyAddress() {
        const address = this.factory.address;
        try {
            await navigator.clipboard.writeText(address);
            this.setState({ copiedAddress: true });
            this.setTimeout(() => this.setState({ copiedAddress: false }), 2000);
        } catch (err) {
            console.error('[FactoryCard] Failed to copy address:', err);
        }
    }

    handleCreateClick(e) {
        e.preventDefault();
        const url = this.getCreateURL();
        const { onNavigate } = this.props;
        if (onNavigate) {
            onNavigate(url);
        } else if (window.router) {
            window.router.navigate(url);
        } else {
            window.location.href = url;
        }
    }

    getCreateURL() {
        const factory = this.factory;
        const factoryTitle = factory.title || factory.displayTitle;
        if (factoryTitle) {
            const chainId = 1;
            const titleSlug = factoryTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            return `/${chainId}/${titleSlug}/create`;
        }
        return `/create?factory=${encodeURIComponent(factory.address)}`;
    }

    renderExternalLink(href, iconName, title, available = true) {
        if (available && href) {
            return h('a', {
                href,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'factory-link available',
                title,
                'aria-label': title,
                onClick: (e) => e.stopPropagation(),
                innerHTML: renderIcon(iconName, `icon-${iconName}`)
            });
        }
        return h('span', {
            className: 'factory-link',
            title: `${title} not available`,
            innerHTML: renderIcon(iconName, `icon-${iconName}`)
        });
    }

    render() {
        const factory = this.factory;
        const address = factory.address || '';
        const name = factory.name || 'Unknown Factory';
        const description = factory.description || '';
        const type = factory.type || 'Unknown';
        const instanceCount = factory.instanceCount || 0;
        const icon = factory.icon || '✦';
        const color = factory.color || '#6b7280';
        const audited = factory.audited || false;

        const etherscanUrl = factory.etherscanUrl || `https://etherscan.io/address/${address}`;
        const githubUrl = factory.githubUrl;
        const websiteUrl = factory.websiteUrl;
        const twitterUrl = factory.twitterUrl;

        return h('div', {
            className: 'factory-card marble-bg marble-stretch-sheer',
            style: `--factory-color: ${color}`
        },
            // Top section
            h('div', { className: 'factory-card-top' },
                h('div', { className: 'factory-header' },
                    h('span', { className: 'factory-icon' }, icon),
                    h('div', { className: 'factory-title-group' },
                        h('h3', { className: 'factory-name' }, name),
                        h('span', { className: `factory-type-badge ${type.toLowerCase()}` }, type)
                    )
                ),
                h('div', {
                    className: `factory-audit-badge ${audited ? '' : 'factory-audit-warning'}`
                }, audited ? '✓ Audited' : '⚠ Not Audited')
            ),

            // Scrollable middle section
            h('div', { className: 'factory-card-scrollable' },
                h('p', { className: 'factory-description' }, description),

                h('div', { className: 'factory-stats' },
                    h('span', { className: 'stat' },
                        h('strong', null, instanceCount),
                        ` project${instanceCount !== 1 ? 's' : ''} created`
                    )
                ),

                factory.features?.length > 0 && h('div', { className: 'factory-features' },
                    h('h4', null, 'Key Features:'),
                    h('ul', { className: 'features-list' },
                        ...factory.features.map((feature, i) =>
                            h('li', { key: i }, feature)
                        )
                    )
                ),

                factory.useCases?.length > 0 && h('div', { className: 'factory-use-cases' },
                    h('h4', null, 'Use Cases:'),
                    h('ul', { className: 'use-cases-list' },
                        ...factory.useCases.map((useCase, i) =>
                            h('li', { key: i }, useCase)
                        )
                    )
                ),

                factory.allegiance && h('div', { className: 'factory-allegiance' },
                    h('h4', null, 'Factory Allegiance:'),
                    h('div', { className: 'allegiance-info' },
                        h('span', { className: 'allegiance-icon' }, factory.allegiance.icon),
                        h('div', { className: 'allegiance-details' },
                            h('div', { className: 'allegiance-benefactor' }, factory.allegiance.benefactor),
                            h('div', { className: 'allegiance-description' }, factory.allegiance.description)
                        )
                    )
                )
            ),

            // Bottom section
            h('div', { className: 'factory-card-bottom' },
                h('div', { className: 'factory-address' },
                    h('span', { className: 'address-label' }, 'Factory Address:'),
                    h('code', { className: 'address-value' }, address),
                    h('button', {
                        className: 'copy-address-button',
                        title: 'Copy address',
                        'aria-label': 'Copy address',
                        onClick: this.bind(this.handleCopyAddress),
                        innerHTML: this.state.copiedAddress
                            ? renderIcon('check', 'icon-check')
                            : renderIcon('copy', 'icon-copy')
                    })
                ),

                h('div', { className: 'factory-links' },
                    this.renderExternalLink(etherscanUrl, 'etherscan', 'View on Etherscan'),
                    this.renderExternalLink(githubUrl, 'github', 'View on GitHub', !!githubUrl),
                    this.renderExternalLink(websiteUrl, 'website', 'Visit Website', !!websiteUrl),
                    this.renderExternalLink(twitterUrl, 'twitter', 'View on Twitter', !!twitterUrl)
                ),

                h('a', {
                    href: this.getCreateURL(),
                    className: 'create-project-button',
                    onClick: this.bind(this.handleCreateClick)
                }, `Establish ${type} Project`)
            )
        );
    }
}

export default FactoryCard;
