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

        // MasterRegistryV1 detection: has getTotalFactories, getVaultInfo, getFeaturedInstances
        this.registerType('MasterRegistry', null, (abi, functions) => {
            const hasTotalFactories = functions.includes('getTotalFactories');
            const hasGetVaultInfo = functions.includes('getVaultInfo');
            const hasFeaturedInstances = functions.includes('getFeaturedInstances');

            return hasTotalFactories && hasGetVaultInfo && hasFeaturedInstances;
        });

        // GlobalMessageRegistry detection: has getMessageCount, getRecentMessages
        this.registerType('GlobalMessageRegistry', null, (abi, functions) => {
            const hasGetMessageCount = functions.includes('getMessageCount');
            const hasGetRecentMessages = functions.includes('getRecentMessages');
            const hasGetInstanceMessages = functions.includes('getInstanceMessages');

            return hasGetMessageCount && hasGetRecentMessages && hasGetInstanceMessages;
        });

        // ERC404BondingInstance detection: has stake, unstake, buyBonding (extends ERC404)
        this.registerType('ERC404Bonding', null, (abi, functions) => {
            const hasBuyBonding = functions.includes('buyBonding');
            const hasStake = functions.includes('stake');
            const hasUnstake = functions.includes('unstake');
            const hasGetStakingInfo = functions.includes('getStakingInfo');

            return hasBuyBonding && hasStake && hasUnstake && hasGetStakingInfo;
        });

        // UltraAlignmentVault detection: has claimFees, getBenefactorContribution
        this.registerType('UltraAlignmentVault', null, (abi, functions) => {
            const hasClaimFees = functions.includes('claimFees');
            const hasGetBenefactorContribution = functions.includes('getBenefactorContribution');
            const hasConvertAndAddLiquidity = functions.includes('convertAndAddLiquidity');

            return hasClaimFees && hasGetBenefactorContribution && hasConvertAndAddLiquidity;
        });

        // FactoryApprovalGovernance detection: has submitApplication, voteWithDeposit, registerFactory
        this.registerType('FactoryGovernance', null, (abi, functions) => {
            const hasSubmitApplication = functions.includes('submitApplication');
            const hasVoteWithDeposit = functions.includes('voteWithDeposit');
            const hasRegisterFactory = functions.includes('registerFactory');

            return hasSubmitApplication && hasVoteWithDeposit && hasRegisterFactory;
        });

        // VaultApprovalGovernance detection: has submitApplication, voteWithDeposit, registerVault
        this.registerType('VaultGovernance', null, (abi, functions) => {
            const hasSubmitApplication = functions.includes('submitApplication');
            const hasVoteWithDeposit = functions.includes('voteWithDeposit');
            const hasRegisterVault = functions.includes('registerVault');

            return hasSubmitApplication && hasVoteWithDeposit && hasRegisterVault;
        });

        // ERC404Factory detection: has createInstance, getHookForInstance
        this.registerType('ERC404Factory', null, (abi, functions) => {
            const hasCreateInstance = functions.includes('createInstance');
            const hasGetHookForInstance = functions.includes('getHookForInstance');

            // Distinguish from ERC1155Factory by checking for ERC404-specific methods
            const hasERC404Methods = functions.some(f =>
                f.includes('Bonding') || f.includes('Hook')
            );

            return hasCreateInstance && hasGetHookForInstance && hasERC404Methods;
        });

        // ERC1155Factory detection: has createInstance, addEdition
        this.registerType('ERC1155Factory', null, (abi, functions) => {
            const hasCreateInstance = functions.includes('createInstance');
            const hasAddEdition = functions.includes('addEdition');
            const hasGetVaultForInstance = functions.includes('getVaultForInstance');

            return hasCreateInstance && hasAddEdition && hasGetVaultForInstance;
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

