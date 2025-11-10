import stylesheetLoader from '../utils/stylesheetLoader.js';
import { EditionDetail } from '../components/ERC1155/EditionDetail.js';
import serviceFactory from '../services/ServiceFactory.js';

/**
 * Edition detail page route handler
 * Route: /project/:projectId/edition/:editionId
 * @param {object} params - Route parameters
 * @param {string} params.projectId - Project ID (contract address)
 * @param {string|number} params.editionId - Edition ID
 */
export async function renderEditionDetail(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    const { projectId, editionId } = params;
    
    if (!projectId || editionId === undefined || editionId === null) {
        console.error('Missing required parameters for edition detail');
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
    stylesheetLoader.load('src/components/WalletDisplay/WalletDisplay.css', 'wallet-display-styles');
    
    // Unload other page styles
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    try {
        // Get project service and load project
        const projectService = serviceFactory.getProjectService();
        const projectRegistry = serviceFactory.getProjectRegistry();
        
        // Get project data
        const project = await projectRegistry.getProject(projectId);
        if (!project) {
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>404 - Project Not Found</h1>
                    <p>The project "${projectId}" does not exist.</p>
                    <a href="/" class="home-link">Go Home</a>
                </div>
            `;
            return;
        }

        // Ensure project is loaded in ProjectService
        const contractAddress = project.contractAddress || project.address || projectId;
        const contractType = project.contractType || 'ERC1155';
        
        if (!projectService.isProjectLoaded(projectId)) {
            await projectService.loadProject(
                projectId,
                contractAddress,
                contractType
            );
        }

        // Get adapter
        const adapter = projectService.getAdapter(projectId);
        if (!adapter) {
            throw new Error('Failed to load contract adapter');
        }

        // Parse edition ID (should be a number)
        const editionIdNum = parseInt(editionId, 10);
        if (isNaN(editionIdNum)) {
            throw new Error('Invalid edition ID');
        }

        // Create container for EditionDetail component
        const detailContainer = document.createElement('div');
        detailContainer.className = 'edition-detail-container';
        appContainer.appendChild(detailContainer);

        // Mount EditionDetail component
        const editionDetailComponent = new EditionDetail(projectId, editionIdNum, adapter);
        editionDetailComponent.mount(detailContainer);

        // Return cleanup function
        return {
            cleanup: () => {
                editionDetailComponent.unmount();
                stylesheetLoader.unload('erc1155-styles');
                stylesheetLoader.unload('project-detail-styles');
            }
        };

    } catch (error) {
        console.error('Error loading edition detail:', error);
        appContainer.innerHTML = `
            <div class="error-page">
                <h1>Error</h1>
                <p class="error-message">${error.message || 'Failed to load edition information'}</p>
                <a href="/project/${projectId}" class="home-link">← Back to Project</a>
            </div>
        `;
    }
}

