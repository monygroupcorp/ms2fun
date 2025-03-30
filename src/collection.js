import BlockchainService from './services/BlockchainService.js';
import Web3Handler from './web3Handler.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

// Add performance marking
performance.mark('startCollection');

class CollectionHandler {
    constructor() {
        this.contractAddress = null;
        this.web3Handler = null;
        this.blockchainService = null;
        this.inputElement = document.getElementById('contractAddress');
        this.loadButton = document.getElementById('loadContract');
        this.contractStatus = document.getElementById('contractStatus');
    }

    async init() {
        try {
            // Get container
            const container = document.getElementById('contractInterface');
            if (!container) {
                throw new Error('App container not found');
            }

            // Check for contract address in URL
            const urlParams = new URLSearchParams(window.location.search);
            const addressFromUrl = urlParams.get('contract');

            if (addressFromUrl && ethers.utils.isAddress(addressFromUrl)) {
                // Initialize blockchain service with contract address
                this.blockchainService = new BlockchainService(addressFromUrl);
                await this.blockchainService.initialize();

                // Initialize Web3Handler with blockchain service
                this.web3Handler = new Web3Handler(this.blockchainService);
                const hasContract = await this.web3Handler.init();

                if (hasContract) {
                    // Hide input if we have a valid contract
                    if (this.inputElement) {
                        this.inputElement.parentElement.style.display = 'none';
                    }
                    
                    // Show wallet selection UI
                    const selectWalletBtn = document.getElementById('selectWallet');
                    if (selectWalletBtn) selectWalletBtn.style.display = 'block';
                    if (this.contractStatus) {
                        this.contractStatus.textContent = 'Contract detected. Please connect your wallet.';
                    }
                }
            } else {
                // Show input and setup listeners for manual contract entry
                this.setupInputListeners();
            }

            // Mark performance end
            performance.mark('componentLoaded');
            performance.measure('componentLoadTime', 'startCollection', 'componentLoaded');

        } catch (error) {
            console.error('Failed to initialize collection:', error);
            if (this.contractStatus) {
                this.contractStatus.textContent = `Error: ${error.message}`;
            }
        }
    }

    setupInputListeners() {
        if (!this.inputElement || !this.loadButton) return;

        // Handle enter key in input
        this.inputElement.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleContractInput();
            }
        });

        // Handle button click
        this.loadButton.addEventListener('click', () => {
            this.handleContractInput();
        });

        // Show input interface
        this.inputElement.parentElement.style.display = 'block';
    }

    async handleContractInput() {
        const address = this.inputElement.value.trim();
        
        if (!ethers.utils.isAddress(address)) {
            this.contractStatus.textContent = 'Please enter a valid Ethereum address';
            return;
        }

        try {
            // Update URL without reloading
            const newUrl = `${window.location.pathname}?contract=${address}`;
            window.history.pushState({ path: newUrl }, '', newUrl);

            // Initialize blockchain service with new address
            this.blockchainService = new BlockchainService(address);
            await this.blockchainService.initialize();

            // Initialize Web3Handler
            this.web3Handler = new Web3Handler(this.blockchainService);
            const hasContract = await this.web3Handler.init();

            if (hasContract) {
                // Hide input
                this.inputElement.parentElement.style.display = 'none';
                
                // Show wallet selection UI
                const selectWalletBtn = document.getElementById('selectWallet');
                if (selectWalletBtn) selectWalletBtn.style.display = 'block';
                if (this.contractStatus) {
                    this.contractStatus.textContent = 'Contract detected. Please connect your wallet.';
                }
            } else {
                throw new Error('Invalid contract');
            }

        } catch (error) {
            console.error('Error loading contract:', error);
            this.contractStatus.textContent = `Error: ${error.message}`;
            
            // Show input again on error
            this.inputElement.parentElement.style.display = 'block';
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const handler = new CollectionHandler();
    handler.init();
});