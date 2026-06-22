import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import walletService from '../services/WalletService.js';

const FACTORY_TYPES = [
    { id: 'erc404', label: 'ERC404 Bonding', description: 'Bonding curve tokens with NFT duality' },
    { id: 'erc1155', label: 'ERC1155 Editions', description: 'Multi-edition NFT collections with tiered pricing' },
    { id: 'erc721', label: 'ERC721 Auctions', description: 'Single-edition NFTs with auction mechanics' },
];

/**
 * Project creation page route handler
 * Cascading flow: factory type → alignment target → vault → project details → deploy
 * @param {object} [params] - Route parameters
 */
export async function renderProjectCreation(params = null) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
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

    const connectedAddress = walletService.getAddress();
    if (!connectedAddress) {
        appContainer.innerHTML = `
            <div class="project-creation">
                <div class="creation-header">
                    <div class="creation-header-content">
                        <h1>Create New Project</h1>
                        <p class="creation-subtitle">Connect your wallet to launch a project.</p>
                    </div>
                    <button class="back-button" data-ref="back-button">&larr; Back</button>
                </div>
                <p class="empty-state" style="text-align:center; padding: var(--spacing-6);">Please connect your wallet to create a project.</p>
            </div>
        `;
        setupBackButton(appContainer);
        return;
    }

    // Show loading state
    appContainer.innerHTML = `
        <div class="project-creation">
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading creation options...</p>
            </div>
        </div>
    `;

    try {
        // Load factories grouped by type
        const masterService = serviceFactory.getMasterService();
        const factoryAddresses = await masterService.getAuthorizedFactories();

        const factories = [];
        for (const address of factoryAddresses) {
            const type = await masterService.getFactoryType(address);
            factories.push({ address, type });
        }

        // Load alignment targets
        let alignmentTargets = [];
        try {
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
            if (masterAdapter && typeof masterAdapter.getAlignmentTargets === 'function') {
                alignmentTargets = await masterAdapter.getAlignmentTargets();
            }
        } catch (e) {
            console.warn('[ProjectCreation] Failed to load alignment targets:', e);
        }

        // Determine pre-selected factory from params/query
        let preselectedType = null;
        if (params && params.factoryTitle) {
            const projectRegistry = serviceFactory.getProjectRegistry();
            const factory = await projectRegistry.getFactoryByTitle(params.factoryTitle);
            if (factory) {
                const type = factories.find(f => f.address === factory.address)?.type;
                if (type) preselectedType = type.toLowerCase().includes('404') ? 'erc404' : type.toLowerCase().includes('1155') ? 'erc1155' : 'erc721';
            }
        }

        // Group factories by type
        const factoriesByType = {};
        for (const f of factories) {
            const typeKey = f.type.toLowerCase().includes('404') ? 'erc404' : f.type.toLowerCase().includes('1155') ? 'erc1155' : 'erc721';
            if (!factoriesByType[typeKey]) factoriesByType[typeKey] = [];
            factoriesByType[typeKey].push(f);
        }

        // Render the cascading form
        renderCascadingForm(appContainer, {
            factories,
            factoriesByType,
            alignmentTargets,
            preselectedType,
        });

    } catch (error) {
        console.error('Error loading project creation page:', error);
        appContainer.innerHTML = `
            <div class="project-creation">
                <div class="error-state">
                    <h2>Error</h2>
                    <p class="error-message">${error.message || 'Failed to load creation form'}</p>
                    <button class="back-button" data-ref="back-button">&larr; Back</button>
                </div>
            </div>
        `;
        setupBackButton(appContainer);
    }

    return {
        cleanup: () => {
            stylesheetLoader.unload('project-creation-styles');
        }
    };
}

/**
 * Render the cascading creation form
 */
function renderCascadingForm(container, { factories, factoriesByType, alignmentTargets, preselectedType }) {
    container.innerHTML = `
        <div class="project-creation">
            <div class="creation-header">
                <div class="creation-header-content">
                    <h1>Create New Project</h1>
                    <p class="creation-subtitle">Launch your project on-chain, bound to an alignment vault.</p>
                </div>
                <button class="back-button" data-ref="back-button">&larr; Back</button>
            </div>

            <div class="creation-form-container card">
                <form class="creation-form" data-ref="creation-form">

                    <!-- Step 1: Factory Type -->
                    <div class="form-section">
                        <div class="form-section-header">
                            <h2>1. Project Type</h2>
                            <p class="form-section-description">Choose the type of project you want to create.</p>
                        </div>
                        <div class="form-group">
                            <label for="factory-type-select" class="form-label required">Factory Type</label>
                            <select id="factory-type-select" class="form-select" data-ref="factory-type-select" required>
                                <option value="">Select project type...</option>
                                ${FACTORY_TYPES.map(ft => `
                                    <option value="${ft.id}" ${ft.id === preselectedType ? 'selected' : ''}>${ft.label} &mdash; ${ft.description}</option>
                                `).join('')}
                            </select>
                        </div>
                    </div>

                    <!-- Step 2: Alignment Target (hidden until type selected) -->
                    <div class="form-section" id="step-alignment" style="display: none;">
                        <div class="form-section-header">
                            <h2>2. Alignment Target</h2>
                            <p class="form-section-description">Select the community your project aligns with. This determines which vault options are available.</p>
                        </div>
                        <div class="form-group">
                            <label for="alignment-target-select" class="form-label required">Community</label>
                            <select id="alignment-target-select" class="form-select" data-ref="alignment-target-select" required>
                                <option value="">Select alignment target...</option>
                                ${alignmentTargets.map(t => `
                                    <option value="${t.id}" data-description="${(t.description || '').replace(/"/g, '&quot;')}">${t.title} (ID: ${t.id})</option>
                                `).join('')}
                            </select>
                            <small class="form-help" id="alignment-target-description"></small>
                        </div>
                    </div>

                    <!-- Step 3: Vault Selection (hidden until target selected) -->
                    <div class="form-section" id="step-vault" style="display: none;">
                        <div class="form-section-header">
                            <h2>3. Alignment Vault</h2>
                            <p class="form-section-description">Choose a vault for your project. Your project's fees will flow to this vault.</p>
                        </div>
                        <div class="form-group">
                            <label for="vault-select" class="form-label required">Vault</label>
                            <select id="vault-select" class="form-select" data-ref="vault-select" required>
                                <option value="">Loading vaults...</option>
                            </select>
                            <small class="form-help">Each vault buys and LPs the target community's token with project fees.</small>
                        </div>
                    </div>

                    <!-- Step 4: Factory Contract (hidden until vault selected, only if multiple factories of the type) -->
                    <div class="form-section" id="step-factory" style="display: none;">
                        <div class="form-section-header">
                            <h2>4. Factory Contract</h2>
                            <p class="form-section-description">Select the specific factory contract to deploy from.</p>
                        </div>
                        <div class="form-group">
                            <label for="factory-select" class="form-label required">Factory</label>
                            <select id="factory-select" class="form-select" data-ref="factory-select" required>
                                <option value="">Select factory...</option>
                            </select>
                        </div>
                    </div>

                    <!-- Step 5: Project Details (hidden until vault/factory selected) -->
                    <div class="form-section" id="step-details" style="display: none;">
                        <div class="form-section-header">
                            <h2>Project Details</h2>
                            <p class="form-section-description">Required fields are marked with an asterisk (*).</p>
                        </div>

                        <div class="form-group">
                            <label for="project-name" class="form-label required">Project Name</label>
                            <input type="text" id="project-name" class="form-input" data-ref="project-name" placeholder="e.g., My Awesome Project" required />
                            <small class="form-help">Choose a clear, memorable name for your project.</small>
                        </div>

                        <div class="form-group">
                            <label for="project-symbol" class="form-label required">Token Symbol</label>
                            <input type="text" id="project-symbol" class="form-input" data-ref="project-symbol" placeholder="e.g., MAP" pattern="[A-Z0-9]{3,10}" title="3-10 uppercase letters or numbers" required />
                            <small class="form-help">A short identifier (3-10 uppercase letters or numbers).</small>
                        </div>

                        <div class="form-group">
                            <label for="project-description" class="form-label">Description</label>
                            <textarea id="project-description" class="form-textarea" data-ref="project-description" placeholder="Describe your project..." rows="4"></textarea>
                        </div>
                    </div>

                    <!-- Metadata & Links (hidden until details visible) -->
                    <div class="form-section" id="step-metadata" style="display: none;">
                        <div class="form-section-header">
                            <h2>Metadata & Links</h2>
                            <p class="form-section-description">Optional links to help users discover your project.</p>
                        </div>

                        <div class="form-group">
                            <label for="metadata-uri" class="form-label">Metadata URI</label>
                            <input type="text" id="metadata-uri" class="form-input" data-ref="metadata-uri" placeholder="https://ipfs.io/ipfs/..." />
                            <small class="form-help">If left empty, metadata will be auto-generated.</small>
                        </div>

                        <div class="form-group">
                            <label for="image-uri" class="form-label">Project Image</label>
                            <input type="url" id="image-uri" class="form-input" data-ref="image-uri" placeholder="https://example.com/image.jpg" />
                        </div>

                        <div class="form-group">
                            <label for="website-uri" class="form-label">Website</label>
                            <input type="url" id="website-uri" class="form-input" data-ref="website-uri" placeholder="https://myproject.com" />
                        </div>

                        <div class="form-group">
                            <label for="twitter-uri" class="form-label">Twitter/X</label>
                            <input type="text" id="twitter-uri" class="form-input" data-ref="twitter-uri" placeholder="@username or https://twitter.com/username" />
                        </div>

                        <div class="form-group">
                            <label for="github-uri" class="form-label">GitHub Repository</label>
                            <input type="url" id="github-uri" class="form-input" data-ref="github-uri" placeholder="https://github.com/user/repo" />
                        </div>
                    </div>

                    <!-- Categories & Tags -->
                    <div class="form-section" id="step-tags" style="display: none;">
                        <div class="form-section-header">
                            <h2>Categories & Tags</h2>
                        </div>
                        <div class="form-group">
                            <label for="category" class="form-label">Category</label>
                            <input type="text" id="category" class="form-input" data-ref="category" placeholder="e.g., Art, Gaming, DeFi" />
                        </div>
                        <div class="form-group">
                            <label for="tags" class="form-label">Tags</label>
                            <input type="text" id="tags" class="form-input" data-ref="tags" placeholder="tag1, tag2, tag3" />
                            <small class="form-help">Comma-separated tags for discoverability.</small>
                        </div>
                    </div>

                    <div class="form-actions" id="step-submit" style="display: none;">
                        <button type="submit" class="btn btn-primary submit-button" data-ref="submit-button">
                            Create Project
                        </button>
                        <button type="button" class="btn cancel-button" data-ref="cancel-button">
                            Cancel
                        </button>
                    </div>
                </form>
            </div>

            <div class="creation-status" data-ref="status-container" style="display: none;"></div>
        </div>
    `;

    // Setup cascading logic
    setupCascadingListeners(container, { factories, factoriesByType, alignmentTargets });
    setupBackButton(container);

    // If pre-selected type, trigger cascade
    if (preselectedType) {
        const typeSelect = container.querySelector('[data-ref="factory-type-select"]');
        if (typeSelect && typeSelect.value) {
            typeSelect.dispatchEvent(new Event('change'));
        }
    }
}

/**
 * Setup cascading form listeners: type → target → vault → factory → details
 */
function setupCascadingListeners(container, { factories, factoriesByType, alignmentTargets }) {
    const typeSelect = container.querySelector('[data-ref="factory-type-select"]');
    const targetSelect = container.querySelector('[data-ref="alignment-target-select"]');
    const vaultSelect = container.querySelector('[data-ref="vault-select"]');
    const factorySelect = container.querySelector('[data-ref="factory-select"]');
    const form = container.querySelector('[data-ref="creation-form"]');
    const cancelButton = container.querySelector('[data-ref="cancel-button"]');
    const statusContainer = container.querySelector('[data-ref="status-container"]');

    const stepAlignment = container.querySelector('#step-alignment');
    const stepVault = container.querySelector('#step-vault');
    const stepFactory = container.querySelector('#step-factory');
    const stepDetails = container.querySelector('#step-details');
    const stepMetadata = container.querySelector('#step-metadata');
    const stepTags = container.querySelector('#step-tags');
    const stepSubmit = container.querySelector('#step-submit');

    // Hide all steps after the given one
    function hideFrom(step) {
        const steps = [stepAlignment, stepVault, stepFactory, stepDetails, stepMetadata, stepTags, stepSubmit];
        const idx = steps.indexOf(step);
        for (let i = idx; i < steps.length; i++) {
            steps[i].style.display = 'none';
        }
    }

    // Step 1: Factory type changes → show alignment targets
    typeSelect.addEventListener('change', () => {
        hideFrom(stepAlignment);
        const selectedType = typeSelect.value;
        if (!selectedType) return;

        // Reset target selection
        targetSelect.value = '';
        stepAlignment.style.display = '';
    });

    // Step 2: Alignment target changes → load vaults for that target
    targetSelect.addEventListener('change', async () => {
        hideFrom(stepVault);
        const targetId = parseInt(targetSelect.value);
        if (!targetId) return;

        // Show target description
        const selectedOption = targetSelect.options[targetSelect.selectedIndex];
        const descEl = container.querySelector('#alignment-target-description');
        if (descEl) {
            descEl.textContent = selectedOption.dataset.description || '';
        }

        // Load vaults for this target
        vaultSelect.innerHTML = '<option value="">Loading vaults...</option>';
        stepVault.style.display = '';

        try {
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
            const vaults = await masterAdapter.getVaultsForTarget(targetId);

            if (vaults.length === 0) {
                vaultSelect.innerHTML = '<option value="">No vaults available for this target</option>';
            } else {
                vaultSelect.innerHTML = '<option value="">Select vault...</option>' +
                    vaults.map(v => `<option value="${v.address}">${v.name || v.address.slice(0, 10) + '...'}</option>`).join('');
            }
        } catch (e) {
            console.error('[ProjectCreation] Failed to load vaults:', e);
            vaultSelect.innerHTML = '<option value="">Failed to load vaults</option>';
        }
    });

    // Step 3: Vault selected → show factory selection and project details
    vaultSelect.addEventListener('change', () => {
        hideFrom(stepFactory);
        if (!vaultSelect.value) return;

        const selectedType = typeSelect.value;
        const typeFactories = factoriesByType[selectedType] || [];

        if (typeFactories.length > 1) {
            // Multiple factories of this type — show factory picker
            factorySelect.innerHTML = '<option value="">Select factory...</option>' +
                typeFactories.map(f => `<option value="${f.address}">${f.type} - ${f.address.slice(0, 10)}...</option>`).join('');
            stepFactory.style.display = '';
        } else if (typeFactories.length === 1) {
            // Only one factory — auto-select and skip to details
            factorySelect.innerHTML = `<option value="${typeFactories[0].address}" selected>${typeFactories[0].type}</option>`;
            showDetailsSteps();
        } else {
            // No factories of this type
            showStatus(statusContainer, 'error', 'No authorized factories available for this project type.');
        }
    });

    // Step 4: Factory selected → show details
    factorySelect.addEventListener('change', () => {
        hideFrom(stepDetails);
        if (!factorySelect.value) return;
        showDetailsSteps();
    });

    function showDetailsSteps() {
        stepDetails.style.display = '';
        stepMetadata.style.display = '';
        stepTags.style.display = '';
        stepSubmit.style.display = '';
    }

    // Cancel button
    if (cancelButton) {
        cancelButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/');
            } else {
                window.location.href = '/';
            }
        });
    }

    // Form submission
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleFormSubmit(form, statusContainer, vaultSelect.value);
        });
    }

    // URL normalization
    setupURLValidation(container, statusContainer);
}

/**
 * Handle form submission - deploy instance with vault binding
 */
async function handleFormSubmit(form, statusContainer, vaultAddress) {
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

    let image = imageURI.value.trim();
    let website = websiteURI.value.trim();
    let twitter = twitterURI.value.trim();
    let github = githubURI.value.trim();
    const categoryValue = category.value.trim();
    const tagsValue = tags.value.trim();

    if (image) image = normalizeURL(image);
    if (website) website = normalizeURL(website);
    if (github) github = normalizeURL(github);
    if (twitter) twitter = normalizeTwitterURL(twitter);

    if (image) {
        validateImageURL(image).then(isValid => {
            if (!isValid) {
                showStatus(statusContainer, 'warning', 'Image URL may not be valid or accessible. The project was still created successfully.');
            }
        }).catch(() => {});
    }

    const tagsArray = tagsValue ? tagsValue.split(',').map(t => t.trim()).filter(t => t) : [];

    if (!name || !symbol) {
        showStatus(statusContainer, 'error', 'Please fill in all required fields.');
        return;
    }

    if (symbol.length < 3 || symbol.length > 10) {
        showStatus(statusContainer, 'error', 'Symbol must be 3-10 characters.');
        return;
    }

    if (!vaultAddress) {
        showStatus(statusContainer, 'error', 'Please select an alignment vault.');
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Creating...';
    showStatus(statusContainer, 'info', 'Creating project instance...');

    try {
        const factoryService = serviceFactory.getFactoryService();
        const projectRegistry = serviceFactory.getProjectRegistry();

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
                vaultAddress,
            }
        );

        await projectRegistry.indexProject(instanceAddress);

        showStatus(statusContainer, 'success', `Project created successfully! Instance address: ${instanceAddress}`);

        setTimeout(async () => {
            const { navigateToProject } = await import('../utils/navigation.js');
            await navigateToProject(instanceAddress);
        }, 2000);

    } catch (error) {
        console.error('Error creating project:', error);
        showStatus(statusContainer, 'error', `Failed to create project: ${error.message}`);
        submitButton.disabled = false;
        submitButton.textContent = 'Create Project';
    }
}

/**
 * Setup back button navigation
 */
function setupBackButton(container) {
    const backButton = container.querySelector('[data-ref="back-button"]');
    if (backButton) {
        backButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/');
            } else {
                window.location.href = '/';
            }
        });
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

