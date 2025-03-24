 import BlockchainService from './services/BlockchainService.js';
 import Web3Handler from '../web3Handler.js';

 // Add this simple performance marker in your code
performance.mark('startIndex');

// At key points in your code:
performance.mark('componentLoaded');
performance.measure('componentLoadTime', 'startIndex', 'componentLoaded');

async function initializeApp() {
    try {
        // Get container
        const container = document.getElementById('contractInterface');
        if (!container) {
            throw new Error('App container not found');
        }

        // Initialize blockchain service
        const blockchainService = new BlockchainService();
        await blockchainService.initialize();
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


    } catch (error) {
        console.error('Failed to initialize app:', error);
        // Show error to user
        // document.body.innerHTML = `
        //     <div class="error-container">
        //         <h2>Failed to load application</h2>
        //         <p>${error.message}</p>
        //         <button onclick="location.reload()">Retry</button>
        //     </div>
        // `;
    }
}

// Initialize Web3Handler when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    initializeApp();
});