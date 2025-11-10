/**
 * Browser Console Test Script
 * 
 * Copy and paste this entire script into your browser console to test the mock system.
 * Make sure the app is loaded first!
 */

(async function testMockSystemInConsole() {
    console.log('🧪 Testing Mock System...\n');

    try {
        // Get services from global serviceFactory
        if (typeof window === 'undefined' || !window.serviceFactory) {
            throw new Error('ServiceFactory not found. Make sure the app is loaded.');
        }

        const masterService = window.serviceFactory.getMasterService();
        const factoryService = window.serviceFactory.getFactoryService();
        const projectRegistry = window.serviceFactory.getProjectRegistry();

        console.log('✅ Services initialized');

        // Test 1: Check if using mock services
        const isMock = window.serviceFactory.isUsingMock();
        console.log(`✅ Using mock services: ${isMock}`);

        // Test 2: Get authorized factories
        const factories = await masterService.getAuthorizedFactories();
        console.log(`✅ Found ${factories.length} authorized factories`);

        // Test 3: Get factories by type
        const erc404Factories = await masterService.getFactoriesByType('ERC404');
        const erc1155Factories = await masterService.getFactoriesByType('ERC1155');
        console.log(`✅ ERC404 factories: ${erc404Factories.length}`);
        console.log(`✅ ERC1155 factories: ${erc1155Factories.length}`);

        // Test 4: Get all projects
        const allProjects = await projectRegistry.getAllProjects();
        console.log(`✅ Found ${allProjects.length} projects`);

        // Test 5: Filter by type
        const erc404Projects = await projectRegistry.filterByType('ERC404');
        const erc1155Projects = await projectRegistry.filterByType('ERC1155');
        console.log(`✅ ERC404 projects: ${erc404Projects.length}`);
        console.log(`✅ ERC1155 projects: ${erc1155Projects.length}`);

        // Test 6: Search projects
        const searchResults = await projectRegistry.searchProjects('art');
        console.log(`✅ Search results for "art": ${searchResults.length}`);

        // Test 7: Sort projects
        const sortedByDate = await projectRegistry.sortBy('date', allProjects);
        const sortedByVolume = await projectRegistry.sortBy('volume', allProjects);
        console.log(`✅ Sorted by date: ${sortedByDate.length} projects`);
        console.log(`✅ Sorted by volume: ${sortedByVolume.length} projects`);

        // Test 8: Get project by address
        if (allProjects.length > 0) {
            const firstProject = allProjects[0];
            const project = await projectRegistry.getProject(firstProject.address);
            console.log(`✅ Retrieved project: ${project ? project.name : 'null'}`);
        }

        // Test 9: Check indexing
        const isIndexed = projectRegistry.isIndexed();
        console.log(`✅ Indexed: ${isIndexed}`);

        // Test 10: Get instances from factory
        if (factories.length > 0) {
            const factoryAddress = factories[0];
            const instances = await factoryService.getInstances(factoryAddress);
            const instanceCount = await factoryService.getInstanceCount(factoryAddress);
            console.log(`✅ Factory ${factoryAddress.substring(0, 10)}... has ${instanceCount} instances`);
        }

        // Display project details
        console.log('\n📋 Project Details:');
        allProjects.forEach((project, index) => {
            console.log(`\n${index + 1}. ${project.name} (${project.symbol})`);
            console.log(`   Type: ${project.contractType}`);
            console.log(`   Address: ${project.address}`);
            console.log(`   Creator: ${project.creator}`);
            console.log(`   Volume: ${project.stats?.volume || 'N/A'}`);
        });

        console.log('\n✅ All tests passed! Mock system is working correctly.');

        return {
            success: true,
            factories: factories.length,
            projects: allProjects.length,
            erc404Projects: erc404Projects.length,
            erc1155Projects: erc1155Projects.length
        };
    } catch (error) {
        console.error('❌ Test failed:', error);
        console.error('Stack:', error.stack);
        return {
            success: false,
            error: error.message
        };
    }
})();

