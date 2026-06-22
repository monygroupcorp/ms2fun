/**
 * Factory Application Page
 * 
 * Form for submitting factory applications for review by EXEC holders.
 */

import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import walletService from '../services/WalletService.js';
import { eventBus } from '../core/EventBus.js';
import MessagePopup from '../components/MessagePopup/MessagePopup.js';

let messagePopup = null;

/**
 * Render factory application page
 */
export async function renderFactoryApplicationPage() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/routes/factory-application.css', 'factory-application-styles');
    
    // Unload other page styles
    stylesheetLoader.unload('home-styles');
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('project-detail-styles');
    stylesheetLoader.unload('factory-detail-styles');
    stylesheetLoader.unload('project-creation-styles');
    stylesheetLoader.unload('factory-exploration-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    messagePopup = new MessagePopup();

    // Render page
    appContainer.innerHTML = `
        <div class="factory-application-page">
            <div class="application-header">
                <button class="back-button" data-ref="back-button">← Back to Factories</button>
                <div class="header-content">
                    <h1>Apply for Factory</h1>
                    <p class="subtitle">Submit your factory contract for review by EXEC holders</p>
                </div>
            </div>

            <div class="application-form-container card">
                <form class="application-form" data-ref="application-form">
                    <div class="form-section">
                        <div class="form-section-header">
                            <h2>Factory Contract Information</h2>
                            <p class="form-section-description">Provide details about your factory contract.</p>
                        </div>

                        <div class="form-group">
                            <label for="factory-address" class="form-label required">Factory Contract Address</label>
                            <input 
                                type="text" 
                                id="factory-address" 
                                class="form-input" 
                                data-ref="factory-address"
                                placeholder="0x..."
                                pattern="^0x[a-fA-F0-9]{40}$"
                                required
                            />
                            <small class="form-help">Ethereum address of your deployed factory contract</small>
                            <div class="field-error" data-ref="factory-address-error"></div>
                        </div>

                        <div class="form-group">
                            <label for="contract-type" class="form-label required">Contract Type</label>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="contract-type" value="ERC404" data-ref="contract-type-erc404" required />
                                    <span>ERC404 Factory</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="contract-type" value="ERC1155" data-ref="contract-type-erc1155" />
                                    <span>ERC1155 Factory</span>
                                </label>
                            </div>
                            <small class="form-help">Select the type of factory contract</small>
                        </div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-header">
                            <h2>Factory Details</h2>
                            <p class="form-section-description">Information displayed on the platform.</p>
                        </div>

                        <div class="form-group">
                            <label for="factory-title" class="form-label required">Factory Title (URL Slug)</label>
                            <input 
                                type="text" 
                                id="factory-title" 
                                class="form-input" 
                                data-ref="factory-title"
                                placeholder="my-factory"
                                pattern="^[a-z0-9-]{3,64}$"
                                required
                            />
                            <small class="form-help">Lowercase, alphanumeric + hyphens only. Used in URL: /factories/[title]</small>
                            <div class="field-error" data-ref="factory-title-error"></div>
                        </div>

                        <div class="form-group">
                            <label for="display-title" class="form-label required">Display Title</label>
                            <input 
                                type="text" 
                                id="display-title" 
                                class="form-input" 
                                data-ref="display-title"
                                placeholder="My Awesome Factory"
                                maxlength="100"
                                required
                            />
                            <small class="form-help">Human-readable name displayed on the site</small>
                        </div>

                        <div class="form-group">
                            <label for="metadata-uri" class="form-label">Metadata URI</label>
                            <input 
                                type="text" 
                                id="metadata-uri" 
                                class="form-input" 
                                data-ref="metadata-uri"
                                placeholder="ipfs://... or https://... or ar://..."
                            />
                            <small class="form-help">IPFS or Arweave URI containing factory metadata JSON</small>
                            <div class="field-error" data-ref="metadata-uri-error"></div>
                        </div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-header">
                            <h2>Features</h2>
                            <p class="form-section-description">Select features supported by your factory (optional).</p>
                        </div>

                        <div class="form-group">
                            <div class="checkbox-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" name="features" value="bonding-curve" data-ref="feature-bonding-curve" />
                                    <span>Bonding Curve</span>
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" name="features" value="nft-minting" data-ref="feature-nft-minting" />
                                    <span>NFT Minting</span>
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" name="features" value="whitelist-support" data-ref="feature-whitelist" />
                                    <span>Whitelist Support</span>
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" name="features" value="liquidity-pool" data-ref="feature-liquidity" />
                                    <span>Liquidity Pool Integration</span>
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" name="features" value="onchain-messaging" data-ref="feature-messaging" />
                                    <span>On-chain Messaging</span>
                                </label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="custom-features" class="form-label">Custom Features</label>
                            <input 
                                type="text" 
                                id="custom-features" 
                                class="form-input" 
                                data-ref="custom-features"
                                placeholder="Comma-separated custom features"
                            />
                            <small class="form-help">Additional features not listed above</small>
                        </div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-header">
                            <h2>Application Fee</h2>
                        </div>

                        <div class="fee-display">
                            <div class="fee-info">
                                <span class="fee-label">Required Fee:</span>
                                <span class="fee-value" data-ref="required-fee">0.1 ETH</span>
                            </div>
                            <div class="balance-info">
                                <span class="balance-label">Your Balance:</span>
                                <span class="balance-value" data-ref="eth-balance">--</span>
                            </div>
                        </div>
                        <div class="fee-warning" data-ref="fee-warning" style="display: none;">
                            ⚠️ Insufficient balance. Please add ETH to your wallet.
                        </div>
                    </div>

                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary submit-button" data-ref="submit-button">
                            Submit Application
                        </button>
                        <button type="button" class="btn cancel-button" data-ref="cancel-button">
                            Cancel
                        </button>
                    </div>
                </form>
            </div>

            <div class="application-status" data-ref="status-container" style="display: none;">
                <!-- Status messages will appear here -->
            </div>
        </div>
    `;

    // Setup event listeners
    setupEventListeners(appContainer);

    // Load ETH balance if wallet connected
    if (walletService.isConnected()) {
        await loadEthBalance(appContainer);
    }

    // Return cleanup function
    return {
        cleanup: () => {
            stylesheetLoader.unload('factory-application-styles');
            messagePopup = null;
        }
    };
}

/**
 * Setup event listeners
 */
function setupEventListeners(container) {
    const form = container.querySelector('[data-ref="application-form"]');
    const backButton = container.querySelector('[data-ref="back-button"]');
    const cancelButton = container.querySelector('[data-ref="cancel-button"]');
    const factoryAddressInput = container.querySelector('[data-ref="factory-address"]');
    const factoryTitleInput = container.querySelector('[data-ref="factory-title"]');
    const metadataURIInput = container.querySelector('[data-ref="metadata-uri"]');

    if (backButton) {
        backButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/factories');
            } else {
                window.location.href = '/factories';
            }
        });
    }

    if (cancelButton) {
        cancelButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/factories');
            } else {
                window.location.href = '/factories';
            }
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleFormSubmit(form, container);
        });
    }

    // Real-time validation
    if (factoryAddressInput) {
        factoryAddressInput.addEventListener('blur', () => {
            validateAddress(factoryAddressInput.value, container);
        });
    }

    if (factoryTitleInput) {
        factoryTitleInput.addEventListener('input', () => {
            validateTitle(factoryTitleInput.value, container);
        });
    }

    if (metadataURIInput) {
        metadataURIInput.addEventListener('blur', () => {
            validateMetadataURI(metadataURIInput.value, container);
        });
    }
}

/**
 * Validate Ethereum address
 */
async function validateAddress(address, container) {
    const errorEl = container.querySelector('[data-ref="factory-address-error"]');
    if (!errorEl) return;

    if (!address) {
        errorEl.textContent = '';
        return;
    }

    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(address)) {
        errorEl.textContent = 'Invalid Ethereum address format';
        return;
    }

    // Check if contract has code (in real implementation)
    // For now, just clear error
    errorEl.textContent = '';
}

/**
 * Validate factory title
 */
async function validateTitle(title, container) {
    const errorEl = container.querySelector('[data-ref="factory-title-error"]');
    if (!errorEl) return;

    if (!title) {
        errorEl.textContent = '';
        return;
    }

    const titleRegex = /^[a-z0-9-]{3,64}$/;
    if (!titleRegex.test(title)) {
        errorEl.textContent = 'Title must be 3-64 characters, lowercase, alphanumeric + hyphens only';
        return;
    }

    // Check uniqueness (in real implementation, would check contract)
    // For now, just clear error
    errorEl.textContent = '';
}

/**
 * Validate metadata URI
 */
function validateMetadataURI(uri, container) {
    const errorEl = container.querySelector('[data-ref="metadata-uri-error"]');
    if (!errorEl) return;

    if (!uri) {
        errorEl.textContent = '';
        return;
    }

    const validPrefixes = ['ipfs://', 'https://', 'ar://'];
    const isValid = validPrefixes.some(prefix => uri.startsWith(prefix));

    if (!isValid) {
        errorEl.textContent = 'URI must start with ipfs://, https://, or ar://';
        return;
    }

    errorEl.textContent = '';
}

/**
 * Load ETH balance
 */
async function loadEthBalance(container) {
    try {
        if (!walletService.ethersProvider) {
            return;
        }

        const address = walletService.connectedAddress;
        const balance = await walletService.ethersProvider.getBalance(address);
        const balanceEth = parseFloat(balance) / 1e18;

        const balanceEl = container.querySelector('[data-ref="eth-balance"]');
        if (balanceEl) {
            balanceEl.textContent = `${balanceEth.toFixed(4)} ETH`;
        }

        // Check if sufficient balance
        const requiredFee = 0.1; // ETH
        const warningEl = container.querySelector('[data-ref="fee-warning"]');
        if (balanceEth < requiredFee && warningEl) {
            warningEl.style.display = 'block';
        } else if (warningEl) {
            warningEl.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading ETH balance:', error);
    }
}

/**
 * Handle form submission
 */
async function handleFormSubmit(form, container) {
    const submitButton = form.querySelector('[data-ref="submit-button"]');
    const statusContainer = container.querySelector('[data-ref="status-container"]');

    // Check wallet connection
    if (!walletService.isConnected()) {
        showStatus(statusContainer, 'error', 'Please connect your wallet to submit an application.');
        return;
    }

    // Get form values
    const factoryAddress = form.querySelector('[data-ref="factory-address"]').value.trim();
    const contractTypeInput = form.querySelector('input[name="contract-type"]:checked');
    const contractType = contractTypeInput ? contractTypeInput.value : null;
    const title = form.querySelector('[data-ref="factory-title"]').value.trim().toLowerCase();
    const displayTitle = form.querySelector('[data-ref="display-title"]').value.trim();
    const metadataURI = form.querySelector('[data-ref="metadata-uri"]').value.trim();
    
    // Get features
    const featureCheckboxes = form.querySelectorAll('input[name="features"]:checked');
    const features = Array.from(featureCheckboxes).map(cb => cb.value);
    
    const customFeatures = form.querySelector('[data-ref="custom-features"]').value.trim();
    if (customFeatures) {
        features.push(...customFeatures.split(',').map(f => f.trim()).filter(f => f));
    }

    // Validate
    if (!factoryAddress || !contractType || !title || !displayTitle) {
        showStatus(statusContainer, 'error', 'Please fill in all required fields.');
        return;
    }

    // Show loading state
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    showStatus(statusContainer, 'info', 'Submitting application...');

    try {
        const votingService = serviceFactory.getExecVotingService();
        const applicant = walletService.connectedAddress;

        // Submit application
        const receipt = await votingService.submitApplication({
            factoryAddress,
            contractType,
            title,
            displayTitle,
            metadataURI: metadataURI || undefined,
            features
        }, applicant);

        // Show success
        showStatus(statusContainer, 'success', 
            `Application submitted successfully! Transaction: ${receipt.transactionHash.slice(0, 10)}...`);

        // Navigate to status page after delay
        setTimeout(() => {
            if (window.router) {
                window.router.navigate(`/factories/application/${factoryAddress}`);
            } else {
                window.location.href = `/factories/application/${factoryAddress}`;
            }
        }, 2000);

    } catch (error) {
        console.error('Error submitting application:', error);
        showStatus(statusContainer, 'error', `Failed to submit application: ${error.message}`);
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Application';
    }
}

/**
 * Show status message
 */
function showStatus(container, type, message) {
    if (!container) return;

    container.style.display = 'block';
    container.className = `application-status ${type}`;
    const icon = type === 'error' ? '❌' : type === 'success' ? '✓' : type === 'warning' ? '⚠️' : 'ℹ️';
    container.innerHTML = `
        <div class="status-message">
            ${icon}
            <span>${message}</span>
        </div>
    `;
}

