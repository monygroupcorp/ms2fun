export class SwapEventManager {
    constructor(swapInterface) {
        this.swap = swapInterface;
        this.handlers = new Map();
    }

    register(eventType, handler) {
        const unsubscribe = eventBus.on(eventType, handler.bind(this.swap));
        this.handlers.set(eventType, unsubscribe);
    }

    initializeCoreEvents() {
        this.register('transaction:pending', this.handleTransactionEvents);
        this.register('transaction:confirmed', this.handleTransactionEvents);
        this.register('transaction:success', this.handleTransactionEvents);
        this.register('transaction:error', this.handleTransactionEvents);
        this.register('balances:updated', this.handleBalanceUpdate);
        this.register('transactionOptions:update', this.handleTransactionOptionsUpdate);
        this.register('contractData:updated', this.handleContractDataUpdate);
    }

    destroy() {
        this.handlers.forEach((unsubscribe, eventType) => {
            unsubscribe();
            this.handlers.delete(eventType);
        });
    }
} 