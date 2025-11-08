import { tradingStore } from '../store/tradingStore.js';
import { eventBus } from '../core/EventBus.js';

/**
 * useWallet Hook
 * 
 * Custom hook for wallet operations.
 * Extracts wallet connection logic, address management,
 * and network change handling.
 * 
 * @param {Object} params - Hook parameters
 * @param {Object} params.walletConnection - Wallet connection object
 * @returns {Object} - Wallet hook API
 */
export function useWallet({ walletConnection }) {
    /**
     * Connect wallet
     * @returns {Promise<Object>} - Connection result with address, networkId, isConnected
     */
    async function connect() {
        // Wallet connection is typically handled by WalletService
        // This hook provides a unified interface
        const { walletAddress, isConnected, networkId } = walletConnection || {};
        
        if (walletAddress) {
            tradingStore.setWalletAddress(walletAddress);
            tradingStore.setWalletConnected(isConnected || false);
            tradingStore.setWalletNetworkId(networkId || null);
        }
        
        return {
            address: walletAddress,
            networkId: networkId,
            isConnected: isConnected || false
        };
    }

    /**
     * Disconnect wallet
     */
    function disconnect() {
        tradingStore.setWalletAddress(null);
        tradingStore.setWalletConnected(false);
        tradingStore.setWalletNetworkId(null);
        
        eventBus.emit('wallet:disconnected');
    }

    /**
     * Get current wallet address
     * @returns {string|null} - Current wallet address
     */
    function getAddress() {
        const walletState = tradingStore.selectWallet();
        return walletState?.address || null;
    }

    /**
     * Get current network ID
     * @returns {number|null} - Current network ID
     */
    function getNetworkId() {
        const walletState = tradingStore.selectWallet();
        return walletState?.networkId || null;
    }

    /**
     * Check if wallet is connected
     * @returns {boolean} - Whether wallet is connected
     */
    function isConnected() {
        const walletState = tradingStore.selectWallet();
        return walletState?.isConnected || false;
    }

    /**
     * Handle network change
     * @param {number} newNetworkId - New network ID
     */
    function handleNetworkChange(newNetworkId) {
        tradingStore.setWalletNetworkId(newNetworkId);
        eventBus.emit('network:changed', { networkId: newNetworkId });
    }

    /**
     * Handle account change
     * @param {string} newAddress - New wallet address
     */
    function handleAccountChange(newAddress) {
        tradingStore.setWalletAddress(newAddress);
        eventBus.emit('account:changed', { address: newAddress });
    }

    return {
        connect,
        disconnect,
        address: getAddress(),
        networkId: getNetworkId(),
        isConnected: isConnected(),
        handleNetworkChange,
        handleAccountChange
    };
}

export default useWallet;

