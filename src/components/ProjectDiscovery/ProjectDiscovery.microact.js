/**
 * ProjectDiscovery - Microact Version
 *
 * Main component for browsing and discovering projects.
 * Always shows CultExecs as the baseline project.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { ProjectCard } from './ProjectCard.microact.js';

// Hardcoded CultExecs - always shows regardless of blockchain state
const CULT_EXECS_PROJECT = {
    name: 'CULT EXECUTIVES',
    address: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2',
    contractType: 'ERC404',
    description: 'The flagship ERC404 project. Bonding curve trading with automatic NFT minting.',
    isFeatured: true,
    isHardcoded: true
};

export class ProjectDiscovery extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            projects: [],
            filteredProjects: [CULT_EXECS_PROJECT], // Start with CultExecs
            filters: {
                viewMode: 'grid'
            },
            loading: false, // Not loading - show CultExecs immediately
            error: null
        };
    }

    async didMount() {
        // Listen for additional projects from data provider
        if (this.props.useDataProvider) {
            const unsub = eventBus.on('homepage:data', (data) => {
                if (data.projects && Array.isArray(data.projects)) {
                    // Add any new projects after CultExecs
                    const newProjects = data.projects.filter(p =>
                        p.instance !== CULT_EXECS_PROJECT.address &&
                        p.address !== CULT_EXECS_PROJECT.address
                    );
                    this.setState({
                        filteredProjects: [CULT_EXECS_PROJECT, ...newProjects]
                    });
                }
            });
            this.registerCleanup(unsub);
        }
    }

    handleNavigate(path) {
        if (window.router) {
            window.router.navigate(path);
        } else {
            window.location.href = path;
        }
    }

    render() {
        const { filteredProjects, filters } = this.state;

        // Render ProjectCards directly as children
        const projectCards = filteredProjects.map(project =>
            h(ProjectCard, {
                key: project.address,
                project,
                onNavigate: (path) => this.handleNavigate(path)
            })
        );

        return h('div', { class: 'project-discovery' },
            h('div', { class: 'discovery-content' },
                h('div', { class: 'projects-section' },
                    h('div', { class: 'section-header' },
                        h('h2', { class: 'section-title' },
                            'Projects',
                            h('span', { class: 'project-count' }, `(${filteredProjects.length})`)
                        )
                    ),
                    h('div', {
                        class: `projects-grid ${filters.viewMode}`
                    }, ...projectCards)
                )
            )
        );
    }
}
