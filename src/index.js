// console.log('Initializing app......');
//import { TransactionOptions } from './components/TransactionOptions/TransactionOptions.js';
 //import TradingInterface from './components/TradingInterface/TradingInterface.js';
 import BlockchainService from './services/BlockchainService.js';
 //import SwapInterface from './components/SwapInterface/SwapInterface.js';
 import Web3Handler from '../web3Handler.js';
// import { ethers } from './node_modules/ethers/dist/ethers.esm.js';
//import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

// Initialize core components
//deprecated
// const swapContainer = document.getElementById('swap-container');
// const swapInterface = new SwapInterface(swapContainer);
// swapInterface.mount();

// Register the TransactionOptions component
// const transactionOptions = new TransactionOptions();
// transactionOptions.mount(document.querySelector('#transaction-options-container'));

async function initializeApp() {
    console.log('Initializing app...');
    try {
        // Get container
        const container = document.getElementById('contractInterface');
        if (!container) {
            throw new Error('App container not found');
        }

        // Initialize blockchain service
        const blockchainService = new BlockchainService();
        await blockchainService.initialize();
        console.log('BlockchainService initialized:', blockchainService);
        // Initialize Web3Handler (migrated from index.html script)
        const web3Handler = new Web3Handler(blockchainService);
        const hasContract = await web3Handler.init();
        
        if (hasContract) {
            const contractInterface = document.getElementById('contractInterface');
            const contractStatus = document.getElementById('contractStatus');
            const selectWalletBtn = document.getElementById('selectWallet');

            if (contractInterface) contractInterface.style.display = 'block';
            if (contractStatus) contractStatus.textContent = 'Contract detected. Please connect your wallet.';
            
            // Add connect wallet button listener
            if (selectWalletBtn) {
                selectWalletBtn.addEventListener('click', async () => {
                    try {
                        const account = await web3Handler.connectWallet();
                        if (contractStatus) contractStatus.textContent = `Connected: ${account}`;
                        if (selectWalletBtn) selectWalletBtn.style.display = 'none';
                    } catch (error) {
                        if (contractStatus) contractStatus.textContent = `Error: ${error.message}`;
                    }
                });
            }
        } else {
            const contractInterface = document.getElementById('contractInterface');
            if (contractInterface) contractInterface.style.display = 'none';
        }

        // Get connected wallet address (if available)
        //const address = await blockchainService.getConnectedAddress();
        
        // Create and mount trading interface with BlockchainService
        //const tradingInterface = new TradingInterface(address, blockchainService, ethers);
        //tradingInterface.mount(container);

    } catch (error) {
        console.error('Failed to initialize app:', error);
        // Show error to user
        document.body.innerHTML = `
            <div class="error-container">
                <h2>Failed to load application</h2>
                <p>${error.message}</p>
                <button onclick="location.reload()">Retry</button>
            </div>
        `;
    }
}

// Initialize app when DOM is ready
//document.addEventListener('DOMContentLoaded', initializeApp); 


// Initialize Web3Handler when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    initializeApp();
    // try {
    //     const web3Handler = new Web3Handler();
    //     const contractInterface = document.getElementById('contractInterface');
    //     const contractStatus = document.getElementById('contractStatus');
    //     const selectWalletBtn = document.getElementById('selectWallet');

    //     // Initialize web3 handler
    //     const hasContract = await web3Handler.init();
        
    //     if (hasContract) {
    //         contractInterface.style.display = 'block';
    //         contractStatus.textContent = 'Contract detected. Please connect your wallet.';
            
    //         // Add connect wallet button listener
    //         selectWalletBtn.addEventListener('click', async () => {
    //             try {
    //                 const account = await web3Handler.connectWallet();
    //                 contractStatus.textContent = `Connected: ${account}`;
    //                 selectWalletBtn.style.display = 'none';
    //             } catch (error) {
    //                 contractStatus.textContent = `Error: ${error.message}`;
    //             }
    //         });
    //     } else {
    //         contractInterface.style.display = 'none';
    //     }
    // } catch (error) {
    //     console.error('Failed to initialize app:', error);
    // }
});