/**
 * Mock Service Manager
 * 
 * Coordinates and initializes all mock services.
 */

import { seedMockData, resetMockData } from './dataSeeder.js';
import MockMasterService from './MockMasterService.js';
import MockFactoryService from './MockFactoryService.js';
import MockProjectRegistry from './MockProjectRegistry.js';
import { seedExampleData } from './exampleData.js';
import { saveMockData } from './mockData.js';

/**
 * Manager class for mock services
 */
export default class MockServiceManager {
    /**
     * @param {boolean} loadFromStorage - Whether to load from localStorage
     * @param {boolean} seedData - Whether to seed example data
     */
    constructor(loadFromStorage = true, seedData = true) {
        this.data = null;
        this.masterService = null;
        this.factoryService = null;
        this.projectRegistry = null;

        this.initialize(loadFromStorage, seedData);
    }

    /**
     * Initialize mock services
     * @param {boolean} loadFromStorage - Whether to load from localStorage
     * @param {boolean} seedData - Whether to seed example data
     */
    initialize(loadFromStorage = true, seedData = true) {
        // Initialize mock data
        this.data = seedMockData(loadFromStorage);

        // Create service instances
        this.masterService = new MockMasterService(this.data);
        this.factoryService = new MockFactoryService(this.data, this.masterService);
        this.projectRegistry = new MockProjectRegistry(this.data);

        // Seed example data if requested and needed
        if (seedData) {
            // Check if seeding is needed
            if (this.needsSeeding()) {
                // seedExampleData will handle indexing after seeding completes
                this.seedExampleData();
                return; // Don't index here, let seedExampleData handle it
            }
        }

        // Index projects (only if seeding was not needed or not requested)
        this.projectRegistry.indexFromMaster();
    }

    /**
     * Seed example data
     */
    async seedExampleData() {
        try {
            await seedExampleData(this.data, this.masterService, this.factoryService);
            // Re-index after seeding
            await this.projectRegistry.indexFromMaster();
        } catch (error) {
            console.warn('Error seeding example data:', error);
        }
    }

    /**
     * Check if data needs to be seeded
     * @returns {boolean} True if seeding is needed
     */
    needsSeeding() {
        const erc404FactoryAddress = '0xFACTORY4040000000000000000000000000000000';
        const erc1155FactoryAddress = '0xFACTORY1155000000000000000000000000000000';
        const TARGET_INSTANCES = 8;

        const erc404Factory = this.data.factories[erc404FactoryAddress];
        const erc1155Factory = this.data.factories[erc1155FactoryAddress];

        // Need seeding if factories don't exist
        if (!erc404Factory || !erc1155Factory) {
            return true;
        }

        // Get instance counts
        const erc404Instances = erc404Factory.instances || [];
        const erc1155Instances = erc1155Factory.instances || [];

        // Need seeding if instance counts are wrong
        if (erc404Instances.length !== TARGET_INSTANCES || 
            erc1155Instances.length !== TARGET_INSTANCES) {
            return true;
        }

        return false; // Everything is correct, no seeding needed
    }

    /**
     * Reset all mock data
     */
    reset() {
        this.data = resetMockData();
        this.masterService = new MockMasterService(this.data);
        this.factoryService = new MockFactoryService(this.data, this.masterService);
        this.projectRegistry = new MockProjectRegistry(this.data);
    }

    /**
     * Get master service instance
     * @returns {MockMasterService} Master service
     */
    getMasterService() {
        return this.masterService;
    }

    /**
     * Get factory service instance
     * @returns {MockFactoryService} Factory service
     */
    getFactoryService() {
        return this.factoryService;
    }

    /**
     * Get project registry instance
     * @returns {MockProjectRegistry} Project registry
     */
    getProjectRegistry() {
        return this.projectRegistry;
    }

    /**
     * Get mock data structure
     * @returns {object} Mock data
     */
    getMockData() {
        return this.data;
    }
}

