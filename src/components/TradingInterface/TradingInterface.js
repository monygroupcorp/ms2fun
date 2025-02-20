class TradingInterface {
    constructor(address, currentPrice) {
        this.address = address;
        this.currentPrice = currentPrice;
        this.isEthToExec = true;
    }

    render() {
        const shortAddress = this.address.slice(0, 6) + '...' + this.address.slice(-4);
        
        const container = document.createElement('div');
        container.className = 'trading-interface';
        container.innerHTML = `
            <div class="trading-container">
                <div class="curve-display">
                    <canvas id="curveChart"></canvas>
                </div>
                <div class="swap-interface">
                    <h2>CULT EXECS</h2>
                    <div class="price-info">
                        <div class="price-display">
                            <span class="current-price">0.0025ETH/1M</span>
                        </div>
                        <div class="connection-status">
                            <span class="status-message" id="contractStatus">CONNECTION ESTABLISHED: ${shortAddress}</span>
                        </div>
                    </div>
                    <div class="swap-module">
                        ${this.renderQuickFillButtons()}
                        ${this.renderSwapInputs()}
                    </div>
                </div>
            </div>
            
            <!-- Mobile Tab Controls -->
            <div class="mobile-tabs">
                <button class="tab-button active" data-view="curve">Price Curve</button>
                <button class="tab-button" data-view="swap">Swap</button>
            </div>
        `;

        this.setupEventListeners(container);
        return container;
    }

    renderQuickFillButtons() {
        return `
            <div class="quick-fill-buttons">
                <button class="quick-fill eth-fill" data-value="0.0025">0.0025</button>
                <button class="quick-fill eth-fill" data-value="0.005">0.005</button>
                <button class="quick-fill eth-fill" data-value="0.01">0.01</button>
                <button class="quick-fill eth-fill" data-value="0.1">0.1</button>
                <button class="quick-fill exec-fill hidden" data-value="25">25%</button>
                <button class="quick-fill exec-fill hidden" data-value="50">50%</button>
                <button class="quick-fill exec-fill hidden" data-value="75">75%</button>
                <button class="quick-fill exec-fill hidden" data-value="100">100%</button>
            </div>
        `;
    }

    renderSwapInputs() {
        return `
            <div class="input-group">
                <input type="number" id="ethAmount" placeholder="0.0" autofocus>
                <span class="currency-label">ETH</span>
            </div>
            <button class="swap-arrow-button"><span class="arrow">↓</span></button>
            <div class="input-group">
                <input type="number" id="execAmount" placeholder="0.0">
                <span class="currency-label">EXEC</span>
            </div>
            <button id="swapButton" class="swap-button">BUY EXEC</button>
        `;
    }

    setupEventListeners(container) {
        const ethAmount = container.querySelector('#ethAmount');
        const execAmount = container.querySelector('#execAmount');
        const swapArrowButton = container.querySelector('.swap-arrow-button');
        const swapButton = container.querySelector('#swapButton');
        const ethFillButtons = container.querySelectorAll('.eth-fill');
        const execFillButtons = container.querySelectorAll('.exec-fill');

        // Handle quick fill buttons
        ethFillButtons.forEach(button => {
            button.addEventListener('click', () => {
                ethAmount.value = button.dataset.value;
                this.updateExecAmount(ethAmount.value);
            });
        });

        execFillButtons.forEach(button => {
            button.addEventListener('click', () => {
                const percentage = parseInt(button.dataset.value);
                execAmount.value = this.calculateExecAmount(percentage);
                this.updateEthAmount(execAmount.value);
            });
        });

        // Handle swap button
        swapArrowButton.addEventListener('click', () => this.handleSwap(container));

        // Update amounts on input
        ethAmount.addEventListener('input', (e) => this.updateExecAmount(e.target.value));
        execAmount.addEventListener('input', (e) => this.updateEthAmount(e.target.value));
    }

    handleSwap(container) {
        this.isEthToExec = !this.isEthToExec;
        
        const swapArrowButton = container.querySelector('.swap-arrow-button');
        const swapButton = container.querySelector('#swapButton');
        const ethAmount = container.querySelector('#ethAmount');
        const execAmount = container.querySelector('#execAmount');

        swapArrowButton.classList.toggle('flipped');

        // Swap input values
        [ethAmount.value, execAmount.value] = [execAmount.value, ethAmount.value];

        // Toggle quick fill buttons
        container.querySelectorAll('.eth-fill').forEach(btn => btn.classList.toggle('hidden'));
        container.querySelectorAll('.exec-fill').forEach(btn => btn.classList.toggle('hidden'));

        // Update swap button text
        swapButton.textContent = this.isEthToExec ? 'BUY EXEC' : 'SELL EXEC';

        // Focus the top input
        container.querySelector('.input-group input').focus();
    }

    updateExecAmount(ethValue) {
        const execAmount = document.getElementById('execAmount');
        execAmount.value = (parseFloat(ethValue) * 400000).toFixed(2); // Example conversion rate
    }

    updateEthAmount(execValue) {
        const ethAmount = document.getElementById('ethAmount');
        ethAmount.value = (parseFloat(execValue) / 400000).toFixed(4); // Example conversion rate
    }

    calculateExecAmount(percentage) {
        // Implement max balance calculation here
        const maxBalance = 1000000; // Example max balance
        return (maxBalance * percentage / 100).toFixed(6);
    }

    setupMobileTabbing() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const curveDisplay = document.querySelector('.curve-display');
        const swapInterface = document.querySelector('.swap-interface');

        if (window.innerWidth <= 768) {
            curveDisplay.classList.add('active');
            swapInterface.classList.remove('active');
            
            tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                    tabButtons.forEach(b => b.classList.remove('active'));
                    button.classList.add('active');

                    if (button.dataset.view === 'curve') {
                        curveDisplay.classList.add('active');
                        swapInterface.classList.remove('active');
                    } else {
                        swapInterface.classList.add('active');
                        curveDisplay.classList.remove('active');
                    }
                });
            });
        }
    }
}

export default TradingInterface; 