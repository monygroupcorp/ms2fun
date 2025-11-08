import Store from './Store.js';

// Define action types as constants
export const TRADING_ACTIONS = {
    SET_DIRECTION: 'trading/setDirection',
    UPDATE_AMOUNTS: 'trading/updateAmounts',
    UPDATE_PRICE: 'trading/updatePrice',
    UPDATE_BALANCES: 'trading/updateBalances',
    SET_VIEW: 'trading/setView',
    UPDATE_MESSAGE: 'trading/updateMessage',
    TOGGLE_OPTIONS: 'trading/toggleOptions',
    SET_LOADING: 'trading/setLoading',
    SET_ERROR: 'trading/setError',
    RESET_STATE: 'trading/resetState',
    LOAD_MESSAGE_BATCH: 'trading/loadMessageBatch',
};

const initialState = {
    ca: '',
    mirror: '',
    isEthToExec: true,
    ethAmount: '',
    execAmount: '',
    showMessageOption: false,
    mintOptionChecked: false,
    transactionMessage: '',
    view: {
        isMobile: false,
        showCurve: true,
        showSwap: true
    },
    price: {
        current: 0,
        lastUpdated: null
    },
    balances: {
        eth: '0',
        exec: '0',
        nfts: '0',
        userNFTs: [],
        lastUpdated: null
    },
    message: {
        text: '',
        pending: '',
        debounceActive: false
    },
    options: {},
    status: {
        loading: false,
        error: null
    },
    amounts: {
        lastUpdated: null
    },
    wallet: {
        address: null,
        isConnected: false,
        networkId: null
    },
    isTransactionValid: true,
    contractData: {
        totalBondingSupply: 0,
        lastUpdated: null,
        totalMessages: 0,
        totalNFTs: 0,
        recentMessages: null,
        freeSupply: 0,
        freeMint: 0
    },
    poolData: {
        liquidityPool: null,
        reserve0: 0,
        reserve1: 0
    }
};

const validators = {
    'ethAmount': (value) => !value || (typeof value === 'string' && !isNaN(parseFloat(value))),
    'execAmount': (value) => !value || (typeof value === 'string' && !isNaN(parseFloat(value))),
    'price.current': (value) => typeof value === 'number' && value >= 0,
    'isEthToExec': (value) => typeof value === 'boolean',
    'view': (value) => typeof value === 'object' && value !== null,
    'balances': (value) => typeof value === 'object' && value !== null,
    'message': (value) => typeof value === 'object' && value !== null,
    'options': (value) => typeof value === 'object' && value !== null,
    'status': (value) => typeof value === 'object' && value !== null,
    'contractData': (value) => typeof value === 'object' && value !== null,
    'poolData': (value) => typeof value === 'object' && value !== null
};

class TradingStore extends Store {
    constructor() {
        super(initialState, validators);
    }

    // Action creators
    setDirection(isEthToExec) {
        this.setState({
            isEthToExec,
            ethAmount: '',
            execAmount: '',
            nfts: '0',
            showMessageOption: false,
            mintOptionChecked: false,
            transactionMessage: '',
            view: {
                ...this.state.view,
                isMobile: window.innerWidth <= 768
            }
        });
    }

    updateAmounts(ethAmount, execAmount) {
        const currentAmounts = this.selectAmounts();
        this.setState({
            amounts: {
                eth: ethAmount !== null ? ethAmount : currentAmounts.eth,
                exec: execAmount !== null ? execAmount : currentAmounts.exec,
                lastUpdated: Date.now()
            }
        });
    }

    updatePrice(price) {
        this.setState({
            price: {
                current: price,
                lastUpdated: Date.now()
            }
        });
    }

    updateBalances(balances) {
        this.setState({
            balances: {
                ...balances,
                lastUpdated: Date.now()
            }
        });
    }

    updateFreeSituation(freeSituation) {
        this.setState({
            contractData: {
                ...this.state.contractData,
                freeMint: freeSituation.freeMint,
                freeSupply: freeSituation.freeSupply
            }
        });
    }

    setView(view) {
        this.setState({
            view: {
                ...view,
                isMobile: window.innerWidth <= 768
            }
        });
    }

    updateMessage(text, isPending = false) {
        this.setState({
            message: {
                text: isPending ? this.state.message.text : text,
                pending: isPending ? text : '',
                debounceActive: isPending
            }
        });
    }

    async updateMessageHistory(newStartIndex, newEndIndex) {
        try {
            const messages = await this.blockchainService.getMessagesBatch(newStartIndex, newEndIndex);
            this.setState({
                contractData: {
                    ...this.state.contractData,
                    recentMessages: messages,
                    lastUpdated: Date.now()
                }
            });
        } catch (error) {
            console.error('Error updating message history:', error);
            this.setError('Failed to update message history');
        }
    }

    toggleOption(option, value) {
        this.setState({
            options: {
                ...this.state.options,
                [option]: value
            }
        });
    }

    setLoading(loading) {
        this.setState({
            status: {
                ...this.state.status,
                loading
            }
        });
    }

    setError(error) {
        this.setState({
            status: {
                ...this.state.status,
                error
            }
        });
    }

    resetState() {
        this.setState(initialState);
    }

    setWalletAddress(address) {
        this.setState({
            wallet: {
                ...this.state.wallet,
                address,
                isConnected: !!address
            }
        });
    }

    setWalletConnected(isConnected) {
        this.setState({
            wallet: {
                ...this.state.wallet,
                isConnected
            }
        });
    }

    setWalletNetworkId(networkId) {
        this.setState({
            wallet: {
                ...this.state.wallet,
                networkId
            }
        });
    }

    setTransactionValidity(isValid) {
        this.setState({
            ...this.state,
            isTransactionValid: isValid
        });
    }

    updateContractData(data) {
        console.log('Updating contract data:', data.liquidityPool);
        this.setState({
            contractData: {
                ...data,
                lastUpdated: Date.now()
            }
        });
    }

    async loadMessageBatch(startIndex, endIndex) {
        try {
            this.setLoading(true);
            const messages = await this.blockchainService.getMessagesBatch(startIndex, endIndex);
            
            // Get current messages
            const currentMessages = this.state.contractData.recentMessages || [];
            
            // If we have existing messages, we need to merge them properly
            // The blockchain returns arrays of comma-separated strings for each field
            // We need to append the new batch to the existing one
            const updatedMessages = [];
            
            if (currentMessages.length >= 5 && currentMessages[0] && currentMessages[0] !== '') {
                // We have existing messages, merge them
                for (let i = 0; i < 5; i++) {
                    if (i < messages.length && messages[i]) {
                        // Append new messages to existing ones with comma separator
                        updatedMessages[i] = currentMessages[i] + ',' + messages[i];
                    } else {
                        // Keep existing if no new data for this field
                        updatedMessages[i] = currentMessages[i] || '';
                    }
                }
            } else {
                // No existing messages, use the new batch directly
                updatedMessages = messages;
            }

            this.updateContractData({
                ...this.state.contractData,
                recentMessages: updatedMessages
            });
        } catch (error) {
            this.setError('Failed to load messages: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    setContracts(ca, mirror) {
        this.setState({
            ca,
            mirror
        });
    }

    selectContracts() {
        return {
            ca: this.state.ca,
            mirror: this.state.mirror
        };
    }

    // Selectors
    selectDirection() {
        return this.state.isEthToExec;
    }

    selectAmounts() {
        return {
            eth: this.state.ethAmount,
            exec: this.state.execAmount,
            lastUpdated: this.state.amounts?.lastUpdated
        };
    }

    selectPrice() {
        return this.state.price;
    }

    selectBalances() {
        return this.state.balances;
    }

    selectUserNFTs() {
        return this.state.balances.userNFTs;
    }

    selectView() {
        return this.state.view;
    }

    selectMessage() {
        return this.state.message;
    }

    selectOptions() {
        return this.state.options;
    }

    selectStatus() {
        return this.state.status;
    }

    selectConnectedAddress() {
        return this.state.wallet.address;
    }

    isWalletConnected() {
        return this.state.wallet.isConnected;
    }

    selectTransactionValidity() {
        return this.state.isTransactionValid;
    }

    selectContractData() {
        return this.state.contractData;
    }

    selectFreeSituation() {
        const { freeSupply, freeMint } = this.state.contractData;
        const address = this.selectConnectedAddress();
        return {
            freeSupply,
            freeMint,
            address
        }
    }

    updateUserNFTs(nftData) {
        this.setState({
            balances: {
                ...this.state.balances,
                userNFTs: nftData
            }
        });
    }

    updatePoolData(data) {
        this.setState({
            poolData: {
                ...this.state.poolData,
                ...data
            }
        });
    }

    getPoolData() {
        return this.state.poolData;
    }
}

// Export singleton instance
export const tradingStore = new TradingStore(); 