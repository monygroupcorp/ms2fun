import { ethers } from '/node_modules/ethers/dist/ethers.esm.js';
import MessagePopup from '/src/components/MessagePopup/MessagePopup.js';
import MerkleHandler from '/src/merkleHandler.js';

console.log('ContractHandler: Ethers imported:', ethers);

class ContractHandler {
    constructor(provider, contractAddress) {
        console.log('ContractHandler: Initializing with provider:', provider);
        this.web3Provider = provider; // Injected provider (Rainbow, MetaMask etc)
        this.contractAddress = contractAddress;
        this.contract = null;
        this.mirrorContract = null;
        this.signer = null;
        this.messagePopup = new MessagePopup();
        this.merkleHandler = new MerkleHandler();
        this.initialize();
        this.initializeMerkleHandler();
    }

    async initialize() {
        try {
            // Get RPC URL from contract data
            const response = await fetch('/EXEC404/switch.json');
            const contractData = await response.json();
            
            // Create ethers provider for local fork - keep this for reading data
            this.provider = new ethers.providers.JsonRpcProvider(contractData.rpcUrl);
            console.log('ContractHandler: Created provider for:', contractData.rpcUrl);

            // If we have a web3Provider, set up the signer
            if (this.web3Provider) {
                const injectedProvider = new ethers.providers.Web3Provider(this.web3Provider);
                this.signer = injectedProvider.getSigner();
                console.log('ContractHandler: Got signer from wallet');
            }

            // Initialize contracts with provider (for reading)
            const contractABI = await (await fetch('/EXEC404/abi.json')).json();
            this.contract = new ethers.Contract(
                this.contractAddress, 
                contractABI, 
                this.provider
            );

            const mirrorAddress = await this.getMirrorAddress();
            const mirrorABI = await (await fetch('/EXEC404/mirrorabi.json')).json();
            this.mirrorContract = new ethers.Contract(
                mirrorAddress,
                mirrorABI,
                this.provider
            );

            // Check network
            const network = await this.provider.getNetwork();
            console.log('ContractHandler: Connected to network:', network);

            // Test RPC connection by getting block number
            const blockNumber = await this.getBlock();
            console.log('ContractHandler: Current block number:', blockNumber);

            // Log contract address we're trying to use
            console.log('ContractHandler: Attempting to connect to contract at:', this.contractAddress);

            // Verify contract exists by checking code at address
            try {
                console.log('ContractHandler: Checking code at address:', this.contractAddress);
                const code = await this.provider.getCode(this.contractAddress);
                //console.log('ContractHandler: Contract code at address:', code);
                console.log('ContractHandler: Contract code length:', code.length);
                if (code === '0x') {
                    throw new Error(`No contract found at address ${this.contractAddress} on local fork`);
                }
            } catch (error) {
                console.error('ContractHandler: Error checking contract code:', error);
                throw error;
            }

            // Try to get contract name first (usually a safer call)
            try {
                const name = await this.contract.name();
                console.log('ContractHandler: Contract name:', name);
            } catch (error) {
                console.error('ContractHandler: Error getting contract name:', error);
            }

            // Now try totalSupply
            try {
                const supply = await this.contract.totalSupply();
                console.log('ContractHandler: Total supply:', supply.toString());
            } catch (error) {
                console.error('ContractHandler: Error getting total supply:', error);
            }

        } catch (error) {
            console.error('ContractHandler: Error initializing contracts:', error);
            throw error;
        }
    }

    async initializeMerkleHandler() {
        try {
            await this.merkleHandler.initializeTrees();
            console.log('Merkle handler initialized');
        } catch (error) {
            console.error('Error initializing merkle handler:', error);
        }
    }

    /**
     * Gets the current block number to test RPC connection
     * @returns {Promise<number>} The current block number
     */
    async getBlock() {
        try {
            if (!this.provider) {
                throw new Error('Provider not initialized');
            }
            const blockNumber = await this.provider.getBlockNumber();
            return blockNumber;
        } catch (error) {
            console.error('Error getting block number:', error);
            throw error;
        }
    }

    /**
     * Gets the price for a given supply amount
     * @param {string|number} supply - The supply amount to calculate price for
     * @returns {Promise<Object>} Object containing both wei and ETH values
     */
    async getPrice(supply) {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const price = await this.contract.getPrice(supply);
            const priceInWei = price.toString();
            const priceInEth = ethers.utils.formatEther(price);
            
            console.log('ContractHandler: Price for supply:', supply, 'is:', {
                wei: priceInWei,
                eth: priceInEth
            });
            
            // Return the raw wei string for contract interactions
            return priceInWei;
        } catch (error) {
            console.error('Error getting price:', error);
            throw error;
        }
    }

    /**
     * Gets the cost for a given amount of EXEC
     * @param {string|number} amount - The amount of EXEC to calculate cost for
     * @returns {Promise<Object>} Object containing both wei and ETH values
     */
    async calculateCost(amount) {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const cost = await this.contract.calculateCost(amount);
            const costInWei = cost.toString();
            const costInEth = ethers.utils.formatEther(cost);
        
            console.log('ContractHandler: cost for supply:', amount, 'is:', {
                wei: costInWei,
                eth: costInEth
            });

            // Return the raw wei string for contract interactions
            return costInWei;
        } catch (error) {
            console.error('Error getting cost:', error);
            throw error;
        }
    }

    /**
     * Gets the current total supply
     * @returns {Promise<string>} The current total supply in wei
     */
    async getTotalSupply() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            console.log('ContractHandler: Calling totalSupply on address:', this.contractAddress);
            const supply = await this.contract.totalSupply();
            console.log('ContractHandler: Total supply result:', supply.toString());
            return supply.toString();
        } catch (error) {
            console.error('Error getting total supply:', error);
            throw error;
        }
    }

    /**
     * Gets the current price based on current total supply
     * @returns {Promise<Object>} Object containing price in wei
     */
    async getCurrentPrice() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const priceInWei = await this.getPrice(1000000);
            
            // For display purposes, also calculate ETH value
            const priceInEth = ethers.utils.formatEther(priceInWei);
            
            console.log('ContractHandler: Current price:', {
                wei: priceInWei,
                eth: priceInEth
            });
            
            // Return the raw wei string for contract interactions
            return { wei: priceInWei, eth: priceInEth };
        } catch (error) {
            console.error('Error getting current price:', error);
            throw error;
        }
    }

    /**
     * Gets the token balance for a given address
     * @param {string} address - The address to check balance for
     * @returns {Promise<string>} The balance in wei
     */
    async getTokenBalance(address) {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const balance = await this.contract.balanceOf(address);
            console.log('ContractHandler: Token balance for', address, ':', balance.toString());
            return balance.toString();
        } catch (error) {
            console.error('Error getting token balance:', error);
            throw error;
        }
    }

    /**
     * Gets the NFT balance for a given address using the mirror contract
     * @param {string} address - The address to check NFT balance for
     * @returns {Promise<number>} The number of NFTs owned
     */
    async getNFTBalance(address) {
        try {
            if (!this.mirrorContract) {
                throw new Error('Mirror contract not initialized');
            }
            const balance = await this.mirrorContract.balanceOf(address);
            console.log('ContractHandler: NFT balance for', address, ':', balance.toString());
            return parseInt(balance.toString());
        } catch (error) {
            console.error('Error getting NFT balance:', error);
            throw error;
        }
    }

    /**
     * Gets the mirror contract address from the main contract
     * @returns {Promise<string>} The mirror contract address
     */
    async getMirrorAddress() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const mirrorAddress = await this.contract.mirrorERC721();
            console.log('ContractHandler: Mirror address:', mirrorAddress);
            return mirrorAddress;
        } catch (error) {
            console.error('Error getting mirror address:', error);
            throw error;
        }
    }

    async buyBonding(params, ethValue) {
        const { amount, maxCost, mintNFT, proof, message } = params;
        
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            if (!this.signer) {
                throw new Error('No wallet connected');
            }

            const contractWithSigner = this.contract.connect(this.signer);
            const valueInWei = ethers.utils.parseEther(ethValue.toString());
            
            // Show pending transaction message
            this.messagePopup.info('Please confirm the transaction in your wallet', 'Transaction Pending');
            
            const tx = await contractWithSigner.buyBonding(
                amount,
                maxCost,
                mintNFT,
                proof,
                message,
                { value: valueInWei }
            );

            // Show transaction sent message
            this.messagePopup.info(`Transaction sent! Hash: ${tx.hash}`, 'Transaction Sent');
            
            // Wait for transaction confirmation using the provider
            const receipt = await this.provider.waitForTransaction(tx.hash);
            
            // Show success message
            this.messagePopup.success('Transaction confirmed!', 'Success');
            
            return receipt;
        } catch (error) {
            console.error('Buy bonding failed:', error);
            
            // Handle specific error types
            if (error.code === 'INSUFFICIENT_FUNDS') {
                this.messagePopup.error(
                    'You do not have enough funds to complete this transaction. Please make sure you have enough ETH to cover the amount plus gas fees.',
                    'Insufficient Funds'
                );
            } else if (error.code === 'USER_REJECTED') {
                this.messagePopup.warning(
                    'Transaction was rejected in your wallet',
                    'Transaction Cancelled'
                );
            } else {
                this.messagePopup.error(
                    'There was an error processing your transaction. Please try again.',
                    'Transaction Failed'
                );
            }
            
            throw error;
        }
    }
    
    async getMerkleProof(address) {
        try {
            // Find which tier the address belongs to
            const tier = this.merkleHandler.findAddressTier(address);
            
            if (!tier) {
                console.log('Address not found in any tier');
                return [];
            }

            // Get proof for the address in its tier
            const proofData = this.merkleHandler.getProof(tier, address);
            
            if (!proofData || !proofData.valid) {
                console.log('Invalid or missing proof');
                return [];
            }

            console.log(`Got merkle proof for address ${address} in tier ${tier}`, proofData);
            return proofData.proof;

        } catch (error) {
            console.error('Error getting merkle proof:', error);
            return [];
        }
    }

    connectSigner(signer) {
        // Connect the contract to a signer for sending transactions
        this.contract = this.contract.connect(signer);
        this.mirrorContract = this.mirrorContract.connect(signer);
    }

    async sellBonding(params) {
        const { amount, minReturn, proof, message } = params;
        
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            if (!this.signer) {
                throw new Error('No wallet connected');
            }

            const contractWithSigner = this.contract.connect(this.signer);
            
            // Show pending transaction message
            this.messagePopup.info('Please confirm the transaction in your wallet', 'Transaction Pending');
            
            const tx = await contractWithSigner.sellBonding(
                amount,
                minReturn,
                proof,
                message
            );

            // Show transaction sent message
            this.messagePopup.info(`Transaction sent! Hash: ${tx.hash}`, 'Transaction Sent');
            
            // Wait for transaction confirmation using the provider
            const receipt = await this.provider.waitForTransaction(tx.hash);
            
            // Show success message
            this.messagePopup.success('Transaction confirmed!', 'Success');
            
            return receipt;
        } catch (error) {
            console.error('Sell bonding failed:', error);
            
            // Handle specific error types
            if (error.code === 'INSUFFICIENT_FUNDS') {
                this.messagePopup.error(
                    'You do not have enough EXEC tokens to complete this transaction.',
                    'Insufficient Tokens'
                );
            } else if (error.code === 'USER_REJECTED') {
                this.messagePopup.warning(
                    'Transaction was rejected in your wallet',
                    'Transaction Cancelled'
                );
            } else {
                this.messagePopup.error(
                    'There was an error processing your transaction. Please try again.',
                    'Transaction Failed'
                );
            }
            
            throw error;
        }
    }
}

export default ContractHandler; 