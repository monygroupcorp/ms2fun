import Web3Handler from './web3Handler.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

class CollectionHandler {
    constructor() {
        this.contractAddress = null;
        this.web3Handler = null;
        this.inputElement = document.getElementById('contractAddress');
        this.loadButton = document.getElementById('loadContract');
        this.contractStatus = document.getElementById('contractStatus');
    }

    async init() {
        // Check for contract address in URL
        const urlParams = new URLSearchParams(window.location.search);
        const addressFromUrl = urlParams.get('contract');

        if (addressFromUrl && ethers.utils.isAddress(addressFromUrl)) {
            // Hide input if we have a valid address
            this.inputElement.parentElement.style.display = 'none';
            await this.loadContract(addressFromUrl);
        } else {
            // Show input and setup listeners
            this.setupInputListeners();
        }
    }

    setupInputListeners() {
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
    }

    async handleContractInput() {
        const address = this.inputElement.value.trim();
        
        if (!ethers.utils.isAddress(address)) {
            this.contractStatus.textContent = 'Please enter a valid Ethereum address';
            return;
        }

        // Update URL without reloading
        const newUrl = `${window.location.pathname}?contract=${address}`;
        window.history.pushState({ path: newUrl }, '', newUrl);

        // Hide input
        this.inputElement.parentElement.style.display = 'none';

        // Load contract
        await this.loadContract(address);
    }

    async loadContract(address) {
        try {
            this.contractAddress = address;
            this.contractStatus.textContent = 'Loading contract...';

            // Create contract data object (similar to what was in switch.json)
            const contractData = {
                address: address,
                network: '1', // Ethereum mainnet
                rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/your-api-key' // You'll want to use your own RPC URL
            };

            // Initialize Web3Handler with contract data
            this.web3Handler = new Web3Handler(contractData);
            const initialized = await this.web3Handler.init();

            if (initialized) {
                // Show wallet selection button
                document.getElementById('selectWallet').style.display = 'block';
            } else {
                throw new Error('Failed to initialize contract');
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