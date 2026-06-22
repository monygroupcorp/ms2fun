/**
 * Contract Utilities
 *
 * Shared utilities for contract operations including:
 * - Batch contract calls
 * - Retry logic with exponential backoff
 * - Pagination helpers
 * - Error handling utilities
 */

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute multiple contract calls in batch
 * @param {Object} adapter - Contract adapter instance
 * @param {Array<Object>} calls - Array of {method, args, options} objects
 * @returns {Promise<Array>} Array of results
 */
export async function batchContractCalls(adapter, calls) {
    if (!adapter || !Array.isArray(calls)) {
        throw new Error('Invalid parameters for batchContractCalls');
    }

    return Promise.all(
        calls.map(({ method, args = [], options = {} }) =>
            adapter.executeContractCall(method, args, options)
        )
    );
}

/**
 * Execute multiple contract calls in batch with error handling
 * Returns both successful and failed results
 * @param {Object} adapter - Contract adapter instance
 * @param {Array<Object>} calls - Array of {method, args, options} objects
 * @returns {Promise<Array<Object>>} Array of {success, result, error} objects
 */
export async function batchContractCallsSettled(adapter, calls) {
    if (!adapter || !Array.isArray(calls)) {
        throw new Error('Invalid parameters for batchContractCallsSettled');
    }

    const results = await Promise.allSettled(
        calls.map(({ method, args = [], options = {} }) =>
            adapter.executeContractCall(method, args, options)
        )
    );

    return results.map((result, index) => ({
        method: calls[index].method,
        success: result.status === 'fulfilled',
        result: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason : null
    }));
}

/**
 * Retry contract call with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {Function} options.shouldRetry - Custom retry condition (default: always retry)
 * @returns {Promise<any>} Function result
 * @throws {Error} If all retries fail
 */
export async function retryContractCall(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        shouldRetry = () => true
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry if this is the last attempt
            if (attempt === maxRetries) {
                break;
            }

            // Don't retry if custom condition says not to
            if (!shouldRetry(error, attempt)) {
                break;
            }

            // Don't retry on user rejection
            if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
                break;
            }

            // Calculate exponential backoff delay
            const delay = Math.min(
                initialDelay * Math.pow(2, attempt),
                maxDelay
            );

            console.warn(
                `[contractUtils] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms:`,
                error.message
            );

            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * Paginate contract results
 * Automatically handles contracts that return paginated data
 * @param {Object} adapter - Contract adapter instance
 * @param {string} method - Contract method name
 * @param {number} totalCount - Total number of items
 * @param {Object} options - Pagination options
 * @param {number} options.pageSize - Items per page (default: 20)
 * @param {number} options.maxPages - Maximum pages to fetch (default: unlimited)
 * @param {Function} options.transform - Transform function for results
 * @returns {Promise<Array>} Flattened array of all results
 */
export async function paginateContractResults(adapter, method, totalCount, options = {}) {
    const {
        pageSize = 20,
        maxPages = Infinity,
        transform = (x) => x
    } = options;

    if (totalCount === 0) {
        return [];
    }

    const numPages = Math.min(
        Math.ceil(totalCount / pageSize),
        maxPages
    );

    const results = [];

    for (let page = 0; page < numPages; page++) {
        const startIndex = page * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalCount);

        try {
            const pageResults = await adapter.executeContractCall(
                method,
                [startIndex, endIndex]
            );

            // Transform and flatten results
            const transformed = Array.isArray(pageResults)
                ? pageResults.map(transform)
                : [transform(pageResults)];

            results.push(...transformed);
        } catch (error) {
            console.error(
                `[contractUtils] Error fetching page ${page + 1}/${numPages}:`,
                error
            );

            // Continue with next page on error
            // Could make this configurable
            continue;
        }
    }

    return results;
}

/**
 * Paginate with cursor-based pagination
 * For contracts that use cursor pagination (lastId, limit pattern)
 * @param {Object} adapter - Contract adapter instance
 * @param {string} method - Contract method name
 * @param {Object} options - Pagination options
 * @param {number} options.pageSize - Items per page (default: 20)
 * @param {number} options.maxPages - Maximum pages to fetch (default: 10)
 * @param {Function} options.getCursor - Function to extract cursor from results
 * @param {any} options.initialCursor - Initial cursor value
 * @returns {Promise<Array>} Flattened array of all results
 */
export async function paginateWithCursor(adapter, method, options = {}) {
    const {
        pageSize = 20,
        maxPages = 10,
        getCursor = (results) => results[results.length - 1]?.id,
        initialCursor = 0
    } = options;

    const allResults = [];
    let cursor = initialCursor;
    let page = 0;

    while (page < maxPages) {
        try {
            const results = await adapter.executeContractCall(
                method,
                [cursor, pageSize]
            );

            if (!results || results.length === 0) {
                break; // No more results
            }

            allResults.push(...results);

            // Get next cursor
            cursor = getCursor(results);

            if (cursor === null || cursor === undefined) {
                break; // No more pages
            }

            page++;
        } catch (error) {
            console.error(
                `[contractUtils] Error in cursor pagination page ${page + 1}:`,
                error
            );
            break;
        }
    }

    return allResults;
}

/**
 * Check if error is retryable
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is retryable
 */
export function isRetryableError(error) {
    if (!error) return false;

    // User rejection - don't retry
    if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        return false;
    }

    // Insufficient funds - don't retry
    if (error.code === 'INSUFFICIENT_FUNDS') {
        return false;
    }

    // Network errors - retry
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
        return true;
    }

    // Server errors - retry
    if (error.code === 'SERVER_ERROR') {
        return true;
    }

    // Call exceptions might be retryable (depends on the error)
    if (error.code === 'CALL_EXCEPTION') {
        // Don't retry if it's a revert
        if (error.message.includes('revert')) {
            return false;
        }
        return true;
    }

    // Default: retry unknown errors
    return true;
}

/**
 * Parse contract error message
 * Extracts revert reason from error
 * @param {Error} error - Contract error
 * @returns {string} Parsed error message
 */
export function parseContractError(error) {
    if (!error) return 'Unknown error';

    // Extract revert reason
    const revertMatch = error.message?.match(/execution reverted: (.*?)(?:"|$)/);
    if (revertMatch) {
        return revertMatch[1];
    }

    // Known error codes
    const errorMessages = {
        'INSUFFICIENT_FUNDS': 'Insufficient funds to complete transaction',
        'UNPREDICTABLE_GAS_LIMIT': 'Transaction would fail - check your inputs',
        'ACTION_REJECTED': 'Transaction rejected by user',
        'NETWORK_ERROR': 'Network error - please check your connection',
        'TIMEOUT': 'Request timed out - please try again',
        'CALL_EXCEPTION': 'Contract call failed'
    };

    if (error.code && errorMessages[error.code]) {
        return errorMessages[error.code];
    }

    return error.message || 'Unknown error';
}

/**
 * Throttle function calls
 * Ensures minimum time between calls
 * @param {Function} fn - Function to throttle
 * @param {number} minInterval - Minimum interval in ms
 * @returns {Function} Throttled function
 */
export function throttle(fn, minInterval = 100) {
    let lastCallTime = 0;
    let timeoutId = null;

    return async function throttled(...args) {
        const now = Date.now();
        const timeSinceLastCall = now - lastCallTime;

        if (timeSinceLastCall >= minInterval) {
            lastCallTime = now;
            return await fn(...args);
        } else {
            // Schedule call for later
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            return new Promise((resolve, reject) => {
                timeoutId = setTimeout(async () => {
                    lastCallTime = Date.now();
                    try {
                        const result = await fn(...args);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                }, minInterval - timeSinceLastCall);
            });
        }
    };
}

export default {
    batchContractCalls,
    batchContractCallsSettled,
    retryContractCall,
    paginateContractResults,
    paginateWithCursor,
    isRetryableError,
    parseContractError,
    throttle
};
