// const {Web3} = require('web3');
// const { ethers } = require('ethers');

// // Initialize Web3 instance
// const web3 = new Web3();

// // Sample Ethereum addresses for testing
// const testAddresses = [
//     "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
//     "0x53d284357ec70cE289D6D64134DfAc8E511c8a3D",
//     "0xFE544e9eC5576Ff7dB5C8e91CBE080C8Ef4D7DAf"
// ];

// // Function to compare hashing results
// function compareHashes(addresses) {
//     console.log("Comparing hashing methods between Web3.js and Ethers.js...\n");

//     addresses.forEach(address => {
//         // Web3.js hashing method
//         const web3Hash = web3.utils.soliditySha3(address);

//         // Ethers.js different hashing methods
//         const ethersHash1 = ethers.utils.keccak256(address);
//         const ethersHash2 = ethers.utils.solidityKeccak256(["address"], [address]);
//         const ethersHash3 = ethers.utils.solidityKeccak256(["bytes"], [ethers.utils.arrayify(address)]);

//         // Display results
//         console.log(`Address: ${address}`);
//         console.log(`Web3.soliditySha3:        ${web3Hash}`);
//         console.log(`Ethers.keccak256:         ${ethersHash1}`);
//         console.log(`Ethers.solidityKeccak256(address): ${ethersHash2}`);
//         console.log(`Ethers.solidityKeccak256(bytes):   ${ethersHash3}`);
//         console.log("\n");

//         // Check for a match
//         if (web3Hash === ethersHash2) {
//             console.log(`✅ Match found with ethers.utils.solidityKeccak256(["address"], [address])`);
//         } else if (web3Hash === ethersHash3) {
//             console.log(`✅ Match found with ethers.utils.solidityKeccak256(["bytes"], [ethers.utils.arrayify(address)])`);
//         } else if (web3Hash === ethersHash1) {
//             console.log(`✅ Match found with ethers.utils.keccak256(address)`);
//         } else {
//             console.log(`❌ No match found. Review encoding methods.`);
//         }
//         console.log("------------------------------------------------\n");
//     });
// }

// // Run the comparison
// compareHashes(testAddresses);
//web3.utils.soliditySha3(address) == ethers.utils.solidityKeccak256(['address'], [address])

//merkletest web3 vs ethers
// const { MerkleTree } = require('merkletreejs');
// const {Web3} = require('web3');
// const { ethers } = require('ethers');

// // Initialize Web3
// const web3 = new Web3();

// // Sample Ethereum addresses for testing
// const testAddresses = [
//     "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
//     "0x53d284357ec70cE289D6D64134DfAc8E511c8a3D",
//     "0xFE544e9eC5576Ff7dB5C8e91CBE080C8Ef4D7DAf"
// ];

// // Create Merkle Tree using Web3.js hashing method
// function createTreeWeb3(addresses) {
//     const leaves = addresses.map(addr => web3.utils.soliditySha3(addr));
//     const tree = new MerkleTree(leaves, web3.utils.soliditySha3, { sortPairs: true });
//     return tree.getHexRoot();
// }
// // Wrapper function for Ethers.js hashing
// const hashWithEthers = (input) => ethers.utils.solidityKeccak256(["address"], [input]);

// // Create Merkle Tree using Ethers.js hashing method
// function createTreeEthers(addresses) {
//     const leaves = addresses.map(addr => hashWithEthers(addr)); // Use wrapper function
//     return new MerkleTree(leaves, hashWithEthers, { sortPairs: true }).getHexRoot();
// }

// // Compare the roots
// const rootWeb3 = createTreeWeb3(testAddresses);
// const rootEthers = createTreeEthers(testAddresses);

// console.log("Merkle Root (Web3.js):   ", rootWeb3);
// console.log("Merkle Root (Ethers.js): ", rootEthers);
// console.log("\n");

// if (rootWeb3 === rootEthers) {
//     console.log("✅ SUCCESS: Merkle roots match!");
// } else {
//     console.log("❌ ERROR: Merkle roots do NOT match. Investigate hashing differences.");
// }

//must use wrapper function for ethers.js hashing