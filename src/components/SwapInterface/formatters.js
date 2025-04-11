export class BalanceFormatter {
    static formatETH(value) {
        return parseFloat(value).toFixed(6);
    }

    static formatEXEC(value) {
        return parseInt(value).toLocaleString();
    }

    static formatAvailableEXEC(balances, isFreeMint) {
        const base = parseInt(balances.exec);
        return isFreeMint 
            ? `Available: ${(base - 1e6).toLocaleString()}`
            : `Balance: ${base.toLocaleString()}`;
    }
} 