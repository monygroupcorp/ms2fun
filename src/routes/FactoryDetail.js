import stylesheetLoader from '../utils/stylesheetLoader.js';
import { h, render, unmountRoot } from '../core/microact-setup.js';
import serviceFactory from '../services/ServiceFactory.js';
import { ProjectCard } from '../components/ProjectDiscovery/ProjectCard.microact.js';

/**
 * Factory detail page route handler
 */
export async function renderFactoryDetail(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    const factoryId = params?.id;
    if (!factoryId) {
        console.error('Factory ID not provided');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/routes/factory-detail.css', 'factory-detail-styles');

    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');
    stylesheetLoader.unload('project-detail-styles');

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Track card containers for cleanup
    const cardContainers = [];

    // Show loading state
    appContainer.innerHTML = `
        <div class="factory-detail">
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading factory information...</p>
            </div>
        </div>
    `;

    try {
        const masterService = serviceFactory.getMasterService();
        const factoryService = serviceFactory.getFactoryService();
        const projectRegistry = serviceFactory.getProjectRegistry();

        const factoryType = await masterService.getFactoryType(factoryId);
        const isAuthorized = await masterService.isFactoryAuthorized(factoryId);
        const instanceAddresses = await factoryService.getInstances(factoryId);
        const instanceCount = instanceAddresses.length;

        const instances = [];
        for (const address of instanceAddresses) {
            const project = await projectRegistry.getProject(address);
            if (project) {
                instances.push(project);
            }
        }

        const createURL = await getCreateURL(factoryId);

        appContainer.innerHTML = `
            <div class="factory-detail">
                <div class="factory-header">
                    <h1>Factory Details</h1>
                    <button class="back-button" data-ref="back-button">← Back to Projects</button>
                </div>

                <div class="factory-info">
                    <div class="info-section">
                        <h2>Factory Information</h2>
                        <div class="info-item">
                            <span class="info-label">Factory Address:</span>
                            <span class="info-value address">${factoryId}</span>
                            <button class="copy-button" data-ref="copy-address" aria-label="Copy address">📋</button>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Contract Type:</span>
                            <span class="info-value">
                                <span class="contract-type-badge ${(factoryType || '').toLowerCase()}">${factoryType || 'Unknown'}</span>
                            </span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Status:</span>
                            <span class="info-value ${isAuthorized ? 'authorized' : 'unauthorized'}">
                                ${isAuthorized ? '✓ Authorized' : '✗ Unauthorized'}
                            </span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Instances Created:</span>
                            <span class="info-value">${instanceCount}</span>
                        </div>
                    </div>

                    <div class="actions-section">
                        <a href="${createURL}" class="create-instance-button" data-ref="create-button">
                            Create New Instance
                        </a>
                    </div>
                </div>

                <div class="instances-section">
                    <h2>Instances (${instances.length})</h2>
                    ${instances.length === 0 ? `
                        <div class="empty-state">
                            <p>No instances created yet.</p>
                            <a href="${createURL}" class="create-instance-link">Create the first instance →</a>
                        </div>
                    ` : `
                        <div class="instances-grid" data-ref="instances-container"></div>
                    `}
                </div>
            </div>
        `;

        // Render instance cards
        if (instances.length > 0) {
            const instancesContainer = appContainer.querySelector('[data-ref="instances-container"]');
            if (instancesContainer) {
                instances.forEach((project) => {
                    const cardContainer = document.createElement('div');
                    instancesContainer.appendChild(cardContainer);
                    cardContainers.push(cardContainer);

                    render(h(ProjectCard, {
                        project,
                        onNavigate: (path) => {
                            if (window.router) {
                                window.router.navigate(path);
                            } else {
                                window.location.href = path;
                            }
                        }
                    }), cardContainer);
                });
            }
        }

        setupEventListeners(appContainer, factoryId);

    } catch (error) {
        console.error('Error loading factory detail:', error);
        appContainer.innerHTML = `
            <div class="factory-detail">
                <div class="error-state">
                    <h2>Error</h2>
                    <p class="error-message">${error.message || 'Failed to load factory information'}</p>
                    <button class="back-button" data-ref="back-button">← Back to Projects</button>
                </div>
            </div>
        `;
        setupEventListeners(appContainer);
    }

    return {
        cleanup: () => {
            cardContainers.forEach(container => unmountRoot(container));
            stylesheetLoader.unload('factory-detail-styles');
        }
    };
}

async function getCreateURL(factoryAddress) {
    try {
        if (serviceFactory.isUsingMock()) {
            const mockManager = serviceFactory.mockManager;
            if (mockManager) {
                const mockData = mockManager.getMockData();
                const factory = mockData?.factories?.[factoryAddress];
                if (factory) {
                    const factoryTitle = factory.title || factory.displayTitle;
                    if (factoryTitle) {
                        const chainId = 1;
                        const titleSlug = factoryTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                        return `/${chainId}/${titleSlug}/create`;
                    }
                }
            }
        }
    } catch (error) {
        console.warn('[FactoryDetail] Could not get factory title:', error);
    }
    return `/create?factory=${encodeURIComponent(factoryAddress)}`;
}

function setupEventListeners(container, factoryId) {
    const backButton = container.querySelector('[data-ref="back-button"]');
    const copyButton = container.querySelector('[data-ref="copy-address"]');
    const createButton = container.querySelector('[data-ref="create-button"]');
    const createLink = container.querySelector('.create-instance-link');

    if (backButton) {
        backButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/');
            } else {
                window.location.href = '/';
            }
        });
    }

    if (copyButton && factoryId) {
        copyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(factoryId).then(() => {
                copyButton.textContent = '✓';
                setTimeout(() => { copyButton.textContent = '📋'; }, 2000);
            }).catch(err => console.error('Failed to copy:', err));
        });
    }

    if (createButton) {
        createButton.addEventListener('click', (e) => {
            e.preventDefault();
            const href = createButton.getAttribute('href');
            if (window.router) {
                window.router.navigate(href);
            } else {
                window.location.href = href;
            }
        });
    }

    if (createLink) {
        createLink.addEventListener('click', (e) => {
            e.preventDefault();
            const href = createLink.getAttribute('href');
            if (window.router) {
                window.router.navigate(href);
            } else {
                window.location.href = href;
            }
        });
    }
}
