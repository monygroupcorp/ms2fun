/**
 * Mock EXEC Voting Service
 * 
 * Simulates the voting and staking system for factory applications.
 * Uses localStorage for persistence.
 */

import { saveMockData } from './mockData.js';

/**
 * Mock implementation of EXEC voting service
 */
export default class MockExecVotingService {
    /**
     * @param {object} mockData - Shared mock data structure
     */
    constructor(mockData) {
        this.data = mockData || this._getDefaultData();
        this._ensureVotingData();
    }

    /**
     * Ensure voting data structure exists
     * @private
     */
    _ensureVotingData() {
        if (!this.data.voting) {
            this.data.voting = {
                stakes: {}, // address -> { amount, stakedAt, lastVoteAt, cooldownUntil }
                applications: {}, // factoryAddress -> application data
                votes: {}, // factoryAddress -> { voter -> vote data }
                reputation: {}, // address -> reputation data
                badges: {} // address -> badges array
            };
            this._save();
        }
    }

    /**
     * Get default data structure
     * @private
     */
    _getDefaultData() {
        return {
            voting: {
                stakes: {},
                applications: {},
                votes: {},
                reputation: {},
                badges: {}
            }
        };
    }

    /**
     * Stake EXEC tokens
     * @param {string} amount - Amount to stake (in wei or smallest unit)
     * @param {string} address - Staker address
     * @returns {Promise<object>} Transaction receipt
     */
    async stakeExec(amount, address) {
        if (!address) {
            throw new Error('Address is required');
        }

        const amountBN = BigInt(amount);
        if (amountBN <= 0n) {
            throw new Error('Amount must be greater than 0');
        }

        this._ensureVotingData();
        
        const stake = this.data.voting.stakes[address] || {
            amount: 0n,
            stakedAt: null,
            lastVoteAt: null,
            cooldownUntil: null
        };

        stake.amount = (BigInt(stake.amount) || 0n) + amountBN;
        if (!stake.stakedAt) {
            stake.stakedAt = Date.now();
        }

        this.data.voting.stakes[address] = stake;
        this._save();

        return {
            transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
            blockNumber: Math.floor(Math.random() * 1000000),
            status: 1
        };
    }

    /**
     * Unstake EXEC tokens
     * @param {string} amount - Amount to unstake
     * @param {string} address - Staker address
     * @returns {Promise<object>} Transaction receipt
     */
    async unstakeExec(amount, address) {
        if (!address) {
            throw new Error('Address is required');
        }

        const amountBN = BigInt(amount);
        if (amountBN <= 0n) {
            throw new Error('Amount must be greater than 0');
        }

        this._ensureVotingData();
        
        const stake = this.data.voting.stakes[address];
        if (!stake || BigInt(stake.amount) < amountBN) {
            throw new Error('Insufficient staked balance');
        }

        // Check cooldown
        if (stake.cooldownUntil && Date.now() < stake.cooldownUntil) {
            const remaining = Math.ceil((stake.cooldownUntil - Date.now()) / 1000 / 60);
            throw new Error(`Cooldown active. ${remaining} minutes remaining.`);
        }

        stake.amount = BigInt(stake.amount) - amountBN;
        if (stake.amount === 0n) {
            stake.stakedAt = null;
        }

        this.data.voting.stakes[address] = stake;
        this._save();

        return {
            transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
            blockNumber: Math.floor(Math.random() * 1000000),
            status: 1
        };
    }

    /**
     * Get staked balance for an address
     * @param {string} address - Address to check
     * @returns {Promise<object>} Stake information
     */
    async getStakedBalance(address) {
        this._ensureVotingData();
        
        const stake = this.data.voting.stakes[address] || {
            amount: 0n,
            stakedAt: null,
            lastVoteAt: null,
            cooldownUntil: null
        };

        return {
            amount: stake.amount.toString(),
            stakedAt: stake.stakedAt,
            lastVoteAt: stake.lastVoteAt,
            cooldownUntil: stake.cooldownUntil,
            daysStaked: stake.stakedAt ? Math.floor((Date.now() - stake.stakedAt) / (1000 * 60 * 60 * 24)) : 0
        };
    }

    /**
     * Calculate voting power (quadratic: sqrt(staked))
     * @param {string} address - Voter address
     * @returns {Promise<object>} Voting power breakdown
     */
    async getVotingPower(address) {
        const stake = await this.getStakedBalance(address);
        const stakedAmount = BigInt(stake.amount || 0);
        
        // Quadratic voting: sqrt(staked)
        const baseVotes = this._sqrt(stakedAmount);
        
        // Time multiplier: +1% per day staked, max 30%
        const daysStaked = stake.daysStaked || 0;
        const timeMultiplier = Math.min(1 + (daysStaked * 0.01), 1.30);
        
        // Streak bonus: +5% per consecutive vote, max 25%
        const streak = await this._getVotingStreak(address);
        const streakMultiplier = Math.min(1 + (streak * 0.05), 1.25);
        
        const totalVotes = Math.floor(baseVotes * timeMultiplier * streakMultiplier);

        return {
            baseVotes: baseVotes.toString(),
            timeMultiplier: timeMultiplier.toFixed(2),
            streakMultiplier: streakMultiplier.toFixed(2),
            totalVotes: totalVotes.toString(),
            stakedAmount: stakedAmount.toString(),
            daysStaked
        };
    }

    /**
     * Cast a vote on a factory application
     * @param {string} factoryAddress - Factory address
     * @param {number} voteType - 0 = Approve, 1 = Reject, 2 = Abstain
     * @param {string} reason - Optional reason
     * @param {string} voter - Voter address
     * @returns {Promise<object>} Transaction receipt
     */
    async castVote(factoryAddress, voteType, reason, voter) {
        if (!factoryAddress || !voter) {
            throw new Error('Factory address and voter address are required');
        }

        if (voteType !== 0 && voteType !== 1 && voteType !== 2) {
            throw new Error('Invalid vote type. Must be 0 (Approve), 1 (Reject), or 2 (Abstain)');
        }

        this._ensureVotingData();

        // Check if application exists
        const application = this.data.voting.applications[factoryAddress];
        if (!application) {
            throw new Error('Application not found');
        }

        if (application.status !== 'pending') {
            throw new Error('Application is not pending');
        }

        // Check if already voted
        if (!this.data.voting.votes[factoryAddress]) {
            this.data.voting.votes[factoryAddress] = {};
        }

        if (this.data.voting.votes[factoryAddress][voter]) {
            throw new Error('Already voted on this application');
        }

        // Get voting power
        const votingPower = await this.getVotingPower(voter);
        const votes = parseInt(votingPower.totalVotes);

        // Record vote
        this.data.voting.votes[factoryAddress][voter] = {
            voteType,
            reason: reason || '',
            votes,
            timestamp: Date.now()
        };

        // Update application stats
        if (!application.stats) {
            application.stats = { approveVotes: 0, rejectVotes: 0, abstainVotes: 0, totalVoters: 0 };
        }

        if (voteType === 0) {
            application.stats.approveVotes += votes;
        } else if (voteType === 1) {
            application.stats.rejectVotes += votes;
        } else {
            application.stats.abstainVotes += votes;
        }
        application.stats.totalVoters += 1;

        // Update stake cooldown (7 days after voting)
        const stake = this.data.voting.stakes[voter];
        if (stake) {
            stake.lastVoteAt = Date.now();
            stake.cooldownUntil = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        }

        // Update reputation
        await this._updateReputation(voter, voteType);

        this._save();

        return {
            transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
            blockNumber: Math.floor(Math.random() * 1000000),
            status: 1
        };
    }

    /**
     * Get user's vote on an application
     * @param {string} factoryAddress - Factory address
     * @param {string} voter - Voter address
     * @returns {Promise<object|null>} Vote data or null
     */
    async getUserVote(factoryAddress, voter) {
        this._ensureVotingData();
        
        if (!this.data.voting.votes[factoryAddress]) {
            return null;
        }

        return this.data.voting.votes[factoryAddress][voter] || null;
    }

    /**
     * Get voting stats for an application
     * @param {string} factoryAddress - Factory address
     * @returns {Promise<object>} Voting statistics
     */
    async getVotingStats(factoryAddress) {
        this._ensureVotingData();
        
        const application = this.data.voting.applications[factoryAddress];
        if (!application) {
            return {
                approveVotes: 0,
                rejectVotes: 0,
                abstainVotes: 0,
                totalVoters: 0
            };
        }

        return application.stats || {
            approveVotes: 0,
            rejectVotes: 0,
            abstainVotes: 0,
            totalVoters: 0
        };
    }

    /**
     * Get all pending applications
     * @returns {Promise<Array>} Array of pending applications
     */
    async getPendingApplications() {
        this._ensureVotingData();
        
        const applications = Object.values(this.data.voting.applications)
            .filter(app => app.status === 'pending')
            .sort((a, b) => b.appliedAt - a.appliedAt);

        return applications;
    }

    /**
     * Get application by factory address
     * @param {string} factoryAddress - Factory address
     * @returns {Promise<object|null>} Application data or null
     */
    async getApplication(factoryAddress) {
        this._ensureVotingData();
        
        return this.data.voting.applications[factoryAddress] || null;
    }

    /**
     * Submit a factory application
     * @param {object} applicationData - Application data
     * @param {string} applicant - Applicant address
     * @returns {Promise<object>} Transaction receipt
     */
    async submitApplication(applicationData, applicant) {
        const {
            factoryAddress,
            contractType,
            title,
            displayTitle,
            metadataURI,
            features = []
        } = applicationData;

        if (!factoryAddress || !contractType || !title || !displayTitle) {
            throw new Error('Missing required fields');
        }

        this._ensureVotingData();

        // Check if application already exists
        if (this.data.voting.applications[factoryAddress]) {
            throw new Error('Application already exists for this factory');
        }

        // Create application
        const application = {
            factoryAddress,
            contractType,
            title,
            displayTitle,
            metadataURI: metadataURI || '',
            features,
            applicant,
            status: 'pending',
            appliedAt: Date.now(),
            stats: {
                approveVotes: 0,
                rejectVotes: 0,
                abstainVotes: 0,
                totalVoters: 0
            }
        };

        this.data.voting.applications[factoryAddress] = application;
        this._save();

        return {
            transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
            blockNumber: Math.floor(Math.random() * 1000000),
            status: 1
        };
    }

    /**
     * Get reputation for an address
     * @param {string} address - Address to check
     * @returns {Promise<object>} Reputation data
     */
    async getReputation(address) {
        this._ensureVotingData();
        
        if (!this.data.voting.reputation[address]) {
            return {
                score: 0,
                totalVotes: 0,
                correctPredictions: 0,
                accuracy: 0,
                streak: 0
            };
        }

        const rep = this.data.voting.reputation[address];
        const accuracy = rep.totalVotes > 0 
            ? (rep.correctPredictions / rep.totalVotes * 100).toFixed(1)
            : 0;

        return {
            ...rep,
            accuracy: parseFloat(accuracy)
        };
    }

    /**
     * Get badges for an address
     * @param {string} address - Address to check
     * @returns {Promise<Array>} Array of badge IDs
     */
    async getBadges(address) {
        this._ensureVotingData();
        
        const badges = this.data.voting.badges[address] || [];
        const reputation = await this.getReputation(address);
        
        // Calculate badges based on reputation
        const earnedBadges = [];
        
        if (reputation.totalVotes >= 1) {
            earnedBadges.push('first-vote');
        }
        if (reputation.totalVotes >= 10) {
            earnedBadges.push('consistent-voter');
        }
        if (reputation.accuracy >= 80 && reputation.totalVotes >= 5) {
            earnedBadges.push('quality-reviewer');
        }
        if (reputation.streak >= 30) {
            earnedBadges.push('streak-master');
        }
        if (reputation.totalVotes >= 1000) {
            earnedBadges.push('whale-voter');
        }

        // Update badges if new ones earned
        if (earnedBadges.length > badges.length) {
            this.data.voting.badges[address] = earnedBadges;
            this._save();
        }

        return earnedBadges;
    }

    /**
     * Calculate square root (for quadratic voting)
     * @param {bigint} n - Number
     * @returns {number} Square root
     * @private
     */
    _sqrt(n) {
        if (n < 0n) return 0;
        if (n < 2n) return Number(n);
        
        let x = n;
        let y = (x + 1n) / 2n;
        while (y < x) {
            x = y;
            y = (x + n / x) / 2n;
        }
        return Number(x);
    }

    /**
     * Get voting streak for an address
     * @param {string} address - Address to check
     * @returns {Promise<number>} Streak count
     * @private
     */
    async _getVotingStreak(address) {
        this._ensureVotingData();
        
        const rep = this.data.voting.reputation[address];
        return rep ? (rep.streak || 0) : 0;
    }

    /**
     * Update reputation after voting
     * @param {string} address - Voter address
     * @param {number} voteType - Vote type
     * @private
     */
    async _updateReputation(address, voteType) {
        this._ensureVotingData();
        
        if (!this.data.voting.reputation[address]) {
            this.data.voting.reputation[address] = {
                score: 0,
                totalVotes: 0,
                correctPredictions: 0,
                streak: 0,
                lastVoteAt: null
            };
        }

        const rep = this.data.voting.reputation[address];
        rep.totalVotes += 1;
        
        // Update streak (simplified - increment for now)
        // In real implementation, would check if votes are consecutive
        if (rep.lastVoteAt && Date.now() - rep.lastVoteAt < 24 * 60 * 60 * 1000) {
            rep.streak += 1;
        } else {
            rep.streak = 1;
        }
        rep.lastVoteAt = Date.now();

        // Note: Correct predictions would be updated when application is resolved
        // For now, we just track votes
    }

    /**
     * Save data to localStorage
     * @private
     */
    _save() {
        if (this.data && typeof saveMockData === 'function') {
            // Ensure voting data is part of the main data structure
            // The data should already be merged, but ensure it's there
            if (!this.data.voting) {
                this.data.voting = {
                    stakes: {},
                    applications: {},
                    votes: {},
                    reputation: {},
                    badges: {}
                };
            }
            saveMockData(this.data);
        }
    }
}

