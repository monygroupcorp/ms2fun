import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';

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

    // Load project detail stylesheet (reuse for now)
    stylesheetLoader.load('src/routes/project-detail.css', 'piece-detail-styles');
    
    // Unload other page styles
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Load project with piece
    const projectRegistry = serviceFactory.getProjectRegistry();
    
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

        // Render piece detail page
        appContainer.innerHTML = `
            <div class="piece-detail">
                <div class="piece-header">
                    <button class="back-button" data-ref="back-button">← Back to ${instance.displayName || instance.name}</button>
                    <h1>${piece.displayTitle || piece.title}</h1>
                </div>

                <div class="piece-info">
                    <div class="info-section">
                        <h2>Piece Information</h2>
                        <div class="info-item">
                            <span class="info-label">Collection:</span>
                            <span class="info-value">${instance.displayName || instance.name}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Factory:</span>
                            <span class="info-value">${factory.displayTitle || factory.title}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Edition ID:</span>
                            <span class="info-value">${piece.editionId || 'N/A'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Price:</span>
                            <span class="info-value">${piece.price || '0 ETH'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Supply:</span>
                            <span class="info-value">${piece.supply || 0}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Minted:</span>
                            <span class="info-value">${piece.minted || 0} / ${piece.supply || 0}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Setup event listeners
        const backButton = appContainer.querySelector('[data-ref="back-button"]');
        if (backButton) {
            backButton.addEventListener('click', () => {
                // Navigate back to instance
                const instanceURL = window.router 
                    ? window.router.generateURL(chainId, factory.title, instance.name)
                    : `/${chainId}/${factory.title}/${instance.name}`;
                
                if (window.router) {
                    window.router.navigate(instanceURL);
                } else {
                    window.location.href = instanceURL;
                }
            });
        }

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
    
    // Return cleanup function
    return {
        cleanup: () => {
            // Unload stylesheet
            stylesheetLoader.unload('piece-detail-styles');
        }
    };
}

