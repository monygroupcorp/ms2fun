/**
 * Data Seeder
 * 
 * Utility functions for initializing and resetting mock data.
 */

import { initializeMockData, generateMockAddress, saveMockData, loadMockData } from './mockData.js';

/**
 * Initialize mock data structure
 * @param {boolean} loadFromStorage - Whether to load from localStorage if available
 * @returns {object} Initialized mock data
 */
export function seedMockData(loadFromStorage = true) {
    let data = initializeMockData();
    
    if (loadFromStorage) {
        const saved = loadMockData();
        if (saved) {
            data = saved;
        }
    }
    
    return data;
}

/**
 * Reset mock data to empty state
 * @returns {object} Fresh empty mock data
 */
export function resetMockData() {
    const data = initializeMockData();
    saveMockData(data);
    return data;
}


