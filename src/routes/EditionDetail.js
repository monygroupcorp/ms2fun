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
    stylesheetLoader.load('src/routes/project-detail.css', 'project-detail-styles');

    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Load project
    if (!projectService.isProjectLoaded(projectId)) {
        const project = await projectRegistry.getProject(projectId);
        if (project) {
            await projectService.loadProject(
                projectId,
                project.address || projectId,
                project.contractType || 'ERC1155'
            );
        }
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
    render(h(EditionDetail, { projectId, editionId, adapter }), detailContainer);

    return {
        cleanup: () => {
            unmountRoot(detailContainer);
            stylesheetLoader.unload('erc1155-styles');
            stylesheetLoader.unload('project-detail-styles');
        }
    };
}
