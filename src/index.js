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

        // Try to fetch switch config
        try {
            const switchResponse = await fetch('/EXEC404/switch.json');
            const switchData = await switchResponse.json();
            
            if (!switchData.network) {
                // No network value in config, exit initialization
                console.log('Invalid switch configuration (no network value) - exiting initialization');
                return;
            } else {
                console.log('Valid switch configuration found - continuing initialization');
            }
        } catch (error) {
            // Fetch failed, exit initialization
            //console.log('No switch configuration found - exiting initialization');
            return;
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
            
            // Check for existing connected wallet first
            try {
                const accounts = await ethereum.request({ method: 'eth_accounts' });
                if (accounts && accounts.length > 0) {
                    // Detect which wallet is connected
                    let walletType = 'metamask'; // default
                    if (window.ethereum.isRabby) walletType = 'rabby';
                    if (window.ethereum.isPhantom) walletType = 'phantom';
                    if (window.rainbow) walletType = 'rainbow';
                    
                    // Set up the wallet through proper channels
                    await web3Handler.handleWalletSelection(walletType);
                    
                    if (contractStatus) contractStatus.textContent = `Connected: ${accounts[0]}`;
                    if (selectWalletBtn) selectWalletBtn.style.display = 'none';
                } else {
                    // No connected account, show connect wallet prompt
                    if (contractStatus) contractStatus.textContent = 'Contract detected. Please connect your wallet.';
                    if (selectWalletBtn) {
                        selectWalletBtn.style.display = 'block';
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
                }
            } catch (error) {
                console.error('Error checking wallet connection:', error);
                if (contractStatus) contractStatus.textContent = `Error checking wallet: ${error.message}`;
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