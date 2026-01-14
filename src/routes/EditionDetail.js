import stylesheetLoader from '../utils/stylesheetLoader.js';
import { EditionDetail } from '../components/ERC1155/EditionDetail.js';
import serviceFactory from '../services/ServiceFactory.js';

/**
 * Edition detail page route handler
 * Supports both old format (/project/:projectId/edition/:editionId) and new format (/:chainId/:instanceName/:pieceTitle)
 * @param {object} params - Route parameters
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
        // Old format: /project/:projectId/edition/:editionId
        projectId = params.projectId;
        editionId = params.editionId;
    } else if (params.instanceName && params.pieceTitle) {
        // New format: /:chainId/:instanceName/:pieceTitle
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

        // Load project to get adapter
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

        // Find edition by piece title
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

    // Load ERC1155 stylesheet
    stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
    stylesheetLoader.load('src/routes/project-detail.css', 'project-detail-styles');

    // Unload other page styles
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

    // Create container for EditionDetail component
    const detailContainer = document.createElement('div');
    detailContainer.className = 'edition-detail-container';
    appContainer.appendChild(detailContainer);

    // Mount EditionDetail component
    const editionDetailComponent = new EditionDetail(projectId, editionId, adapter);
    editionDetailComponent.mount(detailContainer);

    // Return cleanup function
    return {
        cleanup: () => {
            editionDetailComponent.unmount();
            stylesheetLoader.unload('erc1155-styles');
            stylesheetLoader.unload('project-detail-styles');
        }
    };
}
