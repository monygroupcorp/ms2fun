import { html } from '../core/compose.js';
import Component from '../core/Component.js';

/**
 * HomePage V2 - Gallery Brutalism
 *
 * Layout:
 * 1. Top bar (home + create CTA)
 * 2. Featured project banner (#1 paid placement)
 * 3. Vault stats bar (TVL metrics)
 * 4. Recent activity (global messages)
 * 5. Project grid (featured queue #2-9)
 * 6. View all link
 */
export default class HomePage extends Component {
  constructor() {
    super();
    this.state = {
      featuredProject: null,      // #1 featured (banner)
      featuredQueue: [],           // #2-9 featured (grid)
      topVaults: [],               // Vault TVL data
      recentMessages: [],          // Global messages
      loading: true
    };
  }

  async connectedCallback() {
    await this.loadData();
  }

  async loadData() {
    try {
      // TODO: Connect to actual services
      // const featuredQueue = await MasterRegistry.getFeaturedQueue();
      // const topVaults = await QueryAggregator.getTopVaultsByTVL(3);
      // const recentMessages = await GlobalMessageRegistry.getRecentMessages(5);

      // Mock data for now
      this.setState({
        featuredProject: {
          id: 1,
          name: 'Featured Art Collection',
          creator: '0x742d35Cc...',
          type: 'ERC404',
          image: '/assets/featured-placeholder.jpg'
        },
        featuredQueue: [
          { id: 2, name: 'Project Alpha', creator: 'Artist A', type: 'ERC404', tvl: '1.2M' },
          { id: 3, name: 'Project Beta', creator: 'Artist B', type: 'ERC1155', tvl: '800K' },
          { id: 4, name: 'Project Gamma', creator: 'Artist C', type: 'ERC404', tvl: '650K' },
          { id: 5, name: 'Project Delta', creator: 'Artist D', type: 'ERC721', tvl: '450K' },
          { id: 6, name: 'Project Epsilon', creator: 'Artist E', type: 'ERC404', tvl: '320K' },
          { id: 7, name: 'Project Zeta', creator: 'Artist F', type: 'ERC1155', tvl: '280K' },
          { id: 8, name: 'Project Eta', creator: 'Artist G', type: 'ERC404', tvl: '150K' },
          { id: 9, name: 'Project Theta', creator: 'Artist H', type: 'ERC721', tvl: '120K' }
        ],
        topVaults: [
          { name: 'Alpha Vault', tvl: '1.2M' },
          { name: 'Beta Vault', tvl: '800K' },
          { name: 'Gamma Vault', tvl: '650K' }
        ],
        recentMessages: [
          { text: 'User minted NFT #42 in Project Alpha', timestamp: Date.now() },
          { text: 'Creator launched Music Collection', timestamp: Date.now() },
          { text: 'Collector bought Edition #7', timestamp: Date.now() },
          { text: 'Artist updated Generative Series', timestamp: Date.now() }
        ],
        loading: false
      });
    } catch (error) {
      console.error('[HomePage] Failed to load data:', error);
      this.setState({ loading: false });
    }
  }

  handleCreateProject() {
    window.location.href = '/create';
  }

  handleViewAllProjects() {
    window.location.href = '/projects';
  }

  handleViewAllActivity() {
    window.location.href = '/activity';
  }

  handleProjectClick(projectId) {
    window.location.href = `/project/${projectId}`;
  }

  renderTopBar() {
    return html`
      <div class="home-top-bar">
        <a href="/" class="home-logo">MS2</a>
        <button class="btn btn-primary" onclick="${() => this.handleCreateProject()}">
          Create Project
        </button>
      </div>
    `;
  }

  renderFeaturedBanner() {
    const { featuredProject } = this.state;
    if (!featuredProject) return '';

    return html`
      <div class="featured-banner" onclick="${() => this.handleProjectClick(featuredProject.id)}">
        <div class="featured-banner-image">
          <img src="${featuredProject.image}" alt="${featuredProject.name}" />
        </div>
        <div class="featured-banner-content">
          <div class="featured-banner-label">FEATURED</div>
          <h2 class="featured-banner-title">${featuredProject.name}</h2>
          <div class="featured-banner-meta">
            <span class="text-mono">${featuredProject.creator}</span>
            <span class="badge">${featuredProject.type}</span>
          </div>
        </div>
      </div>
    `;
  }

  renderStatsBar() {
    const { topVaults } = this.state;
    if (!topVaults || topVaults.length === 0) return '';

    return html`
      <div class="stats-bar">
        <span class="stats-bar-label">TOP VAULTS:</span>
        ${topVaults.map(vault => html`
          <span class="stats-bar-item">
            ${vault.name} <span class="text-mono">$${vault.tvl}</span>
          </span>
        `).join(' <span class="stats-bar-separator">|</span> ')}
      </div>
    `;
  }

  renderRecentActivity() {
    const { recentMessages } = this.state;
    if (!recentMessages || recentMessages.length === 0) return '';

    return html`
      <div class="activity-section">
        <h3 class="activity-title">RECENT ACTIVITY</h3>
        <div class="activity-list">
          ${recentMessages.map(message => html`
            <div class="activity-item">
              <span class="activity-bullet">•</span>
              <span class="activity-text">${message.text}</span>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-ghost activity-view-all" onclick="${() => this.handleViewAllActivity()}">
          View All Activity →
        </button>
      </div>
    `;
  }

  renderProjectGrid() {
    const { featuredQueue } = this.state;
    if (!featuredQueue || featuredQueue.length === 0) return '';

    return html`
      <div class="projects-section">
        <h3 class="projects-title">PROJECTS</h3>
        <div class="projects-grid">
          ${featuredQueue.map(project => html`
            <div class="project-card" onclick="${() => this.handleProjectClick(project.id)}">
              <div class="project-card-image">
                <div class="project-card-placeholder">${project.name[0]}</div>
              </div>
              <div class="project-card-content">
                <h4 class="project-card-title">${project.name}</h4>
                <div class="project-card-meta">
                  <span class="text-secondary text-mono">${project.creator}</span>
                  <span class="badge">${project.type}</span>
                </div>
                ${project.tvl ? html`
                  <div class="project-card-tvl">
                    <span class="text-secondary">TVL:</span>
                    <span class="text-mono">$${project.tvl}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-secondary projects-view-all" onclick="${() => this.handleViewAllProjects()}">
          View All Projects →
        </button>
      </div>
    `;
  }

  renderLoading() {
    return html`
      <div class="container">
        <div class="loading-state">
          <div class="loading loading-lg"></div>
        </div>
      </div>
    `;
  }

  render() {
    const { loading } = this.state;

    if (loading) {
      return this.renderLoading();
    }

    return html`
      <div class="home-page">
        ${this.renderTopBar()}

        <div class="home-content">
          ${this.renderFeaturedBanner()}
          ${this.renderStatsBar()}
          ${this.renderRecentActivity()}
          ${this.renderProjectGrid()}
        </div>
      </div>
    `;
  }
}

customElements.define('home-page-v2', HomePage);
