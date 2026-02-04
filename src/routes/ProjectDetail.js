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
    } else if (params?.chainId && params?.instanceName) {
        // New format: /:chainId/:instanceName or /:chainId/:factoryTitle/:instanceName
        chainId = params.chainId;

        // Check if this is 2-part (/:chainId/:instanceName) or 3-part (/:chainId/:factoryTitle/:instanceName)
        const projectData = params.factoryTitle
            ? await projectRegistry.getProjectByPath(params.factoryTitle, params.instanceName)
            : await projectRegistry.getProjectByName(params.instanceName);

        if (!projectData || !projectData.instance) {
            // Show 404
            const path = params.factoryTitle
                ? `${params.chainId}/${params.factoryTitle}/${params.instanceName}`
                : `${params.chainId}/${params.instanceName}`;
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>404 - Project Not Found</h1>
                    <p>The project "${path}" does not exist.</p>
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

    // Load contract-type-specific CSS
    if (contractType === 'ERC1155') {
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
    } else if (contractType === 'ERC404') {
        // ERC404 styles would be loaded here if needed
    }

    // CRITICAL: Check for cached project style and preload BEFORE rendering
    // This prevents flash of default styles
    const cachedStyleUri = localStorage.getItem(`projectStyle:${projectId}`);
    if (cachedStyleUri) {
        // Add class to both html and body (html may already have it from inline script)
        document.documentElement.classList.add('has-project-style');
        document.body.classList.add('has-project-style');
        document.body.setAttribute('data-project-style', projectId);

        // Preload the stylesheet
        const styleId = `project-style-${projectId}`;
        const existingLink = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
        if (!existingLink) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cachedStyleUri.startsWith('/') || cachedStyleUri.startsWith('http')
                ? cachedStyleUri
                : '/' + cachedStyleUri;
            link.setAttribute('data-stylesheet-id', styleId);
            link.onload = () => {
                // Add loaded/resolved to both html and body
                document.documentElement.classList.add('project-style-loaded');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.add('project-style-loaded');
                document.body.classList.add('project-style-resolved');
            };
            link.onerror = () => {
                // Style failed to load, resolve anyway to show content
                document.documentElement.classList.add('project-style-resolved');
                document.documentElement.classList.remove('has-project-style');
                document.body.classList.add('project-style-resolved');
                document.body.classList.remove('has-project-style');
            };
            document.head.appendChild(link);

            // Wait a frame for CSS to apply before continuing
            await new Promise(resolve => requestAnimationFrame(resolve));
        } else {
            // Already loaded
            document.documentElement.classList.add('project-style-loaded');
            document.documentElement.classList.add('project-style-resolved');
            document.body.classList.add('project-style-loaded');
            document.body.classList.add('project-style-resolved');
        }
    } else {
        // No cached style for this project
        // Remove speculative/pending classes and revert to default marble style
        document.documentElement.classList.remove('has-project-style');
        document.documentElement.classList.remove('project-style-speculative');
        document.documentElement.classList.remove('project-style-pending');
        document.documentElement.classList.add('project-style-resolved');
        document.body.classList.remove('has-project-style');
        document.body.classList.remove('project-style-pending');
        document.body.classList.add('project-style-resolved');
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
            // Unload stylesheets
            stylesheetLoader.unload('project-detail-styles');

            // Clean up project style classes from both html and body
            document.documentElement.classList.remove('has-project-style');
            document.documentElement.classList.remove('project-style-loaded');
            document.documentElement.classList.remove('project-style-resolved');
            document.documentElement.classList.remove('project-style-pending');
            document.documentElement.classList.remove('project-style-speculative');
            document.body.classList.remove('has-project-style');
            document.body.classList.remove('project-style-loaded');
            document.body.classList.remove('project-style-resolved');
            document.body.classList.remove('project-style-pending');
            document.body.removeAttribute('data-project-style');

            // Unload project-specific stylesheet
            const styleId = `project-style-${projectId}`;
            const link = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
            if (link) {
                link.remove();
            }
        }
    };
}

