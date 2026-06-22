/**
 * Admin Dashboard Component
 * 
 * Main admin dashboard content that displays and executes admin functions.
 */

import { Component } from '../../core/Component.js';
import adminFunctionDiscovery from '../../services/AdminFunctionDiscovery.js';
import mockAdminService from '../../services/mock/MockAdminService.js';
import walletService from '../../services/WalletService.js';

export class AdminDashboard extends Component {
    constructor(contractAddress, contractType, adapter) {
        super();
        this.contractAddress = contractAddress;
        this.contractType = contractType;
        this.adapter = adapter;
        this.state = {
            adminFunctions: [],
            loading: true,
            selectedFunction: null,
            functionParams: {},
            executing: false,
            executionResult: null,
            error: null,
            // For cultexecs special UIs
            currentConfig: null, // For configure function
            availableFees: null, // For collectV3Fees function
            loadingFees: false,
            loadingConfig: false
        };
    }

    async onMount() {
        await this.loadAdminFunctions();
    }

    async loadAdminFunctions() {
        try {
            this.setState({ loading: true, error: null });

            let functions = [];

            if (this.adapter) {
                // Get admin functions from adapter
                functions = await this.adapter.getAdminFunctions();
                
                // If no functions found and it's a mock contract, use mock functions
                if (functions.length === 0 && this.adapter.isMock) {
                    const adminFunctionDiscovery = (await import('../../services/AdminFunctionDiscovery.js')).default;
                    functions = adminFunctionDiscovery.getMockAdminFunctions(
                        this.contractAddress,
                        this.contractType
                    );
                }
            } else {
                // Try to discover from contract directly
                // This would require loading the ABI separately
                console.warn('[AdminDashboard] No adapter available, cannot discover admin functions');
                
                // For mock contracts without adapter, provide mock functions
                const adminFunctionDiscovery = (await import('../../services/AdminFunctionDiscovery.js')).default;
                functions = adminFunctionDiscovery.getMockAdminFunctions(
                    this.contractAddress,
                    this.contractType
                );
            }

            // Group functions by category
            const grouped = this._groupFunctionsByCategory(functions);

            this.setState({
                adminFunctions: functions,
                groupedFunctions: grouped,
                loading: false
            });
        } catch (error) {
            console.error('[AdminDashboard] Error loading admin functions:', error);
            this.setState({
                loading: false,
                error: 'Failed to load admin functions'
            });
        }
    }

    _groupFunctionsByCategory(functions) {
        const grouped = {};
        for (const fn of functions) {
            const category = fn.category || 'other';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(fn);
        }
        return grouped;
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="admin-dashboard loading">
                    <div class="loading-spinner"></div>
                    <p>Loading admin functions...</p>
                </div>
            `;
        }

        if (this.state.error) {
            return `
                <div class="admin-dashboard error">
                    <p class="error-message">${this.escapeHtml(this.state.error)}</p>
                </div>
            `;
        }

        if (this.state.adminFunctions.length === 0) {
            return `
                <div class="admin-dashboard empty">
                    <p>No admin functions found for this contract.</p>
                </div>
            `;
        }

        // If a function is selected, show parameter form
        if (this.state.selectedFunction) {
            return this._renderFunctionForm();
        }

        // Otherwise show function list
        return this._renderFunctionList();
    }

    _renderFunctionList() {
        const categories = Object.keys(this.state.groupedFunctions || {});
        
        return `
            <div class="admin-dashboard">
                <div class="admin-dashboard-header">
                    <h2>Admin Functions</h2>
                    <p class="admin-dashboard-subtitle">Select a function to execute</p>
                </div>
                <div class="admin-functions-list">
                    ${categories.map(category => `
                        <div class="admin-function-category">
                            <h3 class="category-title">${this._formatCategoryName(category)}</h3>
                            <div class="category-functions">
                                ${this.state.groupedFunctions[category].map(fn => `
                                    <div class="admin-function-item" data-ref="function-${fn.name}">
                                        <div class="function-info">
                                            <h4 class="function-name">${this.escapeHtml(fn.name)}</h4>
                                            <p class="function-description">${this.escapeHtml(fn.description || 'No description')}</p>
                                        </div>
                                        <button class="function-select-button" data-function="${this.escapeHtml(fn.name)}">
                                            Execute
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }


    /**
     * Load current configuration values for configure function
     */
    async loadCurrentConfig() {
        if (!this.adapter || !this.adapter.contract) {
            return;
        }

        try {
            this.setState({ loadingConfig: true });
            
            // Get current values from contract
            const [uri, unrevealedUri, revealed] = await Promise.all([
                this.adapter.contract.uri().catch(() => ''),
                this.adapter.contract.unrevealedUri().catch(() => ''),
                this.adapter.contract.revealed().catch(() => false)
            ]);

            this.setState({
                currentConfig: {
                    uri: uri || '',
                    unrevealedUri: unrevealedUri || '',
                    revealed: revealed || false
                },
                loadingConfig: false,
                // Pre-fill form with current values
                functionParams: {
                    '_uri': uri || '',
                    '_unrevealedUri': unrevealedUri || '',
                    '_revealed': revealed ? 'true' : 'false'
                }
            });
        } catch (error) {
            console.error('[AdminDashboard] Error loading current config:', error);
            this.setState({ loadingConfig: false });
        }
    }

    _renderFunctionForm() {
        const fn = this.state.selectedFunction;
        const params = fn.inputs || [];
        const executing = this.state.executing;
        const result = this.state.executionResult;
        const isConfigure = fn.name === 'configure';
        const currentConfig = this.state.currentConfig;
        const loadingConfig = this.state.loadingConfig;

        return `
            <div class="admin-dashboard">
                <div class="admin-dashboard-header">
                    <button class="back-button" data-ref="back-button">← Back</button>
                    <h2>${this.escapeHtml(fn.name)}</h2>
                    <p class="admin-dashboard-subtitle">${this.escapeHtml(fn.description || '')}</p>
                </div>
                ${isConfigure && currentConfig ? `
                    <div class="current-config-display">
                        <h3>Current Configuration</h3>
                        <div class="config-values">
                            <div class="config-item">
                                <label>Current URI:</label>
                                <div class="config-value">${this.escapeHtml(currentConfig.uri || '(empty)')}</div>
                            </div>
                            <div class="config-item">
                                <label>Current Unrevealed URI:</label>
                                <div class="config-value">${this.escapeHtml(currentConfig.unrevealedUri || '(empty)')}</div>
                            </div>
                            <div class="config-item">
                                <label>Currently Revealed:</label>
                                <div class="config-value">${currentConfig.revealed ? 'Yes' : 'No'}</div>
                            </div>
                        </div>
                    </div>
                ` : ''}
                ${isConfigure && loadingConfig ? `
                    <div class="loading-config">
                        <p>Loading current configuration...</p>
                    </div>
                ` : ''}
                <form class="admin-function-form" data-ref="function-form">
                    ${params.map((param, index) => {
                        const paramName = param.name || `param${index}`;
                        const currentValue = isConfigure && currentConfig ? 
                            (paramName === '_uri' ? currentConfig.uri :
                             paramName === '_unrevealedUri' ? currentConfig.unrevealedUri :
                             paramName === '_revealed' ? (currentConfig.revealed ? 'true' : 'false') : '') : '';
                        
                        return `
                        <div class="form-field">
                            <label for="param-${index}">
                                ${this.escapeHtml(param.name || `Parameter ${index + 1}`)}
                                <span class="param-type">(${this.escapeHtml(param.type)})</span>
                                ${isConfigure && currentValue ? `<span class="current-value-hint">Current: ${this.escapeHtml(currentValue.length > 50 ? currentValue.substring(0, 50) + '...' : currentValue)}</span>` : ''}
                            </label>
                            ${param.type === 'bool' ? `
                                <select 
                                    id="param-${index}" 
                                    name="${this.escapeHtml(paramName)}"
                                    data-param-type="${this.escapeHtml(param.type)}"
                                    ${executing ? 'disabled' : ''}
                                >
                                    <option value="true" ${currentValue === 'true' ? 'selected' : ''}>True</option>
                                    <option value="false" ${currentValue === 'false' ? 'selected' : ''}>False</option>
                                </select>
                            ` : `
                                <input 
                                    type="text" 
                                    id="param-${index}" 
                                    name="${this.escapeHtml(paramName)}"
                                    data-param-type="${this.escapeHtml(param.type)}"
                                    placeholder="Enter ${this.escapeHtml(param.name || 'value')}"
                                    value="${this.escapeHtml(currentValue || '')}"
                                    ${executing ? 'disabled' : ''}
                                />
                            `}
                        </div>
                    `;
                    }).join('')}
                    ${fn.payable ? `
                        <div class="form-field">
                            <label for="eth-value">ETH Value (for payable functions)</label>
                            <input 
                                type="text" 
                                id="eth-value" 
                                name="ethValue"
                                placeholder="0.0"
                                ${executing ? 'disabled' : ''}
                            />
                        </div>
                    ` : ''}
                    <div class="form-actions">
                        <button type="submit" class="execute-button" ${executing ? 'disabled' : ''}>
                            ${executing ? 'Executing...' : 'Execute Function'}
                        </button>
                    </div>
                </form>
                ${result ? `
                    <div class="execution-result ${result.success ? 'success' : 'error'}">
                        <p>${this.escapeHtml(result.message)}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }

    _formatCategoryName(category) {
        return category
            .split(/(?=[A-Z])/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    mount(element) {
        super.mount(element);
        this.setTimeout(() => {
            this.bindEvents();
        }, 0);
    }

    bindEvents() {
        // Bind function selection buttons
        if (this.state.groupedFunctions) {
            const categories = Object.keys(this.state.groupedFunctions);
            for (const category of categories) {
                for (const fn of this.state.groupedFunctions[category]) {
                    const functionItem = this.getRef(`function-${fn.name}`, `[data-ref="function-${fn.name}"]`);
                    if (functionItem) {
                        const button = functionItem.querySelector(`[data-function="${fn.name}"]`);
                        if (button) {
                            button.addEventListener('click', () => {
                                this.selectFunction(fn);
                            });
                        }
                    }
                }
            }
        }

        // Bind back button
        const backButton = this.getRef('back-button', '.back-button');
        if (backButton) {
            backButton.addEventListener('click', () => {
                this.setState({ selectedFunction: null, functionParams: {}, executionResult: null });
            });
        }

        // Bind form submission
        const form = this.getRef('function-form', '.admin-function-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.executeFunction();
            });
        }
    }

    async selectFunction(fn) {
        this.setState({
            selectedFunction: fn,
            functionParams: {},
            executionResult: null,
            error: null,
            currentConfig: null,
            availableFees: null
        });

        // Load current values for cultexecs configure function
        if (fn.name === 'configure' && this.adapter && this.adapter.contract) {
            await this.loadCurrentConfig();
        }
    }

    /**
     * Load current configuration values for configure function
     */
    async loadCurrentConfig() {
        if (!this.adapter || !this.adapter.contract) {
            return;
        }

        try {
            this.setState({ loadingConfig: true });
            
            // Get current values from contract
            const [uri, unrevealedUri, revealed] = await Promise.all([
                this.adapter.contract.uri(),
                this.adapter.contract.unrevealedUri(),
                this.adapter.contract.revealed()
            ]);

            this.setState({
                currentConfig: {
                    uri: uri || '',
                    unrevealedUri: unrevealedUri || '',
                    revealed: revealed || false
                },
                loadingConfig: false,
                // Pre-fill form with current values
                functionParams: {
                    '_uri': uri || '',
                    '_unrevealedUri': unrevealedUri || '',
                    '_revealed': revealed ? 'true' : 'false'
                }
            });
        } catch (error) {
            console.error('[AdminDashboard] Error loading current config:', error);
            this.setState({ loadingConfig: false });
        }
    }

    /**
     * Load available fees from V3 position for collectV3Fees function
     */
    async loadAvailableFees() {
        if (!this.adapter || !this.adapter.contract) {
            return;
        }

        try {
            this.setState({ loadingFees: true });
            
            // Get position manager address and position ID
            const positionManagerAddress = await this.adapter.contract.positionManager();
            const positionId = await this.adapter.contract.cultV3Position();
            
            if (!positionManagerAddress || !positionId) {
                this.setState({
                    availableFees: { amount0: '0', amount1: '0' },
                    loadingFees: false
                });
                return;
            }

            // Get provider
            let provider = this.adapter.provider;
            if (!provider && typeof window !== 'undefined' && window.ethereum) {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                provider = new ethers.providers.Web3Provider(window.ethereum);
            }

            if (!provider) {
                this.setState({ loadingFees: false });
                return;
            }

            // INonfungiblePositionManager ABI for collect function
            const positionManagerABI = [
                {
                    "inputs": [
                        {
                            "components": [
                                {"name": "tokenId", "type": "uint256"},
                                {"name": "recipient", "type": "address"},
                                {"name": "amount0Max", "type": "uint128"},
                                {"name": "amount1Max", "type": "uint128"}
                            ],
                            "name": "params",
                            "type": "tuple"
                        }
                    ],
                    "name": "collect",
                    "outputs": [
                        {"name": "amount0", "type": "uint256"},
                        {"name": "amount1", "type": "uint256"}
                    ],
                    "stateMutability": "payable",
                    "type": "function"
                }
            ];

            const positionManager = new ethers.Contract(
                positionManagerAddress,
                positionManagerABI,
                provider
            );

            // Call collect with max values to check available fees
            // We use a read-only call by checking what would be returned
            // Note: collect is payable, but we can estimate or use a static call
            try {
                // Try to get fees using a static call or by checking the position directly
                // For now, we'll set max values and let the user know to check
                const maxUint128 = '340282366920938463463374607431768211455'; // 2^128 - 1
                
                // We can't directly read fees without calling collect, so we'll show max values
                // and let the contract handle it
                this.setState({
                    availableFees: {
                        amount0: maxUint128, // Suggest max
                        amount1: maxUint128, // Suggest max
                        note: 'Enter maximum amounts to collect. The contract will collect available fees up to these limits.'
                    },
                    loadingFees: false,
                    functionParams: {
                        'amount0Max': maxUint128,
                        'amount1Max': maxUint128
                    }
                });
            } catch (error) {
                console.warn('[AdminDashboard] Could not check fees directly:', error);
                this.setState({
                    availableFees: {
                        amount0: '0',
                        amount1: '0',
                        note: 'Unable to check available fees. Enter maximum amounts to collect (use max uint128: 340282366920938463463374607431768211455).'
                    },
                    loadingFees: false
                });
            }
        } catch (error) {
            console.error('[AdminDashboard] Error loading available fees:', error);
            this.setState({
                availableFees: {
                    amount0: '0',
                    amount1: '0',
                    note: 'Error checking fees. Enter maximum amounts to collect.'
                },
                loadingFees: false
            });
        }
    }

    async executeFunction() {
        const fn = this.state.selectedFunction;
        if (!fn) {
            return;
        }

        try {
            this.setState({ executing: true, error: null, executionResult: null });

            // Get form values
            const form = this.getRef('function-form', '.admin-function-form');
            const formData = new FormData(form);
            const params = [];

            // Parse parameters based on their types
            for (let i = 0; i < fn.inputs.length; i++) {
                const input = fn.inputs[i];
                const value = formData.get(input.name || `param${i}`);
                const parsed = this._parseParameter(value, input.type);
                params.push(parsed);
            }

            // Get ETH value if payable
            let ethValue = null;
            if (fn.payable) {
                const ethValueInput = form.querySelector('#eth-value');
                if (ethValueInput && ethValueInput.value) {
                    const ethers = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js').then(m => m.ethers || m.default);
                    ethValue = ethers.utils.parseEther(ethValueInput.value);
                }
            }

            // Execute function
            let result;
            if (this.adapter && this.adapter.isMock) {
                // Use mock admin service
                result = await mockAdminService.executeAdminFunction(
                    this.contractAddress,
                    fn.name,
                    params
                );
            } else if (this.adapter && this.adapter.contract) {
                // Execute on real contract
                const contract = this.adapter.contract;
                const signer = walletService.getProviderAndSigner().signer;
                
                if (!signer) {
                    throw new Error('Wallet not connected');
                }

                const connectedContract = contract.connect(signer);
                const txOptions = ethValue ? { value: ethValue } : {};
                
                const tx = await connectedContract[fn.name](...params, txOptions);
                const receipt = await tx.wait();

                result = {
                    success: true,
                    message: 'Transaction confirmed',
                    data: {
                        transactionHash: receipt.transactionHash,
                        blockNumber: receipt.blockNumber
                    }
                };
            } else {
                throw new Error('Cannot execute function: no adapter available');
            }

            this.setState({
                executing: false,
                executionResult: result
            });
        } catch (error) {
            console.error('[AdminDashboard] Error executing function:', error);
            this.setState({
                executing: false,
                error: error.message || 'Failed to execute function',
                executionResult: {
                    success: false,
                    message: error.message || 'Execution failed'
                }
            });
        }
    }

    _parseParameter(value, type) {
        if (!value) {
            return null;
        }

        // Parse based on type
        if (type.includes('uint') || type.includes('int')) {
            return value;
        }
        if (type === 'bool') {
            return value === 'true' || value === '1';
        }
        if (type === 'address') {
            return value;
        }
        if (type === 'string' || type === 'bytes') {
            return value;
        }
        if (type.includes('[]')) {
            // Array type
            try {
                return JSON.parse(value);
            } catch {
                return value.split(',').map(v => v.trim());
            }
        }

        return value;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

