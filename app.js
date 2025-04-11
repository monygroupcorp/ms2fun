// Main entry point for the application
// This file handles ONLY the UI animations and ticker displays
// All blockchain and wallet functionality is now in src/index.js and related modules

// Add performance markers for monitoring
performance.mark('startApp');

document.addEventListener('DOMContentLoaded', () => {
    // Initialize original UI animations and elements
    initializeAnimations();
    
    // Initialize random price updates for UI
    initializePriceUpdates();
    
    // Set up input handlers for the whitelist checker
    initializeWhitelistChecker();
    
    // Mark UI loaded
    performance.mark('uiLoaded');
    performance.measure('uiLoadTime', 'startApp', 'uiLoaded');
});

/**
 * Initialize UI animations
 */
function initializeAnimations() {
    // Update instructions based on device type
    const desktopInstructions = document.querySelector('.instructions.desktop');
    const mobileInstructions = document.querySelector('.instructions.mobile');
    
    const isMobile = window.innerWidth <= 768 || 
                     /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (desktopInstructions && mobileInstructions) {
        desktopInstructions.style.display = isMobile ? 'none' : 'block';
        mobileInstructions.style.display = isMobile ? 'block' : 'none';
    }
    
    // Set up ticker animation
    const tickerContent = document.querySelector('.ticker-content');
    if (tickerContent) {
        const tickerItems = tickerContent.querySelectorAll('.ticker-item');
        const tickerWidth = Array.from(tickerItems).reduce((sum, item) => sum + item.offsetWidth, 0);
        
        // Clone ticker items to create infinite loop
        if (tickerWidth > 0) {
            tickerContent.style.animationDuration = `${tickerWidth / 50}s`;
        }
    }
}

/**
 * Initialize random price updates for UI
 */
function initializePriceUpdates() {
    // Configure initial values
    let currentCultPrice = 1000;
    let currentEthPrice = 13482.45;
    let currentGasPrice = 0.004;
    let currentOpenPrice = 120.50;
    let currentHighPrice = 123.87;
    let currentLowPrice = 120.15;
    let currentMarketValue = 9.993;
    let currentVolume = 10200000000;
    
    /**
     * Generate random fluctuation in a value
     * @param {number} base - Base value
     * @param {number} percentage - Percentage of maximum fluctuation
     * @returns {number} - New value
     */
    const randomFluctuation = (base, percentage) => {
        const variance = base * (percentage / 100);
        return base + (Math.random() * variance * 2 - variance);
    };
    
    /**
     * Format number with fixed decimals
     * @param {number} num - Number to format
     * @param {number} decimals - Decimal places
     * @returns {string} - Formatted number
     */
    const formatNumber = (num, decimals = 2) => {
        return num.toFixed(decimals);
    };
    
    /**
     * Update price indicators
     */
    function updatePrices() {
        // Update CULT price
        const priceElement = document.getElementById('currentPrice');
        const changeElement = document.getElementById('priceChange');
        
        if (priceElement && changeElement) {
            const newCultPrice = randomFluctuation(currentCultPrice, 1);
            const cultChange = newCultPrice - currentCultPrice;
            currentCultPrice = newCultPrice;
            
            priceElement.textContent = formatNumber(currentCultPrice);
            changeElement.textContent = (cultChange >= 0 ? '+' : '') + formatNumber(cultChange);
            
            // Update classes for color
            priceElement.className = 'price ' + (cultChange >= 0 ? 'up' : 'down');
            changeElement.className = 'change ' + (cultChange >= 0 ? 'up' : 'down');
        }
        
        // Update ETH price
        const ethPriceElement = document.getElementById('ethPrice');
        if (ethPriceElement) {
            const newEthPrice = randomFluctuation(currentEthPrice, 0.1);
            const ethChange = Math.abs(newEthPrice - currentEthPrice);
            currentEthPrice = newEthPrice;
            ethPriceElement.textContent = `${formatNumber(currentEthPrice)} +${formatNumber(ethChange)}`;
        }
        
        // Update Gas price
        const gasPriceElement = document.getElementById('gasPrice');
        if (gasPriceElement) {
            const newGasPrice = randomFluctuation(currentGasPrice, 5);
            const gasChange = newGasPrice - currentGasPrice;
            currentGasPrice = newGasPrice;
            gasPriceElement.textContent = `${currentGasPrice.toFixed(3)} ${gasChange >= 0 ? '+' : ''}${gasChange.toFixed(5)}`;
            gasPriceElement.className = gasChange >= 0 ? 'price-up' : 'price-down';
        }
        
        // Update other price elements
        const openPriceElement = document.getElementById('openPrice');
        const highPriceElement = document.getElementById('highPrice');
        const lowPriceElement = document.getElementById('lowPrice');
        const marketValueElement = document.getElementById('marketValue');
        const volumeElement = document.getElementById('cult volume');
        
        if (openPriceElement) openPriceElement.textContent = formatNumber(randomFluctuation(currentOpenPrice, 0.1)) + 'P';
        if (highPriceElement) highPriceElement.textContent = formatNumber(randomFluctuation(currentHighPrice, 0.1)) + 'Z';
        if (lowPriceElement) lowPriceElement.textContent = formatNumber(randomFluctuation(currentLowPrice, 0.1)) + 'Q';
        if (marketValueElement) marketValueElement.textContent = formatNumber(randomFluctuation(currentMarketValue, 0.5)) + 'B';
        
        // Update volume
        if (volumeElement) {
            const newVolume = Math.round(randomFluctuation(currentVolume, 2));
            currentVolume = newVolume;
            volumeElement.textContent = (newVolume / 1000000000).toFixed(1) + 'B ETH';
        }
        
        // Update time
        const timeElement = document.getElementById('timeStamp');
        if (timeElement) {
            const now = new Date();
            timeElement.textContent = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
    
    // Update prices immediately and then every 1 second
    updatePrices();
    setInterval(updatePrices, 1000);
}

/**
 * Initialize whitelist checker
 */
function initializeWhitelistChecker() {
    const input = document.getElementById('walletAddress');
    const button = document.getElementById('checkButton');
    
    if (!input || !button) return;
    
    // Format Ethereum address for display
    function formatAddress(address) {
        if (address.length !== 42) return address;
        return `${address.substring(0, 6)}...${address.substring(38)}`;
    }
    
    // Auto-focus input on desktop
    if (window.innerWidth > 768) {
        input.focus();
    }
    
    // Simulate whitelist check
    async function checkWhitelist(address) {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Deterministic "random" based on address
        const addressSum = address.split('')
            .reduce((sum, char) => sum + char.charCodeAt(0), 0);
        
        // 50% chance of being whitelisted for this demo
        if (addressSum % 100 < 50) {
            const days = ['March 14th', 'March 15th', 'March 16th', 'March 17th'];
            const day = (addressSum % 4) + 1;
            
            return {
                whitelisted: true,
                day: day,
                date: days[day - 1]
            };
        }
        
        return null;
    }
    
    // Handle address check
    async function checkWhitelistStatus() {
        const address = input.value;
        const resultDiv = document.getElementById('result');
        
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            resultDiv.innerHTML = '<p class="error">Please enter a valid Ethereum address</p>';
            return;
        }
        
        resultDiv.innerHTML = '<p class="checking">Checking...</p>';
        
        const result = await checkWhitelist(address);
        
        if (result) {
            resultDiv.innerHTML = `
                <p class="success">Congratulations! You are whitelisted!</p>
                <p>Address: ${formatAddress(address)}</p>
                <p>You can participate in the bonding curve presale on Day ${result.day}</p>
            `;
        } else {
            resultDiv.innerHTML = `
                <p class="error">Address not found in any whitelist</p>
                <p>Address checked: ${formatAddress(address)}</p>
            `;
        }
    }
    
    // Handle input events
    input.addEventListener('input', () => {
        // Auto-format as user types (optional)
    });
    
    // Listen for Enter key
    input.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            checkWhitelistStatus();
        }
    });
    
    // Button click handler
    button.addEventListener('click', checkWhitelistStatus);
}