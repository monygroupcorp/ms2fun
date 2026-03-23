/**
 * Documentation - Microact Version (v2 Gallery Brutalism)
 *
 * Tab-based documentation page with sidebar navigation.
 * Shows one section at a time; clicking nav links switches sections.
 * Source of truth: docs/examples/documentation-demo.html
 */

import { Component, h } from '../../core/microact-setup.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class Documentation extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            activeSection: 'overview'
        };
    }

    async didMount() {
        await stylesheetLoader.load('/src/core/route-documentation-v2.css', 'route:documentation');

        // Handle direct links to sections via URL hash
        const hash = window.location.hash.substring(1);
        if (hash) {
            this.showSection(hash);
        }

        this.setupNavClicks();
        this.setupArticleCardClicks();
    }

    setupNavClicks() {
        const nav = this._element?.querySelector('.docs-sidebar');
        if (!nav) return;

        const handler = (e) => {
            const link = e.target.closest('.docs-nav-link');
            if (!link) return;
            e.preventDefault();
            e.stopPropagation();

            const href = link.getAttribute('data-section');
            if (href) {
                this.showSection(href);
            }
        };

        nav.addEventListener('click', handler, true);
        this.registerCleanup(() => nav.removeEventListener('click', handler, true));
    }

    setupArticleCardClicks() {
        const main = this._element?.querySelector('.docs-main');
        if (!main) return;

        const handler = (e) => {
            const card = e.target.closest('.article-card[data-section]');
            if (!card) return;
            e.preventDefault();

            const section = card.getAttribute('data-section');
            if (section) {
                this.showSection(section);
            }
        };

        main.addEventListener('click', handler);
        this.registerCleanup(() => main.removeEventListener('click', handler));
    }

    showSection(sectionId) {
        if (!this._element) return;

        // Update sections via DOM (avoid re-render)
        const sections = this._element.querySelectorAll('.docs-section');
        sections.forEach(s => {
            if (s.id === sectionId) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });

        // Update nav links via DOM
        const navLinks = this._element.querySelectorAll('.docs-nav-link');
        navLinks.forEach(link => {
            if (link.getAttribute('data-section') === sectionId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Scroll to top of content
        const main = this._element?.querySelector('.docs-main');
        if (main) main.scrollTop = 0;
        window.scrollTo(0, 0);
    }

    // Prevent re-render — all state changes handled via DOM
    shouldUpdate() {
        return false;
    }

    renderNavLink(sectionId, label, isActive) {
        return h('a', {
            href: `#${sectionId}`,
            className: `docs-nav-link${isActive ? ' active' : ''}`,
            'data-section': sectionId
        }, label);
    }

    render() {
        return h('div', { className: 'content' },
            // Page Header
            h('div', { className: 'page-header' },
                h('h1', { className: 'page-title' }, 'Documentation'),
                h('p', { className: 'page-description' },
                    'Comprehensive guides and references for collectors, creators, developers, and DAO members. Learn how to use MS2.FUN, understand the alignment vault system, integrate with our contracts, and participate in governance.'
                )
            ),

            // Docs Layout
            h('div', { className: 'docs-layout' },
                // Sidebar Navigation
                h('nav', { className: 'docs-sidebar' },
                    h('div', { className: 'docs-nav-section' },
                        h('div', { className: 'docs-nav-title' }, 'Getting Started'),
                        h('div', { className: 'docs-nav-list' },
                            this.renderNavLink('overview', 'Overview', true),
                            this.renderNavLink('for-collectors', 'For Collectors', false),
                            this.renderNavLink('for-creators', 'For Creators', false)
                        )
                    ),
                    h('div', { className: 'docs-nav-section' },
                        h('div', { className: 'docs-nav-title' }, 'Core Concepts'),
                        h('div', { className: 'docs-nav-list' },
                            this.renderNavLink('alignment-vaults', 'Alignment Vaults', false),
                            this.renderNavLink('project-types', 'Project Types', false),
                            this.renderNavLink('revenue-model', 'Revenue Model', false)
                        )
                    ),
                    h('div', { className: 'docs-nav-section' },
                        h('div', { className: 'docs-nav-title' }, 'For Developers'),
                        h('div', { className: 'docs-nav-list' },
                            this.renderNavLink('contract-architecture', 'Contract Architecture', false),
                            this.renderNavLink('integration-guide', 'Integration Guide', false),
                            this.renderNavLink('api-reference', 'API Reference', false)
                        )
                    ),
                    h('div', { className: 'docs-nav-section' },
                        h('div', { className: 'docs-nav-title' }, 'Governance'),
                        h('div', { className: 'docs-nav-list' },
                            this.renderNavLink('dao-overview', 'DAO Overview', false),
                            this.renderNavLink('becoming-member', 'Becoming a Member', false),
                            this.renderNavLink('proposals', 'Proposals', false),
                            this.renderNavLink('treasury', 'Treasury', false)
                        )
                    ),
                    h('div', { className: 'docs-nav-section' },
                        h('div', { className: 'docs-nav-title' }, 'Advanced'),
                        h('div', { className: 'docs-nav-list' },
                            this.renderNavLink('security', 'Security', false),
                            this.renderNavLink('faq', 'FAQ', false)
                        )
                    )
                ),

                // Main Content
                h('main', { className: 'docs-main' },

                    // ============ Overview Section ============
                    h('section', { className: 'docs-section active', id: 'overview' },
                        h('h2', { className: 'section-title' }, 'Overview'),
                        h('p', { className: 'section-intro' },
                            'MS2.FUN is a curated launchpad for derivative art and tokens aligned to established crypto communities. Artists create projects bound to alignment vaults that automatically buy and provide liquidity for the target community\'s token.'
                        ),

                        h('div', { className: 'article-grid' },
                            h('div', { className: 'article-card', 'data-section': 'for-collectors' },
                                h('div', { className: 'article-title' }, 'For Collectors'),
                                h('p', { className: 'article-description' },
                                    'Mint tokens, collect NFTs, and participate in aligned community projects.'
                                )
                            ),
                            h('div', { className: 'article-card', 'data-section': 'for-creators' },
                                h('div', { className: 'article-title' }, 'For Creators'),
                                h('p', { className: 'article-description' },
                                    'Launch ERC404, ERC1155, or ERC721 projects with built-in alignment mechanisms.'
                                )
                            ),
                            h('div', { className: 'article-card', 'data-section': 'contract-architecture' },
                                h('div', { className: 'article-title' }, 'For Developers'),
                                h('p', { className: 'article-description' },
                                    'Integrate with our contracts, query on-chain data, and build on MS2.FUN.'
                                )
                            ),
                            h('div', { className: 'article-card', 'data-section': 'dao-overview' },
                                h('div', { className: 'article-title' }, 'For DAO Members'),
                                h('p', { className: 'article-description' },
                                    'Participate in governance, vote on proposals, and manage the treasury.'
                                )
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'What is MS2.FUN?'),
                            h('p', null,
                                'MS2.FUN combines a curated art launchpad with a novel alignment mechanism. Every project created on the platform is bound to an alignment vault that uses project revenue to buy and provide liquidity for an established community\'s token.'
                            ),
                            h('p', null,
                                'This creates a symbiotic relationship: artists gain access to established communities and distribution channels, while those communities benefit from increased liquidity and fresh derivative work that expands their cultural footprint.'
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Key Features'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'Alignment Vaults:'), ' Automated mechanisms that buy and LP target community tokens'),
                                h('li', null, h('strong', null, 'Multiple Token Standards:'), ' Support for ERC404, ERC1155, and ERC721'),
                                h('li', null, h('strong', null, 'Bonding Curves:'), ' Fair launch mechanics for ERC404 projects'),
                                h('li', null, h('strong', null, 'DAO Governance:'), ' Community-driven curation and parameter management'),
                                h('li', null, h('strong', null, 'Revenue Sharing:'), ' Transparent fee distribution to vaults and protocol')
                            )
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Quick Start'),
                            h('p', null,
                                h('strong', null, 'Collectors:'), ' Browse the discovery page, connect your wallet, and start minting.'
                            ),
                            h('p', null,
                                h('strong', null, 'Creators:'), ' Review the project types guide, then submit a creation application.'
                            ),
                            h('p', null,
                                h('strong', null, 'Developers:'), ' Check the contract architecture and integration guide.'
                            ),
                            h('p', null,
                                h('strong', null, 'DAO Members:'), ' Read the governance overview and proposal process.'
                            )
                        )
                    ),

                    // ============ For Collectors Section ============
                    h('section', { className: 'docs-section', id: 'for-collectors' },
                        h('h2', { className: 'section-title' }, 'For Collectors'),
                        h('p', { className: 'section-intro' },
                            'Learn how to discover projects, mint tokens and NFTs, stake for rewards, and participate in aligned communities.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Discovering Projects'),
                            h('p', null,
                                'The discovery page shows all active projects across different token standards. Use filters to find projects aligned to specific communities or sort by activity, volume, or creation date.'
                            ),
                            h('p', null,
                                'Featured projects appear at the top and rotate based on rental auctions managed by the DAO.'
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Minting Tokens'),
                            h('p', null, 'Each project type has a different minting mechanism:'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'ERC404 (Bonding):'), ' Buy tokens on a bonding curve. When you hold 1 full token unit (e.g., 1M tokens), you automatically receive an NFT. Sell tokens to burn your NFT and recover funds.'),
                                h('li', null, h('strong', null, 'ERC1155 (Editions):'), ' Fixed-price mints for semi-fungible editions. Each edition has a limited supply and can be collected independently.'),
                                h('li', null, h('strong', null, 'ERC721 (Auctions):'), ' Participate in timed auctions to win unique 1/1 NFTs.')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Staking for Vault Rewards'),
                            h('p', null,
                                'If a project has staking enabled, you can stake your tokens to earn a share of vault LP yield. Staking works on a share-based system where earlier stakers receive proportionally more shares per token.'
                            ),
                            h('p', null,
                                'Vault fees accumulate from post-graduation Uniswap V4 hook taxes (for ERC404) or artist withdrawal tithes (for ERC1155). The protocol takes a 5% cut, and the remaining 95% is distributed to stakers and benefactors.'
                            )
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Gas Optimization Tips'),
                            h('p', null,
                                'Batch transactions when possible. For ERC1155, minting multiple editions in one transaction saves gas.'
                            ),
                            h('p', null,
                                'Monitor gas prices and consider using services like Flashbots Protect for high-demand mints.'
                            )
                        )
                    ),

                    // ============ For Creators Section ============
                    h('section', { className: 'docs-section', id: 'for-creators' },
                        h('h2', { className: 'section-title' }, 'For Creators'),
                        h('p', { className: 'section-intro' },
                            'Comprehensive guide to launching projects on MS2.FUN, from concept to deployment.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Choosing a Project Type'),
                            h('p', null, 'Select the token standard that best fits your creative vision:')
                        ),

                        h('div', { className: 'article-grid' },
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'ERC404 Bonding'),
                                h('p', { className: 'article-description' },
                                    'Hybrid tokens + NFTs. Fair launch via bonding curve. Automatic NFT minting at threshold. Best for community-driven projects with tradeable NFTs.'
                                )
                            ),
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'ERC1155 Editions'),
                                h('p', { className: 'article-description' },
                                    'Multiple editions with limited supplies. Fixed-price mints. 20% tithe on withdrawals. Best for serialized artwork or thematic collections.'
                                )
                            ),
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'ERC721 Auctions'),
                                h('p', { className: 'article-description' },
                                    'Unique 1/1 NFTs. Timed auction mechanism. Best for high-value individual pieces with collector competition.'
                                )
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Creating a Project'),
                            h('p', null, 'The creation flow guides you through these steps:'),
                            h('ol', null,
                                h('li', null, h('strong', null, 'Choose Factory:'), ' Select ERC404, ERC1155, or ERC721'),
                                h('li', null, h('strong', null, 'Select Vault:'), ' Choose an existing vault aligned to your target community'),
                                h('li', null, h('strong', null, 'Configure Parameters:'), ' Set supply, pricing, bonding curve parameters, etc.'),
                                h('li', null, h('strong', null, 'Upload Metadata:'), ' Provide artwork and metadata (IPFS recommended)'),
                                h('li', null, h('strong', null, 'Deploy Contract:'), ' Execute deployment transaction'),
                                h('li', null, h('strong', null, 'Configure Advanced Settings:'), ' Set V4 hook (ERC404), enable staking, manage tiers')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Revenue and Fees'),
                            h('p', null, 'Fee structures vary by project type:'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'ERC404:'), ' 1% bonding fee to treasury, 2% graduation fee split between protocol and factory creator. Post-graduation V4 hook tax goes to vault.'),
                                h('li', null, h('strong', null, 'ERC1155:'), ' 20% tithe on creator withdrawals goes to vault. Creators receive 80% of mint revenue.'),
                                h('li', null, h('strong', null, 'ERC721:'), ' Auction settlement fee split between protocol and vault.')
                            )
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Creator Best Practices'),
                            h('p', null,
                                'Choose a vault that genuinely aligns with your work. Authentic alignment drives better community engagement.'
                            ),
                            h('p', null,
                                'For ERC404, set bonding maturity time strategically. Too short and you miss price discovery; too long and you lose momentum.'
                            ),
                            h('p', null,
                                'Engage with your collectors. Active creators see higher secondary volume and stronger community retention.'
                            )
                        )
                    ),

                    // ============ Alignment Vaults Section ============
                    h('section', { className: 'docs-section', id: 'alignment-vaults' },
                        h('h2', { className: 'section-title' }, 'Alignment Vaults'),
                        h('p', { className: 'section-intro' },
                            'Vaults are the core alignment mechanism. They automatically use project revenue to buy and provide liquidity for target community tokens.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'How Vaults Work'),
                            h('p', null,
                                'When a project generates revenue (from bonding fees, edition sales, or auction settlements), a portion flows to its designated vault. The vault uses these funds to:'
                            ),
                            h('ol', null,
                                h('li', null, 'Buy the target community\'s token on the open market'),
                                h('li', null, 'Add the tokens to a Uniswap V4 liquidity position'),
                                h('li', null, 'Generate LP fees from trading activity'),
                                h('li', null, 'Distribute LP yield back to project benefactors and stakers')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Vault Lifecycle'),
                            h('p', null, 'Vaults are created through DAO governance. The process:'),
                            h('ol', null,
                                h('li', null, h('strong', null, 'Target Approval:'), ' DAO approves a new alignment target (e.g., "Milady" or "Pudgy Penguins")'),
                                h('li', null, h('strong', null, 'Vault Factory Selection:'), ' DAO chooses a vault strategy (currently UltraAlignmentVault)'),
                                h('li', null, h('strong', null, 'Vault Deployment:'), ' Vault is deployed and bound to the approved target'),
                                h('li', null, h('strong', null, 'Project Binding:'), ' Creators select this vault when launching projects')
                            ),
                            h('p', null, 'Each target can only have one active vault to prevent fragmentation.')
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Benefactor System'),
                            h('p', null,
                                'Projects that contribute fees to a vault are called "benefactors." Each benefactor earns a proportional share of the vault\'s LP yield based on their total fee contributions.'
                            ),
                            h('p', null,
                                'The protocol takes a 5% cut of all vault yield, with a sub-cut going to factory creators. The remaining 95% is distributed to benefactors and stakers.'
                            )
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Vault TVL and APY'),
                            h('p', null,
                                'Browse active vaults on the vault explorer page to see total value locked (TVL), estimated APY, number of aligned projects, and total benefactors.'
                            ),
                            h('p', null,
                                'Higher TVL generally means more stable liquidity but potentially lower percentage yields. Newer vaults may offer higher APY with more volatility.'
                            )
                        )
                    ),

                    // ============ Project Types Section ============
                    h('section', { className: 'docs-section', id: 'project-types' },
                        h('h2', { className: 'section-title' }, 'Project Types'),
                        h('p', { className: 'section-intro' },
                            'Deep dive into each token standard and project type supported on MS2.FUN.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'ERC404 (Bonding Curve Projects)'),
                            h('p', null,
                                'ERC404 uses the DN404 standard to create hybrid tokens that automatically mint NFTs when you hold a full unit (typically 1M tokens = 1 NFT).'
                            ),
                            h('p', null, 'Projects launch on a bonding curve with several phases:'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'Pre-open:'), ' Configuration period before minting begins'),
                                h('li', null, h('strong', null, 'Bonding:'), ' Active bonding curve, price increases with supply'),
                                h('li', null, h('strong', null, 'Full:'), ' Max bonding supply reached, awaiting maturity'),
                                h('li', null, h('strong', null, 'Matured:'), ' Bonding period complete, ready for liquidity deployment'),
                                h('li', null, h('strong', null, 'Deployed:'), ' Liquidity deployed to Uniswap V4 with custom hook')
                            ),
                            h('p', null,
                                'After graduation to Uniswap V4, a custom hook taxes all swaps and routes fees to the alignment vault.'
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Staking and Rerolls'),
                            h('p', null,
                                'ERC404 projects can enable staking, allowing token holders to stake for a share of vault fees. Staking uses a share-based system with early-staker advantage.'
                            ),
                            h('p', null,
                                'NFTs can be "rerolled" by sending them to an escrow contract and minting a new one. This allows collectors to refresh metadata or randomize traits without selling tokens.'
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'ERC1155 (Edition Projects)'),
                            h('p', null, 'ERC1155 projects consist of multiple editions, each with:'),
                            h('ul', null,
                                h('li', null, 'Unique artwork and metadata'),
                                h('li', null, 'Fixed mint price (can be updated by creator)'),
                                h('li', null, 'Maximum supply (can be increased by creator)'),
                                h('li', null, 'Independent minting status (can be paused per edition)')
                            ),
                            h('p', null,
                                'Mint revenue accumulates in the contract. Creators can withdraw at any time, but 20% is automatically sent to the alignment vault.'
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'ERC721 (Auction Projects)'),
                            h('p', null, 'ERC721 projects use a timed auction mechanism for 1/1 NFTs. Features include:'),
                            h('ul', null,
                                h('li', null, 'Reserve price set by creator'),
                                h('li', null, 'Auction duration and extension logic'),
                                h('li', null, 'Anti-snipe mechanisms (time extensions on late bids)'),
                                h('li', null, 'Settlement fee distributed between protocol and vault')
                            )
                        )
                    ),

                    // ============ Revenue Model Section ============
                    h('section', { className: 'docs-section', id: 'revenue-model' },
                        h('h2', { className: 'section-title' }, 'Revenue Model'),
                        h('p', { className: 'section-intro' },
                            'Transparent breakdown of fees, distribution, and economic flows across the platform.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Fee Structure by Project Type')
                        ),

                        h('table', { className: 'docs-table' },
                            h('thead', null,
                                h('tr', null,
                                    h('th', null, 'Project Type'),
                                    h('th', null, 'Fee Event'),
                                    h('th', null, 'Rate'),
                                    h('th', null, 'Destination')
                                )
                            ),
                            h('tbody', null,
                                h('tr', null,
                                    h('td', null, 'ERC404'),
                                    h('td', null, 'Bonding Fee'),
                                    h('td', null, '1%'),
                                    h('td', null, 'Protocol Treasury')
                                ),
                                h('tr', null,
                                    h('td', null, 'ERC404'),
                                    h('td', null, 'Graduation Fee'),
                                    h('td', null, '2%'),
                                    h('td', null, 'Protocol + Factory Creator')
                                ),
                                h('tr', null,
                                    h('td', null, 'ERC404'),
                                    h('td', null, 'V4 Swap Tax'),
                                    h('td', null, 'Variable'),
                                    h('td', null, 'Alignment Vault')
                                ),
                                h('tr', null,
                                    h('td', null, 'ERC1155'),
                                    h('td', null, 'Withdrawal Tithe'),
                                    h('td', null, '20%'),
                                    h('td', null, 'Alignment Vault')
                                ),
                                h('tr', null,
                                    h('td', null, 'ERC721'),
                                    h('td', null, 'Settlement Fee'),
                                    h('td', null, 'Variable'),
                                    h('td', null, 'Protocol + Vault')
                                )
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Vault LP Yield Distribution'),
                            h('p', null, 'When vaults generate LP fees from Uniswap V4 positions:'),
                            h('ul', null,
                                h('li', null, h('strong', null, '5% Protocol Cut:'), ' Goes to protocol treasury, with a sub-allocation to factory creators'),
                                h('li', null, h('strong', null, '95% to Benefactors/Stakers:'), ' Distributed proportionally based on fee contributions and stake shares')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Creator Economics'),
                            h('p', null, 'Creators retain the majority of project revenue but contribute to vault alignment:'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'ERC404:'), ' Creators don\'t extract revenue directly. Value comes from token/NFT ownership and trading.'),
                                h('li', null, h('strong', null, 'ERC1155:'), ' Creators receive 80% of mint revenue. 20% tithe goes to vault.'),
                                h('li', null, h('strong', null, 'ERC721:'), ' Creators receive auction proceeds minus settlement fees.')
                            )
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Fee Transparency'),
                            h('p', null,
                                'All fees are enforced at the contract level and fully auditable on-chain. The DAO can adjust certain parameters through governance proposals.'
                            )
                        )
                    ),

                    // ============ Contract Architecture Section ============
                    h('section', { className: 'docs-section', id: 'contract-architecture' },
                        h('h2', { className: 'section-title' }, 'Contract Architecture'),
                        h('p', { className: 'section-intro' },
                            'Technical overview of the smart contract system, deployment addresses, and architecture patterns.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'System Overview'),
                            h('p', null, 'The MS2.FUN contract system follows a registry-factory-instance pattern:'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'MasterRegistryV1 (UUPS):'), ' Central registry managing targets, vaults, factories, and instances'),
                                h('li', null, h('strong', null, 'Factories:'), ' Template contracts that deploy new project instances'),
                                h('li', null, h('strong', null, 'Instances:'), ' Individual project contracts created by factories'),
                                h('li', null, h('strong', null, 'Vaults:'), ' Alignment vault contracts that manage LP positions'),
                                h('li', null, h('strong', null, 'DAO (GrandCentral + Safe):'), ' Governance layer controlling registry upgrades and parameters')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Core Contracts')
                        ),

                        h('table', { className: 'docs-table' },
                            h('thead', null,
                                h('tr', null,
                                    h('th', null, 'Contract'),
                                    h('th', null, 'Address'),
                                    h('th', null, 'Purpose')
                                )
                            ),
                            h('tbody', null,
                                h('tr', null,
                                    h('td', null, 'MasterRegistryV1'),
                                    h('td', null, '0x1234...5678'),
                                    h('td', null, 'Central registry and access control')
                                ),
                                h('tr', null,
                                    h('td', null, 'ERC404Factory'),
                                    h('td', null, '0x2345...6789'),
                                    h('td', null, 'Deploys ERC404 bonding instances')
                                ),
                                h('tr', null,
                                    h('td', null, 'ERC1155Factory'),
                                    h('td', null, '0x3456...789a'),
                                    h('td', null, 'Deploys ERC1155 edition instances')
                                ),
                                h('tr', null,
                                    h('td', null, 'ERC721AuctionFactory'),
                                    h('td', null, '0x4567...89ab'),
                                    h('td', null, 'Deploys ERC721 auction instances')
                                ),
                                h('tr', null,
                                    h('td', null, 'ProtocolTreasuryV1'),
                                    h('td', null, '0x5678...9abc'),
                                    h('td', null, 'Holds protocol fees')
                                ),
                                h('tr', null,
                                    h('td', null, 'GrandCentral (DAO)'),
                                    h('td', null, '0x6789...abcd'),
                                    h('td', null, 'Governance contract')
                                )
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Upgradeability'),
                            h('p', null,
                                'MasterRegistryV1 uses the UUPS (Universal Upgradeable Proxy Standard) pattern. Only the DAO can authorize upgrades.'
                            ),
                            h('p', null,
                                'Factories and instances are non-upgradeable for security. New factories can be registered via DAO proposals.'
                            )
                        ),

                        h('div', { className: 'code-block' },
                            '// Query alignment targets\nMasterRegistry.getApprovedTargets() \u2192 AlignmentTarget[]\n\n// Query vaults for a target\nMasterRegistry.getVaultForTarget(targetId) \u2192 address\n\n// Query factory instances\nFactory.getInstancesByCreator(creator) \u2192 address[]\n\n// Check if vault is approved\nMasterRegistry.isVaultApproved(vaultAddress) \u2192 bool'
                        )
                    ),

                    // ============ Integration Guide Section ============
                    h('section', { className: 'docs-section', id: 'integration-guide' },
                        h('h2', { className: 'section-title' }, 'Integration Guide'),
                        h('p', { className: 'section-intro' },
                            'Step-by-step guide for developers building on top of MS2.FUN contracts.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Reading Project Data'),
                            h('p', null, 'To display project information in your application:')
                        ),

                        h('div', { className: 'code-block' },
                            '// Connect to factory\nconst factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);\n\n// Get all instances\nconst instances = await factory.getAllInstances();\n\n// For each instance, query details\nconst instance = new ethers.Contract(instanceAddress, INSTANCE_ABI, provider);\nconst name = await instance.name();\nconst vault = await instance.vault();\nconst bondingStatus = await instance.getBondingStatus();'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Minting Tokens'),
                            h('p', null, 'Example of minting from an ERC404 bonding instance:')
                        ),

                        h('div', { className: 'code-block' },
                            '// Calculate amount out for ETH in\nconst amountOut = await instance.getBuyQuote(ethers.parseEther("0.1"));\n\n// Execute buy with slippage protection\nconst tx = await instance.buy(\n  minAmountOut,  // Minimum tokens expected\n  [], // Tier proofs (if applicable)\n  { value: ethers.parseEther("0.1") }\n);\n\nawait tx.wait();'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Querying Vault Data')
                        ),

                        h('div', { className: 'code-block' },
                            'const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);\n\n// Get vault stats\nconst tvl = await vault.getTotalValueLocked();\nconst benefactors = await vault.getBenefactorCount();\n\n// Get LP position details\nconst position = await vault.getLPPosition();\n\n// Query benefactor share\nconst benefactorInfo = await vault.getBenefactor(projectAddress);'
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Best Practices'),
                            h('p', null,
                                'Always query current state before executing transactions. Bonding curves and vaults are dynamic.'
                            ),
                            h('p', null,
                                'Use multicall patterns to batch reads and reduce RPC calls.'
                            ),
                            h('p', null,
                                'Cache static data (names, symbols, vault addresses) but refresh dynamic data (prices, supplies, TVL) frequently.'
                            )
                        )
                    ),

                    // ============ API Reference Section ============
                    h('section', { className: 'docs-section', id: 'api-reference' },
                        h('h2', { className: 'section-title' }, 'API Reference'),
                        h('p', { className: 'section-intro' },
                            'Complete reference for contract interfaces and query methods.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'MasterRegistryV1')
                        ),

                        h('div', { className: 'code-block' },
                            '// Alignment Targets\ngetApprovedTargets() \u2192 AlignmentTarget[]\ngetTarget(uint256 targetId) \u2192 AlignmentTarget\nisTargetApproved(uint256 targetId) \u2192 bool\n\n// Vaults\ngetVaultForTarget(uint256 targetId) \u2192 address\nisVaultApproved(address vault) \u2192 bool\ngetVaultRegistry() \u2192 address\n\n// Factories\ngetApprovedFactories(FactoryType factoryType) \u2192 address[]\nisFactoryApproved(address factory) \u2192 bool\n\n// Instances\nisInstanceValid(address instance) \u2192 bool\ngetInstanceVault(address instance) \u2192 address'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'ERC404BondingInstance')
                        ),

                        h('div', { className: 'code-block' },
                            '// Bonding Status\ngetBondingStatus() \u2192 BondingStatus\n  - isConfigured: bool\n  - isActive: bool\n  - isEnded: bool\n  - currentSupply: uint256\n  - maxBondingSupply: uint256\n  - currentReserve: uint256\n\n// Trading\nbuy(uint256 minAmountOut, bytes32[] proofs) payable\nsell(uint256 tokenAmount, uint256 minEthOut)\ngetBuyQuote(uint256 ethIn) \u2192 uint256 tokensOut\ngetSellQuote(uint256 tokensIn) \u2192 uint256 ethOut\n\n// Staking\nenableStaking() // Owner only\nstake(uint256 amount)\nunstake(uint256 shares)\nclaimYield()\n\n// Configuration\nsetV4Hook(address hook) // Owner only, one-time\nsetVault(address vault) // Owner only, one-time\nsetBondingOpenTime(uint256 timestamp) // Owner only\nsetBondingActive(bool active) // Owner only'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'ERC1155Instance')
                        ),

                        h('div', { className: 'code-block' },
                            '// Edition Management\ncreateEdition(uint256 price, uint256 maxSupply, string uri) // Owner only\nupdateEditionPrice(uint256 editionId, uint256 newPrice) // Owner only\nupdateEditionSupply(uint256 editionId, uint256 newMax) // Owner only\npauseEdition(uint256 editionId) // Owner only\nresumeEdition(uint256 editionId) // Owner only\n\n// Minting\nmint(uint256 editionId, uint256 quantity) payable\nmintBatch(uint256[] editionIds, uint256[] quantities) payable\n\n// Creator Revenue\ngetCreatorBalance() \u2192 uint256\nwithdraw() // Sends 80% to creator, 20% to vault'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'UltraAlignmentVault')
                        ),

                        h('div', { className: 'code-block' },
                            '// Vault Info\ngetTarget() \u2192 AlignmentTarget\ngetTotalValueLocked() \u2192 uint256\ngetBenefactorCount() \u2192 uint256\n\n// Benefactor Queries\ngetBenefactor(address instance) \u2192 Benefactor\n  - totalFeesContributed: uint256\n  - shareOfYield: uint256\n  - yieldClaimed: uint256\n\n// LP Position\ngetLPPosition() \u2192 LPPosition\n  - poolAddress: address\n  - liquidity: uint128\n  - feesAccrued: uint256\n\n// Fee Distribution\ndistributeYield() // Anyone can call\nclaimYield(address benefactor)'
                        )
                    ),

                    // ============ DAO Overview Section ============
                    h('section', { className: 'docs-section', id: 'dao-overview' },
                        h('h2', { className: 'section-title' }, 'DAO Overview'),
                        h('p', { className: 'section-intro' },
                            'The MS2.FUN DAO governs the protocol using a Moloch-inspired structure with Gnosis Safe execution.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Governance Structure'),
                            h('p', null, 'The DAO uses GrandCentral, a Moloch-pattern governance contract with:'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'Shares:'), ' Voting power in governance proposals'),
                                h('li', null, h('strong', null, 'Loot:'), ' Economic rights to treasury without voting power'),
                                h('li', null, h('strong', null, 'Proposals:'), ' Submitted by members, voted on by shareholders'),
                                h('li', null, h('strong', null, 'Safe Execution:'), ' Approved proposals execute via Gnosis Safe multisig')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Conductor System'),
                            h('p', null, 'The DAO can delegate specific permissions to conductors:'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'Admin Conductor:'), ' Can register factories and vaults'),
                                h('li', null, h('strong', null, 'Manager Conductor:'), ' Can manage featured queue'),
                                h('li', null, h('strong', null, 'Governor Conductor:'), ' Can execute certain parameter changes')
                            ),
                            h('p', null,
                                'Conductors enable operational flexibility without requiring full DAO votes for routine actions.'
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'What the DAO Controls'),
                            h('ul', null,
                                h('li', null, 'Approval of new alignment targets'),
                                h('li', null, 'Registration of vault factories and vault instances'),
                                h('li', null, 'Registration of project factories (ERC404, ERC1155, ERC721)'),
                                h('li', null, 'MasterRegistry upgrades (UUPS pattern)'),
                                h('li', null, 'Protocol fee parameters'),
                                h('li', null, 'Treasury management'),
                                h('li', null, 'Featured queue pricing and parameters')
                            )
                        )
                    ),

                    // ============ Becoming a Member Section ============
                    h('section', { className: 'docs-section', id: 'becoming-member' },
                        h('h2', { className: 'section-title' }, 'Becoming a Member'),
                        h('p', { className: 'section-intro' },
                            'Learn how to join the MS2.FUN DAO and participate in governance.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Membership Process'),
                            h('p', null, 'To become a DAO member:'),
                            h('ol', null,
                                h('li', null, h('strong', null, 'Submit Application:'), ' Provide your background, contribution history, and desired shares/loot amounts'),
                                h('li', null, h('strong', null, 'Sponsorship:'), ' An existing member must sponsor your application'),
                                h('li', null, h('strong', null, 'Voting Period:'), ' Members vote on your application during the proposal period'),
                                h('li', null, h('strong', null, 'Approval:'), ' If approved, you receive shares/loot and gain member status')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Shares vs. Loot'),
                            h('p', null,
                                h('strong', null, 'Shares:'), ' Grant voting power and proportional claims on treasury. Non-transferable.'
                            ),
                            h('p', null,
                                h('strong', null, 'Loot:'), ' Grant proportional claims on treasury without voting power. Non-transferable but can be rage-quit.'
                            ),
                            h('p', null,
                                'Most contributors receive a mix of shares and loot based on their expected participation level.'
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Rage Quit'),
                            h('p', null,
                                'Members can "rage quit" at any time to burn their shares/loot in exchange for a proportional share of the treasury. This ensures members are never locked in and provides an exit mechanism.'
                            )
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Contribution Ideas'),
                            h('p', null,
                                'Active contributors who help with development, design, community management, or ecosystem growth are strong membership candidates.'
                            ),
                            h('p', null,
                                'Factory creators who build new project types automatically receive economic participation through the protocol\'s revenue share.'
                            )
                        )
                    ),

                    // ============ Proposals Section ============
                    h('section', { className: 'docs-section', id: 'proposals' },
                        h('h2', { className: 'section-title' }, 'Proposals'),
                        h('p', { className: 'section-intro' },
                            'How to create, vote on, and execute governance proposals.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Proposal Types')
                        ),

                        h('div', { className: 'article-grid' },
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'Alignment Target'),
                                h('p', { className: 'article-description' },
                                    'Approve a new community/token as an alignment target. Requires target details and token address.'
                                )
                            ),
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'Vault Approval'),
                                h('p', { className: 'article-description' },
                                    'Deploy and approve a new vault for an approved target. Specifies vault factory and configuration.'
                                )
                            ),
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'Factory Registration'),
                                h('p', { className: 'article-description' },
                                    'Register a new project factory (ERC404, ERC1155, ERC721) to enable new project creation patterns.'
                                )
                            ),
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'Treasury Action'),
                                h('p', { className: 'article-description' },
                                    'Execute arbitrary transactions from treasury. Used for investments, grants, or other treasury operations.'
                                )
                            ),
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'Parameter Change'),
                                h('p', { className: 'article-description' },
                                    'Update protocol parameters like fee rates, featured queue pricing, or conductor permissions.'
                                )
                            ),
                            h('div', { className: 'article-card' },
                                h('div', { className: 'article-title' }, 'Membership'),
                                h('p', { className: 'article-description' },
                                    'Grant shares/loot to new members or adjust existing member allocations.'
                                )
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Proposal Lifecycle'),
                            h('ol', null,
                                h('li', null, h('strong', null, 'Submission:'), ' Member submits proposal with details and execution payload'),
                                h('li', null, h('strong', null, 'Sponsorship:'), ' Another member sponsors to move to voting'),
                                h('li', null, h('strong', null, 'Voting Period:'), ' 7-day voting window where shareholders vote yes/no'),
                                h('li', null, h('strong', null, 'Grace Period:'), ' 3-day grace period for members to rage quit if they disagree'),
                                h('li', null, h('strong', null, 'Execution:'), ' If approved, proposal is queued in Gnosis Safe for execution'),
                                h('li', null, h('strong', null, 'Safe Approval:'), ' Safe signers approve and execute the transaction')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Voting Power'),
                            h('p', null,
                                'Voting power is proportional to shares held. One share = one vote. Loot does not grant voting power.'
                            ),
                            h('p', null,
                                'Quorum and approval thresholds are configurable per proposal type. Most proposals require simple majority (>50%) approval.'
                            )
                        )
                    ),

                    // ============ Treasury Section ============
                    h('section', { className: 'docs-section', id: 'treasury' },
                        h('h2', { className: 'section-title' }, 'Treasury'),
                        h('p', { className: 'section-intro' },
                            'How protocol fees accumulate and are managed by the DAO.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Revenue Sources'),
                            h('ul', null,
                                h('li', null, 'ERC404 bonding fees (1%)'),
                                h('li', null, 'ERC404 graduation fees (2%, shared with factory creator)'),
                                h('li', null, 'Vault LP yield protocol cut (5%)'),
                                h('li', null, 'ERC1155 and ERC721 settlement fees'),
                                h('li', null, 'Featured queue rental fees')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Treasury Usage'),
                            h('p', null, 'The DAO can use treasury funds for:'),
                            h('ul', null,
                                h('li', null, 'Protocol development and audits'),
                                h('li', null, 'Ecosystem grants and incentives'),
                                h('li', null, 'Strategic investments in aligned projects'),
                                h('li', null, 'Liquidity provisioning for protocol-owned liquidity'),
                                h('li', null, 'Contributor compensation'),
                                h('li', null, 'Marketing and community initiatives')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Transparency'),
                            h('p', null, 'All treasury transactions are on-chain and auditable. The treasury dashboard shows:'),
                            h('ul', null,
                                h('li', null, 'Total assets under management'),
                                h('li', null, 'Asset breakdown (ETH, tokens, LP positions)'),
                                h('li', null, 'Revenue over time'),
                                h('li', null, 'Recent transactions'),
                                h('li', null, 'Approved but unexecuted proposals')
                            )
                        )
                    ),

                    // ============ Security Section ============
                    h('section', { className: 'docs-section', id: 'security' },
                        h('h2', { className: 'section-title' }, 'Security'),
                        h('p', { className: 'section-intro' },
                            'Security practices, audit status, and risk disclosures.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Audit Status'),
                            h('p', null,
                                'The MS2.FUN contract system has undergone audits by [Audit Firm]. Full audit reports are available in the repository.'
                            ),
                            h('p', null, 'Key findings and mitigations:'),
                            h('ul', null,
                                h('li', null, 'Critical: None'),
                                h('li', null, 'High: Addressed in v1.1'),
                                h('li', null, 'Medium: Documented with mitigations')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Known Risks'),
                            h('ul', null,
                                h('li', null, h('strong', null, 'Smart Contract Risk:'), ' Despite audits, bugs may exist. Use at your own risk.'),
                                h('li', null, h('strong', null, 'Economic Risk:'), ' Bonding curves can be volatile. NFT floor prices may fluctuate.'),
                                h('li', null, h('strong', null, 'Liquidity Risk:'), ' Vaults depend on Uniswap V4 liquidity depth for target tokens.'),
                                h('li', null, h('strong', null, 'Governance Risk:'), ' The DAO controls critical protocol parameters and upgrades.')
                            )
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Best Practices'),
                            h('ul', null,
                                h('li', null, 'Start with small amounts to familiarize yourself with mechanics'),
                                h('li', null, 'Verify contract addresses before interacting'),
                                h('li', null, 'Use hardware wallets for significant holdings'),
                                h('li', null, 'Understand bonding curve dynamics before buying'),
                                h('li', null, 'Monitor vault TVL and liquidity before staking')
                            )
                        ),

                        h('div', { className: 'info-box' },
                            h('div', { className: 'info-box-title' }, 'Bug Bounty'),
                            h('p', null,
                                'MS2.FUN offers a bug bounty program for responsible disclosure of vulnerabilities. Rewards up to $50,000 for critical findings.'
                            ),
                            h('p', null,
                                'Report vulnerabilities to security@ms2.fun with detailed reproduction steps.'
                            )
                        )
                    ),

                    // ============ FAQ Section ============
                    h('section', { className: 'docs-section', id: 'faq' },
                        h('h2', { className: 'section-title' }, 'FAQ'),
                        h('p', { className: 'section-intro' },
                            'Frequently asked questions about MS2.FUN.'
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'General Questions'),

                            h('p', null, h('strong', null, 'What blockchains does MS2.FUN support?')),
                            h('p', null, 'Currently Ethereum mainnet. Future support for L2s is planned.'),

                            h('p', null, h('strong', null, 'Do I need to be a DAO member to create projects?')),
                            h('p', null, 'No. Anyone can create projects without DAO membership. The DAO curates which factories and vaults are available, but project creation is permissionless within approved factories.'),

                            h('p', null, h('strong', null, 'Can I change my project\'s vault after deployment?')),
                            h('p', null, 'No. Vault binding is immutable to ensure authentic alignment.'),

                            h('p', null, h('strong', null, 'What happens if my vault\'s target token goes to zero?')),
                            h('p', null, 'The vault will continue to operate but LP positions will lose value. Benefactors can still claim their proportional share of whatever remains.')
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Technical Questions'),

                            h('p', null, h('strong', null, 'What is the ERC404 standard?')),
                            h('p', null, 'ERC404 uses DN404, a hybrid token standard that combines fungible ERC20-like tokens with NFT ownership. Holding a full token unit (e.g., 1M tokens) automatically mints an NFT.'),

                            h('p', null, h('strong', null, 'How do bonding curves work?')),
                            h('p', null, 'Bonding curves use mathematical formulas to set prices based on supply. As more tokens are minted, the price increases. When tokens are sold back, the price decreases. This creates continuous liquidity and price discovery.'),

                            h('p', null, h('strong', null, 'Why use Uniswap V4 hooks?')),
                            h('p', null, 'V4 hooks allow custom logic on every swap. We use this to tax trades and route fees to alignment vaults, creating a sustainable revenue stream.'),

                            h('p', null, h('strong', null, 'Are contracts upgradeable?')),
                            h('p', null, 'Only MasterRegistry uses UUPS upgradeability (DAO-controlled). Factories and instances are immutable.')
                        ),

                        h('div', { className: 'content-block' },
                            h('h3', { className: 'content-block-title' }, 'Economic Questions'),

                            h('p', null, h('strong', null, 'How is vault APY calculated?')),
                            h('p', null, 'APY estimates are based on recent LP fee generation extrapolated over a year. Actual yields vary with trading volume and liquidity depth.'),

                            h('p', null, h('strong', null, 'What\'s the difference between benefactors and stakers?')),
                            h('p', null, 'Benefactors are projects that contribute fees to a vault. Stakers are token holders who lock tokens to earn vault yield. Both share in the 95% yield pool.'),

                            h('p', null, h('strong', null, 'Can creators earn from secondary sales?')),
                            h('p', null, 'ERC404 and ERC1155 don\'t have built-in royalties on secondary. Creators can implement this at the marketplace level or through custom hooks.')
                        )
                    ),

                    // Bottom spacer (matches demo)
                    h('div', { style: 'height: 80px;' })
                )
            )
        );
    }
}

export default Documentation;
