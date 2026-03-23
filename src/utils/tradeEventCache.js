/**
 * TradeEventCache
 *
 * Fetches BondingSale events backwards from current block,
 * caches them in IndexedDB for fast repeat visits.
 */

const BONDING_SALE_FRAGMENT = 'event BondingSale(address indexed user, uint256 amount, uint256 cost, bool isBuy)';

// ── IndexedDB helpers ──

function openDB(contractAddress) {
    return new Promise((resolve, reject) => {
        const dbName = `ms2fun-trades-${contractAddress.toLowerCase().slice(0, 10)}`;
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('events')) {
                const store = db.createObjectStore('events', { keyPath: 'id' });
                store.createIndex('blockNumber', 'blockNumber', { unique: false });
            }
            if (!db.objectStoreNames.contains('meta')) {
                db.createObjectStore('meta', { keyPath: 'key' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getMeta(db, key) {
    return new Promise((resolve) => {
        const tx = db.transaction('meta', 'readonly');
        const request = tx.objectStore('meta').get(key);
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => resolve(null);
    });
}

function setMeta(db, key, value) {
    return new Promise((resolve) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key, value });
        tx.oncomplete = () => resolve();
    });
}

function storeEvents(db, events) {
    if (!events.length) return Promise.resolve();
    return new Promise((resolve) => {
        const tx = db.transaction('events', 'readwrite');
        const store = tx.objectStore('events');
        for (const event of events) {
            store.put(event);
        }
        tx.oncomplete = () => resolve();
    });
}

function getAllEventsSorted(db) {
    return new Promise((resolve) => {
        const tx = db.transaction('events', 'readonly');
        const index = tx.objectStore('events').index('blockNumber');
        const request = index.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
    });
}

// ── Fetch + parse logs ──

async function fetchAndParse(provider, address, topic, iface, fromBlock, toBlock) {
    const logs = await provider.getLogs({
        address,
        topics: [topic],
        fromBlock,
        toBlock
    });

    return logs.map(log => {
        const decoded = iface.parseLog(log);
        return {
            id: `${log.blockNumber}-${log.logIndex}`,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            user: decoded.args.user,
            amount: decoded.args.amount.toString(),
            cost: decoded.args.cost.toString(),
            isBuy: decoded.args.isBuy
        };
    });
}

// ── Public API ──

export async function createTradeEventCache(contractAddress, provider) {
    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
    const iface = new ethers.utils.Interface([BONDING_SALE_FRAGMENT]);
    const topic = iface.getEventTopic('BondingSale');

    const db = await openDB(contractAddress);
    let events = await getAllEventsSorted(db);
    let oldestBlock = await getMeta(db, 'oldestBlock');
    let newestBlock = await getMeta(db, 'newestBlock');

    return {
        getEvents() {
            return events;
        },

        /** Fetch from last known block to current head */
        async fetchNewest() {
            try {
                const currentBlock = await provider.getBlockNumber();
                const from = newestBlock != null ? newestBlock + 1 : Math.max(0, currentBlock - 500);
                if (from > currentBlock) return events;

                const newEvents = await fetchAndParse(provider, contractAddress, topic, iface, from, currentBlock);
                if (newEvents.length) {
                    await storeEvents(db, newEvents);
                    events = await getAllEventsSorted(db);
                }

                newestBlock = currentBlock;
                await setMeta(db, 'newestBlock', currentBlock);
                if (oldestBlock == null) {
                    oldestBlock = from;
                    await setMeta(db, 'oldestBlock', from);
                }
                return events;
            } catch (e) {
                console.warn('[TradeEventCache] fetchNewest error:', e);
                return events;
            }
        },

        /** Fetch one older chunk for backfill */
        async fetchOlderChunk(chunkSize = 500) {
            try {
                if (oldestBlock == null || oldestBlock <= 0) return events;

                const to = oldestBlock - 1;
                const from = Math.max(0, to - chunkSize);
                if (from >= to) return events;

                const olderEvents = await fetchAndParse(provider, contractAddress, topic, iface, from, to);
                if (olderEvents.length) {
                    await storeEvents(db, olderEvents);
                    events = await getAllEventsSorted(db);
                }

                oldestBlock = from;
                await setMeta(db, 'oldestBlock', from);
                return events;
            } catch (e) {
                console.warn('[TradeEventCache] fetchOlderChunk error:', e);
                return events;
            }
        },

        get oldestBlock() { return oldestBlock; },
        get newestBlock() { return newestBlock; }
    };
}
