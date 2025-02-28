import priceService from '../services/PriceService.js';

// Example usage
async function demonstratePriceService() {
    try {
        // Get price for token ID 1
        const price = await priceService.getPrice(1, 'USD');
        console.log('Token 1 price:', price);

        // Update price
        await priceService.updatePrice(1, 150.00, 'USD');
        console.log('Updated price:', await priceService.getPrice(1, 'USD'));

        // Convert price to different currency
        const priceInEUR = await priceService.convertPrice(150.00, 'USD', 'EUR');
        console.log('Price in EUR:', priceInEUR);

        // Listen for price updates
        window.addEventListener('priceUpdate', (event) => {
            console.log('Price updated:', event.detail);
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run the demonstration
demonstratePriceService(); 