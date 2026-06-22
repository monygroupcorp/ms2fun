/**
 * AdminDashboard - Microact Version
 *
 * Displays and executes admin functions for contracts.
 * Groups functions by category and provides parameter forms.
 */

import { Component, h } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class AdminDashboard extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            adminFunctions: [],
            groupedFunctions: {},
            loading: true,
            selectedFunction: null,
            functionParams: {},
            executing: false,
            executionResult: null,
            error: null,
            currentConfig: null,
            loadingConfig: false
        };
    }

    get contractAddress() {
        return this.props.contractAddress;
    }

    get contractType() {
        return this.props.contractType;
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.loadAdminFunctions();
    }

    async loadAdminFunctions() {
        try {
            this.setState({ loading: true, error: null });

            let functions = [];

            if (this.adapter) {
                functions = await this.adapter.getAdminFunctions();

                if (functions.length === 0 && this.adapter.isMock) {
                    const adminFunctionDiscovery = (await import('../../services/AdminFunctionDiscovery.js')).default;
                    functions = adminFunctionDiscovery.getMockAdminFunctions(
                        this.contractAddress,
                        this.contractType
                    );
                }
            } else {
                const adminFunctionDiscovery = (await import('../../services/AdminFunctionDiscovery.js')).default;
                functions = adminFunctionDiscovery.getMockAdminFunctions(
                    this.contractAddress,
                    this.contractType
                );
            }

            const grouped = this.groupFunctionsByCategory(functions);

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

    groupFunctionsByCategory(functions) {
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

    formatCategoryName(category) {
        return category
            .split(/(?=[A-Z])/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    selectFunction(fn) {
        this.setState({
            selectedFunction: fn,
            functionParams: {},
            executionResult: null,
            error: null,
            currentConfig: null
        });

        if (fn.name === 'configure' && this.adapter?.contract) {
            this.loadCurrentConfig();
        }
    }

    async loadCurrentConfig() {
        if (!this.adapter?.contract) return;

        try {
            this.setState({ loadingConfig: true });

            const [uri, unrevealedUri, revealed] = await Promise.all([
                this.adapter.contract.uri().catch(() => ''),
                this.adapter.contract.unrevealedUri().catch(() => ''),
                this.adapter.contract.revealed().catch(() => false)
            ]);

            this.setState({
                currentConfig: { uri, unrevealedUri, revealed },
                loadingConfig: false,
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

    handleBack() {
        this.setState({ selectedFunction: null, functionParams: {}, executionResult: null });
    }

    handleParamChange(paramName, value) {
        this.setState({
            functionParams: {
                ...this.state.functionParams,
                [paramName]: value
            }
        });
    }

    async handleSubmit(e) {
        e.preventDefault();
        const fn = this.state.selectedFunction;
        if (!fn) return;

        try {
            this.setState({ executing: true, error: null, executionResult: null });

            const params = [];
            for (let i = 0; i < fn.inputs.length; i++) {
                const input = fn.inputs[i];
                const value = this.state.functionParams[input.name || `param${i}`];
                params.push(this.parseParameter(value, input.type));
            }

            let result;
            if (this.adapter?.isMock) {
                const mockAdminService = (await import('../../services/mock/MockAdminService.js')).default;
                result = await mockAdminService.executeAdminFunction(
                    this.contractAddress,
                    fn.name,
                    params
                );
            } else if (this.adapter?.contract) {
                const { signer } = walletService.getProviderAndSigner();
                if (!signer) {
                    throw new Error('Wallet not connected');
                }

                const connectedContract = this.adapter.contract.connect(signer);
                const tx = await connectedContract[fn.name](...params);
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

            this.setState({ executing: false, executionResult: result });
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

    parseParameter(value, type) {
        if (!value) return null;

        if (type === 'bool') {
            return value === 'true' || value === '1';
        }
        if (type.includes('[]')) {
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

    renderFunctionList() {
        const { groupedFunctions } = this.state;
        const categories = Object.keys(groupedFunctions);

        return h('div', { className: 'admin-dashboard' },
            h('div', { className: 'admin-dashboard-header' },
                h('h2', null, 'Admin Functions'),
                h('p', { className: 'admin-dashboard-subtitle' }, 'Select a function to execute')
            ),
            h('div', { className: 'admin-functions-list' },
                ...categories.map(category =>
                    h('div', { className: 'admin-function-category', key: category },
                        h('h3', { className: 'category-title' }, this.formatCategoryName(category)),
                        h('div', { className: 'category-functions' },
                            ...groupedFunctions[category].map(fn =>
                                h('div', { className: 'admin-function-item', key: fn.name },
                                    h('div', { className: 'function-info' },
                                        h('h4', { className: 'function-name' }, this.escapeHtml(fn.name)),
                                        h('p', { className: 'function-description' },
                                            this.escapeHtml(fn.description || 'No description')
                                        )
                                    ),
                                    h('button', {
                                        className: 'function-select-button',
                                        onClick: () => this.selectFunction(fn)
                                    }, 'Execute')
                                )
                            )
                        )
                    )
                )
            )
        );
    }

    renderFunctionForm() {
        const { selectedFunction: fn, executing, executionResult, currentConfig, loadingConfig, functionParams } = this.state;
        const params = fn.inputs || [];
        const isConfigure = fn.name === 'configure';

        return h('div', { className: 'admin-dashboard' },
            h('div', { className: 'admin-dashboard-header' },
                h('button', {
                    className: 'back-button',
                    onClick: this.bind(this.handleBack)
                }, '\u2190 Back'),
                h('h2', null, this.escapeHtml(fn.name)),
                h('p', { className: 'admin-dashboard-subtitle' }, this.escapeHtml(fn.description || ''))
            ),

            isConfigure && currentConfig && h('div', { className: 'current-config-display' },
                h('h3', null, 'Current Configuration'),
                h('div', { className: 'config-values' },
                    h('div', { className: 'config-item' },
                        h('label', null, 'Current URI:'),
                        h('div', { className: 'config-value' }, this.escapeHtml(currentConfig.uri || '(empty)'))
                    ),
                    h('div', { className: 'config-item' },
                        h('label', null, 'Current Unrevealed URI:'),
                        h('div', { className: 'config-value' }, this.escapeHtml(currentConfig.unrevealedUri || '(empty)'))
                    ),
                    h('div', { className: 'config-item' },
                        h('label', null, 'Currently Revealed:'),
                        h('div', { className: 'config-value' }, currentConfig.revealed ? 'Yes' : 'No')
                    )
                )
            ),

            loadingConfig && h('div', { className: 'loading-config' },
                h('p', null, 'Loading current configuration...')
            ),

            h('form', {
                className: 'admin-function-form',
                onSubmit: this.bind(this.handleSubmit)
            },
                ...params.map((param, index) => {
                    const paramName = param.name || `param${index}`;
                    const currentValue = functionParams[paramName] || '';

                    return h('div', { className: 'form-field', key: paramName },
                        h('label', { htmlFor: `param-${index}` },
                            this.escapeHtml(param.name || `Parameter ${index + 1}`),
                            h('span', { className: 'param-type' }, ` (${this.escapeHtml(param.type)})`)
                        ),
                        param.type === 'bool'
                            ? h('select', {
                                id: `param-${index}`,
                                disabled: executing,
                                value: currentValue,
                                onChange: (e) => this.handleParamChange(paramName, e.target.value)
                            },
                                h('option', { value: 'true' }, 'True'),
                                h('option', { value: 'false' }, 'False')
                            )
                            : h('input', {
                                type: 'text',
                                id: `param-${index}`,
                                placeholder: `Enter ${this.escapeHtml(param.name || 'value')}`,
                                value: currentValue,
                                disabled: executing,
                                onInput: (e) => this.handleParamChange(paramName, e.target.value)
                            })
                    );
                }),

                h('div', { className: 'form-actions' },
                    h('button', {
                        type: 'submit',
                        className: 'execute-button',
                        disabled: executing
                    }, executing ? 'Executing...' : 'Execute Function')
                )
            ),

            executionResult && h('div', {
                className: `execution-result ${executionResult.success ? 'success' : 'error'}`
            },
                h('p', null, this.escapeHtml(executionResult.message))
            )
        );
    }

    render() {
        const { loading, error, adminFunctions, selectedFunction } = this.state;

        if (loading) {
            return h('div', { className: 'admin-dashboard loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading admin functions...')
            );
        }

        if (error) {
            return h('div', { className: 'admin-dashboard error' },
                h('p', { className: 'error-message' }, this.escapeHtml(error))
            );
        }

        if (adminFunctions.length === 0) {
            return h('div', { className: 'admin-dashboard empty' },
                h('p', null, 'No admin functions found for this contract.')
            );
        }

        if (selectedFunction) {
            return this.renderFunctionForm();
        }

        return this.renderFunctionList();
    }
}

export default AdminDashboard;
