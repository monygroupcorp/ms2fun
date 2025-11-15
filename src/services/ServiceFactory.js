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
import createExecVotingService from './ExecVotingService.js';

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
        this.execVotingService = null;

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

    /**
     * Get EXEC voting service instance
     * @returns {MockExecVotingService|RealExecVotingService} Voting service
     */
    getExecVotingService() {
        if (!this.execVotingService) {
            const mockData = this.useMock ? this.mockManager?.getMockData() : null;
            this.execVotingService = createExecVotingService(
                '0xMASTER0000000000000000000000000000000000', // master contract address
                '0xEXEC4040000000000000000000000000000000000', // EXEC token address
                mockData
            );
        }
        return this.execVotingService;
    }

    /**
     * Check if using mock services
     * @returns {boolean} True if using mock services
     */
    isUsingMock() {
        return this.useMock;
    }

    /**
     * Get mock data (for mock services)
     * @returns {object|null} Mock data or null
     */
    getMockData() {
        return this.mockManager?.getMockData() || null;
    }
}

// Export singleton instance
const serviceFactory = new ServiceFactory();
export default serviceFactory;

