import stylesheetLoader from '../utils/stylesheetLoader.js';
import { h, render, unmountRoot } from '../core/microact-setup.js';
import { EditionDetail } from '../components/ERC1155/EditionDetail.microact.js';
import serviceFactory from '../services/ServiceFactory.js';

/**
 * Edition detail page route handler
 */
export async function renderEditionDetail(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    const projectRegistry = serviceFactory.getProjectRegistry();
    const projectService = serviceFactory.getProjectService();

    let projectId, editionId;

    // Determine format: old (projectId/editionId) or new (instanceName/pieceTitle)
    if (params.projectId && params.editionId !== undefined) {
        projectId = params.projectId;
        editionId = params.editionId;
    } else if (params.instanceName && params.pieceTitle) {
        const projectData = await projectRegistry.getProjectByName(params.instanceName);

        if (!projectData || !projectData.instance) {
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>404 - Project Not Found</h1>
                    <p>The project "${params.instanceName}" does not exist.</p>
                    <a href="/" class="home-link">Go Home</a>
                </div>
            `;
            return;
        }

        projectId = projectData.instance.address;

        if (!projectService.isProjectLoaded(projectId)) {
            await projectService.loadProject(
                projectId,
                projectData.instance.address,
                projectData.instance.contractType || 'ERC1155'
            );
        }

        const adapter = projectService.getAdapter(projectId);
        if (!adapter) {
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>Error</h1>
                    <p>Failed to load project adapter.</p>
                    <a href="/" class="home-link">Go Home</a>
                </div>
            `;
            return;
        }

        const editions = await adapter.getEditions();
        const slugify = (text) => {
            if (!text) return '';
            return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        };

        const edition = editions.find(e =>
            slugify(e.pieceTitle) === slugify(params.pieceTitle) ||
            slugify(e.metadata?.name) === slugify(params.pieceTitle)
        );

        if (!edition) {
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>404 - Edition Not Found</h1>
                    <p>The edition "${params.pieceTitle}" does not exist in this project.</p>
                    <a href="/${params.chainId}/${params.instanceName}" class="home-link">Back to Project</a>
                </div>
            `;
            return;
        }

        editionId = edition.id;
    } else {
        appContainer.innerHTML = `
            <div class="error-page">
                <h1>400 - Bad Request</h1>
                <p>Missing required parameters for edition detail.</p>
                <a href="/" class="home-link">Go Home</a>
            </div>
        `;
        return;
    }

    // Load stylesheets
    stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');

    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');

    // Add v2-route class so marble-svg-filters SVG gets hidden
    document.body.classList.add('v2-route');

    // Handle project style - must happen BEFORE clearing content so the speculative
    // has-project-style class (added by inline script in index.html) gets resolved.
    const cachedStyleUri = localStorage.getItem(`projectStyle:${projectId}`);
    if (cachedStyleUri) {
        document.documentElement.classList.add('has-project-style');
        document.body.classList.add('has-project-style');
        document.body.setAttribute('data-project-style', projectId);

        const styleId = `project-style-${projectId}`;
        const existingLink = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
        if (!existingLink) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cachedStyleUri.startsWith('/') || cachedStyleUri.startsWith('http')
                ? cachedStyleUri : '/' + cachedStyleUri;
            link.setAttribute('data-stylesheet-id', styleId);
            link.onload = () => {
                document.documentElement.classList.add('project-style-loaded', 'project-style-resolved');
                document.body.classList.add('project-style-loaded', 'project-style-resolved');
            };
            link.onerror = () => {
                document.documentElement.classList.remove('has-project-style');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.remove('has-project-style');
                document.body.classList.add('project-style-resolved');
            };
            document.head.appendChild(link);
            await new Promise(resolve => requestAnimationFrame(resolve));
        } else {
            document.documentElement.classList.add('project-style-loaded', 'project-style-resolved');
            document.body.classList.add('project-style-loaded', 'project-style-resolved');
        }
    } else {
        // No cached style - remove speculative classes and reveal page immediately
        document.documentElement.classList.remove('has-project-style', 'project-style-speculative', 'project-style-pending');
        document.documentElement.classList.add('project-style-resolved');
        document.body.classList.remove('has-project-style', 'project-style-pending');
        document.body.classList.add('project-style-resolved');
    }

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Load project
    let projectName = null;
    if (!projectService.isProjectLoaded(projectId)) {
        const project = await projectRegistry.getProject(projectId);
        if (project) {
            projectName = project.name || project.instanceName || null;
            await projectService.loadProject(
                projectId,
                project.address || projectId,
                project.contractType || 'ERC1155'
            );
        }
    } else {
        const project = await projectRegistry.getProject(projectId);
        projectName = project?.name || project?.instanceName || null;
    }

    const adapter = projectService.getAdapter(projectId);
    if (!adapter) {
        appContainer.innerHTML = `
            <div class="error-page">
                <h1>Error</h1>
                <p>Failed to load contract adapter.</p>
                <a href="/" class="home-link">Go Home</a>
            </div>
        `;
        return;
    }

    // Create container
    const detailContainer = document.createElement('div');
    detailContainer.className = 'edition-detail-container';
    appContainer.appendChild(detailContainer);

    // Render EditionDetail
    render(h(EditionDetail, { projectId, editionId, adapter, projectName }), detailContainer);

    return {
        cleanup: () => {
            unmountRoot(detailContainer);
            stylesheetLoader.unload('erc1155-styles');
            document.body.classList.remove('v2-route');

            // Clean up project style classes
            document.documentElement.classList.remove('has-project-style', 'project-style-loaded', 'project-style-resolved', 'project-style-pending', 'project-style-speculative');
            document.body.classList.remove('has-project-style', 'project-style-loaded', 'project-style-resolved', 'project-style-pending');
            document.body.removeAttribute('data-project-style');

            const styleId = `project-style-${projectId}`;
            const link = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
            if (link) link.remove();
        }
    };
}
