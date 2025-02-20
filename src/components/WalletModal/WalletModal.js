class WalletModal {
    constructor(providerMap, walletIcons) {
        this.providerMap = providerMap;
        this.walletIcons = walletIcons;
        this.modal = document.getElementById('walletModal');
        this.selectedWalletDisplay = document.getElementById('selectedWalletDisplay');
        this.continuePrompt = document.getElementById('continuePrompt');
        this.selectButton = document.getElementById('selectWallet');
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close modal when clicking outside
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });

        // Setup wallet options
        const walletOptions = document.querySelectorAll('.wallet-option');
        walletOptions.forEach(option => {
            option.addEventListener('click', async () => {
                const walletType = option.dataset.wallet;
                await this.handleWalletSelection(walletType);
                this.hide();
            });
        });
    }

    show() {
        this.modal.classList.add('active');
    }

    hide() {
        this.modal.classList.remove('active');
    }

    async handleWalletSelection(walletType) {
        try {
            const provider = this.providerMap[walletType]();
            
            if (!provider) {
                throw new Error(`${walletType} not detected`);
            }

            // Store the provider for future use
            this.provider = provider;

            // Update the selected wallet display
            this.updateSelectedWalletDisplay(walletType);

            // Some providers (like Rabby) need to be explicitly activated
            if (walletType === 'rabby' && provider.activate) {
                await provider.activate();
            }

            return {
                provider,
                walletType
            };

        } catch (error) {
            throw new Error(`${error.message}. Please install ${walletType}.`);
        }
    }

    updateSelectedWalletDisplay(walletType) {
        const icon = document.getElementById('selectedWalletIcon');
        const name = document.getElementById('selectedWalletName');

        // Update display
        icon.src = this.walletIcons[walletType];
        name.textContent = walletType.toUpperCase();
        this.selectedWalletDisplay.classList.add('active');
        this.continuePrompt.style.display = 'block';
        this.selectButton.style.display = 'none';

        // Add fallback for icon load error
        icon.onerror = () => {
            icon.style.display = 'none';
        };
    }

    hideWalletDisplay() {
        if (this.selectedWalletDisplay) {
            this.selectedWalletDisplay.remove();
        }
        this.continuePrompt?.remove();
        this.selectButton?.remove();
    }

    showSelectButton() {
        this.selectButton.style.display = 'block';
        this.selectedWalletDisplay.classList.remove('active');
        this.continuePrompt.style.display = 'none';
    }
}

export default WalletModal; 