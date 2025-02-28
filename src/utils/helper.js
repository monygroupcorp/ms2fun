/**
 * Creates a debounced version of a function that delays execution until after a specified wait time
 * @param {Function} func - The function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @returns {Function} - The debounced function
 */
export function debounce(func, wait) {
    let timeout;
    
    // Return wrapped function
    const debounced = function(...args) {
        // Clear any existing timeout
        if (timeout) {
            clearTimeout(timeout);
        }

        // Set new timeout
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, wait);
    };

    // Add cancel method to clear timeout
    debounced.cancel = function() {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
    };

    return debounced;
}
