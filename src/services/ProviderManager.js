/**
 * ProviderManager - Handles provider detection and fallback
 *
 * Priority:
 * 1. User's wallet (if connected) - read/write
 * 2. Public RPC fallback - read-only
 *
 * For production, supports provider rotation for reliability.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { detectNetwork } from '../config/network.js';

class ProviderManager {
    constructor() {
        this.provider = null;
        this.providerType = null; // 'wallet' | 'public'
        this.currentRpcIndex = 0;
        this.publicRpcUrls = [];
        this.ethers = ethers;
    }

    /**
     * Initialize provider with public RPC (no wallet prompt).
     * Wallet connection is opt-in via connectWallet().
     * @returns {Promise<{provider: object, type: string}>}
     */
    async initialize() {
        const network = detectNetwork();
        this.network = network;

        // Set up public RPC URLs based on network
        this.setupPublicRpcUrls(network);

        // Passively check if wallet is already connected (no popup)
        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts && accounts.length > 0) {
                    const walletProvider = new ethers.providers.Web3Provider(window.ethereum, 'any');
                    const walletNetwork = await walletProvider.getNetwork();

                    if (walletNetwork.chainId === network.chainId) {
                        this.provider = walletProvider;
                        this.providerType = 'wallet';
                        console.log('[ProviderManager] Using existing wallet connection (no prompt)');
                        return { provider: this.provider, type: 'wallet' };
                    }
                }
            } catch (error) {
                // Silent fail — fall through to public RPC
            }
        }

        // No existing wallet connection — use public RPC
        this.provider = await this.getPublicProvider();
        this.providerType = 'public';
        console.log('[ProviderManager] Using public RPC provider (read-only)');
        return { provider: this.provider, type: 'public' };
    }

    /**
     * Explicitly connect wallet (user-initiated only).
     * Call this from a "Connect Wallet" button handler.
     * @returns {Promise<{provider: object, type: string}>}
     */
    async connectWallet() {
        if (!window.ethereum) {
            throw new Error('No wallet detected');
        }

        const network = this.network || detectNetwork();

        // Request account access — this is the only place we trigger MetaMask
        await window.ethereum.request({ method: 'eth_requestAccounts' });

        const walletProvider = new ethers.providers.Web3Provider(window.ethereum, 'any');
        const walletNetwork = await walletProvider.getNetwork();

        // Verify wallet is on correct network
        if (walletNetwork.chainId === network.chainId) {
            this.provider = walletProvider;
            this.providerType = 'wallet';
            console.log('[ProviderManager] Connected wallet provider');
            return { provider: this.provider, type: 'wallet' };
        }

        // Wrong network — request switch
        console.log(`[ProviderManager] Wallet on wrong network (${walletNetwork.chainId}), requesting switch to ${network.chainId}`);
        const switched = await this.requestNetworkSwitch(network);

        if (switched) {
            const newWalletProvider = new ethers.providers.Web3Provider(window.ethereum, 'any');
            this.provider = newWalletProvider;
            this.providerType = 'wallet';
            console.log('[ProviderManager] Successfully switched network, using wallet provider');
            return { provider: this.provider, type: 'wallet' };
        }

        // Switch rejected — stay on public RPC
        console.log('[ProviderManager] Network switch cancelled, staying on public RPC');
        return { provider: this.provider, type: this.providerType };
    }

    /**
     * Setup public RPC URLs based on network
     * @private
     */
    setupPublicRpcUrls(network) {
        if (network.mode === 'local') {
            // Local Anvil first, then fall back to mainnet public RPCs
            this.publicRpcUrls = [
                'http://127.0.0.1:8545',
                'https://ethereum.publicnode.com',
                'https://rpc.ankr.com/eth',
                'https://eth.llamarpc.com',
                'https://cloudflare-eth.com'
            ];
        } else if (network.chainId === 1) {
            // Mainnet - multiple public RPCs for reliability
            this.publicRpcUrls = [
                'https://ethereum.publicnode.com',
                'https://rpc.ankr.com/eth',
                'https://eth.llamarpc.com',
                'https://cloudflare-eth.com'
            ];
        } else {
            // Use configured RPC
            this.publicRpcUrls = [network.rpcUrl];
        }
    }

    /**
     * Request network switch via MetaMask
     * @private
     * @param {object} network - Network config from detectNetwork()
     * @returns {Promise<boolean>} True if switch succeeded
     */
    async requestNetworkSwitch(network) {
        try {
            const chainIdHex = `0x${network.chainId.toString(16)}`;

            // Request switch to the correct network
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: chainIdHex }]
            });

            console.log(`[ProviderManager] Switched to chain ${network.chainId}`);
            return true;

        } catch (switchError) {
            // 4902 = chain not added to wallet yet
            if (switchError.code === 4902) {
                console.log('[ProviderManager] Network not in wallet, attempting to add...');

                try {
                    // For local networks, add the chain
                    if (network.mode === 'local') {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: `0x${network.chainId.toString(16)}`,
                                chainName: `Anvil Local (${network.chainId})`,
                                rpcUrls: [network.rpcUrl],
                                nativeCurrency: {
                                    name: 'Ethereum',
                                    symbol: 'ETH',
                                    decimals: 18
                                }
                            }]
                        });

                        console.log(`[ProviderManager] Added and switched to chain ${network.chainId}`);
                        return true;
                    } else {
                        console.log('[ProviderManager] Cannot auto-add non-local networks');
                        return false;
                    }
                } catch (addError) {
                    console.error('[ProviderManager] Failed to add network:', addError);
                    return false;
                }
            } else if (switchError.code === 4001) {
                // User rejected the request
                console.log('[ProviderManager] User rejected network switch');
                return false;
            } else {
                console.error('[ProviderManager] Network switch error:', switchError);
                return false;
            }
        }

        return false;
    }

    /**
     * Get public provider with rotation fallback
     * @private
     * @returns {Promise<object>}
     */
    async getPublicProvider() {
        // Try each RPC URL until one works
        for (let i = 0; i < this.publicRpcUrls.length; i++) {
            const rpcUrl = this.publicRpcUrls[this.currentRpcIndex];

            try {
                // Use StaticJsonRpcProvider for public RPCs to avoid deprecated eth_accounts call
                const chainId = this.network?.chainId || 1;
                const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, chainId);
                // Test the connection
                await provider.getBlockNumber();
                console.log(`[ProviderManager] Connected to ${rpcUrl}`);
                return provider;
            } catch (error) {
                console.warn(`[ProviderManager] Failed to connect to ${rpcUrl}:`, error);
                // Rotate to next RPC
                this.currentRpcIndex = (this.currentRpcIndex + 1) % this.publicRpcUrls.length;
            }
        }

        throw new Error('All public RPC providers failed');
    }

    /**
     * Rotate to next public RPC provider (for error recovery)
     * @returns {Promise<object>}
     */
    async rotateProvider() {
        if (this.providerType !== 'public') {
            console.warn('[ProviderManager] Cannot rotate wallet provider');
            return this.provider;
        }

        this.currentRpcIndex = (this.currentRpcIndex + 1) % this.publicRpcUrls.length;
        console.log('[ProviderManager] Rotating to next RPC provider...');
        this.provider = await this.getPublicProvider();
        return this.provider;
    }

    /**
     * Get current provider
     * @returns {object|null}
     */
    getProvider() {
        return this.provider;
    }

    /**
     * Check if using wallet (read/write) or public RPC (read-only)
     * @returns {string} 'wallet' | 'public' | null
     */
    getProviderType() {
        return this.providerType;
    }

    /**
     * Check if provider is read-only
     * @returns {boolean}
     */
    isReadOnly() {
        return this.providerType === 'public';
    }
}

// Export singleton
const providerManager = new ProviderManager();
export default providerManager;
