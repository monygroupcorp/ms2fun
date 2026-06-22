/**
 * Debug logging utility
 *
 * Toggle DEBUG_MODE to enable/disable all debug logs
 */

// Set to false to disable all debug logs
const DEBUG_MODE = true;

export const debug = {
    log: (...args) => {
        if (DEBUG_MODE) console.log(...args);
    },
    warn: (...args) => {
        if (DEBUG_MODE) console.warn(...args);
    },
    error: (...args) => {
        // Always show errors
        console.error(...args);
    },
    time: (label) => {
        if (DEBUG_MODE) console.time(label);
    },
    timeEnd: (label) => {
        if (DEBUG_MODE) console.timeEnd(label);
    }
};
