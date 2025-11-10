import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import { EditionDetail } from '../components/ERC1155/EditionDetail.js';

/**
 * ERC1155 piece detail route handler (triple endpoint with chain ID)
 * @param {object} params - Route parameters
 * @param {string|number} params.chainId - Chain ID
 * @param {string} params.factoryTitle - Factory title slug
 * @param {string} params.instanceName - Instance name slug
 * @param {string} params.pieceTitle - Piece title slug
 */
export async function renderPieceDetail(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    const { chainId, factoryTitle, instanceName, pieceTitle } = params;
    
    if (!chainId || !factoryTitle || !instanceName || !pieceTitle) {
        console.error('Missing required parameters for piece detail');
        appContainer.innerHTML = `
            <div class="error-page">
                <h1>400 - Bad Request</h1>
                <p>Missing required parameters for piece detail.</p>
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

    // Load project with piece
    const projectRegistry = serviceFactory.getProjectRegistry();
    const projectService = serviceFactory.getProjectService();
    
    try {
        const projectData = await projectRegistry.getProjectByPath(
            factoryTitle,
            instanceName,
            pieceTitle
        );

        if (!projectData || !projectData.piece) {
            appContainer.innerHTML = `
                <div class="error-page">
                    <h1>404 - Piece Not Found</h1>
                    <p>The piece "${chainId}/${factoryTitle}/${instanceName}/${pieceTitle}" does not exist.</p>
                    <a href="/" class="home-link">Go Home</a>
                </div>
            `;
            return;
        }

        const { factory, instance, piece } = projectData;
        const projectId = instance.address || instance.contractAddress;
        const contractType = instance.contractType || 'ERC1155';

        // Ensure project is loaded in ProjectService
        if (!projectService.isProjectLoaded(projectId)) {
            await projectService.loadProject(
                projectId,
                projectId,
                contractType
            );
        }

        // Get adapter
        const adapter = projectService.getAdapter(projectId);
        if (!adapter) {
            throw new Error('Failed to load contract adapter');
        }

        // Find edition ID from piece data
        // The piece should have an editionId, or we need to find it by matching the piece title
        let editionId = piece.editionId;
        
        // If editionId is not directly available, try to find it by matching piece title
        if (editionId === undefined || editionId === null) {
            try {
                const editions = await adapter.getEditions();
                const matchingEdition = editions.find(e => {
                    const editionName = e.metadata?.name || `Edition #${e.id}`;
                    const pieceName = piece.displayTitle || piece.title;
                    // Compare slugified versions
                    const editionSlug = editionName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    const pieceSlug = pieceName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    return editionSlug === pieceSlug;
                });
                
                if (matchingEdition) {
                    editionId = matchingEdition.id;
                } else if (editions.length > 0) {
                    // Fallback to first edition if we can't match
                    console.warn('[PieceDetail] Could not match piece title to edition, using first edition');
                    editionId = editions[0].id;
                }
            } catch (error) {
                console.warn('[PieceDetail] Failed to get editions for matching:', error);
            }
        }

        if (editionId === undefined || editionId === null) {
            throw new Error('Could not determine edition ID');
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

    } catch (error) {
        console.error('Error loading piece detail:', error);
        appContainer.innerHTML = `
            <div class="error-page">
                <h1>Error</h1>
                <p class="error-message">${error.message || 'Failed to load piece information'}</p>
                <a href="/" class="home-link">Go Home</a>
            </div>
        `;
    }
}

