import stylesheetLoader from '../utils/stylesheetLoader.js';
import { h, render, unmountRoot } from '../core/microact-setup.js';
import serviceFactory from '../services/ServiceFactory.js';
import { EditionDetail } from '../components/ERC1155/EditionDetail.microact.js';

/**
 * ERC1155 piece detail route handler
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

    // Load stylesheets
    stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
    stylesheetLoader.load('src/routes/project-detail.css', 'project-detail-styles');

    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    const projectRegistry = serviceFactory.getProjectRegistry();
    const projectService = serviceFactory.getProjectService();

    let detailContainer = null;

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

        const { instance, piece } = projectData;
        const projectId = instance.address || instance.contractAddress;
        const contractType = instance.contractType || 'ERC1155';

        if (!projectService.isProjectLoaded(projectId)) {
            await projectService.loadProject(projectId, projectId, contractType);
        }

        const adapter = projectService.getAdapter(projectId);
        if (!adapter) {
            throw new Error('Failed to load contract adapter');
        }

        let editionId = piece.editionId;

        if (editionId === undefined || editionId === null) {
            try {
                const editions = await adapter.getEditions();
                const matchingEdition = editions.find(e => {
                    const editionName = e.metadata?.name || `Edition #${e.id}`;
                    const pieceName = piece.displayTitle || piece.title;
                    const editionSlug = editionName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    const pieceSlug = pieceName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    return editionSlug === pieceSlug;
                });

                if (matchingEdition) {
                    editionId = matchingEdition.id;
                } else if (editions.length > 0) {
                    console.warn('[PieceDetail] Could not match piece title, using first edition');
                    editionId = editions[0].id;
                }
            } catch (error) {
                console.warn('[PieceDetail] Failed to get editions:', error);
            }
        }

        if (editionId === undefined || editionId === null) {
            throw new Error('Could not determine edition ID');
        }

        // Create container and render
        detailContainer = document.createElement('div');
        detailContainer.className = 'edition-detail-container';
        appContainer.appendChild(detailContainer);

        render(h(EditionDetail, { projectId, editionId, adapter }), detailContainer);

        return {
            cleanup: () => {
                if (detailContainer) {
                    unmountRoot(detailContainer);
                }
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
