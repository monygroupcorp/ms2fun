/**
 * Service Factory
 * 
 * Provides access to mock or real services via feature flag.
 * Singleton pattern ensures consistent service instances.
 */

import { USE_MOCK_SERVICES } from '../config.js';
import MockServiceManager from './mock/MockServiceManager.js';
import ProjectService from './ProjectService.js';
import BlockchainService from './BlockchainService.js';

// Placeholder classes for real services (to be implemented in Phase 6)
class MasterService {
    constructor() {
        throw new Error('Real MasterService not yet implemented. Use mock services.');
    }
}

class FactoryService {
    constructor() {
        throw new Error('Real FactoryService not yet implemented. Use mock services.');
    }
}

class ProjectRegistry {
    constructor() {
        throw new Error('Real ProjectRegistry not yet implemented. Use mock services.');
    }
}

/**
 * Service Factory
 * 
 * Provides access to services (mock or real) based on feature flag.
 */
class ServiceFactory {
    constructor() {
        this.useMock = USE_MOCK_SERVICES;
        this.mockManager = null;
        this.projectService = null;
        this.blockchainService = null;

        if (this.useMock) {
            this.mockManager = new MockServiceManager(true, true);
        }
    }

    /**
     * Get master service instance
     * @returns {MockMasterService|MasterService} Master service
     */
    getMasterService() {
        if (this.useMock) {
            return this.mockManager.getMasterService();
        } else {
            return new MasterService();
        }
    }

    /**
     * Get factory service instance
     * @returns {MockFactoryService|FactoryService} Factory service
     */
    getFactoryService() {
        if (this.useMock) {
            return this.mockManager.getFactoryService();
        } else {
            return new FactoryService();
        }
    }

    /**
     * Get project registry instance
     * @returns {MockProjectRegistry|ProjectRegistry} Project registry
     */
    getProjectRegistry() {
        if (this.useMock) {
            return this.mockManager.getProjectRegistry();
        } else {
            return new ProjectRegistry();
        }
    }

    /**
     * Check if using mock services
     * @returns {boolean} True if using mock services
     */
    isUsingMock() {
        return this.useMock;
    }

    /**
     * Get mock data structure (only available when using mock services)
     * @returns {object|null} Mock data or null if not using mock services
     */
    getMockData() {
        if (this.useMock && this.mockManager) {
            return this.mockManager.getMockData();
        }
        return null;
    }

    /**
     * Get ProjectService instance (singleton)
     * @returns {ProjectService} ProjectService instance
     */
    getProjectService() {
        if (!this.projectService) {
            this.projectService = new ProjectService();
        }
        return this.projectService;
    }

    /**
     * Get BlockchainService instance (singleton)
     * Note: CULT EXEC uses BlockchainService directly
     * @returns {BlockchainService} BlockchainService instance
     */
    getBlockchainService() {
        if (!this.blockchainService) {
            this.blockchainService = new BlockchainService();
        }
        return this.blockchainService;
    }

    /**
     * Get appropriate service for a project
     * CULT EXEC uses BlockchainService, other projects use ProjectService
     * @param {string} projectId - Project identifier
     * @returns {BlockchainService|ProjectService} Appropriate service
     */
    getServiceForProject(projectId) {
        if (projectId === 'exec404') {
            // CULT EXEC uses BlockchainService (existing)
            return this.getBlockchainService();
        } else {
            // Factory-created projects use ProjectService
            return this.getProjectService();
        }
    }
}

// Export singleton instance
const serviceFactory = new ServiceFactory();
export default serviceFactory;

