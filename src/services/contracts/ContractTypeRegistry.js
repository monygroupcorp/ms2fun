/**
 * Contract Type Registry
 * 
 * Manages contract type detection and adapter mapping.
 * Supports extensible registration of new contract types.
 */

class ContractTypeRegistry {
    constructor() {
        // Store type registry: type -> { adapterClass, detector }
        this.types = new Map();
        
        // Register built-in types
        this._registerBuiltInTypes();
    }

    /**
     * Register a contract type with its adapter class and detector function
     * @param {string} type - Contract type identifier (e.g., 'ERC404', 'ERC1155')
     * @param {class|null} adapterClass - Adapter class for this contract type (optional, can be set later)
     * @param {Function} detector - Function to detect this type from ABI: (abi) => boolean
     */
    registerType(type, adapterClass, detector) {
        if (!type || typeof type !== 'string') {
            throw new Error('Type must be a non-empty string');
        }
        if (!detector || typeof detector !== 'function') {
            throw new Error('Detector function is required');
        }

        this.types.set(type, {
            adapterClass: adapterClass || null,
            detector
        });

        console.log(`[ContractTypeRegistry] Registered type: ${type}${adapterClass ? ' (with adapter)' : ' (adapter to be set later)'}`);
    }

    /**
     * Get adapter class for a contract type
     * @param {string} type - Contract type identifier
     * @returns {class|null} Adapter class or null if not registered or not set
     * @throws {Error} If type is registered but adapter class is not set
     */
    getAdapterClass(type) {
        const entry = this.types.get(type);
        if (!entry) {
            return null;
        }
        if (!entry.adapterClass) {
            throw new Error(`Adapter class not set for type: ${type}. Use setAdapterClass() to set it.`);
        }
        return entry.adapterClass;
    }

    /**
     * Detect contract type from ABI
     * @param {Array} abi - Contract ABI array
     * @returns {string|null} Detected contract type or null if unknown
     */
    detectContractTypeFromABI(abi) {
        if (!abi || !Array.isArray(abi)) {
            return null;
        }

        // Extract function names from ABI
        const functions = abi
            .filter(item => item.type === 'function')
            .map(item => item.name)
            .filter(Boolean);

        // Try each registered type's detector
        for (const [type, { detector }] of this.types.entries()) {
            try {
                if (detector(abi, functions)) {
                    return type;
                }
            } catch (error) {
                console.warn(`[ContractTypeRegistry] Error in detector for ${type}:`, error);
            }
        }

        return null; // Unknown type
    }

    /**
     * Detect contract type from address (requires fetching ABI)
     * @param {string} address - Contract address
     * @param {Object} provider - Ethers provider
     * @returns {Promise<string|null>} Detected contract type or null
     */
    async detectContractTypeFromAddress(address, provider) {
        // This would require fetching ABI from a service like Etherscan
        // For now, return null - this can be implemented later
        console.warn('[ContractTypeRegistry] detectContractTypeFromAddress not yet implemented');
        return null;
    }

    /**
     * Detect contract type (from ABI or address)
     * @param {string} address - Contract address (optional)
     * @param {Array} abi - Contract ABI (optional)
     * @param {Object} provider - Ethers provider (optional, for address-based detection)
     * @returns {Promise<string|null>} Detected contract type or null
     */
    async detectContractType(address, abi, provider = null) {
        // Prefer ABI-based detection if available
        if (abi) {
            return this.detectContractTypeFromABI(abi);
        }

        // Fall back to address-based detection if provider is available
        if (address && provider) {
            return await this.detectContractTypeFromAddress(address, provider);
        }

        return null;
    }

    /**
     * Get all registered types
     * @returns {Array<string>} Array of registered type identifiers
     */
    getRegisteredTypes() {
        return Array.from(this.types.keys());
    }

    /**
     * Check if a type is registered
     * @param {string} type - Contract type identifier
     * @returns {boolean} True if type is registered
     */
    isTypeRegistered(type) {
        return this.types.has(type);
    }

    /**
     * Register built-in contract types
     * @private
     */
    _registerBuiltInTypes() {
        // ERC404 detection: has buyBonding, sellBonding, getCurrentPrice
        this.registerType('ERC404', null, (abi, functions) => {
            // Check for ERC404-specific functions
            const hasBuyBonding = functions.includes('buyBonding');
            const hasSellBonding = functions.includes('sellBonding');
            const hasGetCurrentPrice = functions.includes('getCurrentPrice') || 
                                      functions.includes('calculateCost');
            
            return hasBuyBonding && hasSellBonding && hasGetCurrentPrice;
        });

        // ERC1155 detection: has balanceOfBatch, safeBatchTransferFrom
        this.registerType('ERC1155', null, (abi, functions) => {
            const hasBalanceOfBatch = functions.includes('balanceOfBatch');
            const hasSafeBatchTransferFrom = functions.includes('safeBatchTransferFrom');
            const hasUri = functions.includes('uri');
            
            return hasBalanceOfBatch && hasSafeBatchTransferFrom && hasUri;
        });

        // Note: Adapter classes will be set when adapters are imported
        // This allows for lazy loading of adapters
    }

    /**
     * Set adapter class for a type (used when adapters are loaded)
     * @param {string} type - Contract type identifier
     * @param {class} adapterClass - Adapter class
     */
    setAdapterClass(type, adapterClass) {
        const entry = this.types.get(type);
        if (!entry) {
            throw new Error(`Type ${type} is not registered`);
        }
        entry.adapterClass = adapterClass;
        console.log(`[ContractTypeRegistry] Set adapter class for type: ${type}`);
    }
}

// Export singleton instance
const contractTypeRegistry = new ContractTypeRegistry();
export default contractTypeRegistry;

