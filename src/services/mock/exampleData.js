/**
 * Example Data
 * 
 * Seeded example data for testing the mock system.
 */

import { generateMockAddress, saveMockData } from './mockData.js';

const TARGET_INSTANCES_PER_FACTORY = 8;

/**
 * Seed example data into the mock system
 * @param {object} mockData - Mock data structure
 * @param {MockMasterService} masterService - Master service instance
 * @param {MockFactoryService} factoryService - Factory service instance
 * @returns {Promise<void>}
 */
export async function seedExampleData(mockData, masterService, factoryService) {
    // Generate factory addresses
    const erc404FactoryAddress = '0xFACTORY4040000000000000000000000000000000';
    const erc1155FactoryAddress = '0xFACTORY1155000000000000000000000000000000';

    // Register factories with titles (if not already registered)
    try {
        await masterService.registerFactory(erc404FactoryAddress, 'ERC404', 'ERC404 Factory');
        await masterService.registerFactory(erc1155FactoryAddress, 'ERC1155', 'ERC1155 Factory');
    } catch (error) {
        if (!error.message.includes('already registered')) {
            console.warn('Error registering factories:', error);
        }
    }

    // Check existing instances for ERC404 factory
    const existingERC404Instances = await factoryService.getInstances(erc404FactoryAddress);
    const erc404Count = existingERC404Instances.length;
    const erc404Needed = Math.max(0, TARGET_INSTANCES_PER_FACTORY - erc404Count);

    // Remove excess ERC404 instances if any
    if (erc404Count > TARGET_INSTANCES_PER_FACTORY) {
        const excess = erc404Count - TARGET_INSTANCES_PER_FACTORY;
        await removeExcessInstances(mockData, factoryService, erc404FactoryAddress, excess);
    }

    // Check existing instances for ERC1155 factory
    const existingERC1155Instances = await factoryService.getInstances(erc1155FactoryAddress);
    const erc1155Count = existingERC1155Instances.length;
    const erc1155Needed = Math.max(0, TARGET_INSTANCES_PER_FACTORY - erc1155Count);

    // Remove excess ERC1155 instances if any
    if (erc1155Count > TARGET_INSTANCES_PER_FACTORY) {
        const excess = erc1155Count - TARGET_INSTANCES_PER_FACTORY;
        await removeExcessInstances(mockData, factoryService, erc1155FactoryAddress, excess);
    }

    // Only create instances if needed
    if (erc404Needed > 0) {
        await createERC404Instances(mockData, factoryService, erc404FactoryAddress, erc404Needed);
    }

    if (erc1155Needed > 0) {
        await createERC1155Instances(mockData, factoryService, erc1155FactoryAddress, erc1155Needed);
    }

    // Save all changes
    saveMockData(mockData);
}

/**
 * Remove excess instances from a factory
 * @param {object} mockData - Mock data structure
 * @param {MockFactoryService} factoryService - Factory service
 * @param {string} factoryAddress - Factory address
 * @param {number} excessCount - Number of excess instances to remove
 */
async function removeExcessInstances(mockData, factoryService, factoryAddress, excessCount) {
    const factory = mockData.factories[factoryAddress];
    if (!factory || !factory.instances || factory.instances.length === 0) {
        return;
    }

    // Get instances to remove (remove from end, keeping oldest)
    // Sort instances by creation time to keep oldest
    const instancesWithTime = factory.instances.map(addr => ({
        address: addr,
        createdAt: mockData.instances[addr]?.createdAt || 0
    })).sort((a, b) => a.createdAt - b.createdAt);

    // Get the newest instances to remove (last excessCount)
    const instancesToRemove = instancesWithTime.slice(-excessCount).map(item => item.address);

    for (const instanceAddress of instancesToRemove) {
        // Remove from factory instances array
        const index = factory.instances.indexOf(instanceAddress);
        if (index > -1) {
            factory.instances.splice(index, 1);
        }

        // Remove from instances object
        delete mockData.instances[instanceAddress];

        // Remove from project index
        removeFromProjectIndex(mockData, instanceAddress);
    }

    // Update master service instance count
    const factoryEntry = mockData.masterContract.factories.find(
        f => f.address === factoryAddress
    );
    if (factoryEntry) {
        factoryEntry.instanceCount = factory.instances.length;
    }

    // Save changes
    saveMockData(mockData);
}

/**
 * Remove instance from project index
 * @param {object} mockData - Mock data structure
 * @param {string} instanceAddress - Instance address to remove
 */
function removeFromProjectIndex(mockData, instanceAddress) {
    const instance = mockData.instances[instanceAddress];
    if (!instance) return;

    // Remove from byType index
    const typeArray = mockData.projectIndex.byType[instance.contractType];
    if (typeArray) {
        const typeIndex = typeArray.indexOf(instanceAddress);
        if (typeIndex > -1) {
            typeArray.splice(typeIndex, 1);
        }
    }

    // Remove from byFactory index
    const factoryArray = mockData.projectIndex.byFactory[instance.factoryAddress];
    if (factoryArray) {
        const factoryIndex = factoryArray.indexOf(instanceAddress);
        if (factoryIndex > -1) {
            factoryArray.splice(factoryIndex, 1);
        }
    }

    // Remove from byCreator index
    const creatorArray = mockData.projectIndex.byCreator[instance.creator];
    if (creatorArray) {
        const creatorIndex = creatorArray.indexOf(instanceAddress);
        if (creatorIndex > -1) {
            creatorArray.splice(creatorIndex, 1);
        }
    }

    // Remove from all array
    const allIndex = mockData.projectIndex.all.indexOf(instanceAddress);
    if (allIndex > -1) {
        mockData.projectIndex.all.splice(allIndex, 1);
    }
}

/**
 * Create ERC404 instances
 * @param {object} mockData - Mock data structure
 * @param {MockFactoryService} factoryService - Factory service
 * @param {string} factoryAddress - Factory address
 * @param {number} count - Number of instances to create
 */
async function createERC404Instances(mockData, factoryService, factoryAddress, count) {
    const erc404Templates = [
        {
            name: 'Digital Art Collective',
            symbol: 'DAC',
            description: 'A community-driven ERC404 project featuring digital art pieces with fractional ownership.',
            metadataURI: 'ipfs://QmExample1',
            creator: '0xCREATOR1111111111111111111111111111111111',
            stats: { totalSupply: 1000000, holders: 150, volume: '50.5 ETH' }
        },
        {
            name: 'Crypto Memes Token',
            symbol: 'MEME',
            description: 'The ultimate meme token with bonding curve mechanics. Join the meme revolution!',
            metadataURI: 'ipfs://QmExample2',
            creator: '0xCREATOR2222222222222222222222222222222222',
            stats: { totalSupply: 5000000, holders: 320, volume: '125.8 ETH' }
        },
        {
            name: 'Fractional NFT Protocol',
            symbol: 'FNFT',
            description: 'Fractionalize any NFT into tradeable tokens. Own a piece of the art you love.',
            metadataURI: 'ipfs://QmExample5',
            creator: '0xCREATOR5555555555555555555555555555555555',
            stats: { totalSupply: 2000000, holders: 280, volume: '89.3 ETH' }
        },
        {
            name: 'DeFi Art Token',
            symbol: 'DAT',
            description: 'Combine DeFi yield farming with digital art ownership. Earn while you collect.',
            metadataURI: 'ipfs://QmExample6',
            creator: '0xCREATOR6666666666666666666666666666666666',
            stats: { totalSupply: 3000000, holders: 450, volume: '156.7 ETH' }
        },
        {
            name: 'Generative Art Series',
            symbol: 'GAS',
            description: 'Algorithmically generated art pieces with unique properties. Each token is one-of-a-kind.',
            metadataURI: 'ipfs://QmExample7',
            creator: '0xCREATOR7777777777777777777777777777777777',
            stats: { totalSupply: 10000, holders: 890, volume: '234.1 ETH' }
        },
        {
            name: 'Music Royalty Token',
            symbol: 'MRT',
            description: 'Own a share of music royalties through ERC404 tokens. Support artists directly.',
            metadataURI: 'ipfs://QmExample8',
            creator: '0xCREATOR8888888888888888888888888888888888',
            stats: { totalSupply: 500000, holders: 120, volume: '67.4 ETH' }
        },
        {
            name: 'Virtual Real Estate',
            symbol: 'VRE',
            description: 'Own virtual land parcels in the metaverse. Build, trade, and monetize your space.',
            metadataURI: 'ipfs://QmExample9',
            creator: '0xCREATOR9999999999999999999999999999999999',
            stats: { totalSupply: 100000, holders: 340, volume: '189.2 ETH' }
        },
        {
            name: 'AI Art Collection',
            symbol: 'AIA',
            description: 'AI-generated art pieces with unique styles. Each piece is created by advanced neural networks.',
            metadataURI: 'ipfs://QmExample10',
            creator: '0xCREATORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            stats: { totalSupply: 50000, holders: 560, volume: '312.8 ETH' }
        }
    ];

    for (let i = 0; i < count; i++) {
        const template = erc404Templates[i % erc404Templates.length];
        // Add index to make unique if needed
        const uniqueName = i >= erc404Templates.length 
            ? `${template.name} ${Math.floor(i / erc404Templates.length) + 1}`
            : template.name;
        
        const uniqueSymbol = i >= erc404Templates.length
            ? `${template.symbol}${Math.floor(i / erc404Templates.length) + 1}`
            : template.symbol;

        try {
            const instanceAddress = await factoryService.createInstance(
                factoryAddress,
                uniqueName,
                uniqueSymbol,
                {
                    name: uniqueName,  // Explicitly set name
                    description: template.description,
                    metadataURI: template.metadataURI,
                    creator: template.creator
                }
            );

            // Update stats
            if (instanceAddress && mockData.instances[instanceAddress]) {
                mockData.instances[instanceAddress].stats = template.stats;
            }
        } catch (error) {
            console.warn('Error creating ERC404 instance:', error);
        }
    }
}

/**
 * Create ERC1155 instances
 * @param {object} mockData - Mock data structure
 * @param {MockFactoryService} factoryService - Factory service
 * @param {string} factoryAddress - Factory address
 * @param {number} count - Number of instances to create
 */
async function createERC1155Instances(mockData, factoryService, factoryAddress, count) {
    const erc1155Templates = [
        {
            name: 'Limited Edition Prints',
            symbol: 'LEP',
            description: 'Exclusive limited edition art prints. Each edition is unique and collectible.',
            metadataURI: 'ipfs://QmExample3',
            creator: '0xCREATOR3333333333333333333333333333333333',
            stats: { totalEditions: 10, totalMinted: 500, volume: '25.2 ETH' },
            pieces: [
                {
                    displayTitle: 'Sunset Over Mountains',
                    editionId: 1,
                    price: '0.1 ETH',
                    supply: 100,
                    minted: 50
                },
                {
                    displayTitle: 'Ocean Waves',
                    editionId: 2,
                    price: '0.15 ETH',
                    supply: 50,
                    minted: 25
                },
                {
                    displayTitle: 'Forest Path',
                    editionId: 3,
                    price: '0.12 ETH',
                    supply: 75,
                    minted: 40
                }
            ]
        },
        {
            name: 'Gaming Collectibles',
            symbol: 'GAME',
            description: 'Rare gaming collectibles and in-game items. Trade, collect, and play!',
            metadataURI: 'ipfs://QmExample4',
            creator: '0xCREATOR4444444444444444444444444444444444',
            stats: { totalEditions: 5, totalMinted: 250, volume: '42.7 ETH' },
            pieces: [
                {
                    displayTitle: 'Legendary Sword',
                    editionId: 1,
                    price: '0.2 ETH',
                    supply: 50,
                    minted: 30
                },
                {
                    displayTitle: 'Epic Shield',
                    editionId: 2,
                    price: '0.18 ETH',
                    supply: 60,
                    minted: 35
                }
            ]
        },
        {
            name: 'Trading Card Series',
            symbol: 'TCS',
            description: 'Rare trading cards with unique attributes. Collect full sets for special rewards.',
            metadataURI: 'ipfs://QmExample11',
            creator: '0xCREATORBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
            stats: { totalEditions: 20, totalMinted: 1200, volume: '78.5 ETH' }
        },
        {
            name: 'Photography Collection',
            symbol: 'PHOTO',
            description: 'Curated photography collection from renowned artists. Each photo is a limited edition.',
            metadataURI: 'ipfs://QmExample12',
            creator: '0xCREATORCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
            stats: { totalEditions: 15, totalMinted: 800, volume: '95.3 ETH' }
        },
        {
            name: '3D Model Assets',
            symbol: '3DMA',
            description: 'High-quality 3D models for games and virtual worlds. Use across multiple platforms.',
            metadataURI: 'ipfs://QmExample13',
            creator: '0xCREATORDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
            stats: { totalEditions: 8, totalMinted: 400, volume: '112.6 ETH' }
        },
        {
            name: 'Animation Frames',
            symbol: 'ANIM',
            description: 'Rare animation frames from iconic moments. Own a piece of animation history.',
            metadataURI: 'ipfs://QmExample14',
            creator: '0xCREATOREEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
            stats: { totalEditions: 12, totalMinted: 600, volume: '64.9 ETH' }
        },
        {
            name: 'Sound Effect Library',
            symbol: 'SOUND',
            description: 'Professional sound effects and audio clips. Royalty-free for commercial use.',
            metadataURI: 'ipfs://QmExample15',
            creator: '0xCREATORFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
            stats: { totalEditions: 25, totalMinted: 1500, volume: '143.2 ETH' }
        },
        {
            name: 'Virtual Fashion Items',
            symbol: 'VFASH',
            description: 'Exclusive virtual fashion items for avatars. Wear unique designs in the metaverse.',
            metadataURI: 'ipfs://QmExample16',
            creator: '0xCREATOR0000000000000000000000000000000000',
            stats: { totalEditions: 6, totalMinted: 300, volume: '201.4 ETH' }
        }
    ];

    for (let i = 0; i < count; i++) {
        const template = erc1155Templates[i % erc1155Templates.length];
        const uniqueName = i >= erc1155Templates.length 
            ? `${template.name} ${Math.floor(i / erc1155Templates.length) + 1}`
            : template.name;
        
        const uniqueSymbol = i >= erc1155Templates.length
            ? `${template.symbol}${Math.floor(i / erc1155Templates.length) + 1}`
            : template.symbol;

        try {
            const instanceAddress = await factoryService.createInstance(
                factoryAddress,
                uniqueName,
                uniqueSymbol,
                {
                    name: uniqueName,  // Explicitly set name
                    description: template.description,
                    metadataURI: template.metadataURI,
                    creator: template.creator,
                    pieces: template.pieces || []  // Include pieces for ERC1155
                }
            );

            // Update stats
            if (instanceAddress && mockData.instances[instanceAddress]) {
                mockData.instances[instanceAddress].stats = template.stats;
            }
        } catch (error) {
            console.warn('Error creating ERC1155 instance:', error);
        }
    }
}
