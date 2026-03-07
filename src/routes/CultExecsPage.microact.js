/**
 * CultExecsPage - Microact Version
 *
 * Terminal Brutalism redesign of the CULT EXEC genesis project page.
 * Standalone route at /cultexecs — NOT part of the factory system.
 * CULT EXEC is a pre-factory genesis contract with its own ABI.
 *
 * Uses BlockchainService + PriceService — the original proven data pipeline.
 * BondingCurve component reads from tradingStore (populated by PriceService).
 * Trading uses BlockchainService directly for buy/sell.
 */

import { Component, h } from '../core/microact-setup.js';
import { eventBus } from '../core/microact-setup.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';
import walletService from '../services/WalletService.js';
import BlockchainService from '../services/BlockchainService.js';
import priceService from '../services/PriceService.js';
import { BondingCurve } from '../components/BondingCurve/BondingCurve.microact.js';
import { tradingStore } from '../store/tradingStore.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

const CULT_EXEC_ADDRESS = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';

export class CultExecsPage extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            error: null,
            config: null
        };
        this._blockchainService = null;
        this._connected = false;
        this._walletAddress = null;
        this._isBuy = true;
    }

    async didMount() {
        stylesheetLoader.load('src/routes/cultexecs-v2.css', 'cultexecs-v2-styles');

        // Add body class for floating wallet terminal overrides
        document.body.classList.add('cultexecs-active');

        this.registerCleanup(() => {
            document.body.classList.remove('cultexecs-active');
            stylesheetLoader.unload('cultexecs-v2-styles');
            priceService.stopContractUpdates();
        });

        // Load config
        let config = null;
        try {
            const resp = await fetch('/EXEC404/switch.json');
            if (resp.ok) config = await resp.json();
        } catch (e) {
            console.warn('[CultExecsPage] Failed to load switch.json:', e);
        }

        // Check wallet state
        try {
            this._connected = walletService.isConnected();
            this._walletAddress = this._connected ? walletService.getAddress() : null;
        } catch (e) {
            console.warn('[CultExecsPage] Wallet check failed:', e);
        }

        // Render the page (loading → content)
        this.setState({ loading: false, config });

        // Sync wallet address to tradingStore so PriceService polling can find it
        if (this._walletAddress) {
            tradingStore.setWalletAddress(this._walletAddress);
        }

        // Wire up event listeners BEFORE pipeline init so we catch the first data emission
        const unsub1 = eventBus.on('wallet:connected', async (data) => {
            this._connected = true;
            this._walletAddress = data.address;
            tradingStore.setWalletAddress(data.address);
            this.updateConnectButtonDOM();
            // Re-init with signer for write operations
            await this.initBlockchainPipeline();
        });
        const unsub2 = eventBus.on('wallet:disconnected', () => {
            this._connected = false;
            this._walletAddress = null;
            tradingStore.setWalletAddress(null);
            this.updateConnectButtonDOM();
        });
        const unsub3 = eventBus.on('price:updated', () => {
            this.updatePriceRunnerFromStore();
        });
        const unsub4 = eventBus.on('contractData:updated', () => {
            this.updatePriceRunnerFromStore();
            this.updateBalancesFromStore();
        });
        const unsub5 = eventBus.on('balances:updated', () => {
            this.updateBalancesFromStore();
        });
        const unsub6 = eventBus.on('transaction:success', () => {
            priceService.debouncedUpdateContractData();
            this.loadActivityFeed();
        });

        this.registerCleanup(() => {
            unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6();
        });

        // Wire up trade panel interactions after DOM exists
        setTimeout(() => this.wireTradePanel(), 0);

        // Initialize the proven data pipeline: BlockchainService + PriceService
        await this.initBlockchainPipeline();
    }

    async initBlockchainPipeline() {
        try {
            // BlockchainService handles: switch.json, ABI loading, provider/signer,
            // network switching, contract creation, v2 pool detection — all proven working.
            const blockchainService = new BlockchainService();
            await blockchainService.initialize();
            this._blockchainService = blockchainService;

            // PriceService singleton drives the 60s polling loop and populates tradingStore
            // with price, supply, balances, phase, pool reserves — everything.
            priceService.initialize(blockchainService, this._walletAddress);

            // Wait a tick for the initial async fetch to complete, then read store directly.
            // We can't rely solely on events because PriceService deduplicates emissions
            // (skips if data hasn't changed from last emit).
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log('[CultExecsPage] Pipeline ready — reading tradingStore for initial paint');
            this.updatePriceRunnerFromStore();
            this.updateBalancesFromStore();

            // Load activity feed after blockchain is ready
            this.loadActivityFeed();
        } catch (e) {
            console.warn('[CultExecsPage] Blockchain pipeline init failed:', e);
        }
    }

    updatePriceRunnerFromStore() {
        try {
            const price = tradingStore.selectPrice();
            const contractData = tradingStore.selectContractData();
            if (!price && !contractData) return;

            const priceVal = price?.current || 0;
            // PriceService stores price as "per 1M tokens" in ETH
            // Display as price per token
            const pricePerToken = priceVal / 1000000;

            const liquidityPool = contractData?.liquidityPool;
            const isGraduated = liquidityPool &&
                liquidityPool !== '0x0000000000000000000000000000000000000000';

            // Format ETH raised — BlockchainService.getContractEthBalance() returns
            // an already-formatted string like "0.01"
            let ethRaised = '—';
            if (contractData?.contractEthBalance != null) {
                const bal = contractData.contractEthBalance;
                ethRaised = parseFloat(bal).toFixed(4);
            }

            // Format supply — getTotalBondingSupply returns a raw JS number in base units
            // (e.g. 1.74e+27 = 1,740,326,825 tokens with 18 decimals)
            let supply = '—';
            if (contractData?.totalBondingSupply != null) {
                const raw = Number(contractData.totalBondingSupply);
                // Divide by 1e18 to get human-readable token count
                const tokens = raw / 1e18;
                supply = tokens.toLocaleString(undefined, { maximumFractionDigits: 0 });
            }

            // Format price — very small numbers use subscript zero notation
            // e.g. 0.0₈1589 means 0.00000000​1589
            let priceStr = '—';
            let priceIsHtml = false;
            if (pricePerToken > 0) {
                if (pricePerToken < 0.000001) {
                    const zeros = Math.floor(-Math.log10(pricePerToken));
                    const significant = (pricePerToken * Math.pow(10, zeros)).toFixed(4);
                    const digits = significant.replace('0.', '');
                    priceStr = `0.0<sub>${zeros}</sub>${digits}`;
                    priceIsHtml = true;
                } else {
                    priceStr = pricePerToken.toFixed(8);
                }
            }

            console.log('[CultExecsPage] Updating price runner DOM:', { priceStr, ethRaised, supply, phase: isGraduated ? 'GRADUATED' : 'BONDING' });

            this.updatePriceRunnerDOM({
                currentPrice: priceStr,
                priceIsHtml,
                ethRaised: `${ethRaised} ETH`,
                supply,
                phase: isGraduated ? 'GRADUATED' : 'BONDING'
            });
        } catch (e) {
            console.warn('[CultExecsPage] updatePriceRunnerFromStore error:', e);
        }
    }

    updatePriceRunnerDOM(data) {
        if (!this._el) return;

        const priceEl = this._el.querySelector('[data-ce-price]');
        const raisedEl = this._el.querySelector('[data-ce-raised]');
        const supplyEl = this._el.querySelector('[data-ce-supply]');
        const phaseEl = this._el.querySelector('[data-ce-phase]');

        if (priceEl) {
            if (data.priceIsHtml) {
                priceEl.innerHTML = data.currentPrice;
            } else {
                priceEl.textContent = data.currentPrice;
            }
        }
        if (raisedEl) raisedEl.textContent = `${data.ethRaised} ETH`;
        if (supplyEl) supplyEl.textContent = data.supply;
        if (phaseEl) {
            phaseEl.textContent = data.phase;
            phaseEl.style.color = data.phase === 'GRADUATED' ? 'var(--ce-green)' : 'var(--ce-gold)';
        }
    }

    updateBalancesFromStore() {
        if (!this._el) return;

        try {
            const balances = tradingStore.selectBalances();
            if (!balances) return;

            const execEl = this._el.querySelector('[data-ce-bal-exec]');
            const ethEl = this._el.querySelector('[data-ce-bal-eth]');
            const nftEl = this._el.querySelector('[data-ce-bal-nft]');

            if (ethEl && balances.eth) {
                try {
                    const raw = balances.eth;
                    const formatted = typeof raw === 'string' || typeof raw === 'number'
                        ? ethers.utils.formatEther(raw.toString())
                        : ethers.utils.formatEther(raw);
                    ethEl.textContent = parseFloat(formatted).toFixed(4);
                } catch (e) { /* */ }
            }
            if (execEl && balances.exec) {
                try {
                    const raw = balances.exec;
                    const formatted = typeof raw === 'string' || typeof raw === 'number'
                        ? ethers.utils.formatEther(raw.toString())
                        : ethers.utils.formatEther(raw);
                    const val = parseFloat(formatted);
                    execEl.textContent = val > 0
                        ? val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : '0';
                } catch (e) { /* */ }
            }
            if (nftEl && balances.nfts != null) {
                try {
                    const raw = balances.nfts;
                    nftEl.textContent = typeof raw === 'object' && raw._hex
                        ? parseInt(raw._hex, 16)
                        : raw.toString();
                } catch (e) { /* */ }
            }

            // Also update wallet panel if open
            const walletPanel = this._el.querySelector('[data-ce-wallet-panel]');
            if (walletPanel && walletPanel.style.display !== 'none') {
                this.updateWalletPanelFromStore();
            }
        } catch (e) {
            console.warn('[CultExecsPage] updateBalancesFromStore error:', e);
        }
    }

    // NOTE: microact passes the same state object reference to shouldUpdate,
    // so property comparisons always return false. We avoid shouldUpdate entirely
    // and only call setState once (loading→loaded). All subsequent updates use
    // direct DOM manipulation to avoid destroying child components.
    // Logged to MICROACT_IMPROVEMENTS.md

    updateConnectButtonDOM() {
        if (!this._el) return;

        const navWallet = this._el.querySelector('[data-ce-nav-wallet]');
        const tradeBtn = this._el.querySelector('[data-ce-connect]');
        const portfolioBtn = this._el.querySelector('[data-ce-portfolio-btn]');
        const walletPanel = this._el.querySelector('[data-ce-wallet-panel]');
        const adminBtn = this._el.querySelector('[data-ce-admin-btn]');

        if (this._connected && this._walletAddress) {
            const short = `${this._walletAddress.slice(0, 6)}...${this._walletAddress.slice(-4)}`;

            // Nav wallet button — show address with status dot
            if (navWallet) {
                navWallet.innerHTML = '';
                const dot = document.createElement('span');
                dot.className = 'ce-wallet-dot';
                const addr = document.createElement('span');
                addr.className = 'ce-wallet-addr';
                addr.textContent = short;
                navWallet.appendChild(dot);
                navWallet.appendChild(addr);
                navWallet.classList.add('connected');
            }

            // Trade button stays as action
            if (tradeBtn) {
                tradeBtn.textContent = this._isBuy ? 'BUY $EXEC' : 'SELL $EXEC';
                tradeBtn.classList.add('connected');
            }

            // Show portfolio button
            if (portfolioBtn) portfolioBtn.style.display = '';

            // Update wallet panel values
            const panelAddr = this._el.querySelector('[data-ce-panel-addr]');
            if (panelAddr) panelAddr.textContent = short;

            // Check admin status
            this.checkAdminStatus();
        } else {
            if (navWallet) {
                navWallet.innerHTML = '<span>CONNECT</span>';
                navWallet.classList.remove('connected');
            }
            if (tradeBtn) {
                tradeBtn.textContent = 'CONNECT WALLET';
                tradeBtn.classList.remove('connected');
            }
            if (portfolioBtn) portfolioBtn.style.display = 'none';
            if (walletPanel) walletPanel.style.display = 'none';
        }
    }

    async checkAdminStatus() {
        if (!this._blockchainService || !this._walletAddress) return;
        try {
            // CultExecs admin check: OPERATOR_NFT token #598 owner
            const mirrorContract = this._blockchainService.mirrorContract;
            if (mirrorContract) {
                const owner = await mirrorContract.ownerOf(598);
                if (owner.toLowerCase() === this._walletAddress.toLowerCase()) {
                    const adminBtn = this._el?.querySelector('[data-ce-admin-btn]');
                    if (adminBtn) adminBtn.style.display = '';
                }
            }
        } catch (e) {
            // Not admin or contract call failed — hide button
        }
    }

    wireTradePanel() {
        if (!this._el) return;

        // Buy/Sell toggle
        const toggleBtns = this._el.querySelectorAll('.ce-toggle-btn');
        const pickBtns = this._el.querySelectorAll('.ce-pick-btn');
        const amountInput = this._el.querySelector('.ce-amount-input');

        const buyPicks = ['.1', '.5', '1', 'MAX'];
        const sellPicks = ['25%', '50%', '75%', '100%'];

        const updatePickLabels = (isBuy) => {
            const labels = isBuy ? buyPicks : sellPicks;
            pickBtns.forEach((btn, i) => {
                if (labels[i]) btn.textContent = labels[i];
            });
        };

        // Debounced quote fetcher
        let quoteTimer = null;
        const fetchQuote = () => {
            clearTimeout(quoteTimer);
            const val = parseFloat(amountInput?.value);
            if (!val || val <= 0 || !this._blockchainService) {
                this._updateQuoteDisplay('—');
                return;
            }
            this._updateQuoteDisplay('...');
            quoteTimer = setTimeout(() => this._fetchQuote(val), 400);
        };

        if (amountInput) {
            amountInput.addEventListener('input', fetchQuote);
        }

        toggleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                toggleBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._isBuy = btn.getAttribute('data-side') === 'buy';
                const unitEl = this._el.querySelector('.ce-amount-unit');
                if (unitEl) unitEl.textContent = this._isBuy ? 'ETH' : 'EXEC';
                const execBtn = this._el.querySelector('[data-ce-connect]');
                if (execBtn && this._connected) {
                    execBtn.textContent = this._isBuy ? 'BUY $EXEC' : 'SELL $EXEC';
                }
                updatePickLabels(this._isBuy);
                if (amountInput) amountInput.value = '';
                this._updateQuoteDisplay('—');
            });
        });

        // Quick pick buttons — ETH amounts for buy, portfolio % for sell
        pickBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (!amountInput) return;
                const val = btn.textContent;

                if (this._isBuy) {
                    if (val === 'MAX') {
                        const balEl = this._el.querySelector('[data-ce-bal-eth]');
                        amountInput.value = balEl ? balEl.textContent : '0';
                    } else {
                        amountInput.value = val;
                    }
                } else {
                    const balEl = this._el.querySelector('[data-ce-bal-exec]');
                    const balText = balEl ? balEl.textContent.replace(/,/g, '') : '0';
                    const balance = parseFloat(balText) || 0;
                    const pct = parseInt(val) / 100;
                    const amount = balance * pct;
                    amountInput.value = amount > 0
                        ? amount.toLocaleString(undefined, { maximumFractionDigits: 2, useGrouping: false })
                        : '0';
                }
                fetchQuote();
            });
        });

        // Execute button — connect OR trade
        const execBtn = this._el.querySelector('[data-ce-connect]');
        if (execBtn) {
            execBtn.addEventListener('click', () => this.handleExecute());
        }

        // Nav wallet button — connect or toggle panel
        const navWallet = this._el.querySelector('[data-ce-nav-wallet]');
        if (navWallet) {
            navWallet.addEventListener('click', () => {
                if (!this._connected) {
                    this.handleConnect();
                } else {
                    this.toggleWalletPanel();
                }
            });
        }

        // Portfolio button — navigate to portfolio
        const portfolioBtn = this._el.querySelector('[data-ce-portfolio-btn]');
        if (portfolioBtn) {
            portfolioBtn.addEventListener('click', () => {
                this.openPortfolioModal();
            });
        }

        // Disconnect button
        const disconnectBtn = this._el.querySelector('[data-ce-disconnect]');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => {
                walletService.disconnect();
                const panel = this._el.querySelector('[data-ce-wallet-panel]');
                if (panel) panel.style.display = 'none';
            });
        }

        // Admin button
        const adminBtn = this._el.querySelector('[data-ce-admin-btn]');
        if (adminBtn) {
            adminBtn.addEventListener('click', () => {
                // TODO: open admin modal when available
                console.log('[CultExecsPage] Admin panel requested');
            });
        }
    }

    toggleWalletPanel() {
        const panel = this._el?.querySelector('[data-ce-wallet-panel]');
        if (!panel) return;

        const isHidden = panel.style.display === 'none';
        panel.style.display = isHidden ? '' : 'none';

        // Update panel balances when opening
        if (isHidden) {
            this.updateWalletPanelFromStore();
        }
    }

    updateWalletPanelFromStore() {
        if (!this._el) return;
        const balances = tradingStore.selectBalances();
        if (!balances) return;

        try {
            const ethEl = this._el.querySelector('[data-ce-panel-eth]');
            const execEl = this._el.querySelector('[data-ce-panel-exec]');
            const nftsEl = this._el.querySelector('[data-ce-panel-nfts]');

            if (ethEl && balances.eth) {
                const raw = balances.eth;
                const formatted = typeof raw === 'string' || typeof raw === 'number'
                    ? ethers.utils.formatEther(raw.toString())
                    : ethers.utils.formatEther(raw);
                ethEl.textContent = parseFloat(formatted).toFixed(4) + ' ETH';
            }
            if (execEl && balances.exec) {
                const raw = balances.exec;
                const formatted = typeof raw === 'string' || typeof raw === 'number'
                    ? ethers.utils.formatEther(raw.toString())
                    : ethers.utils.formatEther(raw);
                const val = parseFloat(formatted);
                execEl.textContent = val > 0
                    ? val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : '0';
            }
            if (nftsEl && balances.nfts != null) {
                const raw = balances.nfts;
                nftsEl.textContent = typeof raw === 'object' && raw._hex
                    ? parseInt(raw._hex, 16)
                    : raw.toString();
            }
        } catch (e) {
            // silent
        }
    }

    async openPortfolioModal() {
        if (!this._connected || !this._walletAddress || !this._blockchainService) return;

        // Remove existing modal if open
        const existing = document.querySelector('.ce-portfolio-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'ce-portfolio-overlay';
        overlay.innerHTML = `
            <div class="ce-portfolio-modal">
                <div class="ce-portfolio-header">
                    <span class="ce-portfolio-title">PORTFOLIO — CULT EXEC</span>
                    <button class="ce-portfolio-close">✕</button>
                </div>
                <div class="ce-portfolio-body">
                    <div class="ce-portfolio-loading">
                        <span>SCANNING HOLDINGS...</span>
                        <span class="loading-cursor"></span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Store reference for detail view navigation
        this._portfolioOverlay = overlay;

        // Close handlers
        overlay.querySelector('.ce-portfolio-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // Load portfolio data
        await this._loadPortfolioContent(overlay);
    }

    async _loadPortfolioContent(overlay) {
        try {
            const bs = this._blockchainService;
            const addr = this._walletAddress;

            const [tokenBalance, nftBalance, nftIds] = await Promise.all([
                bs.getTokenBalance(addr),
                bs.getNFTBalance(addr),
                bs.getUserNFTs(addr)
            ]);

            // Format token balance
            const execRaw = BigInt(tokenBalance.toString());
            const execFormatted = Number(execRaw) / 1e18;
            const execStr = execFormatted > 0
                ? execFormatted.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : '0';

            // Calculate how many NFTs can be minted (1M EXEC = 1 NFT)
            const execForOneNFT = BigInt('1000000000000000000000000');
            const mintableNFTs = execRaw > 0n ? Number(execRaw / execForOneNFT) : 0;
            const currentNFTCount = parseInt(nftBalance) || 0;

            // Build holdings + actions section
            let html = `
                <div class="ce-portfolio-section">
                    <div class="ce-portfolio-section-title">HOLDINGS</div>
                    <div class="ce-portfolio-holdings">
                        <div class="ce-holding-row">
                            <span class="ce-holding-label">$EXEC TOKENS</span>
                            <span class="ce-holding-value">${execStr}</span>
                        </div>
                        <div class="ce-holding-row">
                            <span class="ce-holding-label">EXEC NFTS</span>
                            <span class="ce-holding-value">${currentNFTCount}</span>
                        </div>
                    </div>
                </div>

                <div class="ce-portfolio-section">
                    <div class="ce-portfolio-section-title">BALANCE MINT</div>
                    <div class="ce-mint-section">
                        ${mintableNFTs > 0
                            ? `<p class="ce-mint-explainer">Your balance of ${execStr} EXEC qualifies you to mint <strong>${mintableNFTs} NFT${mintableNFTs !== 1 ? 's' : ''}</strong>. Each NFT requires 1,000,000 EXEC from your token balance.</p>
                               <div class="ce-mint-picker-row">
                                   <button class="ce-mint-dec">−</button>
                                   <input type="number" class="ce-mint-input" value="1" min="1" max="${mintableNFTs}">
                                   <button class="ce-mint-inc">+</button>
                                   <button class="ce-mint-confirm">MINT</button>
                               </div>`
                            : `<p class="ce-mint-explainer dim">You need at least 1,000,000 EXEC to mint an NFT. Current balance: ${execStr} EXEC.</p>`
                        }
                    </div>
                </div>

                <div class="ce-portfolio-section">
                    <div class="ce-portfolio-section-title">REROLL</div>
                    <div class="ce-portfolio-actions">
                        <div class="ce-action-row">
                            <div class="ce-action-info">
                                <span class="ce-action-desc">Burn all ${currentNFTCount} NFTs + re-mint for new art</span>
                            </div>
                            <button class="ce-action-btn ce-action-reroll" ${currentNFTCount === 0 ? 'disabled' : ''}>
                                REROLL
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Store all IDs + metadata cache for pagination
            this._portfolioNFTMeta = {};
            this._portfolioAllNFTIds = nftIds || [];
            this._portfolioPage = 0;
            this._portfolioPerPage = 20;

            // Gallery placeholder — rendered by _renderNFTGalleryPage
            html += `<div class="ce-portfolio-gallery-container"></div>`;

            const body = overlay.querySelector('.ce-portfolio-body');
            body.innerHTML = html;

            // Cache non-gallery content for restore after detail view
            this._portfolioCachedMintable = mintableNFTs;
            this._portfolioCachedNFTCount = currentNFTCount;

            // Wire up balance mint controls
            this._wirePortfolioMint(body, mintableNFTs, overlay);

            // Wire up reroll button
            const rerollBtn = body.querySelector('.ce-action-reroll');
            if (rerollBtn && currentNFTCount > 0) {
                rerollBtn.addEventListener('click', () => this._handlePortfolioReroll(overlay));
            }

            // Render first page of NFT gallery
            await this._renderNFTGalleryPage(overlay, 0);

        } catch (e) {
            console.error('[CultExecsPage] Portfolio load failed:', e);
            overlay.querySelector('.ce-portfolio-body').innerHTML = `
                <div class="ce-portfolio-empty">FAILED TO LOAD PORTFOLIO DATA</div>
            `;
        }
    }

    _wirePortfolioMint(body, maxMintable, overlay) {
        if (maxMintable <= 0) return;

        const input = body.querySelector('.ce-mint-input');
        const decBtn = body.querySelector('.ce-mint-dec');
        const incBtn = body.querySelector('.ce-mint-inc');
        const confirmBtn = body.querySelector('.ce-mint-confirm');
        if (!input || !confirmBtn) return;

        decBtn.addEventListener('click', () => {
            input.value = Math.max(1, parseInt(input.value) - 1);
        });
        incBtn.addEventListener('click', () => {
            input.value = Math.min(maxMintable, parseInt(input.value) + 1);
        });
        confirmBtn.addEventListener('click', async () => {
            const amount = parseInt(input.value) || 1;
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'MINTING...';
            try {
                await this._blockchainService.balanceMint(amount);
                confirmBtn.textContent = 'SUCCESS';
                setTimeout(() => this._loadPortfolioContent(overlay), 2000);
            } catch (e) {
                confirmBtn.textContent = 'FAILED';
                confirmBtn.disabled = false;
                setTimeout(() => { confirmBtn.textContent = 'MINT'; }, 2000);
            }
        });
    }

    async _renderNFTGalleryPage(overlay, page) {
        const container = overlay.querySelector('.ce-portfolio-gallery-container');
        if (!container) return;

        const allIds = this._portfolioAllNFTIds;
        const perPage = this._portfolioPerPage;
        const totalPages = Math.ceil(allIds.length / perPage);
        this._portfolioPage = page;

        if (!allIds || allIds.length === 0) {
            container.innerHTML = `
                <div class="ce-portfolio-section">
                    <div class="ce-portfolio-section-title">NFT GALLERY</div>
                    <div class="ce-portfolio-empty">NO EXEC NFTS HELD</div>
                </div>
            `;
            this._cacheBodySnapshot(overlay);
            return;
        }

        const start = page * perPage;
        const pageIds = allIds.slice(start, start + perPage);

        // Show loading placeholders immediately
        let placeholders = pageIds.map(id => `
            <div class="ce-nft-card ce-nft-loading" data-nft-id="${id.toString()}">
                <div class="ce-nft-image"><div class="ce-nft-placeholder">#${id.toString()}</div></div>
                <div class="ce-nft-id">EXEC #${id.toString()}</div>
            </div>
        `).join('');

        const titleSuffix = totalPages > 1 ? ` (${allIds.length} TOTAL)` : '';
        container.innerHTML = `
            <div class="ce-portfolio-section">
                <div class="ce-portfolio-section-title">NFT GALLERY${titleSuffix}</div>
                <div class="ce-nft-grid">${placeholders}</div>
                ${totalPages > 1 ? `<div class="ce-gallery-paginator">${this._buildPaginator(page, totalPages)}</div>` : ''}
            </div>
        `;

        this._wireGalleryEvents(overlay);

        // Fetch metadata for this page
        const bs = this._blockchainService;
        try {
            // Step 1: Get tokenURIs from contract (parallel)
            const uriResults = await Promise.allSettled(
                pageIds.map(id => {
                    const tid = id.toString();
                    if (this._portfolioNFTMeta[tid]) return Promise.resolve('__cached__');
                    return bs.getNFTMetadata(id);
                })
            );

            // Step 2: Fetch metadata JSON from URIs (parallel)
            const resolvedMeta = await Promise.allSettled(
                pageIds.map(async (id, i) => {
                    const uriResult = uriResults[i];
                    if (uriResult.value === '__cached__') return '__cached__';
                    if (uriResult.status !== 'fulfilled' || !uriResult.value) return null;

                    const uri = uriResult.value;
                    if (uri.startsWith('data:application/json')) {
                        return JSON.parse(atob(uri.split(',')[1]));
                    } else if (uri.startsWith('{')) {
                        return JSON.parse(uri);
                    } else if (uri.startsWith('http')) {
                        const resp = await fetch(uri);
                        return resp.ok ? resp.json() : null;
                    } else if (uri.startsWith('ipfs://')) {
                        const resp = await fetch(uri.replace('ipfs://', 'https://ipfs.io/ipfs/'));
                        return resp.ok ? resp.json() : null;
                    }
                    return null;
                })
            );

            // Step 3: Build cache from resolved metadata
            for (let i = 0; i < pageIds.length; i++) {
                const tokenId = pageIds[i].toString();
                const result = resolvedMeta[i];
                if (result.value === '__cached__') continue;

                let imageUrl = '';
                let name = `EXEC #${tokenId}`;
                let traits = [];

                if (result.status === 'fulfilled' && result.value) {
                    const parsed = result.value;
                    imageUrl = parsed.image || '';
                    name = parsed.name || name;
                    traits = parsed.attributes || [];
                    if (imageUrl.startsWith('ipfs://')) {
                        imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
                    }
                }

                this._portfolioNFTMeta[tokenId] = { imageUrl, name, traits, tokenId };
            }

            // Re-render cards with metadata (if still on the same page)
            if (this._portfolioPage !== page) return;

            const grid = container.querySelector('.ce-nft-grid');
            if (!grid) return;

            let nftCards = '';
            for (const id of pageIds) {
                const tid = id.toString();
                const m = this._portfolioNFTMeta[tid] || { imageUrl: '', name: `EXEC #${tid}`, tokenId: tid };
                nftCards += `
                    <div class="ce-nft-card" data-nft-id="${tid}">
                        <div class="ce-nft-image">
                            ${m.imageUrl
                                ? `<img src="${m.imageUrl}" alt="${m.name}" loading="lazy" onerror="this.style.display='none'">`
                                : `<div class="ce-nft-placeholder">#${tid}</div>`
                            }
                        </div>
                        <div class="ce-nft-id">${m.name}</div>
                    </div>
                `;
            }
            grid.innerHTML = nftCards;
            this._wireGalleryEvents(overlay);

        } catch (e) {
            console.error('[CultExecsPage] Metadata fetch failed:', e);
        }

        this._cacheBodySnapshot(overlay);
    }

    _cacheBodySnapshot(overlay) {
        const body = overlay.querySelector('.ce-portfolio-body');
        if (body) this._portfolioCachedBodyHTML = body.innerHTML;
    }

    _buildPaginator(current, totalPages) {
        let buttons = [];

        if (totalPages <= 2) {
            // 2 pages: just PREV / NEXT
            if (current > 0) buttons.push(`<button class="ce-page-btn" data-page="${current - 1}">← PREV</button>`);
            if (current < totalPages - 1) buttons.push(`<button class="ce-page-btn" data-page="${current + 1}">NEXT →</button>`);
        } else if (totalPages <= 4) {
            // 3-4 pages: numbered buttons
            for (let i = 0; i < totalPages; i++) {
                buttons.push(`<button class="ce-page-btn ${i === current ? 'active' : ''}" data-page="${i}">${i + 1}</button>`);
            }
        } else {
            // 5+ pages: FIRST ... N-1 N N+1 ... LAST
            // Always show first
            buttons.push(`<button class="ce-page-btn ${current === 0 ? 'active' : ''}" data-page="0">1</button>`);

            // Ellipsis before window
            if (current > 2) buttons.push(`<span class="ce-page-ellipsis">...</span>`);

            // Window of pages around current
            const windowStart = Math.max(1, current - 1);
            const windowEnd = Math.min(totalPages - 2, current + 1);
            for (let i = windowStart; i <= windowEnd; i++) {
                buttons.push(`<button class="ce-page-btn ${i === current ? 'active' : ''}" data-page="${i}">${i + 1}</button>`);
            }

            // Ellipsis after window
            if (current < totalPages - 3) buttons.push(`<span class="ce-page-ellipsis">...</span>`);

            // Always show last
            buttons.push(`<button class="ce-page-btn ${current === totalPages - 1 ? 'active' : ''}" data-page="${totalPages - 1}">${totalPages}</button>`);
        }

        return buttons.join('');
    }

    _wireGalleryEvents(overlay) {
        const container = overlay.querySelector('.ce-portfolio-gallery-container');
        if (!container) return;

        // Wire NFT card clicks
        container.querySelectorAll('.ce-nft-card[data-nft-id]').forEach(card => {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => {
                this._openNFTDetail(card.dataset.nftId, overlay);
            });
        });

        // Wire paginator buttons
        container.querySelectorAll('.ce-page-btn[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                this._renderNFTGalleryPage(overlay, page);
            });
        });
    }

    async _handlePortfolioReroll(overlay) {
        const body = overlay.querySelector('.ce-portfolio-body');
        const rerollBtn = body.querySelector('.ce-action-reroll');
        if (!rerollBtn || rerollBtn.disabled) return;

        // Show reroll confirmation inline
        const actionRow = rerollBtn.closest('.ce-action-row');
        const existingConfirm = actionRow.querySelector('.ce-reroll-confirm-panel');
        if (existingConfirm) { existingConfirm.remove(); return; }

        const bs = this._blockchainService;
        const addr = this._walletAddress;

        // Check skipNFT status
        let skipNFTStatus = false;
        try {
            skipNFTStatus = await bs.getSkipNFT(addr);
        } catch (e) { /* assume false */ }

        const balances = tradingStore.selectBalances();
        const execBalance = BigInt(balances.exec || '0');
        const execFormattedForWarning = (Number(execBalance) / 1e18).toLocaleString();
        const nftCount = parseInt(balances.nfts || '0');

        const panel = document.createElement('div');
        panel.className = 'ce-reroll-confirm-panel';
        panel.innerHTML = `
            <div class="ce-reroll-warning">
                ⚠ EXPERIMENTAL FEATURE — USE WITH CAUTION
            </div>
            <div class="ce-reroll-explainer">
                <p>Rerolling will <strong>permanently burn ALL ${nftCount} of your NFTs</strong> and re-mint your entire balance of ${execFormattedForWarning} EXEC into new NFTs with new randomly assigned art.</p>
                <p>This is irreversible. Any NFT IDs you currently hold will be destroyed. If you have NFTs you want to keep, transfer them to another wallet first.</p>
                <p>1,000,000 EXEC = 1 NFT. Gas costs scale with the number of NFTs burned + minted.</p>
                ${skipNFTStatus ? '<p>This will require 2 transactions: (1) set skipNFT to false, (2) transfer tokens to self.</p>' : ''}
            </div>
            <div class="ce-reroll-steps">
                <span class="ce-reroll-step" data-step="1" style="display:${skipNFTStatus ? 'inline' : 'none'}">① SKIP_NFT</span>
                <span class="ce-reroll-step" data-step="2">② REROLL</span>
            </div>
            <button class="ce-reroll-execute ce-reroll-first-confirm">I UNDERSTAND THE RISKS</button>
        `;
        actionRow.appendChild(panel);

        // First click: "are you sure?" gate
        panel.querySelector('.ce-reroll-first-confirm').addEventListener('click', () => {
            const btn = panel.querySelector('.ce-reroll-first-confirm');
            btn.classList.remove('ce-reroll-first-confirm');
            btn.classList.add('ce-reroll-final-confirm');
            btn.textContent = 'ARE YOU SURE? CLICK AGAIN TO EXECUTE';

            // Second click: actually execute
            btn.addEventListener('click', async () => {
                const execBtn = btn;
                execBtn.disabled = true;

                try {
                    if (execBalance === 0n) throw new Error('No EXEC tokens');

                    // Step 1: Set skipNFT to false if needed
                    if (skipNFTStatus) {
                        const step1El = panel.querySelector('[data-step="1"]');
                        step1El.classList.add('active');
                        execBtn.textContent = 'STEP 1: SETTING SKIP_NFT...';
                        await bs.setSkipNFT(false);
                        step1El.classList.remove('active');
                        step1El.classList.add('done');
                    }

                    // Step 2: Transfer to self
                    const step2El = panel.querySelector('[data-step="2"]');
                    step2El.classList.add('active');
                    execBtn.textContent = 'STEP 2: REROLLING...';
                    await bs.transferTokensToSelf(execBalance.toString());
                    step2El.classList.remove('active');
                    step2El.classList.add('done');

                    execBtn.textContent = 'REROLL COMPLETE';
                    setTimeout(() => this._loadPortfolioContent(overlay), 2000);
                } catch (e) {
                    execBtn.textContent = 'REROLL FAILED';
                    execBtn.disabled = false;
                    setTimeout(() => { execBtn.textContent = 'ARE YOU SURE? CLICK AGAIN TO EXECUTE'; }, 3000);
                }
            }, { once: true });
        }, { once: true });
    }

    _restorePortfolioView(overlay) {
        const body = overlay.querySelector('.ce-portfolio-body');
        if (!this._portfolioCachedBodyHTML) {
            this._loadPortfolioContent(overlay);
            return;
        }

        body.innerHTML = this._portfolioCachedBodyHTML;

        // Re-wire balance mint controls
        this._wirePortfolioMint(body, this._portfolioCachedMintable, overlay);

        // Re-wire reroll
        const rerollBtn = body.querySelector('.ce-action-reroll');
        if (rerollBtn && this._portfolioCachedNFTCount > 0) {
            rerollBtn.addEventListener('click', () => this._handlePortfolioReroll(overlay));
        }

        // Re-wire paginator + card clicks
        this._wireGalleryEvents(overlay);
    }

    _openNFTDetail(tokenId, overlay) {
        const meta = this._portfolioNFTMeta?.[tokenId];
        if (!meta) return;

        const body = overlay.querySelector('.ce-portfolio-body');

        // Build traits HTML
        let traitsHtml = '';
        if (meta.traits && meta.traits.length > 0) {
            const traitItems = meta.traits.map(t =>
                `<div class="ce-trait">
                    <span class="ce-trait-type">${t.trait_type || 'TRAIT'}</span>
                    <span class="ce-trait-value">${t.value || '—'}</span>
                </div>`
            ).join('');
            traitsHtml = `
                <div class="ce-detail-section">
                    <div class="ce-portfolio-section-title">TRAITS</div>
                    <div class="ce-trait-grid">${traitItems}</div>
                </div>
            `;
        }

        // Mirror contract address for OpenSea
        const mirrorAddress = '0xbC61B64dF7C1B2e26D48Db6eC8a95A3023C3a742';
        const openSeaUrl = `https://opensea.io/assets/ethereum/${mirrorAddress}/${tokenId}`;

        body.innerHTML = `
            <div class="ce-nft-detail">
                <button class="ce-detail-back">← BACK</button>
                <div class="ce-detail-hero">
                    <div class="ce-detail-image">
                        ${meta.imageUrl
                            ? `<img src="${meta.imageUrl}" alt="${meta.name}" onerror="this.style.display='none'">`
                            : `<div class="ce-nft-placeholder ce-detail-placeholder">#${tokenId}</div>`
                        }
                    </div>
                    <div class="ce-detail-info">
                        <h3 class="ce-detail-name">${meta.name}</h3>
                        <span class="ce-detail-id">TOKEN #${tokenId}</span>
                    </div>
                </div>

                ${traitsHtml}

                <div class="ce-detail-section">
                    <div class="ce-portfolio-section-title">ACTIONS</div>
                    <div class="ce-detail-actions">
                        <a href="${openSeaUrl}" target="_blank" rel="noopener" class="ce-detail-link">
                            VIEW ON OPENSEA ↗
                        </a>
                        <button class="ce-detail-send-btn">SEND NFT</button>
                    </div>
                </div>

                <div class="ce-send-panel" style="display:none">
                    <div class="ce-portfolio-section-title">SEND EXEC #${tokenId}</div>
                    <div class="ce-send-form">
                        <input type="text" class="ce-send-address" placeholder="0x... recipient address" spellcheck="false">
                        <button class="ce-send-confirm">CONFIRM SEND</button>
                    </div>
                    <div class="ce-send-status"></div>
                </div>
            </div>
        `;

        // Back button → restore cached portfolio view
        body.querySelector('.ce-detail-back').addEventListener('click', () => {
            this._restorePortfolioView(overlay);
        });

        // Send button → show send form
        body.querySelector('.ce-detail-send-btn').addEventListener('click', () => {
            const sendPanel = body.querySelector('.ce-send-panel');
            sendPanel.style.display = sendPanel.style.display === 'none' ? 'block' : 'none';
        });

        // Confirm send
        body.querySelector('.ce-send-confirm').addEventListener('click', async () => {
            const addrInput = body.querySelector('.ce-send-address');
            const statusEl = body.querySelector('.ce-send-status');
            const confirmBtn = body.querySelector('.ce-send-confirm');
            const recipient = addrInput.value.trim();

            if (!recipient || !recipient.startsWith('0x') || recipient.length !== 42) {
                statusEl.textContent = 'INVALID ADDRESS';
                statusEl.className = 'ce-send-status error';
                return;
            }

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'SENDING...';
            statusEl.textContent = '';

            try {
                await this._blockchainService.transferNFT(this._walletAddress, recipient, tokenId);
                statusEl.textContent = 'SENT SUCCESSFULLY';
                statusEl.className = 'ce-send-status success';
                confirmBtn.textContent = 'DONE';
                // Reload portfolio after delay
                setTimeout(() => this._loadPortfolioContent(overlay), 2000);
            } catch (e) {
                statusEl.textContent = e.message || 'TRANSFER FAILED';
                statusEl.className = 'ce-send-status error';
                confirmBtn.textContent = 'CONFIRM SEND';
                confirmBtn.disabled = false;
            }
        });
    }

    _updateQuoteDisplay(text, suffix) {
        const quoteEl = this._el?.querySelector('[data-ce-quote]');
        if (!quoteEl) return;
        const valueEl = quoteEl.querySelector('.ce-quote-value');
        if (valueEl) {
            valueEl.textContent = suffix ? `${text} ${suffix}` : text;
        }
    }

    async _fetchQuote(amount) {
        const bs = this._blockchainService;
        if (!bs) return;

        const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
        const TOKEN = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';

        try {
            if (this._isBuy) {
                // ETH → EXEC quote
                const ethWei = ethers.utils.parseEther(amount.toString());
                const amounts = await bs.executeContractCall(
                    'getAmountsOut', [ethWei, [WETH, TOKEN]], { useContract: 'router' }
                );
                const execOut = amounts[1];
                // Account for 4% tax on receive
                const afterTax = ethers.BigNumber.from(execOut).mul(96).div(100);
                const formatted = parseFloat(ethers.utils.formatEther(afterTax));
                const display = formatted > 1000
                    ? formatted.toLocaleString(undefined, { maximumFractionDigits: 0 })
                    : formatted.toLocaleString(undefined, { maximumFractionDigits: 2 });
                this._updateQuoteDisplay(`~${display}`, '$EXEC');
            } else {
                // EXEC → ETH quote
                const execWei = ethers.utils.parseUnits(amount.toString(), 18);
                const amounts = await bs.executeContractCall(
                    'getAmountsOut', [execWei, [TOKEN, WETH]], { useContract: 'router' }
                );
                const ethOut = amounts[1];
                // Account for 4% tax on send
                const afterTax = ethers.BigNumber.from(ethOut).mul(96).div(100);
                const formatted = parseFloat(ethers.utils.formatEther(afterTax));
                this._updateQuoteDisplay(`~${formatted.toFixed(6)}`, 'ETH');
            }
        } catch (e) {
            console.warn('[CultExecsPage] Quote failed:', e.message);
            this._updateQuoteDisplay('QUOTE UNAVAILABLE');
        }
    }

    async handleExecute() {
        if (!this._connected) {
            return this.handleConnect();
        }
        if (!this._blockchainService) {
            console.warn('[CultExecsPage] No blockchain service — cannot trade');
            return;
        }

        const amountInput = this._el?.querySelector('.ce-amount-input');
        const amount = amountInput?.value;
        if (!amount || parseFloat(amount) <= 0) return;

        const execBtn = this._el?.querySelector('[data-ce-connect]');
        const originalText = execBtn?.textContent;

        try {
            if (execBtn) {
                execBtn.textContent = 'PENDING...';
                execBtn.classList.add('pending');
            }

            const bs = this._blockchainService;

            if (this._isBuy) {
                const execAmount = await bs.executeContractCall('getExecForEth', [
                    ethers.utils.parseEther(amount)
                ]);
                const cost = await bs.executeContractCall('calculateCost', [execAmount]);
                const maxCost = ethers.BigNumber.from(cost).mul(101).div(100);
                await bs.executeContractCall('buyBonding', [
                    execAmount, maxCost, false, [], ''
                ], { requiresSigner: true, txOptions: { value: maxCost } });
            } else {
                const execWei = ethers.utils.parseUnits(amount, 18);
                const refund = await bs.executeContractCall('calculateCost', [execWei]);
                const minReturn = ethers.BigNumber.from(refund).mul(99).div(100);
                await bs.executeContractCall('sellBonding', [
                    execWei, minReturn, [], ''
                ], { requiresSigner: true });
            }

            if (amountInput) amountInput.value = '';
            if (execBtn) execBtn.textContent = 'SUCCESS';
            setTimeout(() => {
                if (execBtn) {
                    execBtn.textContent = this._isBuy ? 'BUY $EXEC' : 'SELL $EXEC';
                    execBtn.classList.remove('pending');
                }
            }, 2000);
        } catch (e) {
            console.error('[CultExecsPage] Trade failed:', e);
            if (execBtn) {
                execBtn.textContent = 'FAILED';
                execBtn.classList.remove('pending');
                setTimeout(() => {
                    execBtn.textContent = originalText || (this._isBuy ? 'BUY $EXEC' : 'SELL $EXEC');
                }, 2000);
            }
        }
    }

    async handleConnect() {
        if (walletService.isConnected()) return;
        try {
            await walletService.connect();
        } catch (e) {
            console.warn('[CultExecsPage] Wallet connect error:', e);
        }
    }

    async loadActivityFeed() {
        if (!this._el || !this._blockchainService) return;
        const container = this._el.querySelector('[data-ce-comments]');
        if (!container) return;

        try {
            const totalMessages = await this._blockchainService.getTotalMessages();
            if (!totalMessages || totalMessages === 0) {
                container.innerHTML = `<div class="ce-activity-empty">NO TRANSMISSIONS RECORDED</div>`;
                return;
            }

            // getMessagesBatch(start, end) — end is inclusive, so use totalMessages - 1
            const endIndex = totalMessages - 1;
            const startIndex = Math.max(0, endIndex - 19);
            // Call contract directly — BlockchainService.getMessagesBatch does .map(toString)
            // which destroys the 5-array tuple structure
            const result = await this._blockchainService.executeContractCall(
                'getMessagesBatch', [startIndex, endIndex]
            );

            // Contract returns 5 parallel arrays: [senders[], timestamps[], amounts[], isBuys[], messages[]]
            if (!result || result.length < 5) {
                container.innerHTML = `<div class="ce-activity-empty">NO TRANSMISSIONS RECORDED</div>`;
                return;
            }

            const [senders, timestamps, amounts, isBuys, messages] = result;
            const rows = [];

            for (let i = senders.length - 1; i >= 0; i--) {
                const msg = messages[i] || '';
                if (!msg.trim()) continue;

                const short = `${senders[i].slice(0, 6)}...${senders[i].slice(-4)}`;
                const action = isBuys[i] ? 'BOUGHT' : 'SOLD';
                const time = this.formatRelativeTime(parseInt(timestamps[i]?.toString() || '0'));
                const escapedMsg = msg.replace(/</g, '&lt;').replace(/>/g, '&gt;');

                rows.push(`
                    <div class="ce-activity-row">
                        <div class="ce-activity-meta">
                            <span class="ce-activity-addr">${short}</span>
                            <span class="ce-activity-action ${isBuys[i] ? 'buy' : 'sell'}">${action}</span>
                            <span class="ce-activity-time">${time}</span>
                        </div>
                        <div class="ce-activity-msg">${escapedMsg}</div>
                    </div>
                `);
            }

            container.innerHTML = rows.length > 0
                ? rows.join('')
                : `<div class="ce-activity-empty">NO TRANSMISSIONS RECORDED</div>`;
        } catch (e) {
            console.warn('[CultExecsPage] Activity feed load failed:', e);
            container.innerHTML = `<div class="ce-activity-empty">FEED OFFLINE</div>`;
        }
    }

    formatRelativeTime(timestamp) {
        if (!timestamp) return '';
        const diff = Math.floor(Date.now() / 1000) - timestamp;
        if (diff < 60) return 'NOW';
        if (diff < 3600) return `${Math.floor(diff / 60)}M`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}H`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}D`;
        return `${Math.floor(diff / 604800)}W`;
    }

    formatTime() {
        const now = new Date();
        return now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    }

    render() {
        const { loading, error, config } = this.state;
        const contractAddress = config?.address || CULT_EXEC_ADDRESS;
        const shortAddress = `${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}`;

        if (loading) {
            return h('div', { className: 'cultexecs-page' },
                this.renderTerminalNav(),
                h('div', { className: 'ce-loading' },
                    h('span', null, 'INITIALIZING CULT EXECUTIVE TERMINAL'),
                    h('span', { className: 'loading-cursor' })
                )
            );
        }

        if (error) {
            return h('div', { className: 'cultexecs-page' },
                this.renderTerminalNav(),
                h('div', { className: 'ce-error' },
                    h('div', { className: 'error-code' }, 'SYSTEM ERROR'),
                    h('div', { className: 'error-message' }, error)
                )
            );
        }

        return h('div', { className: 'cultexecs-page' },
            this.renderTerminalNav(),
            this.renderPriceRunner(),

            h('div', { className: 'ce-content' },
                h('div', { className: 'ce-layout' },
                    // Left: Chart
                    h('div', { className: 'ce-main' },
                        h('div', { className: 'chart-panel' },
                            h('div', { className: 'panel-header' },
                                h('span', { 'data-ce-chart-title': true }, 'CHART'),
                                h('span', { className: 'panel-status', 'data-ce-phase': true },
                                    this.renderSkeleton('narrow')
                                )
                            ),
                            h('div', { className: 'chart-container' },
                                h(BondingCurve)
                            )
                        )
                    ),

                    // Right: Trading panel
                    h('div', { className: 'ce-sidebar' },
                        this.renderTradingPanel(shortAddress)
                    )
                ),

                // Color Bar
                h('div', { className: 'color-bar' },
                    h('div', { className: 'yellow-section' }, 'CULT EXEC'),
                    h('div', { className: 'red-section' },
                        h('span', null, '99) Report'),
                        h('span', { className: 'security-desc' },
                            'Page 1/4 Security Description: Dual Nature ERC404'
                        )
                    )
                )
            ),

            // Activity feed — loaded from contract's own messaging
            h('div', { className: 'ce-comments' },
                h('div', { className: 'comments-header' },
                    h('div', { className: 'comments-title' }, 'TRANSMISSIONS'),
                    h('div', { className: 'comments-count' }, 'LIVE FEED')
                ),
                h('div', { className: 'ce-activity-feed', 'data-ce-comments': true },
                    h('div', { className: 'ce-activity-row' },
                        h('div', { className: 'ce-activity-meta' },
                            h('span', { className: 'ce-skeleton ce-skeleton-text narrow' }, '\u00A0'),
                            h('span', { className: 'ce-skeleton ce-skeleton-text narrow', style: 'margin-left: 8px' }, '\u00A0')
                        ),
                        h('div', { className: 'ce-skeleton ce-skeleton-text wide', style: 'margin-top: 4px' }, '\u00A0')
                    ),
                    h('div', { className: 'ce-activity-row' },
                        h('div', { className: 'ce-activity-meta' },
                            h('span', { className: 'ce-skeleton ce-skeleton-text narrow' }, '\u00A0'),
                            h('span', { className: 'ce-skeleton ce-skeleton-text narrow', style: 'margin-left: 8px' }, '\u00A0')
                        ),
                        h('div', { className: 'ce-skeleton ce-skeleton-text medium', style: 'margin-top: 4px' }, '\u00A0')
                    ),
                    h('div', { className: 'ce-activity-row' },
                        h('div', { className: 'ce-activity-meta' },
                            h('span', { className: 'ce-skeleton ce-skeleton-text narrow' }, '\u00A0'),
                            h('span', { className: 'ce-skeleton ce-skeleton-text narrow', style: 'margin-left: 8px' }, '\u00A0')
                        ),
                        h('div', { className: 'ce-skeleton ce-skeleton-text wide', style: 'margin-top: 4px' }, '\u00A0')
                    )
                )
            ),

            this.renderNewsTicker()
        );
    }

    renderTerminalNav() {
        return h('div', { className: 'terminal-nav-section' },
            h('div', { className: 'terminal-nav' },
                h('div', { className: 'nav-left' },
                    h('span', { className: 'nav-arrows' }, '< >'),
                    h('span', { className: 'nav-title' }, 'CULT EXECUTIVE ENTERPRISE INCORPORATED TERMINAL'),
                    h('span', { className: 'nav-mode' }, 'MS2')
                )
            ),

            // Wallet detail panel — collapsed by default
            this.renderWalletPanel()
        );
    }

    renderWalletPanel() {
        const connected = this._connected || false;
        const addr = this._walletAddress;
        const shortAddr = addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

        return h('div', {
            className: 'ce-wallet-panel',
            'data-ce-wallet-panel': true,
            style: 'display: none'
        },
            h('div', { className: 'ce-wallet-panel-inner' },
                h('div', { className: 'ce-wallet-info' },
                    h('div', { className: 'ce-wallet-row' },
                        h('span', { className: 'ce-wallet-label' }, 'WALLET'),
                        h('span', { className: 'ce-wallet-value', 'data-ce-panel-addr': true }, shortAddr || '—')
                    ),
                    h('div', { className: 'ce-wallet-row' },
                        h('span', { className: 'ce-wallet-label' }, 'ETH'),
                        h('span', { className: 'ce-wallet-value', 'data-ce-panel-eth': true }, '—')
                    ),
                    h('div', { className: 'ce-wallet-row' },
                        h('span', { className: 'ce-wallet-label' }, '$EXEC'),
                        h('span', { className: 'ce-wallet-value', 'data-ce-panel-exec': true }, '—')
                    ),
                    h('div', { className: 'ce-wallet-row' },
                        h('span', { className: 'ce-wallet-label' }, 'NFTS'),
                        h('span', { className: 'ce-wallet-value', 'data-ce-panel-nfts': true }, '—')
                    )
                ),
                h('div', { className: 'ce-wallet-actions' },
                    h('button', {
                        className: 'ce-wallet-action-btn disconnect',
                        'data-ce-disconnect': true
                    }, 'DISCONNECT')
                )
            )
        );
    }

    renderSkeleton(width = 'medium') {
        return h('span', { className: `ce-skeleton ce-skeleton-text ${width}` }, '\u00A0');
    }

    renderPriceRunner() {
        const connected = this._connected || false;
        const addr = this._walletAddress;
        const shortAddr = addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

        return h('div', { className: 'price-runner' },
            h('div', { className: 'price-runner-left' },
                h('div', { className: 'ticker-info' },
                    h('span', { className: 'ticker-symbol' }, 'CULT $EXEC'),
                    h('span', { className: 'ticker-price up', 'data-ce-price': true },
                        this.renderSkeleton('medium')
                    ),
                    h('span', { className: 'ticker-change up' }, '')
                ),
                h('div', { className: 'ticker-details' },
                    h('span', { className: 'ticker-detail' },
                        h('span', { className: 'label' }, 'At'),
                        h('span', { className: 'value' }, this.formatTime())
                    ),
                    h('span', { className: 'ticker-detail' },
                        h('span', { className: 'label' }, 'Raised'),
                        h('span', { className: 'value', 'data-ce-raised': true },
                            this.renderSkeleton('narrow')
                        )
                    ),
                    h('span', { className: 'ticker-detail' },
                        h('span', { className: 'label' }, 'Supply'),
                        h('span', { className: 'value', 'data-ce-supply': true },
                            this.renderSkeleton('medium')
                        )
                    ),
                    h('span', { className: 'ticker-detail' },
                        h('span', { className: 'label' }, 'Phase'),
                        h('span', { className: 'value', 'data-ce-phase': true },
                            this.renderSkeleton('narrow')
                        )
                    )
                )
            ),
            h('div', { className: 'price-runner-actions' },
                // Portfolio button — prominent, always visible when connected
                h('button', {
                    className: 'ce-action-portfolio',
                    'data-ce-portfolio-btn': true,
                    style: connected ? '' : 'display: none'
                }, 'PORTFOLIO'),

                // Wallet connect / status
                h('button', {
                    className: `ce-nav-wallet ${connected ? 'connected' : ''}`,
                    'data-ce-nav-wallet': true
                },
                    connected
                        ? [
                            h('span', { className: 'ce-wallet-dot' }),
                            h('span', { className: 'ce-wallet-addr' }, shortAddr)
                        ]
                        : h('span', null, 'CONNECT WALLET')
                ),

                // Admin button — hidden by default, shown if owner
                h('button', {
                    className: 'ce-nav-btn ce-admin-btn',
                    'data-ce-admin-btn': true,
                    style: 'display: none'
                }, 'ADMIN')
            )
        );
    }

    renderTradingPanel(shortAddress) {
        const connected = this._connected || false;
        const walletAddress = this._walletAddress || null;
        const connectLabel = connected && walletAddress
            ? 'BUY $EXEC'
            : 'CONNECT WALLET';

        return h('div', { className: 'sidebar-panel' },
            h('div', { className: 'panel-header' },
                h('span', null, 'TRADE'),
                h('span', { className: 'panel-status' }, shortAddress)
            ),

            // Trade toggle
            h('div', { className: 'ce-trade-toggle' },
                h('button', { className: 'ce-toggle-btn active', 'data-side': 'buy' }, 'BUY'),
                h('button', { className: 'ce-toggle-btn', 'data-side': 'sell' }, 'SELL')
            ),

            // Amount input
            h('div', { className: 'ce-amount-wrapper' },
                h('input', {
                    type: 'text',
                    className: 'ce-amount-input',
                    placeholder: '0.0'
                }),
                h('span', { className: 'ce-amount-unit' }, 'ETH')
            ),

            // Quick picks
            h('div', { className: 'ce-quick-picks' },
                h('button', { className: 'ce-pick-btn' }, '.1'),
                h('button', { className: 'ce-pick-btn' }, '.5'),
                h('button', { className: 'ce-pick-btn' }, '1'),
                h('button', { className: 'ce-pick-btn' }, 'MAX')
            ),

            // Quote display
            h('div', { className: 'ce-quote-display', 'data-ce-quote': true },
                h('span', { className: 'ce-quote-label' }, 'YOU RECEIVE'),
                h('span', { className: 'ce-quote-value' }, '—')
            ),

            // Connect / Execute button
            h('button', {
                className: `ce-execute-btn ${connected ? 'connected' : ''}`,
                'data-ce-connect': true
            }, connectLabel),

            // Balances (populated via DOM from tradingStore)
            h('div', { className: 'ce-token-info' },
                h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'YOUR ETH'),
                    h('span', { className: 'info-value', 'data-ce-bal-eth': true },
                        this.renderSkeleton('narrow')
                    )
                ),
                h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'YOUR $EXEC'),
                    h('span', { className: 'info-value', 'data-ce-bal-exec': true },
                        this.renderSkeleton('narrow')
                    )
                ),
                h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'YOUR NFTS'),
                    h('span', { className: 'info-value', 'data-ce-bal-nft': true },
                        this.renderSkeleton('narrow')
                    )
                ),
                h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'CONTRACT'),
                    h('span', { className: 'info-value' }, shortAddress)
                ),
                h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'TYPE'),
                    h('span', { className: 'info-value' }, 'ERC404')
                ),
                h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'NETWORK'),
                    h('span', { className: 'info-value' }, 'ETHEREUM')
                )
            )
        );
    }

    renderNewsTicker() {
        const items = [
            'SYSTEM ONLINE',
            'CULT EXECUTIVE TERMINAL ACTIVE',
            'ERC404 DUAL NATURE ASSET',
            'BONDING CURVE PRESALE',
            'MS2.FUN GENESIS PROJECT',
            'ALIGNMENT PROTOCOL ENABLED'
        ];

        const allItems = [...items, ...items];

        return h('div', { className: 'news-ticker' },
            h('div', { className: 'ticker-scroll' },
                ...allItems.map(text =>
                    h('span', { className: 'ticker-item' }, text)
                )
            )
        );
    }
}

export default CultExecsPage;
