/**
 * CandleAggregator
 *
 * Transforms raw BondingSale events into OHLC candles
 * using block numbers as the time axis.
 */

export function aggregateCandles(events, blocksPerCandle) {
    if (!events.length) return [];

    const sorted = [...events].sort((a, b) => a.blockNumber - b.blockNumber);

    // Derive price per trade: cost / amount (both in wei, ratio = ETH per token)
    const trades = sorted.map(e => ({
        blockNumber: e.blockNumber,
        price: parseFloat(e.cost) / parseFloat(e.amount),
        volume: parseFloat(e.cost),
        isBuy: e.isBuy
    })).filter(t => isFinite(t.price) && t.price > 0);

    if (!trades.length) return [];

    const minBlock = trades[0].blockNumber;
    const maxBlock = trades[trades.length - 1].blockNumber;
    const blockRange = maxBlock - minBlock;

    // Auto-calculate interval: fewer candles so each has multiple trades with real OHLC spread
    if (!blocksPerCandle) {
        const targetCandles = Math.max(3, Math.min(15, Math.floor(trades.length / 4)));
        blocksPerCandle = Math.max(2, Math.ceil(blockRange / Math.max(1, targetCandles)));
    }

    // Align to interval boundaries
    const startBucket = Math.floor(minBlock / blocksPerCandle) * blocksPerCandle;
    const endBucket = Math.floor(maxBlock / blocksPerCandle) * blocksPerCandle;

    const candles = [];
    let lastClose = trades[0].price;

    for (let bucket = startBucket; bucket <= endBucket; bucket += blocksPerCandle) {
        const bucketEnd = bucket + blocksPerCandle;
        const bucketTrades = trades.filter(
            t => t.blockNumber >= bucket && t.blockNumber < bucketEnd
        );

        if (bucketTrades.length === 0) {
            // Empty interval — carry forward previous close
            candles.push({
                blockStart: bucket,
                open: lastClose,
                high: lastClose,
                low: lastClose,
                close: lastClose,
                volume: 0,
                trades: 0
            });
        } else {
            const open = bucketTrades[0].price;
            const close = bucketTrades[bucketTrades.length - 1].price;
            const high = Math.max(...bucketTrades.map(t => t.price));
            const low = Math.min(...bucketTrades.map(t => t.price));
            const volume = bucketTrades.reduce((sum, t) => sum + t.volume, 0);

            candles.push({
                blockStart: bucket,
                open,
                high,
                low,
                close,
                volume,
                trades: bucketTrades.length
            });

            lastClose = close;
        }
    }

    return candles;
}
