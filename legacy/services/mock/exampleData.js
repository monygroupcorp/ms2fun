/**
 * Example Data
 * 
 * Seeded example data for testing the mock system.
 */

import { generateMockAddress, saveMockData } from './mockData.js';

const TARGET_INSTANCES_PER_FACTORY = 8;
const USER_ADDRESS = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6'; // Your address for testing

/**
 * Seed example data into the mock system
 * @param {object} mockData - Mock data structure
 * @param {MockMasterService} masterService - Master service instance
 * @param {MockFactoryService} factoryService - Factory service instance
 * @returns {Promise<void>}
 */
export async function seedExampleData(mockData, masterService, factoryService) {
    // Set user address as default mock owner for testing
    mockData.mockOwnerAddress = USER_ADDRESS;
    
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
            name: 'MiladyStation Collection',
            symbol: 'MILADY',
            description: 'A beautiful collection of 1212 unique MiladyStation NFTs. Each token is a work of art with its own personality and style.',
            // Real IPFS metadata URI for MiladyStation token 45
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/45',
            // Direct IPFS image URI (metadata will contain the actual image URL)
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/45',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
        },
        {
            name: 'MiladyStation #100',
            symbol: 'MILADY',
            description: 'Another beautiful MiladyStation from the collection. Token #100 showcases unique traits and style.',
            // Real IPFS metadata URI for MiladyStation token 100
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/100',
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/100',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
        },
        {
            name: 'MiladyStation #500',
            symbol: 'MILADY',
            description: 'MiladyStation token #500 from the collection. Each MiladyStation is unique and special.',
            // Real IPFS metadata URI for MiladyStation token 500
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/500',
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/500',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
        },
        {
            name: 'MiladyStation #750',
            symbol: 'MILADY',
            description: 'MiladyStation token #750. Part of the amazing collection of 1212 unique MiladyStations.',
            // Real IPFS metadata URI for MiladyStation token 750
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/750',
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/750',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
        },
        {
            name: 'MiladyStation #1000',
            symbol: 'MILADY',
            description: 'MiladyStation token #1000. One of the later tokens in this wonderful collection of 1212.',
            // Real IPFS metadata URI for MiladyStation token 1000
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1000',
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1000',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
        },
        {
            name: 'MiladyStation #1212',
            symbol: 'MILADY',
            description: 'The final MiladyStation token #1212. The last piece in this amazing collection!',
            // Real IPFS metadata URI for MiladyStation token 1212 (the last one!)
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1212',
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1212',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
        },
        {
            name: 'MiladyStation #1',
            symbol: 'MILADY',
            description: 'The very first MiladyStation token #1. The beginning of this incredible collection!',
            // Real IPFS metadata URI for MiladyStation token 1 (the first one!)
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1',
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
        },
        {
            name: 'MiladyStation #250',
            symbol: 'MILADY',
            description: 'MiladyStation token #250. A beautiful piece from the middle of the collection.',
            // Real IPFS metadata URI for MiladyStation token 250
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/250',
            imageURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/250',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalSupply: 1212, holders: 850, volume: '245.8 ETH' }
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
                    creator: template.creator,
                    owner: template.owner || template.creator  // Set owner for admin access
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
            name: 'MiladyStation Collection',
            symbol: 'MILADY',
            description: 'A beautiful collection of 1212 unique MiladyStation NFTs. Each token is a work of art with its own personality and style. This ERC1155 collection showcases selected MiladyStations from the full collection.',
            // Real MiladyStation IPFS metadata URI for token 45
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/45',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 5, totalMinted: 250, volume: '45.8 ETH' },
            pieces: [
                {
                    displayTitle: 'MiladyStation #45',
                    editionId: 1,
                    price: '0.1 ETH',
                    supply: 50,
                    minted: 25,
                    description: 'MiladyStation token #45 from the collection. A beautiful piece with unique traits and style.',
                    // Real MiladyStation IPFS metadata URI - this will be fetched and contain the image URL
                    metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/45',
                    // Fallback image (will be overridden by metadata fetch)
                    image: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/45'
                },
                {
                    displayTitle: 'MiladyStation #200',
                    editionId: 2,
                    price: '0.15 ETH',
                    supply: 50,
                    minted: 30,
                    description: 'MiladyStation token #200. Part of the amazing collection of 1212 unique MiladyStations.',
                    // Real MiladyStation IPFS metadata URI
                    metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/200',
                    image: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/200'
                },
                {
                    displayTitle: 'MiladyStation #500',
                    editionId: 3,
                    price: '0.12 ETH',
                    supply: 50,
                    minted: 20,
                    description: 'MiladyStation token #500. A beautiful piece from the middle of the collection.',
                    // Real MiladyStation IPFS metadata URI
                    metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/500',
                    image: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/500'
                },
                {
                    displayTitle: 'MiladyStation #1000',
                    editionId: 4,
                    price: '0.18 ETH',
                    supply: 50,
                    minted: 35,
                    description: 'MiladyStation token #1000. One of the later tokens in this wonderful collection of 1212.',
                    // Real MiladyStation IPFS metadata URI
                    metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1000',
                    image: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1000'
                },
                {
                    displayTitle: 'MiladyStation #1212',
                    editionId: 5,
                    price: '0.2 ETH',
                    supply: 50,
                    minted: 40,
                    description: 'The final MiladyStation token #1212. The last piece in this amazing collection!',
                    // Real MiladyStation IPFS metadata URI
                    metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1212',
                    image: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/1212'
                }
            ]
        },
        {
            name: 'MiladyStation Gaming Collection',
            symbol: 'MILADY',
            description: 'MiladyStation tokens with gaming themes. Each token is a unique character from the collection of 1212.',
            // Real MiladyStation IPFS metadata URI
            metadataURI: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/300',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 5, totalMinted: 250, volume: '42.7 ETH' },
            pieces: [
                {
                    displayTitle: 'MiladyStation #300',
                    editionId: 1,
                    price: '0.2 ETH',
                    supply: 50,
                    minted: 30,
                    description: 'MiladyStation token #300. A legendary character from the collection with unique gaming-inspired traits.',
                    // Real MiladyStation IPFS metadata URI
                    image: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/300'
                },
                {
                    displayTitle: 'Epic Shield',
                    editionId: 2,
                    price: '0.18 ETH',
                    supply: 60,
                    minted: 35,
                    description: 'An unbreakable shield blessed by the gods. Provides +40 defense and reflects 25% of incoming damage back to attackers.',
                    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Magic Staff',
                    editionId: 3,
                    price: '0.22 ETH',
                    supply: 45,
                    minted: 28,
                    description: 'A staff imbued with the power of the elements. Increases spell damage by 60% and reduces mana cost by 30%.',
                    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Dragon Armor',
                    editionId: 4,
                    price: '0.25 ETH',
                    supply: 40,
                    minted: 25,
                    description: 'Armor crafted from dragon scales. Provides maximum protection and grants immunity to fire damage.',
                    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=800&fit=crop'
                }
            ]
        },
        {
            name: 'Trading Card Series',
            symbol: 'TCS',
            description: 'Rare trading cards with unique attributes. Collect full sets for special rewards.',
            metadataURI: 'ipfs://QmExample11',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 20, totalMinted: 1200, volume: '78.5 ETH' },
            pieces: [
                {
                    displayTitle: 'Legendary Hero Card',
                    editionId: 1,
                    price: '0.05 ETH',
                    supply: 200,
                    minted: 120,
                    description: 'A powerful hero card featuring a legendary warrior. Collect this rare card to unlock special abilities in the game.',
                    image: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Epic Monster Card',
                    editionId: 2,
                    price: '0.08 ETH',
                    supply: 150,
                    minted: 95,
                    description: 'A fearsome monster card with devastating attack power. This epic rarity card is highly sought after by collectors.',
                    image: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Rare Spell Card',
                    editionId: 3,
                    price: '0.06 ETH',
                    supply: 180,
                    minted: 110,
                    description: 'A magical spell card that can turn the tide of battle. Use this rare card to cast powerful enchantments.',
                    image: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Common Item Card',
                    editionId: 4,
                    price: '0.02 ETH',
                    supply: 500,
                    minted: 320,
                    description: 'A useful item card for everyday gameplay. While common, these cards are essential for building your deck.',
                    image: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=800&h=800&fit=crop'
                }
            ]
        },
        {
            name: 'Photography Collection',
            symbol: 'PHOTO',
            description: 'Curated photography collection from renowned artists. Each photo is a limited edition.',
            metadataURI: 'ipfs://QmExample12',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 15, totalMinted: 800, volume: '95.3 ETH' },
            pieces: [
                {
                    displayTitle: 'Urban Nightscape',
                    editionId: 1,
                    price: '0.12 ETH',
                    supply: 100,
                    minted: 65,
                    description: 'A stunning photograph of city lights at night. This limited edition print captures the energy and beauty of urban life after dark.',
                    image: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Mountain Sunrise',
                    editionId: 2,
                    price: '0.15 ETH',
                    supply: 80,
                    minted: 52,
                    description: 'The first light of dawn breaking over snow-capped peaks. A breathtaking moment captured in this exclusive photography edition.',
                    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Ocean Sunset',
                    editionId: 3,
                    price: '0.10 ETH',
                    supply: 120,
                    minted: 78,
                    description: 'A peaceful sunset over the ocean horizon. This serene photograph brings the tranquility of the sea into your space.',
                    image: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'City Lights',
                    editionId: 4,
                    price: '0.18 ETH',
                    supply: 60,
                    minted: 45,
                    description: 'The vibrant glow of city lights creating patterns of light and shadow. A modern urban photography masterpiece.',
                    image: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&h=800&fit=crop'
                }
            ]
        },
        {
            name: '3D Model Assets',
            symbol: '3DMA',
            description: 'High-quality 3D models for games and virtual worlds. Use across multiple platforms.',
            metadataURI: 'ipfs://QmExample13',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 8, totalMinted: 400, volume: '112.6 ETH' },
            pieces: [
                {
                    displayTitle: 'Medieval Sword Model',
                    editionId: 1,
                    price: '0.25 ETH',
                    supply: 50,
                    minted: 32,
                    description: 'High-quality 3D model of a medieval sword. Includes textures, normal maps, and optimized for game engines. Compatible with Unity, Unreal, and Blender.',
                    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Fantasy Castle Model',
                    editionId: 2,
                    price: '0.35 ETH',
                    supply: 40,
                    minted: 28,
                    description: 'Detailed fantasy castle 3D model with multiple LOD levels. Perfect for RPG games and virtual worlds. Includes interior and exterior models.',
                    image: 'https://images.unsplash.com/photo-1515542622106-78bda8ba0e5b?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Sci-Fi Spaceship Model',
                    editionId: 3,
                    price: '0.30 ETH',
                    supply: 45,
                    minted: 30,
                    description: 'Futuristic spaceship 3D model with animated parts. Ready to use in space exploration games. Includes engine effects and landing gear animations.',
                    image: 'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Character Avatar Model',
                    editionId: 4,
                    price: '0.20 ETH',
                    supply: 60,
                    minted: 42,
                    description: 'Rigged character avatar model with multiple animation sets. Compatible with major game engines and VR platforms. Includes facial expressions.',
                    image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&h=800&fit=crop'
                }
            ]
        },
        {
            name: 'Animation Frames',
            symbol: 'ANIM',
            description: 'Rare animation frames from iconic moments. Own a piece of animation history.',
            metadataURI: 'ipfs://QmExample14',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 12, totalMinted: 600, volume: '64.9 ETH' },
            pieces: [
                {
                    displayTitle: 'Classic Frame #001',
                    editionId: 1,
                    price: '0.08 ETH',
                    supply: 100,
                    minted: 65,
                    description: 'A historic animation frame from a classic production. Own a piece of animation history with this collectible frame.',
                    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Classic Frame #002',
                    editionId: 2,
                    price: '0.10 ETH',
                    supply: 80,
                    minted: 52,
                    description: 'Another iconic frame from animation history. Each frame tells a story and captures a moment in time.',
                    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Classic Frame #003',
                    editionId: 3,
                    price: '0.09 ETH',
                    supply: 90,
                    minted: 58,
                    description: 'A beautifully preserved animation frame showcasing the artistry of traditional animation techniques.',
                    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Rare Frame #001',
                    editionId: 4,
                    price: '0.15 ETH',
                    supply: 50,
                    minted: 38,
                    description: 'An extremely rare animation frame from a legendary production. This limited edition piece is highly sought after by collectors.',
                    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=800&fit=crop'
                }
            ]
        },
        {
            name: 'Sound Effect Library',
            symbol: 'SOUND',
            description: 'Professional sound effects and audio clips. Royalty-free for commercial use.',
            metadataURI: 'ipfs://QmExample15',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 25, totalMinted: 1500, volume: '143.2 ETH' },
            pieces: [
                {
                    displayTitle: 'Explosion Sound Pack',
                    editionId: 1,
                    price: '0.05 ETH',
                    supply: 200,
                    minted: 125,
                    description: 'Professional explosion sound effects in multiple variations. Includes close, distant, and muffled versions. Royalty-free for commercial use.',
                    image: 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Nature Ambience Pack',
                    editionId: 2,
                    price: '0.06 ETH',
                    supply: 180,
                    minted: 110,
                    description: 'High-quality nature ambience recordings including forests, oceans, and mountains. Perfect for games, films, and meditation apps.',
                    image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Sci-Fi Sound Pack',
                    editionId: 3,
                    price: '0.07 ETH',
                    supply: 150,
                    minted: 95,
                    description: 'Futuristic sound effects for sci-fi projects. Includes laser blasts, spaceship engines, and alien technology sounds.',
                    image: 'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Musical Stings Pack',
                    editionId: 4,
                    price: '0.04 ETH',
                    supply: 250,
                    minted: 160,
                    description: 'Short musical stings and transitions perfect for video production. Includes victory, suspense, and comedic themes.',
                    image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=800&fit=crop'
                }
            ]
        },
        {
            name: 'Virtual Fashion Items',
            symbol: 'VFASH',
            description: 'Exclusive virtual fashion items for avatars. Wear unique designs in the metaverse.',
            metadataURI: 'ipfs://QmExample16',
            creator: USER_ADDRESS,
            owner: USER_ADDRESS,
            stats: { totalEditions: 6, totalMinted: 300, volume: '201.4 ETH' },
            pieces: [
                {
                    displayTitle: 'Luxury Jacket',
                    editionId: 1,
                    price: '0.30 ETH',
                    supply: 50,
                    minted: 35,
                    description: 'An exclusive luxury jacket for your virtual avatar. Designed by top fashion houses, this jacket makes a statement in any metaverse.',
                    image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Designer Sunglasses',
                    editionId: 2,
                    price: '0.15 ETH',
                    supply: 100,
                    minted: 68,
                    description: 'Stylish designer sunglasses that add flair to any avatar. Available in multiple color variations and compatible with all major platforms.',
                    image: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Exclusive Sneakers',
                    editionId: 3,
                    price: '0.25 ETH',
                    supply: 60,
                    minted: 42,
                    description: 'Limited edition virtual sneakers with unique designs. Each pair is individually numbered and comes with a certificate of authenticity.',
                    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&h=800&fit=crop'
                },
                {
                    displayTitle: 'Rare Hat Collection',
                    editionId: 4,
                    price: '0.20 ETH',
                    supply: 75,
                    minted: 52,
                    description: 'A collection of rare virtual hats from different eras and styles. Mix and match to create your unique look.',
                    image: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=800&h=800&fit=crop'
                }
            ]
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
                    owner: template.owner || template.creator,  // Set owner for admin access
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
