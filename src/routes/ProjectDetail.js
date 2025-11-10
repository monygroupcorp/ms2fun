import stylesheetLoader from '../utils/stylesheetLoader.js';
import { ProjectDetail } from '../components/ProjectDetail/ProjectDetail.js';
import serviceFactory from '../services/ServiceFactory.js';

/**
 * Project detail page route handler
 * Supports both:
 * - Old format: /project/:id (address-based)
 * - New format: /:chainId/:factoryTitle/:instanceName (title-based with chain ID)
 * @param {object} params - Route parameters
 * @param {string} [params.id] - Project ID (instance address) for old format
 * @param {string|number} [params.chainId] - Chain ID for new format
 * @param {string} [params.factoryTitle] - Factory title slug for new format
 * @param {string} [params.instanceName] - Instance name slug for new format
 */
export async function renderProjectDetail(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    let projectId = null;
    let chainId = null;
    const projectRegistry = serviceFactory.getProjectRegistry();

    // Check if params has address (old format) or title/name (new format)
    if (params?.id) {
        // Old format: /project/:id (address)
        projectId = params.id;
        chainId = 1; // Default to Ethereum mainnet for old format
    } else if (params?.chainId && params?.factoryTitle && params?.instanceName) {
        // New format: /:chainId/:factoryTitle/:instanceName
        chainId = params.chainId;
        const projectData = await projectRegistry.getProjectByPath(
            params.factoryTitle,
            params.instanceName
        );
        
        if (!projectData || !projectData.instance) {
            // Show 404
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>404 - Project Not Found</h1>
                    <p>The project "${params.chainId}/${params.factoryTitle}/${params.instanceName}" does not exist.</p>
                    <a href="/" class="home-link">Go Home</a>
                </div>
            `;
            return;
        }
        
        projectId = projectData.instance.address;
    } else {
        console.error('Project ID or path not provided');
        appContainer.innerHTML = `
            <div class="error-page">
                <h1>400 - Bad Request</h1>
                <p>Invalid project identifier.</p>
                <a href="/" class="home-link">Go Home</a>
            </div>
        `;
        return;
    }

    if (!projectId) {
        console.error('Project ID not resolved');
        return;
    }
    
    // Get project to determine contract type for CSS loading
    let contractType = null;
    try {
        const project = await projectRegistry.getProject(projectId);
        if (project) {
            contractType = project.contractType;
        }
    } catch (error) {
        console.warn('[ProjectDetail route] Could not get project for CSS loading:', error);
    }
    
    // Load project detail stylesheet
    stylesheetLoader.load('src/routes/project-detail.css', 'project-detail-styles');
    
    // Load WalletDisplay stylesheet
    stylesheetLoader.load('src/components/WalletDisplay/WalletDisplay.css', 'wallet-display-styles');
    
    // Load contract-type-specific CSS
    if (contractType === 'ERC1155') {
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
    } else if (contractType === 'ERC404') {
        // ERC404 styles would be loaded here if needed
    }
    
    // Unload other page styles
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';
    
    // Create container for ProjectDetail
    const detailContainer = document.createElement('div');
    detailContainer.id = 'project-detail-container';
    appContainer.appendChild(detailContainer);
    
    // Mount ProjectDetail component
    const projectDetail = new ProjectDetail(projectId);
    projectDetail.mount(detailContainer);
    
    // Return cleanup function
    return {
        cleanup: () => {
            // Unmount ProjectDetail component
            if (projectDetail && typeof projectDetail.unmount === 'function') {
                projectDetail.unmount();
            }
            // Unload stylesheet
            stylesheetLoader.unload('project-detail-styles');
        }
    };
}

