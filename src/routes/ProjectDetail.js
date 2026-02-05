import stylesheetLoader from '../utils/stylesheetLoader.js';
import { h, render, unmountRoot } from '../core/microact-setup.js';
import { ProjectDetail } from '../components/ProjectDetail/ProjectDetail.microact.js';
import serviceFactory from '../services/ServiceFactory.js';

/**
 * Project detail page route handler
 * Supports both:
 * - Old format: /project/:id (address-based)
 * - New format: /:chainId/:factoryTitle/:instanceName (title-based with chain ID)
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
        projectId = params.id;
        chainId = 1;
    } else if (params?.chainId && params?.instanceName) {
        chainId = params.chainId;

        const projectData = params.factoryTitle
            ? await projectRegistry.getProjectByPath(params.factoryTitle, params.instanceName)
            : await projectRegistry.getProjectByName(params.instanceName);

        if (!projectData || !projectData.instance) {
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

    // Load stylesheets
    stylesheetLoader.load('src/routes/project-detail.css', 'project-detail-styles');

    if (contractType === 'ERC1155') {
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
    }

    // Handle cached project style
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
                ? cachedStyleUri
                : '/' + cachedStyleUri;
            link.setAttribute('data-stylesheet-id', styleId);
            link.onload = () => {
                document.documentElement.classList.add('project-style-loaded');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.add('project-style-loaded');
                document.body.classList.add('project-style-resolved');
            };
            link.onerror = () => {
                document.documentElement.classList.add('project-style-resolved');
                document.documentElement.classList.remove('has-project-style');
                document.body.classList.add('project-style-resolved');
                document.body.classList.remove('has-project-style');
            };
            document.head.appendChild(link);
            await new Promise(resolve => requestAnimationFrame(resolve));
        } else {
            document.documentElement.classList.add('project-style-loaded');
            document.documentElement.classList.add('project-style-resolved');
            document.body.classList.add('project-style-loaded');
            document.body.classList.add('project-style-resolved');
        }
    } else {
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

    // Create container
    const detailContainer = document.createElement('div');
    detailContainer.id = 'project-detail-container';
    appContainer.appendChild(detailContainer);

    // Render ProjectDetail
    render(h(ProjectDetail, { projectId }), detailContainer);

    // Return cleanup function
    return {
        cleanup: () => {
            unmountRoot(detailContainer);
            stylesheetLoader.unload('project-detail-styles');

            // Clean up project style classes
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

            const styleId = `project-style-${projectId}`;
            const link = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
            if (link) {
                link.remove();
            }
        }
    };
}
