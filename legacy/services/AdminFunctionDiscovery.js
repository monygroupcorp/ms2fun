/**
 * Admin Function Discovery Service
 * 
 * Discovers admin functions from contract ABIs by analyzing function signatures
 * and identifying patterns that indicate admin-only functions.
 */

class AdminFunctionDiscovery {
    constructor() {
        // Admin function patterns
        this.adminPatterns = [
            /^set/i,           // setStyle, setMetadata, etc.
            /^withdraw/i,      // withdraw, withdrawFunds, etc.
            /^lock/i,          // lockMetadata, lock, etc.
            /^unlock/i,        // unlockMetadata, unlock, etc.
            /^pause/i,         // pause, pauseMinting, etc.
            /^unpause/i,       // unpause, unpauseMinting, etc.
            /^update/i,        // updateMetadata, updateStyle, etc.
            /^configure/i,     // configure, configureMetadata, etc.
            /^collect/i,       // collectV3Fees, collect, etc.
            /^transferOwnership/i,
            /^renounceOwnership/i,
            /^addAdmin/i,
            /^removeAdmin/i,
            /^setAdmin/i,
        ];

        // Function categories for grouping
        this.categories = {
            settings: ['set', 'update', 'configure'],
            withdrawals: ['withdraw', 'collect'],
            metadata: ['setMetadata', 'updateMetadata', 'lockMetadata', 'unlockMetadata'],
            access: ['pause', 'unpause', 'addAdmin', 'removeAdmin'],
            ownership: ['transferOwnership', 'renounceOwnership']
        };
    }

    /**
     * Discover admin functions from contract ABI
     * @param {string} contractAddress - Contract address
     * @param {string} contractType - Contract type
     * @param {Array} abi - Contract ABI array
     * @returns {Promise<Array>} Array of admin function definitions
     */
    async discoverAdminFunctions(contractAddress, contractType, abi) {
        if (!abi || !Array.isArray(abi)) {
            return [];
        }

        try {
            const functions = this._analyzeABI(abi);
            const adminFunctions = functions.filter(fn => this._isAdminFunction(fn));
            
            // Enrich with metadata
            return adminFunctions.map(fn => this._enrichFunctionDefinition(fn, contractAddress, contractType));
        } catch (error) {
            console.error('[AdminFunctionDiscovery] Error discovering admin functions:', error);
            return [];
        }
    }

    /**
     * Analyze ABI to extract functions
     * @private
     */
    _analyzeABI(abi) {
        return abi
            .filter(item => item.type === 'function')
            .filter(item => item.stateMutability !== 'view' && item.stateMutability !== 'pure')
            .map(item => ({
                name: item.name,
                inputs: item.inputs || [],
                outputs: item.outputs || [],
                stateMutability: item.stateMutability,
                payable: item.stateMutability === 'payable',
                constant: item.constant || false
            }));
    }

    /**
     * Check if function is an admin function
     * @private
     */
    _isAdminFunction(functionDef) {
        const name = functionDef.name;

        // Check against patterns
        for (const pattern of this.adminPatterns) {
            if (pattern.test(name)) {
                return true;
            }
        }

        // Check for onlyOwner modifier (if ABI includes modifiers)
        // Note: Most ABIs don't include modifiers, but we can check if available
        if (functionDef.modifiers && functionDef.modifiers.includes('onlyOwner')) {
            return true;
        }

        return false;
    }

    /**
     * Enrich function definition with metadata
     * @private
     */
    _enrichFunctionDefinition(functionDef, contractAddress, contractType) {
        const category = this._categorizeFunction(functionDef.name);
        const description = this._generateDescription(functionDef);
        
        // Mark cultexecs functions
        const cultexecsAddress = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';
        const isCultExecs = contractAddress && 
                           (contractAddress.toLowerCase() === cultexecsAddress.toLowerCase());

        return {
            name: functionDef.name,
            inputs: functionDef.inputs,
            outputs: functionDef.outputs,
            payable: functionDef.payable,
            category: category,
            description: description,
            contractAddress: contractAddress,
            contractType: contractType,
            isCultExecs: isCultExecs
        };
    }

    /**
     * Categorize function by name
     * @private
     */
    _categorizeFunction(functionName) {
        const lowerName = functionName.toLowerCase();

        // Check each category
        for (const [category, keywords] of Object.entries(this.categories)) {
            for (const keyword of keywords) {
                if (lowerName.includes(keyword.toLowerCase())) {
                    return category;
                }
            }
        }

        // Default category
        return 'other';
    }

    /**
     * Generate human-readable description for function
     * @private
     */
    _generateDescription(functionDef) {
        const name = functionDef.name;
        
        // Generate description based on function name
        if (name === 'configure') {
            return 'Update token URI configuration (URI, unrevealed URI, and reveal status)';
        }
        if (name === 'collectV3Fees') {
            return 'Collect fees from the Uniswap V3 liquidity position';
        }
        if (name.startsWith('set')) {
            const param = name.substring(3);
            return `Set ${this._formatParameterName(param)}`;
        }
        if (name.startsWith('withdraw')) {
            return 'Withdraw funds from contract';
        }
        if (name.startsWith('collect')) {
            return 'Collect fees or rewards from contract';
        }
        if (name.startsWith('lock')) {
            const param = name.substring(4);
            return `Lock ${this._formatParameterName(param)}`;
        }
        if (name.startsWith('unlock')) {
            const param = name.substring(6);
            return `Unlock ${this._formatParameterName(param)}`;
        }
        if (name.startsWith('pause')) {
            return 'Pause contract operations';
        }
        if (name.startsWith('unpause')) {
            return 'Unpause contract operations';
        }
        if (name.includes('Ownership')) {
            return 'Transfer contract ownership';
        }

        // Default: format function name
        return this._formatFunctionName(name);
    }

    /**
     * Format parameter name for display
     * @private
     */
    _formatParameterName(name) {
        // Convert camelCase to Title Case
        return name
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    /**
     * Format function name for display
     * @private
     */
    _formatFunctionName(name) {
        // Convert camelCase to Title Case
        return name
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    /**
     * Get ABI from contract adapter
     * @param {Object} adapter - Contract adapter instance
     * @returns {Promise<Array|null>} Contract ABI or null
     */
    async getABIFromAdapter(adapter) {
        if (!adapter) {
            return null;
        }

        try {
            // For cultexecs, try to load ABI directly if contract not initialized
            const cultexecsAddress = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';
            if (adapter.contractAddress && 
                (adapter.contractAddress === cultexecsAddress || 
                 adapter.contractAddress.toLowerCase() === cultexecsAddress.toLowerCase())) {
                try {
                    const abiResponse = await fetch('/EXEC404/abi.json');
                    if (abiResponse.ok) {
                        return await abiResponse.json();
                    }
                } catch (error) {
                    console.warn('[AdminFunctionDiscovery] Could not load cultexecs ABI directly:', error);
                }
            }

            // Try to get ABI from contract interface
            if (adapter.contract && adapter.contract.interface && adapter.contract.interface.fragments) {
                // Convert fragments to ABI format
                const fragments = adapter.contract.interface.fragments;
                return fragments.map(fragment => {
                    if (fragment.type === 'function') {
                        return {
                            type: 'function',
                            name: fragment.name,
                            inputs: fragment.inputs.map(input => ({
                                name: input.name,
                                type: input.type,
                                internalType: input.type
                            })),
                            outputs: fragment.outputs ? fragment.outputs.map(output => ({
                                name: output.name,
                                type: output.type,
                                internalType: output.type
                            })) : [],
                            stateMutability: fragment.stateMutability
                        };
                    }
                    return null;
                }).filter(Boolean);
            }

            // If adapter has ABI stored, use it
            if (adapter.abi) {
                return adapter.abi;
            }

            return null;
        } catch (error) {
            console.warn('[AdminFunctionDiscovery] Error getting ABI from adapter:', error);
            return null;
        }
    }

    /**
     * Discover admin functions from adapter
     * @param {Object} adapter - Contract adapter instance
     * @returns {Promise<Array>} Array of admin function definitions
     */
    async discoverFromAdapter(adapter) {
        if (!adapter) {
            return [];
        }

        try {
            // For mock contracts, provide default admin functions for testing
            if (adapter.isMock) {
                return this.getMockAdminFunctions(adapter.contractAddress, adapter.contractType);
            }

            const abi = await this.getABIFromAdapter(adapter);
            if (!abi) {
                // If no ABI available, return empty array (or mock functions for testing)
                return [];
            }

            return await this.discoverAdminFunctions(
                adapter.contractAddress,
                adapter.contractType,
                abi
            );
        } catch (error) {
            console.error('[AdminFunctionDiscovery] Error discovering from adapter:', error);
            // Return mock functions as fallback for testing
            if (adapter && adapter.isMock) {
                return this.getMockAdminFunctions(adapter.contractAddress, adapter.contractType);
            }
            return [];
        }
    }

    /**
     * Get mock admin functions for testing
     * @param {string} contractAddress - Contract address
     * @param {string} contractType - Contract type
     * @returns {Array} Array of mock admin function definitions
     */
    getMockAdminFunctions(contractAddress, contractType) {
        const mockFunctions = [
            {
                name: 'setStyle',
                inputs: [
                    { name: 'style', type: 'string', internalType: 'string' }
                ],
                outputs: [],
                payable: false,
                category: 'settings',
                description: 'Set the style/theme for the project page',
                contractAddress: contractAddress,
                contractType: contractType
            },
            {
                name: 'setMetadata',
                inputs: [
                    { name: 'metadataURI', type: 'string', internalType: 'string' }
                ],
                outputs: [],
                payable: false,
                category: 'metadata',
                description: 'Update the metadata URI for the collection',
                contractAddress: contractAddress,
                contractType: contractType
            },
            {
                name: 'lockMetadata',
                inputs: [],
                outputs: [],
                payable: false,
                category: 'metadata',
                description: 'Lock metadata to prevent further changes',
                contractAddress: contractAddress,
                contractType: contractType
            },
            {
                name: 'unlockMetadata',
                inputs: [],
                outputs: [],
                payable: false,
                category: 'metadata',
                description: 'Unlock metadata to allow changes',
                contractAddress: contractAddress,
                contractType: contractType
            },
            {
                name: 'withdraw',
                inputs: [],
                outputs: [],
                payable: false,
                category: 'withdrawals',
                description: 'Withdraw mint funds from the contract',
                contractAddress: contractAddress,
                contractType: contractType
            },
            {
                name: 'pause',
                inputs: [],
                outputs: [],
                payable: false,
                category: 'access',
                description: 'Pause contract operations',
                contractAddress: contractAddress,
                contractType: contractType
            },
            {
                name: 'unpause',
                inputs: [],
                outputs: [],
                payable: false,
                category: 'access',
                description: 'Unpause contract operations',
                contractAddress: contractAddress,
                contractType: contractType
            }
        ];

        return mockFunctions;
    }
}

// Create singleton instance
const adminFunctionDiscovery = new AdminFunctionDiscovery();

export default adminFunctionDiscovery;

