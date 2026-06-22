/**
 * Factory Application Status Page
 * 
 * View application status, voting progress, and vote details.
 */

import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import walletService from '../services/WalletService.js';
import MessagePopup from '../components/MessagePopup/MessagePopup.js';

let messagePopup = null;

/**
 * Render factory application status page
 */
export async function renderFactoryApplicationStatusPage(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    const factoryAddress = params?.address;
    if (!factoryAddress) {
        appContainer.innerHTML = '<div class="error-state"><p>Factory address not provided</p></div>';
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/routes/factory-application-status.css', 'factory-application-status-styles');
    
    // Unload other page styles
    stylesheetLoader.unload('home-styles');
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('project-detail-styles');
    stylesheetLoader.unload('factory-detail-styles');
    stylesheetLoader.unload('project-creation-styles');
    stylesheetLoader.unload('factory-exploration-styles');
    stylesheetLoader.unload('factory-application-styles');
    stylesheetLoader.unload('exec-voting-dashboard-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    messagePopup = new MessagePopup();

    // Show loading state
    appContainer.innerHTML = `
        <div class="application-status-page">
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading application status...</p>
            </div>
        </div>
    `;

    try {
        const votingService = serviceFactory.getExecVotingService();
        const application = await votingService.getApplication(factoryAddress);

        if (!application) {
            appContainer.innerHTML = `
                <div class="application-status-page">
                    <div class="error-state">
                        <h2>Application Not Found</h2>
                        <p>The application for this factory address was not found.</p>
                        <button class="back-button" data-ref="back-button">← Back to Factories</button>
                    </div>
                </div>
            `;
            setupBackButton(appContainer);
            return;
        }

        // Load voting stats
        const stats = await votingService.getVotingStats(factoryAddress);
        const userVote = walletService.isConnected() 
            ? await votingService.getUserVote(factoryAddress, walletService.connectedAddress)
            : null;

        // Render page
        renderApplicationStatus(appContainer, application, stats, userVote, factoryAddress);

    } catch (error) {
        console.error('Error loading application status:', error);
        appContainer.innerHTML = `
            <div class="application-status-page">
                <div class="error-state">
                    <h2>Error</h2>
                    <p>${error.message || 'Failed to load application status'}</p>
                    <button class="back-button" data-ref="back-button">← Back to Factories</button>
                </div>
            </div>
        `;
        setupBackButton(appContainer);
    }

    // Return cleanup function
    return {
        cleanup: () => {
            stylesheetLoader.unload('factory-application-status-styles');
            messagePopup = null;
        }
    };
}

/**
 * Render application status
 */
function renderApplicationStatus(container, application, stats, userVote, factoryAddress) {
    const statusBadge = getStatusBadge(application.status);
    const approvePercent = stats.totalVoters > 0 
        ? (stats.approveVotes / (stats.approveVotes + stats.rejectVotes + stats.abstainVotes) * 100).toFixed(1)
        : 0;
    const rejectPercent = stats.totalVoters > 0
        ? (stats.rejectVotes / (stats.approveVotes + stats.rejectVotes + stats.abstainVotes) * 100).toFixed(1)
        : 0;

    container.innerHTML = `
        <div class="application-status-page">
            <div class="status-header">
                <button class="back-button" data-ref="back-button">← Back</button>
                <div class="header-content">
                    <h1>${application.displayTitle || application.title}</h1>
                    <div class="status-badge ${application.status}">${statusBadge}</div>
                </div>
            </div>

            <div class="status-grid">
                <!-- Application Info -->
                <div class="status-panel info-panel">
                    <h2>Application Information</h2>
                    <div class="info-list">
                        <div class="info-item">
                            <span class="info-label">Factory Address:</span>
                            <span class="info-value">${factoryAddress}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Contract Type:</span>
                            <span class="info-value">${application.contractType}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Title (Slug):</span>
                            <span class="info-value">${application.title}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Display Title:</span>
                            <span class="info-value">${application.displayTitle}</span>
                        </div>
                        ${application.metadataURI ? `
                            <div class="info-item">
                                <span class="info-label">Metadata URI:</span>
                                <span class="info-value">${application.metadataURI}</span>
                            </div>
                        ` : ''}
                        <div class="info-item">
                            <span class="info-label">Applied:</span>
                            <span class="info-value">${new Date(application.appliedAt).toLocaleString()}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Applicant:</span>
                            <span class="info-value">${application.applicant.slice(0, 10)}...${application.applicant.slice(-8)}</span>
                        </div>
                    </div>
                </div>

                <!-- Voting Progress -->
                <div class="status-panel voting-panel">
                    <h2>Voting Progress</h2>
                    <div class="voting-stats">
                        <div class="stat-display">
                            <div class="stat-value approve">${stats.approveVotes}</div>
                            <div class="stat-label">Approve Votes</div>
                        </div>
                        <div class="stat-display">
                            <div class="stat-value reject">${stats.rejectVotes}</div>
                            <div class="stat-label">Reject Votes</div>
                        </div>
                        <div class="stat-display">
                            <div class="stat-value">${stats.totalVoters}</div>
                            <div class="stat-label">Total Voters</div>
                        </div>
                    </div>
                    <div class="progress-bars">
                        <div class="progress-bar approve">
                            <div class="progress-fill" style="width: ${approvePercent}%"></div>
                            <span class="progress-label">Approve: ${approvePercent}%</span>
                        </div>
                        <div class="progress-bar reject">
                            <div class="progress-fill" style="width: ${rejectPercent}%"></div>
                            <span class="progress-label">Reject: ${rejectPercent}%</span>
                        </div>
                    </div>
                    ${userVote ? `
                        <div class="user-vote-display">
                            <h3>Your Vote</h3>
                            <div class="vote-detail">
                                <span>Type: ${userVote.voteType === 0 ? 'Approve' : userVote.voteType === 1 ? 'Reject' : 'Abstain'}</span>
                                <span>Votes Cast: ${userVote.votes}</span>
                                ${userVote.reason ? `<span>Reason: ${userVote.reason}</span>` : ''}
                                <span>Date: ${new Date(userVote.timestamp).toLocaleString()}</span>
                            </div>
                        </div>
                    ` : application.status === 'pending' ? `
                        <div class="vote-prompt">
                            <p>You haven't voted on this application yet.</p>
                            <a href="/voting" class="vote-link">Go to Voting Dashboard</a>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    setupBackButton(container);
}

/**
 * Get status badge text
 */
function getStatusBadge(status) {
    const badges = {
        'pending': '⏳ Pending',
        'approved': '✓ Approved',
        'rejected': '✗ Rejected',
        'withdrawn': '↩ Withdrawn'
    };
    return badges[status] || status;
}

/**
 * Setup back button
 */
function setupBackButton(container) {
    const backButton = container.querySelector('[data-ref="back-button"]');
    if (backButton) {
        backButton.addEventListener('click', () => {
            if (window.router) {
                window.router.navigate('/factories');
            } else {
                window.location.href = '/factories';
            }
        });
    }
}

