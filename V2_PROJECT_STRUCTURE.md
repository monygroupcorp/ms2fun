# V2 Frontend Project Structure

**Date:** 2026-02-18
**Purpose:** Architecture design for the Gallery Brutalism frontend rebuild

---

## Directory Structure

```
ms2fun/
├── index.html                      # Root entry point
├── 404.html                        # GitHub Pages SPA fallback (identical to index.html)
│
├── src/
│   ├── index.js                    # App initialization, router setup
│   │
│   ├── core/                       # Core framework utilities
│   │   ├── global-v2.css          # Design tokens, typography, spacing (EXISTS)
│   │   └── components-v2.css      # Component styles, nav, buttons (EXISTS)
│   │
│   ├── components/                 # Reusable UI components
│   │   ├── Loading/               # Skeleton & loading states
│   │   │   ├── Skeleton.js
│   │   │   ├── SkeletonText.js
│   │   │   ├── SkeletonCard.js
│   │   │   ├── SkeletonProjectCard.js
│   │   │   ├── Spinner.js
│   │   │   ├── DotsLoader.js
│   │   │   ├── ProgressBar.js
│   │   │   └── LoadingMessage.js
│   │   │
│   │   ├── Layout/                # Layout components
│   │   │   ├── TopBar.js          # Desktop: Logo + Create btn
│   │   │   ├── MobileNav.js       # Mobile: Hamburger menu panel
│   │   │   ├── Footer.js          # Footer with icons
│   │   │   └── FloatingWalletButton.js (EXISTS - migrate to h())
│   │   │
│   │   ├── Common/                # Common UI components
│   │   │   ├── Icon.js            # SVG icon wrapper
│   │   │   ├── Badge.js           # ERC404, ERC1155 badges
│   │   │   ├── ProjectCard.js     # Project grid card
│   │   │   ├── ActivityItem.js    # Activity feed item
│   │   │   └── StatsBar.js        # Metrics bar
│   │   │
│   │   └── Web3/                  # Web3-specific components (from micro-web3)
│   │       ├── WalletModal.js     # Re-export from micro-web3
│   │       ├── IpfsImage.js       # Re-export from micro-web3
│   │       └── ...                # Other micro-web3 components
│   │
│   ├── routes/                    # Route components (pages)
│   │   ├── HomePage.js            # Homepage with featured + grid
│   │   ├── ProjectDiscovery.js    # Browse/search projects
│   │   ├── ProjectDetail.js       # Project detail page
│   │   ├── Portfolio.js           # User holdings
│   │   ├── VaultExplorer.js       # Vault browser
│   │   ├── VaultDetail.js         # Vault detail page
│   │   ├── ActivityFeed.js        # Global activity feed
│   │   ├── Documentation.js       # Docs page
│   │   │
│   │   └── governance/            # Governance pages
│   │       ├── GovernanceOverview.js
│   │       ├── ProposalsList.js
│   │       ├── ProposalDetail.js
│   │       ├── GovernanceApply.js
│   │       ├── FactoryApplicationForm.js
│   │       ├── VaultApplicationForm.js
│   │       ├── MemberDashboard.js
│   │       ├── TreasuryView.js
│   │       └── ShareOffering.js
│   │
│   ├── services/                  # Backend/contract services (KEEP AS-IS)
│   │   ├── ServiceFactory.js      # Service provider
│   │   ├── WalletService.js       # Wallet connection
│   │   ├── ProjectIndex.js        # Event indexing
│   │   ├── GovernanceEventIndexer.js
│   │   ├── QueryService.js        # Batch queries
│   │   └── contracts/             # Contract adapters
│   │       ├── MasterRegistryAdapter.js
│   │       ├── ERC404FactoryAdapter.js
│   │       ├── ERC1155FactoryAdapter.js
│   │       ├── UltraAlignmentVaultAdapter.js
│   │       ├── GlobalMessageRegistryAdapter.js
│   │       └── ...
│   │
│   └── config/                    # Configuration files (KEEP AS-IS)
│       ├── contracts.local.json   # Anvil contracts
│       └── contracts.mainnet.json # Production contracts
│
├── docs/                          # Documentation & demos
│   └── examples/                  # HTML demos (REFERENCE ONLY)
│       ├── homepage-v2-demo.html
│       ├── portfolio-demo.html
│       └── ...
│
└── spike-*.js                     # Temporary spike files (DELETE after migration)
```

---

## Component Patterns

### Route Component Template

**Location:** `src/routes/ProjectDetail.js`

```javascript
import { h, Component } from '@monygroupcorp/microact';
import serviceFactory from '../services/ServiceFactory.js';
import { Spinner, SkeletonProjectCard } from '../components/Loading/index.js';
import { ProjectCard, Badge } from '../components/Common/index.js';

/**
 * Project Detail Route
 * Shows project information, vault details, and activity
 */
export class ProjectDetailRoute extends Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            project: null,
            error: null
        };
    }

    async didMount() {
        try {
            const projectService = serviceFactory.getProjectService();
            const project = await projectService.getProjectById(this.props.projectId);
            this.setState({ loading: false, project });
        } catch (error) {
            this.setState({ loading: false, error: error.message });
        }
    }

    renderLoading() {
        return h('div', { className: 'project-detail-loading' },
            h('div', { className: 'container' },
                h(SkeletonProjectCard),
                h(SkeletonProjectCard)
            )
        );
    }

    renderError() {
        return h('div', { className: 'error-page' },
            h('h1', null, 'Error'),
            h('p', null, this.state.error)
        );
    }

    renderProject() {
        const { project } = this.state;
        return h('div', { className: 'project-detail' },
            h('div', { className: 'container' },
                h('h1', { className: 'project-title' }, project.name),
                h(Badge, { type: project.type }),
                h('p', { className: 'project-description' }, project.description)
            )
        );
    }

    render() {
        if (this.state.loading) return this.renderLoading();
        if (this.state.error) return this.renderError();
        return this.renderProject();
    }
}

export default ProjectDetailRoute;
```

### Reusable Component Template

**Location:** `src/components/Common/ProjectCard.js`

```javascript
import { h, Component } from '@monygroupcorp/microact';
import { Badge } from './Badge.js';

/**
 * Project Card Component
 * Used in project grids
 */
export class ProjectCard extends Component {
    render() {
        const { project, onClick } = this.props;

        return h('div', {
            className: 'project-card',
            onClick: onClick || (() => window.router.navigate(`/project/${project.address}`))
        },
            h('div', { className: 'project-card-image' }, project.name[0]),
            h('div', { className: 'project-card-content' },
                h('h4', { className: 'project-card-title' }, project.name),
                h('div', { className: 'project-card-meta' },
                    h('span', { className: 'text-mono text-secondary' }, project.address.slice(0, 8) + '...'),
                    h(Badge, { type: project.type })
                ),
                h('p', { className: 'project-card-description' }, project.description),
                h('div', { className: 'project-card-tvl' },
                    h('span', { className: 'text-secondary' }, 'TVL:'),
                    h('span', { className: 'text-mono' }, project.tvl)
                )
            )
        );
    }
}

export default ProjectCard;
```

---

## App Initialization Flow

### src/index.js (New Entry Point)

```javascript
import { Router, h, render } from '@monygroupcorp/microact';
import serviceFactory from './services/ServiceFactory.js';
import walletService from './services/WalletService.js';
import { FloatingWalletButton } from './components/Layout/FloatingWalletButton.js';

/**
 * Initialize the application
 */
async function initializeApp() {
    console.log('Initializing MS2.FUN v2...');

    // Initialize services (detects environment, falls back to mock)
    await serviceFactory.initialize();
    console.log('Services initialized:', serviceFactory.isUsingMock() ? 'mock' : 'real');

    // Initialize wallet service
    await walletService.initialize();
    console.log('Wallet service initialized');

    // Create router
    const router = new Router();
    window.router = router; // Global access for navigation

    // Register routes (async-loaded)
    registerRoutes(router);

    // 404 handler
    router.notFound((path) => {
        const container = document.getElementById('app');
        container.innerHTML = `
            <div class="error-page">
                <h1>404</h1>
                <p>Page not found: ${path}</p>
            </div>
        `;
    });

    // Start router (reads window.location.pathname)
    await router.start();

    // Mount global components
    mountGlobalComponents();

    console.log('App initialized successfully');
}

/**
 * Register all routes
 */
function registerRoutes(router) {
    // Home
    router.on('/', async () => {
        const { HomePage } = await import('./routes/HomePage.js');
        renderRoute(h(HomePage));
    });

    // Discovery
    router.on('/discover', async () => {
        const { ProjectDiscovery } = await import('./routes/ProjectDiscovery.js');
        renderRoute(h(ProjectDiscovery));
    });

    // Portfolio
    router.on('/portfolio', async () => {
        const { Portfolio } = await import('./routes/Portfolio.js');
        renderRoute(h(Portfolio));
    });

    // Project Detail
    router.on('/project/:id', async (params) => {
        const { ProjectDetailRoute } = await import('./routes/ProjectDetail.js');
        renderRoute(h(ProjectDetailRoute, { projectId: params.id }));
    });

    // Vault Routes
    router.on('/vaults', async () => {
        const { VaultExplorer } = await import('./routes/VaultExplorer.js');
        renderRoute(h(VaultExplorer));
    });

    router.on('/vaults/:address', async (params) => {
        const { VaultDetail } = await import('./routes/VaultDetail.js');
        renderRoute(h(VaultDetail, { vaultAddress: params.address }));
    });

    // Governance Routes
    router.on('/governance', async () => {
        const { GovernanceOverview } = await import('./routes/governance/GovernanceOverview.js');
        renderRoute(h(GovernanceOverview));
    });

    router.on('/governance/proposals', async () => {
        const { ProposalsList } = await import('./routes/governance/ProposalsList.js');
        renderRoute(h(ProposalsList));
    });

    router.on('/governance/proposals/:id', async (params) => {
        const { ProposalDetail } = await import('./routes/governance/ProposalDetail.js');
        renderRoute(h(ProposalDetail, { proposalId: params.id }));
    });

    // ... more routes
}

/**
 * Render route component to app container
 */
function renderRoute(vnode) {
    const container = document.getElementById('app');
    render(vnode, container);
}

/**
 * Mount global components (wallet button, notifications, etc.)
 */
function mountGlobalComponents() {
    // Floating Wallet Button
    const walletContainer = document.createElement('div');
    walletContainer.id = 'floating-wallet-container';
    document.body.appendChild(walletContainer);
    render(h(FloatingWalletButton), walletContainer);

    console.log('Global components mounted');
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initializeApp, 100); // Slight delay for wallet injections
});
```

---

## Layout Architecture

### Global Layout Pattern

**Every route includes TopBar + Footer:**

```javascript
// Option 1: Each route renders its own layout
class HomePage extends Component {
    render() {
        return h('div', { className: 'page' },
            h(TopBar),
            h('div', { className: 'page-content' },
                // Page content here
            ),
            h(Footer)
        );
    }
}

// Option 2: Layout wrapper component (RECOMMENDED)
class Layout extends Component {
    render() {
        return h('div', { className: 'page' },
            h(TopBar),
            h('div', { className: 'page-content' },
                this.props.children
            ),
            h(Footer)
        );
    }
}

// Then routes use:
class HomePage extends Component {
    render() {
        return h(Layout, null,
            h('h1', null, 'Welcome to MS2.FUN')
        );
    }
}
```

### TopBar Component

**Location:** `src/components/Layout/TopBar.js`

```javascript
import { h, Component } from '@monygroupcorp/microact';
import { MobileNav } from './MobileNav.js';

export class TopBar extends Component {
    constructor(props) {
        super(props);
        this.state = { mobileMenuOpen: false };
    }

    toggleMobileMenu = () => {
        this.setState({ mobileMenuOpen: !this.state.mobileMenuOpen });
    }

    render() {
        return h('div', { className: 'home-top-bar' },
            // Logo
            h('a', {
                href: '/',
                className: 'home-logo',
                onClick: (e) => {
                    e.preventDefault();
                    window.router.navigate('/');
                }
            },
                'MS2',
                h('span', { className: 'logo-tld' }, '.fun')
            ),

            // Mobile hamburger
            h('button', {
                className: 'mobile-menu-toggle',
                'aria-label': 'Menu',
                'aria-expanded': this.state.mobileMenuOpen,
                onClick: this.toggleMobileMenu
            },
                h('span', { className: 'hamburger-bar' })
            ),

            // Desktop nav
            h('div', {
                className: 'nav-links',
                style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }
            },
                h('a', {
                    href: '/create',
                    className: 'btn btn-primary',
                    onClick: (e) => {
                        e.preventDefault();
                        window.router.navigate('/create');
                    }
                }, 'Create')
            ),

            // Mobile nav panel
            h(MobileNav, {
                isOpen: this.state.mobileMenuOpen,
                onClose: () => this.setState({ mobileMenuOpen: false })
            })
        );
    }
}

export default TopBar;
```

---

## CSS Organization

### Global Styles (Already Exist!)

- `src/core/global-v2.css` - Design tokens, typography
- `src/core/components-v2.css` - Component styles

**No new CSS files needed!** All component styles use classes from `components-v2.css`.

### Component-Specific CSS (Only if Needed)

If a component needs custom styles not in `components-v2.css`:

```
src/components/Custom/CustomComponent.js
src/components/Custom/CustomComponent.css  # Only if necessary
```

**But prefer using existing v2 CSS classes!**

---

## Service Access Pattern

**Always use ServiceFactory:**

```javascript
import serviceFactory from '../services/ServiceFactory.js';

// In component
async didMount() {
    const masterService = serviceFactory.getMasterService();
    const factories = await masterService.getFactories();

    const projectIndex = serviceFactory.getProjectIndex();
    await projectIndex.ensureSynced();
    const projects = await projectIndex.getAllProjects();

    this.setState({ factories, projects, loading: false });
}
```

---

## Migration Strategy

### Phase 1: Setup Structure
1. Create `src/components/` directory structure
2. Create `src/routes/` directory structure
3. Move skeleton components from spike → `src/components/Loading/`

### Phase 2: Build Layout Components
1. TopBar (desktop nav)
2. MobileNav (hamburger panel)
3. Footer
4. Layout wrapper

### Phase 3: Migrate Routes (Priority Order)
1. **HomePage** - Most visible, sets the tone
2. **ProjectDiscovery** - Core discovery experience
3. **ProjectDetail** - Project pages
4. **Portfolio** - User holdings
5. **Governance pages** - DAO functionality
6. Everything else

### Phase 4: Update index.js
1. Replace old router with Microact Router
2. Register all routes
3. Test GitHub Pages 404.html routing

### Phase 5: Cleanup
1. Remove old `src/routes/` files (after testing)
2. Delete spike files
3. Update README with v2 architecture

---

## Key Decisions

✅ **Use Layout wrapper** - TopBar + Footer in every route
✅ **Async-load routes** - Smaller initial bundle
✅ **Keep services as-is** - ServiceFactory, adapters work perfectly
✅ **No new CSS** - Use existing `global-v2.css` + `components-v2.css`
✅ **Path-based routing** - Microact Router + GitHub Pages 404.html
✅ **Skeleton components** - Consistent loading states
✅ **Component-based** - Everything is a Microact component with `h()`

---

**Ready to start implementation!**
