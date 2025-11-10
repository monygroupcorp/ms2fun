/**
 * Mock Data Structure
 * 
 * Core data structure for the mock master contract, factory, and instance system.
 * Provides localStorage persistence for development convenience.
 */

/**
 * Generate a mock Ethereum address
 * @returns {string} Mock address (0x followed by 40 hex characters)
 */
export function generateMockAddress() {
    const random = Math.random().toString(16).substring(2, 42);
    return '0x' + random.padStart(40, '0');
}

/**
 * Initialize empty mock data structure
 * @returns {object} Empty mock data structure
 */
export function initializeMockData() {
    return {
        masterContract: {
            address: '0xMASTER0000000000000000000000000000000000',
            owner: '0xOWNER0000000000000000000000000000000000',
            factories: []
        },
        factories: {},
        instances: {},
        projectIndex: {
            byType: {},
            byFactory: {},
            byCreator: {},
            all: []
        }
    };
}

/**
 * Load mock data from localStorage
 * @returns {object|null} Loaded mock data or null if not found
 */
export function loadMockData() {
    try {
        const saved = localStorage.getItem('mockLaunchpadData');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (error) {
        console.warn('Failed to load mock data from localStorage:', error);
    }
    return null;
}

/**
 * Save mock data to localStorage
 * @param {object} data - Mock data to save
 */
export function saveMockData(data) {
    try {
        localStorage.setItem('mockLaunchpadData', JSON.stringify(data));
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            console.warn('localStorage quota exceeded, mock data not saved');
        } else {
            console.warn('Failed to save mock data to localStorage:', error);
        }
    }
}

/**
 * Clear all mock data from localStorage
 */
export function clearMockData() {
    try {
        localStorage.removeItem('mockLaunchpadData');
    } catch (error) {
        console.warn('Failed to clear mock data from localStorage:', error);
    }
}

