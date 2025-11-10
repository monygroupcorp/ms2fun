import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';

/**
 * Project creation page route handler
 * Handles creating new project instances
 */
export async function renderProjectCreation() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    // Get factory from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const factoryParam = urlParams.get('factory');

    // Load stylesheet
    stylesheetLoader.load('src/routes/project-creation.css', 'project-creation-styles');
    
    // Unload other page styles
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('home-styles');
    stylesheetLoader.unload('project-detail-styles');
    stylesheetLoader.unload('factory-detail-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';
    
    // Show loading state while fetching factories
    appContainer.innerHTML = `
        <div class="project-creation">
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading factories...</p>
            </div>
        </div>
    `;

    try {
        // Load factories
        const masterService = serviceFactory.getMasterService();
        const factoryAddresses = await masterService.getAuthorizedFactories();
        
        const factories = [];
        for (const address of factoryAddresses) {
            const type = await masterService.getFactoryType(address);
            factories.push({ address, type });
        }

        // Determine selected factory
        let selectedFactory = null;
        if (factoryParam) {
            // Validate that the factory is authorized
            const isAuthorized = await masterService.isFactoryAuthorized(factoryParam);
            if (isAuthorized) {
                selectedFactory = factoryParam;
            } else {
                console.warn(`Factory ${factoryParam} is not authorized, using default`);
            }
        }
        
        // Fall back to first factory if no valid factory param
        if (!selectedFactory && factories.length > 0) {
            selectedFactory = factories[0].address;
        }

        // Render creation form
        appContainer.innerHTML = `
            <div class="project-creation">
                <div class="creation-header">
                    <h1>Create New Project</h1>
                    <button class="back-button" data-ref="back-button">← Back</button>
                </div>

                <div class="creation-form-container">
                    <form class="creation-form" data-ref="creation-form">
                        <div class="form-section">
                            <h2>Factory Selection</h2>
                            <div class="form-group">
                                <label for="factory-select">Factory:</label>
                                <select id="factory-select" class="form-select" data-ref="factory-select" required>
                                    ${factories.map(factory => `
                                        <option value="${factory.address}" ${factory.address === selectedFactory ? 'selected' : ''}>
                                            ${factory.type} - ${factory.address.slice(0, 10)}...
                                        </option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>

                        <div class="form-section">
                            <h2>Project Details</h2>
                            <div class="form-group">
                                <label for="project-name">Project Name <span class="required">*</span>:</label>
                                <input 
                                    type="text" 
                                    id="project-name" 
                                    class="form-input" 
                                    data-ref="project-name"
                                    placeholder="Enter project name"
                                    required
                                />
                            </div>

                            <div class="form-group">
                                <label for="project-symbol">Symbol <span class="required">*</span>:</label>
                                <input 
                                    type="text" 
                                    id="project-symbol" 
                                    class="form-input" 
                                    data-ref="project-symbol"
                                    placeholder="e.g., CULT"
                                    pattern="[A-Z0-9]{3,10}"
                                    title="3-10 uppercase letters or numbers"
                                    required
                                />
                                <small class="form-hint">3-10 uppercase letters or numbers</small>
                            </div>

                            <div class="form-group">
                                <label for="project-description">Description:</label>
                                <textarea 
                                    id="project-description" 
                                    class="form-textarea" 
                                    data-ref="project-description"
                                    placeholder="Enter project description (optional)"
                                    rows="4"
                                ></textarea>
                            </div>

                            <div class="form-group">
                                <label for="metadata-uri">Metadata URI (optional):</label>
                                <input 
                                    type="text" 
                                    id="metadata-uri" 
                                    class="form-input" 
                                    data-ref="metadata-uri"
                                    placeholder="https://..."
                                />
                                <small class="form-hint">Leave empty to auto-generate</small>
                            </div>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="submit-button" data-ref="submit-button">
                                Create Project
                            </button>
                            <button type="button" class="cancel-button" data-ref="cancel-button">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>

                <div class="creation-status" data-ref="status-container" style="display: none;">
                    <!-- Status messages will appear here -->
                </div>
            </div>
        `;

        // Setup event listeners
        setupEventListeners(appContainer, selectedFactory);

    } catch (error) {
        console.error('Error loading project creation page:', error);
        appContainer.innerHTML = `
            <div class="project-creation">
                <div class="error-state">
                    <h2>Error</h2>
                    <p class="error-message">${error.message || 'Failed to load creation form'}</p>
                    <button class="back-button" data-ref="back-button">← Back</button>
                </div>
            </div>
        `;
        setupEventListeners(appContainer);
    }
    
    // Return cleanup function
    return {
        cleanup: () => {
            // Unload stylesheet
            stylesheetLoader.unload('project-creation-styles');
        }
    };
}

/**
 * Setup event listeners for project creation page
 */
function setupEventListeners(container, initialFactory) {
    const form = container.querySelector('[data-ref="creation-form"]');
    const factorySelect = container.querySelector('[data-ref="factory-select"]');
    const backButton = container.querySelector('[data-ref="back-button"]');
    const cancelButton = container.querySelector('[data-ref="cancel-button"]');
    const statusContainer = container.querySelector('[data-ref="status-container"]');

    if (backButton) {
        backButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/');
            } else {
                window.location.href = '/';
            }
        });
    }

    if (cancelButton) {
        cancelButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/');
            } else {
                window.location.href = '/';
            }
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleFormSubmit(form, statusContainer);
        });
    }

    // Update form based on factory selection
    if (factorySelect) {
        factorySelect.addEventListener('change', () => {
            // Could update form fields based on factory type here
            // For now, just store the selected factory
        });
    }
}

/**
 * Handle form submission
 */
async function handleFormSubmit(form, statusContainer) {
    const submitButton = form.querySelector('[data-ref="submit-button"]');
    const factorySelect = form.querySelector('[data-ref="factory-select"]');
    const projectName = form.querySelector('[data-ref="project-name"]');
    const projectSymbol = form.querySelector('[data-ref="project-symbol"]');
    const projectDescription = form.querySelector('[data-ref="project-description"]');
    const metadataURI = form.querySelector('[data-ref="metadata-uri"]');

    const factoryAddress = factorySelect.value;
    const name = projectName.value.trim();
    const symbol = projectSymbol.value.trim().toUpperCase();
    const description = projectDescription.value.trim();
    const metadata = metadataURI.value.trim();

    // Validate
    if (!name || !symbol) {
        showStatus(statusContainer, 'error', 'Please fill in all required fields.');
        return;
    }

    if (symbol.length < 3 || symbol.length > 10) {
        showStatus(statusContainer, 'error', 'Symbol must be 3-10 characters.');
        return;
    }

    // Show loading state
    submitButton.disabled = true;
    submitButton.textContent = 'Creating...';
    showStatus(statusContainer, 'info', 'Creating project instance...');

    try {
        const factoryService = serviceFactory.getFactoryService();
        const projectRegistry = serviceFactory.getProjectRegistry();

        // Create instance
        const instanceAddress = await factoryService.createInstance(
            factoryAddress,
            name,
            symbol,
            {
                description: description || undefined,
                metadataURI: metadata || undefined,
                creator: '0xCREATOR0000000000000000000000000000000000' // Mock creator
            }
        );

        // Index the new project
        await projectRegistry.indexProject(instanceAddress);

        // Show success
        showStatus(statusContainer, 'success', `Project created successfully! Instance address: ${instanceAddress}`);

        // Navigate to project detail after a short delay
        setTimeout(() => {
            if (window.router) {
                window.router.navigate(`/project/${instanceAddress}`);
            } else {
                window.location.href = `/project/${instanceAddress}`;
            }
        }, 2000);

    } catch (error) {
        console.error('Error creating project:', error);
        showStatus(statusContainer, 'error', `Failed to create project: ${error.message}`);
        submitButton.disabled = false;
        submitButton.textContent = 'Create Project';
    }
}

/**
 * Show status message
 */
function showStatus(container, type, message) {
    if (!container) return;

    container.style.display = 'block';
    container.className = `creation-status ${type}`;
    container.innerHTML = `
        <div class="status-message">
            ${type === 'error' ? '❌' : type === 'success' ? '✓' : 'ℹ️'}
            <span>${message}</span>
        </div>
    `;
}

