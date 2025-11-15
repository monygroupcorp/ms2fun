/**
 * EXEC Voting Dashboard
 * 
 * Dashboard for EXEC holders to stake tokens, vote on factory applications,
 * and view reputation and badges.
 */

import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import walletService from '../services/WalletService.js';
import { eventBus } from '../core/EventBus.js';
import MessagePopup from '../components/MessagePopup/MessagePopup.js';

let messagePopup = null;
let updateInterval = null;

/**
 * Render EXEC voting dashboard
 */
export async function renderExecVotingDashboard() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/routes/exec-voting-dashboard.css', 'exec-voting-dashboard-styles');
    
    // Unload other page styles
    stylesheetLoader.unload('home-styles');
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('project-detail-styles');
    stylesheetLoader.unload('factory-detail-styles');
    stylesheetLoader.unload('project-creation-styles');
    stylesheetLoader.unload('factory-exploration-styles');
    stylesheetLoader.unload('factory-application-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    messagePopup = new MessagePopup();

    // Render page
    appContainer.innerHTML = `
        <div class="exec-voting-dashboard">
            <div class="dashboard-header">
                <h1>EXEC Voting Dashboard</h1>
                <p class="subtitle">Stake EXEC tokens and vote on factory applications</p>
                <div class="exec-balance" data-ref="exec-balance" style="display: none;">
                    <span class="balance-label">EXEC Balance:</span>
                    <span class="balance-value" data-ref="exec-balance-value">--</span>
                </div>
            </div>

            <div class="dashboard-grid">
                <!-- Staking Panel -->
                <div class="dashboard-panel staking-panel">
                    <h2>Staking</h2>
                    <div class="staking-content">
                        <div class="stake-display">
                            <div class="stake-info">
                                <span class="stake-label">Staked:</span>
                                <span class="stake-value" data-ref="staked-balance">0 EXEC</span>
                            </div>
                            <div class="stake-info">
                                <span class="stake-label">Days Staked:</span>
                                <span class="stake-value" data-ref="days-staked">0</span>
                            </div>
                        </div>

                        <div class="staking-form">
                            <div class="form-group">
                                <label for="stake-amount" class="form-label">Amount to Stake</label>
                                <input 
                                    type="number" 
                                    id="stake-amount" 
                                    class="form-input" 
                                    data-ref="stake-amount"
                                    placeholder="0"
                                    min="0"
                                    step="0.0001"
                                />
                            </div>
                            <div class="button-group">
                                <button class="btn btn-primary stake-button" data-ref="stake-button">
                                    Stake
                                </button>
                                <button class="btn btn-secondary unstake-button" data-ref="unstake-button">
                                    Unstake
                                </button>
                            </div>
                            <div class="cooldown-warning" data-ref="cooldown-warning" style="display: none;">
                                ⚠️ Cooldown active. Cannot unstake yet.
                            </div>
                        </div>

                        <div class="voting-power-display">
                            <h3>Voting Power</h3>
                            <div class="power-value" data-ref="voting-power">0</div>
                            <div class="power-breakdown" data-ref="power-breakdown">
                                <div class="breakdown-item">
                                    <span>Base Votes:</span>
                                    <span data-ref="base-votes">0</span>
                                </div>
                                <div class="breakdown-item">
                                    <span>Time Multiplier:</span>
                                    <span data-ref="time-multiplier">1.00x</span>
                                </div>
                                <div class="breakdown-item">
                                    <span>Streak Bonus:</span>
                                    <span data-ref="streak-multiplier">1.00x</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Reputation Panel -->
                <div class="dashboard-panel reputation-panel">
                    <h2>Reputation</h2>
                    <div class="reputation-content">
                        <div class="reputation-score" data-ref="reputation-score">0</div>
                        <div class="reputation-stats">
                            <div class="stat-item">
                                <span class="stat-label">Total Votes:</span>
                                <span class="stat-value" data-ref="total-votes">0</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Accuracy:</span>
                                <span class="stat-value" data-ref="accuracy">0%</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Streak:</span>
                                <span class="stat-value" data-ref="streak">0</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Badges Panel -->
                <div class="dashboard-panel badges-panel">
                    <h2>Badges</h2>
                    <div class="badges-content" data-ref="badges-content">
                        <!-- Badges will be rendered here -->
                    </div>
                </div>
            </div>

            <!-- Active Applications Section -->
            <div class="applications-section">
                <h2>Active Applications</h2>
                <div class="applications-list" data-ref="applications-list">
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>Loading applications...</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Setup event listeners
    setupEventListeners(appContainer);

    // Load initial data
    await loadDashboardData(appContainer);

    // Set up polling for updates
    updateInterval = setInterval(() => {
        loadDashboardData(appContainer);
    }, 30000); // Update every 30 seconds

    // Return cleanup function
    return {
        cleanup: () => {
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            stylesheetLoader.unload('exec-voting-dashboard-styles');
            messagePopup = null;
        }
    };
}

/**
 * Setup event listeners
 */
function setupEventListeners(container) {
    const stakeButton = container.querySelector('[data-ref="stake-button"]');
    const unstakeButton = container.querySelector('[data-ref="unstake-button"]');
    const stakeAmountInput = container.querySelector('[data-ref="stake-amount"]');

    if (stakeButton) {
        stakeButton.addEventListener('click', async () => {
            await handleStake(container);
        });
    }

    if (unstakeButton) {
        unstakeButton.addEventListener('click', async () => {
            await handleUnstake(container);
        });
    }

    // Listen for wallet connection
    eventBus.on('wallet:connected', () => {
        loadDashboardData(container);
    });
}

/**
 * Load dashboard data
 */
async function loadDashboardData(container) {
    if (!walletService.isConnected()) {
        // Show connect wallet message
        const execBalance = container.querySelector('[data-ref="exec-balance"]');
        if (execBalance) {
            execBalance.style.display = 'none';
        }
        return;
    }

    const address = walletService.connectedAddress;
    const votingService = serviceFactory.getExecVotingService();

    try {
        // Load staking data
        const stake = await votingService.getStakedBalance(address);
        const votingPower = await votingService.getVotingPower(address);

        // Update UI
        updateStakingDisplay(container, stake, votingPower);

        // Load reputation
        const reputation = await votingService.getReputation(address);
        updateReputationDisplay(container, reputation);

        // Load badges
        const badges = await votingService.getBadges(address);
        updateBadgesDisplay(container, badges);

        // Load applications
        await loadApplications(container, address, votingService);

    } catch (error) {
        console.error('Error loading dashboard data:', error);
        if (messagePopup) {
            messagePopup.error('Failed to load dashboard data', 'Error');
        }
    }
}

/**
 * Update staking display
 */
function updateStakingDisplay(container, stake, votingPower) {
    const stakedBalanceEl = container.querySelector('[data-ref="staked-balance"]');
    const daysStakedEl = container.querySelector('[data-ref="days-staked"]');
    const votingPowerEl = container.querySelector('[data-ref="voting-power"]');
    const baseVotesEl = container.querySelector('[data-ref="base-votes"]');
    const timeMultiplierEl = container.querySelector('[data-ref="time-multiplier"]');
    const streakMultiplierEl = container.querySelector('[data-ref="streak-multiplier"]');
    const cooldownWarning = container.querySelector('[data-ref="cooldown-warning"]');

    if (stakedBalanceEl) {
        const amount = parseFloat(stake.amount) / 1e18;
        stakedBalanceEl.textContent = `${amount.toFixed(4)} EXEC`;
    }

    if (daysStakedEl) {
        daysStakedEl.textContent = stake.daysStaked || 0;
    }

    if (votingPowerEl) {
        votingPowerEl.textContent = votingPower.totalVotes || '0';
    }

    if (baseVotesEl) {
        baseVotesEl.textContent = votingPower.baseVotes || '0';
    }

    if (timeMultiplierEl) {
        timeMultiplierEl.textContent = `${votingPower.timeMultiplier || '1.00'}x`;
    }

    if (streakMultiplierEl) {
        streakMultiplierEl.textContent = `${votingPower.streakMultiplier || '1.00'}x`;
    }

    // Show cooldown warning if active
    if (cooldownWarning && stake.cooldownUntil && Date.now() < stake.cooldownUntil) {
        const remaining = Math.ceil((stake.cooldownUntil - Date.now()) / 1000 / 60);
        cooldownWarning.textContent = `⚠️ Cooldown active. ${remaining} minutes remaining.`;
        cooldownWarning.style.display = 'block';
    } else if (cooldownWarning) {
        cooldownWarning.style.display = 'none';
    }
}

/**
 * Update reputation display
 */
function updateReputationDisplay(container, reputation) {
    const scoreEl = container.querySelector('[data-ref="reputation-score"]');
    const totalVotesEl = container.querySelector('[data-ref="total-votes"]');
    const accuracyEl = container.querySelector('[data-ref="accuracy"]');
    const streakEl = container.querySelector('[data-ref="streak"]');

    if (scoreEl) {
        scoreEl.textContent = reputation.score || 0;
    }

    if (totalVotesEl) {
        totalVotesEl.textContent = reputation.totalVotes || 0;
    }

    if (accuracyEl) {
        accuracyEl.textContent = `${reputation.accuracy || 0}%`;
    }

    if (streakEl) {
        streakEl.textContent = reputation.streak || 0;
    }
}

/**
 * Update badges display
 */
function updateBadgesDisplay(container, badges) {
    const badgesContent = container.querySelector('[data-ref="badges-content"]');
    if (!badgesContent) return;

    const badgeConfig = {
        'first-vote': { emoji: '🎯', name: 'First Vote' },
        'consistent-voter': { emoji: '🔥', name: 'Consistent Voter' },
        'quality-reviewer': { emoji: '⭐', name: 'Quality Reviewer' },
        'early-adopter': { emoji: '⚡', name: 'Early Adopter' },
        'whale-voter': { emoji: '🐋', name: 'Whale Voter' },
        'streak-master': { emoji: '🔥', name: 'Streak Master' }
    };

    if (badges.length === 0) {
        badgesContent.innerHTML = '<p class="no-badges">No badges earned yet. Start voting to earn badges!</p>';
        return;
    }

    badgesContent.innerHTML = badges.map(badgeId => {
        const config = badgeConfig[badgeId] || { emoji: '🏅', name: badgeId };
        return `
            <div class="badge-item" title="${config.name}">
                <span class="badge-emoji">${config.emoji}</span>
                <span class="badge-name">${config.name}</span>
            </div>
        `;
    }).join('');
}

/**
 * Load applications
 */
async function loadApplications(container, address, votingService) {
    const applicationsList = container.querySelector('[data-ref="applications-list"]');
    if (!applicationsList) return;

    try {
        const applications = await votingService.getPendingApplications();

        if (applications.length === 0) {
            applicationsList.innerHTML = '<p class="no-applications">No pending applications at this time.</p>';
            return;
        }

        // Render application cards
        const cardsHtml = await Promise.all(applications.map(async (app) => {
            const stats = await votingService.getVotingStats(app.factoryAddress);
            const userVote = await votingService.getUserVote(app.factoryAddress, address);
            
            const approvePercent = stats.totalVoters > 0 
                ? (stats.approveVotes / (stats.approveVotes + stats.rejectVotes + stats.abstainVotes) * 100).toFixed(1)
                : 0;
            const rejectPercent = stats.totalVoters > 0
                ? (stats.rejectVotes / (stats.approveVotes + stats.rejectVotes + stats.abstainVotes) * 100).toFixed(1)
                : 0;

            return `
                <div class="application-card" data-factory-address="${app.factoryAddress}">
                    <div class="card-header">
                        <h3>${app.displayTitle || app.title}</h3>
                        <span class="contract-type-badge ${app.contractType.toLowerCase()}">${app.contractType}</span>
                    </div>
                    <div class="card-body">
                        <div class="application-info">
                            <div class="info-item">
                                <span class="info-label">Factory:</span>
                                <span class="info-value">${app.factoryAddress.slice(0, 10)}...${app.factoryAddress.slice(-8)}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Applied:</span>
                                <span class="info-value">${new Date(app.appliedAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div class="voting-stats">
                            <div class="vote-bar approve">
                                <div class="vote-bar-fill" style="width: ${approvePercent}%"></div>
                                <span class="vote-label">Approve: ${stats.approveVotes}</span>
                            </div>
                            <div class="vote-bar reject">
                                <div class="vote-bar-fill" style="width: ${rejectPercent}%"></div>
                                <span class="vote-label">Reject: ${stats.rejectVotes}</span>
                            </div>
                            <div class="vote-info">
                                <span>Total Voters: ${stats.totalVoters}</span>
                            </div>
                        </div>
                        ${userVote ? `
                            <div class="user-vote">
                                <span>Your Vote: ${userVote.voteType === 0 ? 'Approve' : userVote.voteType === 1 ? 'Reject' : 'Abstain'}</span>
                                <span>(${userVote.votes} votes)</span>
                            </div>
                        ` : `
                            <div class="vote-actions">
                                <button class="btn btn-sm btn-success vote-approve" data-factory="${app.factoryAddress}">Approve</button>
                                <button class="btn btn-sm btn-danger vote-reject" data-factory="${app.factoryAddress}">Reject</button>
                            </div>
                        `}
                    </div>
                </div>
            `;
        }));

        applicationsList.innerHTML = cardsHtml.join('');

        // Setup vote button listeners
        setupVoteButtons(container, address, votingService);

    } catch (error) {
        console.error('Error loading applications:', error);
        applicationsList.innerHTML = '<p class="error-message">Failed to load applications.</p>';
    }
}

/**
 * Setup vote button listeners
 */
function setupVoteButtons(container, address, votingService) {
    const approveButtons = container.querySelectorAll('.vote-approve');
    const rejectButtons = container.querySelectorAll('.vote-reject');

    approveButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const factoryAddress = button.getAttribute('data-factory');
            await castVote(container, factoryAddress, 0, address, votingService);
        });
    });

    rejectButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const factoryAddress = button.getAttribute('data-factory');
            await castVote(container, factoryAddress, 1, address, votingService);
        });
    });
}

/**
 * Cast a vote
 */
async function castVote(container, factoryAddress, voteType, address, votingService) {
    if (!messagePopup) return;

    try {
        messagePopup.info('Submitting vote...', 'Voting');

        const receipt = await votingService.castVote(factoryAddress, voteType, '', address);

        messagePopup.success('Vote cast successfully!', 'Success');

        // Reload applications
        await loadApplications(container, address, votingService);
        await loadDashboardData(container);

    } catch (error) {
        console.error('Error casting vote:', error);
        messagePopup.error(`Failed to cast vote: ${error.message}`, 'Error');
    }
}

/**
 * Handle stake
 */
async function handleStake(container) {
    if (!walletService.isConnected()) {
        if (messagePopup) {
            messagePopup.error('Please connect your wallet', 'Wallet Required');
        }
        return;
    }

    const amountInput = container.querySelector('[data-ref="stake-amount"]');
    const amount = amountInput.value;

    if (!amount || parseFloat(amount) <= 0) {
        if (messagePopup) {
            messagePopup.error('Please enter a valid amount', 'Invalid Amount');
        }
        return;
    }

    try {
        const votingService = serviceFactory.getExecVotingService();
        const amountWei = (BigInt(Math.floor(parseFloat(amount) * 1e18))).toString();
        const address = walletService.connectedAddress;

        if (messagePopup) {
            messagePopup.info('Staking EXEC tokens...', 'Staking');
        }

        await votingService.stakeExec(amountWei, address);

        if (messagePopup) {
            messagePopup.success('Successfully staked EXEC tokens!', 'Success');
        }

        // Clear input and reload data
        amountInput.value = '';
        await loadDashboardData(container);

    } catch (error) {
        console.error('Error staking:', error);
        if (messagePopup) {
            messagePopup.error(`Failed to stake: ${error.message}`, 'Error');
        }
    }
}

/**
 * Handle unstake
 */
async function handleUnstake(container) {
    if (!walletService.isConnected()) {
        if (messagePopup) {
            messagePopup.error('Please connect your wallet', 'Wallet Required');
        }
        return;
    }

    const amountInput = container.querySelector('[data-ref="stake-amount"]');
    const amount = amountInput.value;

    if (!amount || parseFloat(amount) <= 0) {
        if (messagePopup) {
            messagePopup.error('Please enter a valid amount', 'Invalid Amount');
        }
        return;
    }

    try {
        const votingService = serviceFactory.getExecVotingService();
        const amountWei = (BigInt(Math.floor(parseFloat(amount) * 1e18))).toString();
        const address = walletService.connectedAddress;

        if (messagePopup) {
            messagePopup.info('Unstaking EXEC tokens...', 'Unstaking');
        }

        await votingService.unstakeExec(amountWei, address);

        if (messagePopup) {
            messagePopup.success('Successfully unstaked EXEC tokens!', 'Success');
        }

        // Clear input and reload data
        amountInput.value = '';
        await loadDashboardData(container);

    } catch (error) {
        console.error('Error unstaking:', error);
        if (messagePopup) {
            messagePopup.error(`Failed to unstake: ${error.message}`, 'Error');
        }
    }
}

