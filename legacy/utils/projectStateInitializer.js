/**
 * Project State Initializer
 * 
 * Utility functions to initialize project state from ProjectService data.
 * Ensures consistency between ProjectService and ProjectStore state formats.
 */

/**
 * Initialize project state from ProjectService data
 * @param {Object} projectServiceData - Project data from ProjectService
 * @returns {Object} Initialized project state
 */
export function initializeProjectState(projectServiceData) {
    return {
        id: projectServiceData.projectId || projectServiceData.id,
        contractAddress: projectServiceData.contractAddress || projectServiceData.address || '',
        contractType: projectServiceData.contractType || 'ERC404',
        name: projectServiceData.name || projectServiceData.projectId || projectServiceData.id,
        factoryAddress: projectServiceData.factoryAddress || null,
        isFactoryCreated: projectServiceData.isFactoryCreated || (projectServiceData.factoryAddress !== null),
        
        // Contract addresses
        ca: projectServiceData.contractAddress || projectServiceData.address || '',
        mirror: projectServiceData.mirrorAddress || projectServiceData.mirror || '',
        
        // Trading state defaults
        isEthToExec: true,
        ethAmount: '',
        execAmount: '',
        showMessageOption: false,
        mintOptionChecked: false,
        transactionMessage: '',
        
        // View state
        view: {
            isMobile: typeof window !== 'undefined' && window.innerWidth <= 768,
            showCurve: true,
            showSwap: true
        },
        
        // Price state
        price: {
            current: 0,
            lastUpdated: null
        },
        
        // Balance state
        balances: {
            eth: '0',
            exec: '0',
            nfts: '0',
            userNFTs: [],
            lastUpdated: null
        },
        
        // Message state
        message: {
            text: '',
            pending: '',
            debounceActive: false
        },
        
        // Options
        options: {},
        
        // Status
        status: {
            loading: false,
            error: null
        },
        
        // Amounts tracking
        amounts: {
            lastUpdated: null
        },
        
        // Transaction validity
        isTransactionValid: true,
        
        // Contract data
        contractData: {
            totalBondingSupply: 0,
            lastUpdated: null,
            totalMessages: 0,
            totalNFTs: 0,
            recentMessages: null,
            freeSupply: 0,
            freeMint: 0,
            liquidityPool: null
        },
        
        // Pool data
        poolData: {
            liquidityPool: null,
            reserve0: 0,
            reserve1: 0
        }
    };
}

/**
 * Convert ProjectService instance metadata to ProjectStore metadata format
 * @param {Object} projectInstance - Project instance from ProjectService
 * @returns {Object} Metadata object for ProjectStore
 */
export function convertProjectServiceMetadata(projectInstance) {
    if (!projectInstance) {
        return {
            contractAddress: '',
            contractType: 'ERC404',
            name: 'Unknown',
            factoryAddress: null,
            isFactoryCreated: false
        };
    }

    const metadata = projectInstance.metadata || {};
    
    return {
        contractAddress: projectInstance.contractAddress || metadata.contractAddress || '',
        contractType: projectInstance.contractType || metadata.contractType || 'ERC404',
        name: metadata.name || projectInstance.projectId || 'Unknown',
        factoryAddress: metadata.factoryAddress || null,
        isFactoryCreated: metadata.isFactoryCreated || (metadata.factoryAddress !== null),
        mirrorAddress: metadata.mirrorAddress || metadata.mirror || ''
    };
}

