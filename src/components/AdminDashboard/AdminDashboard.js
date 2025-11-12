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
            error: null
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

    _renderFunctionForm() {
        const fn = this.state.selectedFunction;
        const params = fn.inputs || [];
        const executing = this.state.executing;
        const result = this.state.executionResult;

        return `
            <div class="admin-dashboard">
                <div class="admin-dashboard-header">
                    <button class="back-button" data-ref="back-button">← Back</button>
                    <h2>${this.escapeHtml(fn.name)}</h2>
                    <p class="admin-dashboard-subtitle">${this.escapeHtml(fn.description || '')}</p>
                </div>
                <form class="admin-function-form" data-ref="function-form">
                    ${params.map((param, index) => `
                        <div class="form-field">
                            <label for="param-${index}">
                                ${this.escapeHtml(param.name || `Parameter ${index + 1}`)}
                                <span class="param-type">(${this.escapeHtml(param.type)})</span>
                            </label>
                            <input 
                                type="text" 
                                id="param-${index}" 
                                name="${this.escapeHtml(param.name || `param${index}`)}"
                                data-param-type="${this.escapeHtml(param.type)}"
                                placeholder="Enter ${this.escapeHtml(param.name || 'value')}"
                                ${executing ? 'disabled' : ''}
                            />
                        </div>
                    `).join('')}
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

    selectFunction(fn) {
        this.setState({
            selectedFunction: fn,
            functionParams: {},
            executionResult: null,
            error: null
        });
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

