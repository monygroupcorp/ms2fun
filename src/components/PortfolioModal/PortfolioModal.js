import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import { tradingStore } from '../../store/tradingStore.js';
import { MintModal } from '../MintModal/MintModal.js';
import { SendModal } from '../SendModal/SendModal.js';

export default class PortfolioModal extends Component {
    constructor(blockchainService) {
        super();
        this.handleClose = this.handleClose.bind(this);
        this.blockchainService = blockchainService;
        this.tradingStore = tradingStore;
        this.loadNFTData = this.loadNFTData.bind(this);
        this.handleLoadMore = this.handleLoadMore.bind(this);
        this.handleSearch = this.handleSearch.bind(this);
        this.handlePageChange = this.handlePageChange.bind(this);
        this.handleMintComplete = this.handleMintComplete.bind(this);
        this.isLoading = false;
        this.currentLimit = 4;
        this.itemsPerPage = 8;
        this.currentPage = 1;
        this.searchQuery = '';
        this.totalNFTs = this.tradingStore.selectBalances().nfts;
        this.executeSearch = this.executeSearch.bind(this);
        this.handleSearchKeyPress = this.handleSearchKeyPress.bind(this);
        this.filteredNFTs = null;
        this.mintModal = null;
        this.sendModal = null;
    }

    async loadNFTData(limit = this.currentLimit) {
        try {
            this.isLoading = true;
            this.updateLoadingState();

            const address = await this.tradingStore.selectConnectedAddress();
            const existingData = this.tradingStore.selectUserNFTs();
            
            // Get total NFT count from trading store
            this.totalNFTs = await this.tradingStore.selectBalances().nfts;
            console.log('totalNFTs in loadNFTData', this.totalNFTs);
            
            // If we have existing data, just load metadata for visible items
            if(existingData && existingData.length >= limit) {
                const visibleNFTs = existingData.slice(0, limit);
                await this.loadMetadataForNFTs(visibleNFTs);
                this.updatePortfolioContent(existingData);
                return existingData;
            }

            const nftsWithMetadata = await this.blockchainService.getUserNFTsWithMetadata(address, limit);
            
            // Process the metadata URLs
            const processedNFTs = nftsWithMetadata.map(nft => ({
                ...nft,
                isValidHttp: this.isValidHttpUrl(nft.metadata),
                processedMetadata: null,
                imageUrl: null
            }));

            // Only fetch metadata for visible NFTs
            const visibleNFTs = processedNFTs.slice(0, this.itemsPerPage);
            await this.loadMetadataForNFTs(visibleNFTs);
            
            this.tradingStore.updateUserNFTs(processedNFTs);
            this.isLoading = false;
            this.updatePortfolioContent(processedNFTs);
            return processedNFTs;
        } catch (error) {
            console.error('Error loading NFT data:', error);
            this.isLoading = false;
            this.updateLoadingState();
        }
    }

    async loadMetadataForNFTs(nfts) {
        const validNFTs = nfts.filter(nft => nft.isValidHttp && !nft.processedMetadata);
        await this.fetchMetadataContent(validNFTs);
    }

    handleSearch(event) {
        this.searchQuery = event.target.value;
    }

    executeSearch() {
        const existingData = this.tradingStore.selectUserNFTs();
        if (existingData) {
            this.filteredNFTs = existingData.filter(nft => 
                nft.tokenId.toString().includes(this.searchQuery) ||
                (nft.processedMetadata?.name || '').toLowerCase().includes(this.searchQuery.toLowerCase())
            );
            this.currentPage = 1;
            this.updatePortfolioElements(this.filteredNFTs);
        }
    }

    handleSearchKeyPress(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.executeSearch();
        }
    }

    updatePortfolioElements(nfts) {
        const portfolioContent = this.element.querySelector('.portfolio-content');
        if (!portfolioContent) return;

        // Use filtered NFTs if we have them
        const displayNFTs = this.filteredNFTs || nfts;
        const { ca, mirror } = this.tradingStore.selectContracts();
        console.log('ca', ca);
        console.log('mirror', mirror);
        // Calculate pagination
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedNFTs = displayNFTs.slice(startIndex, endIndex);

        // Update NFT cards container
        const nftCardsContainer = portfolioContent.querySelector('.nft-cards-container');
        if (nftCardsContainer) {
            if (paginatedNFTs.length === 0) {
                nftCardsContainer.innerHTML = `
                    <div class="no-results">
                        ${this.searchQuery ? `No NFTs found matching "${this.searchQuery}"` : 'No NFTs found'}
                    </div>
                `;
            } else {
                nftCardsContainer.innerHTML = paginatedNFTs.map(nft => {
                    if (!nft.processedMetadata) {
                        return `
                            <div class="nft-card loading">
                                <div class="loading-spinner"></div>
                                <p>Loading NFT #${nft.tokenId}...</p>
                            </div>
                        `;
                    }

                    const attributes = nft.processedMetadata.attributes
                        .map(attr => `
                            <div class="nft-attribute">
                                <span class="trait-type">${attr.trait_type}:</span>
                                <span class="trait-value">${attr.value}</span>
                            </div>
                        `).join('');

                    return `
                        <div class="nft-card">
                            <div class="nft-image-container">
                                <img src="${nft.imageUrl}" alt="${nft.processedMetadata.name}" class="nft-image">
                            </div>
                            <div class="nft-info">
                                <h3>${nft.processedMetadata.name}</h3>
                                <div class="nft-buttons">
                                    <button class="toggle-details" data-nft-id="${nft.tokenId}">
                                        Show Details
                                    </button>
                                    <button class="send-button" data-nft-id="${nft.tokenId}">
                                        Send ⌲
                                    </button>
                                    <a href="https://opensea.io/assets/${mirror}/${nft.tokenId}" 
                                       target="_blank" 
                                       rel="noopener noreferrer" 
                                       class="opensea-button">
                                        View on OpenSea ⛵︎
                                    </a>
                                    <button class="send-button" data-nft-id="${nft.tokenId}">
                                        Send ⌲
                                    </button>
                                </div>
                                <div class="nft-details hidden" id="details-${nft.tokenId}">
                                    <p class="nft-description">${nft.processedMetadata.description}</p>
                                    <div class="nft-attributes">
                                        ${attributes}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Update pagination
        const paginationContainer = portfolioContent.querySelector('.pagination-container');
        if (paginationContainer) {
            paginationContainer.innerHTML = this.getPaginationHTML(displayNFTs.length);
        }

        // Re-setup event listeners
        this.setupNFTEventListeners();
        this.setupPaginationEventListeners();
    }

    updatePortfolioContent(nfts) {
        const portfolioContent = this.element.querySelector('.portfolio-content');
        if (!portfolioContent) return;

        // Initial render with proper structure
        portfolioContent.innerHTML = `
            <div class="search-container">
                <div class="search-input-group">
                    <input 
                        type="text" 
                        class="nft-search" 
                        placeholder="Search by ID or name..."
                        value="${this.searchQuery}"
                    >
                    <button class="search-button">
                        Search
                    </button>
                </div>
            </div>
            ${this.getDashboardHTML()}
            <div class="nft-cards-container"></div>
            <div class="pagination-container"></div>
        `;

        // Now update the elements
        this.updatePortfolioElements(nfts);
        
        // Setup search listener only once during full content update
        this.setupSearchListener();
        this.setupMintButton();
    }

    async handlePageChange(newPage) {
        this.currentPage = newPage;
        const allNFTs = this.filteredNFTs || this.tradingStore.selectUserNFTs();
        if (allNFTs) {
            // Calculate which NFTs will be visible on this page
            const startIndex = (newPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const visibleNFTs = allNFTs.slice(startIndex, endIndex);
            
            // Load metadata for NFTs that don't have it yet
            await this.loadMetadataForNFTs(visibleNFTs);
            
            this.updatePortfolioElements(allNFTs);
        }
    }

    async handleLoadMore() {
        if (this.currentLimit >= this.itemsPerPage) {
            // Switch to pagination mode
            this.currentLimit = this.totalNFTs;
            await this.loadNFTData(this.currentLimit);
        } else {
            this.currentLimit += 2;
            await this.loadNFTData(this.currentLimit);
        }
    }

    isValidHttpUrl(urlString) {
        return true//urlString.toLowerCase().startsWith('http');
    }

    async fetchMetadataContent(nfts) {
        const fetchPromises = nfts.map(async (nft) => {
            try {
                const response = await fetch(nft.metadata);
                if (!response.ok) throw new Error('Network response was not ok');
                const jsonData = await response.json();
                nft.processedMetadata = jsonData;
                
                // Process the image URL
                if (jsonData.image) {
                    nft.imageUrl = jsonData.image.startsWith('http') 
                        ? jsonData.image 
                        : jsonData.image.startsWith('/') 
                            ? jsonData.image 
                            : `/${jsonData.image}`;
                }
            } catch (error) {
                console.error(`Error fetching metadata for NFT:`, error);
                nft.processedMetadata = null;
            }
        });

        await Promise.all(fetchPromises);
    }

    setupSearchListener() {
        const searchInput = this.element.querySelector('.nft-search');
        const searchButton = this.element.querySelector('.search-button');
        
        if (searchInput) {
            searchInput.addEventListener('input', this.handleSearch);
            searchInput.addEventListener('keypress', this.handleSearchKeyPress);
        }
        
        if (searchButton) {
            searchButton.addEventListener('click', this.executeSearch);
        }
    }

    getPaginationHTML(totalFilteredNFTs) {
        if (this.currentLimit <= this.itemsPerPage) {
            // Show load more button if we haven't switched to pagination mode
            if (this.currentLimit >= this.totalNFTs) {
                return `
                    <div class="pagination-info">
                        Showing all ${this.totalNFTs} NFTs
                    </div>
                `;
            }
            return `
                <div class="pagination-container">
                    <div class="pagination-info">
                        Showing ${this.currentLimit} of ${this.totalNFTs} NFTs
                    </div>
                    <button class="load-more-btn">
                        Load More
                    </button>
                </div>
            `;
        }

        // Show pagination controls
        const totalPages = Math.ceil(totalFilteredNFTs / this.itemsPerPage);
        const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
        
        return `
            <div class="pagination-container">
                <div class="pagination-info">
                    Showing ${Math.min(this.itemsPerPage, totalFilteredNFTs - (this.currentPage - 1) * this.itemsPerPage)} 
                    of ${totalFilteredNFTs} NFTs
                </div>
                <div class="pagination-controls-wrapper">
                    <div class="pagination-controls">
                        ${pages.map(page => `
                            <button class="page-btn ${page === this.currentPage ? 'active' : ''}" 
                                    data-page="${page}">
                                ${page}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    setupPaginationEventListeners() {
        const loadMoreBtn = this.element.querySelector('.load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', this.handleLoadMore);
        }

        const pageButtons = this.element.querySelectorAll('.page-btn');
        pageButtons.forEach(button => {
            button.addEventListener('click', () => {
                const newPage = parseInt(button.dataset.page);
                this.handlePageChange(newPage);
            });
        });
    }

    setupNFTEventListeners() {
        const toggleButtons = this.element.querySelectorAll('.toggle-details');
        toggleButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const nftId = e.target.getAttribute('data-nft-id');
                const details = this.element.querySelector(`#details-${nftId}`);
                const isHidden = details.classList.contains('hidden');
                
                details.classList.toggle('hidden');
                e.target.textContent = isHidden ? 'Hide Details' : 'Show Details';
            });
        });
        const sendButtons = this.element.querySelectorAll('.send-button');
        sendButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const tokenId = e.target.getAttribute('data-nft-id');
                if (!this.sendModal) {
                    this.sendModal = new SendModal(tokenId, this.blockchainService);
                    this.sendModal.mount(this.element.querySelector('.portfolio-modal-content'));
                } else {
                    this.sendModal.tokenId = tokenId;
                }
                this.sendModal.show();
            });
        });
    }

    mount(container) {
        super.mount(container);
        this.setupDOMEventListeners();
        this.loadNFTData();
        
        // Subscribe to mint complete event
        eventBus.on('mint:complete', this.handleMintComplete);
    }

    setupDOMEventListeners() {
        const closeButton = this.element.querySelector('.portfolio-modal-close');
        const overlay = this.element.querySelector('.portfolio-modal-overlay');
        
        if (closeButton) {
            closeButton.addEventListener('click', this.handleClose);
        }
        
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.handleClose();
                }
            });
        }
    }

    handleClose() {
        eventBus.emit('portfolio:close');
        this.unmount();
    }

    updateLoadingState() {
        const portfolioContent = this.element.querySelector('.portfolio-content');
        if (!portfolioContent) return;

        if (this.isLoading) {
            portfolioContent.innerHTML = `
                <div class="loading-container">
                    <div class="loading-spinner"></div>
                    <p>Loading your NFTs...</p>
                </div>
            `;
        } else {
            // If not loading and no content has been set, show empty state
            portfolioContent.innerHTML = `
                <div class="empty-state">
                    <p>No NFTs found</p>
                </div>
            `;
        }
    }

    render() {
        return `
            <div class="portfolio-modal-overlay">
                <div class="portfolio-modal">
                    <button class="portfolio-modal-close">&times;</button>
                    <div class="portfolio-modal-content">
                        <h2>Your Portfolio</h2>
                        <div class="portfolio-content">
                            <div class="loading-container">
                                <div class="loading-spinner"></div>
                                <p>Loading your NFTs...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getDashboardHTML() {
        const balances = this.tradingStore.selectBalances();
        const execBalance = parseInt(balances.exec).toLocaleString();
        const nftBalance = parseInt(balances.nfts).toLocaleString();
        
        // Calculate potential NFTs (1 NFT per 1M EXEC)
        const execForOneNFT = BigInt('1000000000000000000000000'); // 1M EXEC in wei
        const currentExecBalance = BigInt(balances.exec);
        const currentNFTs = parseInt(balances.nfts);
        const potentialNFTs = Number(currentExecBalance / execForOneNFT);
        const remainingNFTs = Math.max(0, potentialNFTs - currentNFTs);

        return `
            <div class="portfolio-dashboard">
                <div class="dashboard-stats">
                    <div class="stat-item">
                        <span class="stat-label">$EXEC Balance</span>
                        <span class="stat-value">${execBalance}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">NFTs Owned</span>
                        <span class="stat-value">${nftBalance}</span>
                    </div>
                </div>
                ${remainingNFTs > 0 ? `
                    <div class="mint-info">
                        <div class="mint-status">
                            You can mint ${remainingNFTs} more NFT${remainingNFTs > 1 ? 's' : ''}!
                        </div>
                        <button class="mint-button">
                            Mint NFT
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    setupMintButton() {
        const mintButton = this.element.querySelector('.mint-button');
        if (mintButton) {
            mintButton.addEventListener('click', () => {
                // Calculate max mintable NFTs
                const balances = this.tradingStore.selectBalances();
                const execForOneNFT = BigInt('1000000000000000000000000'); // 1M EXEC in wei
                const currentExecBalance = BigInt(balances.exec);
                const currentNFTs = parseInt(balances.nfts);
                const potentialNFTs = Number(currentExecBalance / execForOneNFT);
                const maxMintable = Math.max(0, potentialNFTs - currentNFTs);

                // Create mint modal if it doesn't exist, or show it if it does
                if (!this.mintModal) {
                    this.mintModal = new MintModal(maxMintable, this.blockchainService);
                    // Mount to the portfolio modal's container instead of document.body
                    this.mintModal.mount(this.element.querySelector('.portfolio-modal-content'));
                    
                    // Listen for mint completion
                    eventBus.on('mint:complete', async () => {
                        await this.loadNFTData();
                        const dashboardSection = this.element.querySelector('.portfolio-dashboard');
                        if (dashboardSection) {
                            dashboardSection.innerHTML = this.getDashboardHTML();
                            this.setupMintButton();
                        }
                    });
                }
                this.mintModal.show();
            });
        }
    }

    clearSearch() {
        this.searchQuery = '';
        this.filteredNFTs = null;
        this.currentPage = 1;
        const searchInput = this.element.querySelector('.nft-search');
        if (searchInput) {
            searchInput.value = '';
        }
        this.updatePortfolioElements(this.tradingStore.selectUserNFTs());
    }

    async handleMintComplete() {
        // Reload NFT data
        await this.loadNFTData();
        
        // Refresh the entire portfolio content
        const portfolioContent = this.element.querySelector('.portfolio-content');
        if (portfolioContent) {
            portfolioContent.innerHTML = `
                <div class="search-container">
                    <div class="search-input-group">
                        <input 
                            type="text" 
                            class="nft-search" 
                            placeholder="Search by ID or name..."
                            value="${this.searchQuery}"
                        >
                        <button class="search-button">
                            Search
                        </button>
                    </div>
                </div>
                ${this.getDashboardHTML()}
                <div class="nft-cards-container"></div>
                <div class="pagination-container"></div>
            `;
            
            // Re-setup all event listeners and update content
            this.setupSearchListener();
            this.setupMintButton();
            this.updatePortfolioElements(this.tradingStore.selectUserNFTs());
        }
    }

    unmount() {
        // Unsubscribe from mint complete event
        eventBus.off('mint:complete', this.handleMintComplete);
        super.unmount();
    }

    static get styles() {
        
        return `
            .portfolio-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.75);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000;
                overflow-y: auto; /* Allow overlay to scroll if needed */
            }

            .portfolio-modal {
                background-color: #111;
                border-radius: 8px;
                padding: 24px;
                position: relative;
                width: 90%;
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto; /* Enable scrolling within modal */
                margin: 40px 0; /* Add margin to ensure modal doesn't touch screen edges */
            }

            .portfolio-modal-close {
                position: absolute;
                top: 16px;
                right: 16px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 4px;
            }

            .portfolio-modal-close:hover {
                background-color: rgba(0, 0, 0, 0.1);
            }

            .portfolio-modal-content {
                margin-top: 16px;
                /* Remove any fixed height constraints */
            }

            .portfolio-modal h2 {
                margin: 0;
                padding-bottom: 16px;
                border-bottom: 1px solid #eee;
            }

            .portfolio-content {
                padding: 16px 0;
                /* Remove any fixed height constraints */
            }

            .nft-card {
                border: 1px solid #eee;
                border-radius: 8px;
                margin-bottom: 16px;
                padding: 16px;
                display: flex;
                gap: 16px;
            }

            .nft-image-container {
                width: 150px;
                height: 150px;
                flex-shrink: 0;
            }

            .nft-image {
                width: 100%;
                height: 100%;
                object-fit: cover;
                border-radius: 4px;
            }

            .nft-info {
                flex-grow: 1;
            }

            .nft-info h3 {
                margin: 0 0 8px 0;
            }

            .nft-buttons {
                display: grid;
                grid-template-areas:
                    "details send"
                    "opensea opensea";
                gap: 8px;
                margin-bottom: 8px;
                width: 100%;
            }

            .toggle-details {
                grid-area: details;
                background-color: #007bff;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                width: 100%;
            }

            .send-button {
                grid-area: send;
                background-color: #ff3366;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                width: 100%;
            }

            .opensea-button {
                grid-area: opensea;
                background-color: #007bff;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                text-decoration: none;
                text-align: center;
                width: 47%;
            }

            .nft-details {
                margin-top: 8px;
            }

            .nft-description {
                margin-bottom: 8px;
            }

            .nft-attributes {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 8px;
            }

            .nft-attribute {
                background-color: black;
                padding: 8px;
                border-radius: 4px;
            }

            .trait-type {
                font-weight: bold;
                margin-right: 4px;
            }

            .hidden {
                display: none;
            }

            .loading-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px;
                text-align: center;
            }

            .loading-spinner {
                width: 50px;
                height: 50px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #007bff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 20px;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            .empty-state {
                text-align: center;
                padding: 40px;
                color: #666;
            }

            .pagination-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                margin-top: 20px;
                padding: 20px;
            }

            .pagination-info {
                margin-bottom: 10px;
                color: #666;
            }

            .load-more-btn {
                background-color: #007bff;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.2s;
            }

            .load-more-btn:hover {
                background-color: #0056b3;
            }

            .search-container {
                margin-bottom: 20px;
            }

            .search-input-group {
                display: flex;
                gap: 8px;
            }

            .nft-search {
                flex: 1;
                padding: 10px;
                border: 1px solid #333;
                border-radius: 4px;
                background-color: #222;
                color: white;
                font-size: 14px;
            }

            .search-button {
                padding: 10px 20px;
                background-color: #007bff;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.2s;
            }

            .search-button:hover {
                background-color: #0056b3;
            }

            .pagination-controls {
                display: block;
                gap: 8px;
                justify-content: center;
                margin-top: 16px;
            }

            .page-btn {
                padding: 8px 12px;
                border: 1px solid #333;
                border-radius: 4px;
                background-color: #222;
                color: white;
                cursor: pointer;
            }

            .page-btn.active {
                background-color: #007bff;
                border-color: #007bff;
            }

            .page-btn:hover:not(.active) {
                background-color: #333;
            }

            .portfolio-dashboard {
                background: #1a1a1a;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                border: 1px solid #333;
            }

            .dashboard-stats {
                display: block;
                gap: 24px;
                margin-bottom: '0'};
            }

            .stat-item {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .stat-label {
                color: #888;
                font-size: 14px;
            }

            .stat-value {
                font-size: 10px;
                font-weight: bold;
                color: white;
            }

            .mint-info {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-top: 16px;
                border-top: 1px solid #333;
            }

            .mint-status {
                color: #00ff00;
                font-size: 16px;
            }

            .mint-button {
                background-color: #00ff00;
                color: #000;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                transition: background-color 0.2s;
            }

            .mint-button:hover {
                background-color: #00cc00;
            }

            .no-results {
                text-align: center;
                padding: 20px;
                color: #666;
                font-style: italic;
            }
        `;
    }
}