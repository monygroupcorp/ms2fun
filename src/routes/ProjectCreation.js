import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';

/**
 * Project creation page route handler
 * Handles creating new project instances
 * Supports both:
 * - Old format: /create?factory=0x... (address-based)
 * - New format: /:chainId/:factoryTitle/create (title-based with chain ID)
 * @param {object} [params] - Route parameters (for new format)
 * @param {string|number} [params.chainId] - Chain ID for new format
 * @param {string} [params.factoryTitle] - Factory title slug for new format
 */
export async function renderProjectCreation(params = null) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    // Determine factory from route params or URL query string
    let factoryParam = null;
    let chainId = 1; // Default to Ethereum mainnet
    
    if (params && params.factoryTitle) {
        // New format: /:chainId/:factoryTitle/create
        chainId = params.chainId || 1;
        const projectRegistry = serviceFactory.getProjectRegistry();
        const factory = await projectRegistry.getFactoryByTitle(params.factoryTitle);
        if (factory) {
            factoryParam = factory.address;
        } else {
            console.error(`Factory not found for title: ${params.factoryTitle}`);
        }
    } else {
        // Old format: /create?factory=0x...
        const urlParams = new URLSearchParams(window.location.search);
        factoryParam = urlParams.get('factory');
    }

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

                            <div class="form-group">
                                <label for="image-uri">Image URL (optional):</label>
                                <input 
                                    type="url" 
                                    id="image-uri" 
                                    class="form-input" 
                                    data-ref="image-uri"
                                    placeholder="https://... or example.com/image.jpg"
                                />
                                <small class="form-hint">Project image or logo (https:// will be added if missing)</small>
                            </div>

                            <div class="form-group">
                                <label for="website-uri">Website (optional):</label>
                                <input 
                                    type="url" 
                                    id="website-uri" 
                                    class="form-input" 
                                    data-ref="website-uri"
                                    placeholder="https://... or example.com"
                                />
                                <small class="form-hint">https:// will be added if missing</small>
                            </div>

                            <div class="form-group">
                                <label for="twitter-uri">Twitter/X (optional):</label>
                                <input 
                                    type="text" 
                                    id="twitter-uri" 
                                    class="form-input" 
                                    data-ref="twitter-uri"
                                    placeholder="@username, username, or https://twitter.com/..."
                                />
                                <small class="form-hint">Will be converted to https://twitter.com/username</small>
                            </div>

                            <div class="form-group">
                                <label for="github-uri">GitHub (optional):</label>
                                <input 
                                    type="url" 
                                    id="github-uri" 
                                    class="form-input" 
                                    data-ref="github-uri"
                                    placeholder="https://github.com/... or github.com/user/repo"
                                />
                                <small class="form-hint">https:// will be added if missing</small>
                            </div>

                            <div class="form-group">
                                <label for="category">Category (optional):</label>
                                <input 
                                    type="text" 
                                    id="category" 
                                    class="form-input" 
                                    data-ref="category"
                                    placeholder="e.g., Art, Gaming, DeFi"
                                />
                            </div>

                            <div class="form-group">
                                <label for="tags">Tags (optional):</label>
                                <input 
                                    type="text" 
                                    id="tags" 
                                    class="form-input" 
                                    data-ref="tags"
                                    placeholder="tag1, tag2, tag3"
                                />
                                <small class="form-hint">Comma-separated tags</small>
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

    // Add real-time URL normalization and validation
    setupURLValidation(container, statusContainer);
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
    const imageURI = form.querySelector('[data-ref="image-uri"]');
    const websiteURI = form.querySelector('[data-ref="website-uri"]');
    const twitterURI = form.querySelector('[data-ref="twitter-uri"]');
    const githubURI = form.querySelector('[data-ref="github-uri"]');
    const category = form.querySelector('[data-ref="category"]');
    const tags = form.querySelector('[data-ref="tags"]');

    const factoryAddress = factorySelect.value;
    const name = projectName.value.trim();
    const symbol = projectSymbol.value.trim().toUpperCase();
    const description = projectDescription.value.trim();
    const metadata = metadataURI.value.trim();
    
    // Parse optional metadata fields
    let image = imageURI.value.trim();
    let website = websiteURI.value.trim();
    let twitter = twitterURI.value.trim();
    let github = githubURI.value.trim();
    const categoryValue = category.value.trim();
    const tagsValue = tags.value.trim();
    
    // Normalize URLs (auto-fix, don't block)
    if (image) {
        image = normalizeURL(image);
    }
    
    if (website) {
        website = normalizeURL(website);
    }
    
    if (github) {
        github = normalizeURL(github);
    }
    
    // Normalize Twitter URI
    if (twitter) {
        twitter = normalizeTwitterURL(twitter);
    }
    
    // Validate image URL in background (non-blocking)
    if (image) {
        validateImageURL(image).then(isValid => {
            if (!isValid) {
                showStatus(statusContainer, 'warning', '⚠️ Image URL may not be valid or accessible. The project was still created successfully.');
            }
        }).catch(() => {
            // Silently fail - validation is optional
        });
    }
    
    // Parse tags
    const tagsArray = tagsValue ? tagsValue.split(',').map(t => t.trim()).filter(t => t) : [];

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

        // Create instance with all metadata
        const instanceAddress = await factoryService.createInstance(
            factoryAddress,
            name,
            symbol,
            {
                description: description || undefined,
                metadataURI: metadata || undefined,
                imageURI: image || undefined,
                websiteURI: website || undefined,
                twitterURI: twitter || undefined,
                githubURI: github || undefined,
                category: categoryValue || undefined,
                tags: tagsArray.length > 0 ? tagsArray : undefined,
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
 * Setup real-time URL validation and normalization
 * @param {HTMLElement} container - Form container
 * @param {HTMLElement} statusContainer - Status message container
 */
function setupURLValidation(container, statusContainer) {
    const imageInput = container.querySelector('[data-ref="image-uri"]');
    const websiteInput = container.querySelector('[data-ref="website-uri"]');
    const twitterInput = container.querySelector('[data-ref="twitter-uri"]');
    const githubInput = container.querySelector('[data-ref="github-uri"]');

    // Image URL validation on blur
    if (imageInput) {
        let validationTimeout = null;
        imageInput.addEventListener('blur', async () => {
            const value = imageInput.value.trim();
            if (!value) return;

            // Clear any existing timeout
            if (validationTimeout) {
                clearTimeout(validationTimeout);
            }

            // Normalize the URL
            const normalized = normalizeURL(value);
            if (normalized !== value) {
                imageInput.value = normalized;
            }

            // Validate image (with debounce)
            validationTimeout = setTimeout(async () => {
                const isValid = await validateImageURL(normalized);
                if (!isValid) {
                    showStatus(statusContainer, 'warning', '⚠️ Image URL may not be valid or accessible. You can still submit the form.');
                } else {
                    // Clear warning if validation passes
                    if (statusContainer && statusContainer.classList.contains('warning')) {
                        statusContainer.style.display = 'none';
                    }
                }
            }, 500);
        });
    }

    // Website URL normalization on blur
    if (websiteInput) {
        websiteInput.addEventListener('blur', () => {
            const value = websiteInput.value.trim();
            if (value && !value.match(/^https?:\/\//i)) {
                websiteInput.value = normalizeURL(value);
            }
        });
    }

    // Twitter URL normalization on blur
    if (twitterInput) {
        twitterInput.addEventListener('blur', () => {
            const value = twitterInput.value.trim();
            if (value) {
                twitterInput.value = normalizeTwitterURL(value);
            }
        });
    }

    // GitHub URL normalization on blur
    if (githubInput) {
        githubInput.addEventListener('blur', () => {
            const value = githubInput.value.trim();
            if (value && !value.match(/^https?:\/\//i)) {
                githubInput.value = normalizeURL(value);
            }
        });
    }
}

/**
 * Normalize URL - add https:// if missing
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
function normalizeURL(url) {
    if (!url) return '';
    
    url = url.trim();
    
    // If it already has a protocol, return as-is
    if (url.match(/^https?:\/\//i)) {
        return url;
    }
    
    // If it starts with //, add https:
    if (url.startsWith('//')) {
        return `https:${url}`;
    }
    
    // Otherwise, add https://
    return `https://${url}`;
}

/**
 * Normalize Twitter URL
 * @param {string} twitter - Twitter handle or URL
 * @returns {string} Normalized Twitter URL
 */
function normalizeTwitterURL(twitter) {
    if (!twitter) return '';
    
    twitter = twitter.trim();
    
    // If it's already a full URL, normalize it
    if (twitter.match(/^https?:\/\//i)) {
        // Normalize twitter.com or x.com to twitter.com
        twitter = twitter.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://twitter.com');
        return twitter;
    }
    
    // If it starts with @, remove it
    if (twitter.startsWith('@')) {
        twitter = twitter.substring(1);
    }
    
    // Remove any leading/trailing slashes
    twitter = twitter.replace(/^\/+|\/+$/g, '');
    
    // Build Twitter URL
    return `https://twitter.com/${twitter}`;
}

/**
 * Validate image URL by attempting to load it
 * @param {string} imageURL - Image URL to validate
 * @returns {Promise<boolean>} True if image loads successfully
 */
async function validateImageURL(imageURL) {
    if (!imageURL) return false;
    
    try {
        const img = new Image();
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, 5000); // 5 second timeout
            
            img.onload = () => {
                clearTimeout(timeout);
                resolve(true);
            };
            
            img.onerror = () => {
                clearTimeout(timeout);
                resolve(false);
            };
            
            img.src = imageURL;
        });
    } catch (error) {
        console.warn('Error validating image URL:', error);
        return false;
    }
}

/**
 * Show status message
 */
function showStatus(container, type, message) {
    if (!container) return;

    container.style.display = 'block';
    container.className = `creation-status ${type}`;
    const icon = type === 'error' ? '❌' : type === 'success' ? '✓' : type === 'warning' ? '⚠️' : 'ℹ️';
    container.innerHTML = `
        <div class="status-message">
            ${icon}
            <span>${message}</span>
        </div>
    `;
}

