/**
 * Governance Adapter
 *
 * Handles both FactoryApprovalGovernance and VaultApprovalGovernance contracts.
 * Provides unified interface for application submission, voting, challenges, and finalization.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

// Cache TTL configuration
const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (constants)
    DYNAMIC: 2 * 60 * 1000,       // 2 minutes (proposals, votes)
};

class GovernanceAdapter extends ContractAdapter {
    /**
     * @param {string} contractAddress - Governance contract address
     * @param {string} governanceType - 'Factory' or 'Vault'
     * @param {Object} ethersProvider - Ethers provider
     * @param {Object} signer - Ethers signer
     */
    constructor(contractAddress, governanceType, ethersProvider, signer) {
        super(contractAddress, `${governanceType}Governance`, ethersProvider, signer);
        this.governanceType = governanceType; // 'Factory' or 'Vault'
        this.ethers = ethers;
    }

    /**
     * Initialize the adapter - load appropriate governance ABI
     */
    async initialize() {
        try {
            // Check if we have a mock provider
            const isMockProvider = this.provider && this.provider.isMock === true;

            if (isMockProvider) {
                this.initialized = true;
                this.isMock = true;
                eventBus.emit('contract:adapter:initialized', {
                    contractAddress: this.contractAddress,
                    contractType: this.contractType,
                    isMock: true
                });
                return true;
            }

            // Validate provider
            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available for contract initialization');
            }

            // Load appropriate ABI based on governance type
            const abiName = this.governanceType === 'Factory'
                ? 'FactoryApprovalGovernance'
                : 'VaultApprovalGovernance';

            const abi = await loadABI(abiName);

            // Initialize main contract
            this.contract = new ethers.Contract(
                this.contractAddress,
                abi,
                this.signer || this.provider
            );

            this.initialized = true;
            eventBus.emit('contract:adapter:initialized', {
                contractAddress: this.contractAddress,
                contractType: this.contractType
            });

            return true;
        } catch (error) {
            throw this.wrapError(error, `${this.governanceType}GovernanceAdapter initialization failed`);
        }
    }

    // =========================
    // Application Management
    // =========================

    /**
     * Submit application (factory or vault)
     * @param {Object} params - Application parameters
     * @param {string} params.contractAddress - Contract address to apply
     * @param {string} params.contractType - Contract type
     * @param {string} params.title - Title
     * @param {string} params.displayTitle - Display title
     * @param {string} params.metadataURI - Metadata URI
     * @param {Array<string>} params.features - Feature array
     * @param {string} params.message - Application message
     * @returns {Promise<Object>} Transaction receipt
     */
    async submitApplication(params) {
        try {
            const {
                contractAddress,
                contractType,
                title,
                displayTitle,
                metadataURI,
                features = [],
                message = ''
            } = params;

            // Get application fee
            const fee = await this.getApplicationFee();
            const feeWei = ethers.utils.parseEther(fee);

            eventBus.emit('transaction:pending', {
                type: 'submitApplication',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'submitApplication',
                [contractAddress, contractType, title, displayTitle, metadataURI, features, message],
                {
                    requiresSigner: true,
                    txOptions: { value: feeWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'submitApplication',
                receipt,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('application', 'governance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'submitApplication',
                error: this.wrapError(error, 'Application submission failed')
            });
            throw error;
        }
    }

    /**
     * Get application details
     * @param {string} subjectAddress - Factory or vault address
     * @returns {Promise<Object>} Application information
     */
    async getApplication(subjectAddress) {
        return await this.getCachedOrFetch('getApplication', [subjectAddress], async () => {
            // Applications are stored in a public mapping, access directly
            const app = await this.contract.applications(subjectAddress);
            return this._parseApplication(app);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get total governance messages
     * @returns {Promise<number>} Total message count
     */
    async totalMessages() {
        return await this.getCachedOrFetch('totalMessages', [], async () => {
            const count = await this.executeContractCall('totalMessages');
            return parseInt(count.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get governance message by ID
     * @param {number} messageId - Message ID
     * @returns {Promise<Object>} Governance message
     */
    async governanceMessages(messageId) {
        return await this.getCachedOrFetch('governanceMessages', [messageId], async () => {
            // Messages are in a public mapping
            const msg = await this.contract.governanceMessages(messageId);
            return this._parseGovernanceMessage(msg);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get application fee
     * @returns {Promise<string>} Application fee in ETH
     */
    async applicationFee() {
        return await this.getCachedOrFetch('applicationFee', [], async () => {
            const fee = await this.executeContractCall('applicationFee');
            return ethers.utils.formatEther(fee);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get application fee (alias)
     */
    async getApplicationFee() {
        return await this.applicationFee();
    }

    // =========================
    // Voting
    // =========================

    /**
     * Vote on application with deposit
     * @param {string} subjectAddress - Factory or vault address
     * @param {boolean} approve - True to approve, false to reject
     * @param {string} amount - Deposit amount in ETH
     * @param {string} message - Vote message
     * @returns {Promise<Object>} Transaction receipt
     */
    async voteWithDeposit(subjectAddress, approve, amount, message = '') {
        try {
            const amountWei = ethers.utils.parseEther(amount);

            eventBus.emit('transaction:pending', {
                type: 'voteWithDeposit',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'voteWithDeposit',
                [subjectAddress, approve, amountWei, message],
                {
                    requiresSigner: true,
                    txOptions: { value: amountWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'voteWithDeposit',
                receipt,
                approve,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('vote', 'deposit', 'governance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'voteWithDeposit',
                error: this.wrapError(error, 'Voting failed')
            });
            throw error;
        }
    }

    /**
     * Get deposit information
     * @param {string} subjectAddress - Factory or vault address
     * @param {string} voterAddress - Voter address
     * @param {number} roundIndex - Round index
     * @returns {Promise<Object>} Deposit information
     */
    async deposits(subjectAddress, voterAddress, roundIndex) {
        return await this.getCachedOrFetch('deposits', [subjectAddress, voterAddress, roundIndex], async () => {
            // Deposits are in a public mapping
            const deposit = await this.contract.deposits(subjectAddress, voterAddress, roundIndex);
            return {
                amount: ethers.utils.formatEther(deposit.amount || deposit[0]),
                approve: deposit.approve !== undefined ? deposit.approve : deposit[1],
                claimed: deposit.claimed !== undefined ? deposit.claimed : deposit[2]
            };
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get user's vote on application
     * @param {string} subjectAddress - Factory or vault address
     * @param {string} voterAddress - Voter address
     * @returns {Promise<Object>} Vote details
     */
    async getUserVote(subjectAddress, voterAddress) {
        // Get current round from application
        const app = await this.getApplication(subjectAddress);
        const roundIndex = app.currentRound || 0;

        return await this.deposits(subjectAddress, voterAddress, roundIndex);
    }

    /**
     * Check if user has voted
     * @param {string} subjectAddress - Factory or vault address
     * @param {string} voterAddress - Voter address
     * @returns {Promise<boolean>} True if user has voted
     */
    async hasVoted(subjectAddress, voterAddress) {
        const vote = await this.getUserVote(subjectAddress, voterAddress);
        return parseFloat(vote.amount) > 0;
    }

    // =========================
    // Challenges
    // =========================

    /**
     * Initiate challenge on application
     * @param {string} subjectAddress - Factory or vault address
     * @param {string} message - Challenge reason
     * @returns {Promise<Object>} Transaction receipt
     */
    async initiateChallenge(subjectAddress, message = '') {
        try {
            eventBus.emit('transaction:pending', {
                type: 'initiateChallenge',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'initiateChallenge',
                [subjectAddress, message],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'initiateChallenge',
                receipt,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('challenge', 'governance', 'application');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'initiateChallenge',
                error: this.wrapError(error, 'Challenge initiation failed')
            });
            throw error;
        }
    }

    /**
     * Get challenges for application
     * @param {string} subjectAddress - Factory or vault address
     * @returns {Promise<Array>} Array of challenge details
     */
    async getChallenges(subjectAddress) {
        // This would require iterating through governance messages
        // For now, return empty array - can be enhanced
        return [];
    }

    // =========================
    // Finalization
    // =========================

    /**
     * Finalize voting round
     * @param {string} subjectAddress - Factory or vault address
     * @returns {Promise<Object>} Transaction receipt
     */
    async finalizeRound(subjectAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'finalizeRound',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'finalizeRound',
                [subjectAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'finalizeRound',
                receipt,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('application', 'governance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'finalizeRound',
                error: this.wrapError(error, 'Round finalization failed')
            });
            throw error;
        }
    }

    /**
     * Register factory (after successful approval)
     * @param {string} factoryAddress - Factory address
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerFactory(factoryAddress) {
        if (this.governanceType !== 'Factory') {
            throw new Error('registerFactory only available on Factory governance');
        }

        try {
            eventBus.emit('transaction:pending', {
                type: 'registerFactory',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerFactory',
                [factoryAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'registerFactory',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('factory', 'registry');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerFactory',
                error: this.wrapError(error, 'Factory registration failed')
            });
            throw error;
        }
    }

    /**
     * Register vault (after successful approval)
     * @param {string} vaultAddress - Vault address
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerVault(vaultAddress) {
        if (this.governanceType !== 'Vault') {
            throw new Error('registerVault only available on Vault governance');
        }

        try {
            eventBus.emit('transaction:pending', {
                type: 'registerVault',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerVault',
                [vaultAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'registerVault',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('vault', 'registry');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerVault',
                error: this.wrapError(error, 'Vault registration failed')
            });
            throw error;
        }
    }

    // =========================
    // Deposit Withdrawal
    // =========================

    /**
     * Withdraw deposits after round completion
     * @param {string} subjectAddress - Factory or vault address
     * @returns {Promise<Object>} Transaction receipt
     */
    async withdrawDeposits(subjectAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'withdrawDeposits',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'withdrawDeposits',
                [subjectAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'withdrawDeposits',
                receipt,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('deposit', 'vote');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'withdrawDeposits',
                error: this.wrapError(error, 'Deposit withdrawal failed')
            });
            throw error;
        }
    }

    // =========================
    // Governance Constants
    // =========================

    /**
     * Get APPLICATION_FEE constant
     * @returns {Promise<string>} Application fee in ETH
     */
    async APPLICATION_FEE() {
        return await this.getCachedOrFetch('APPLICATION_FEE', [], async () => {
            const fee = await this.executeContractCall('APPLICATION_FEE');
            return ethers.utils.formatEther(fee);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get MIN_QUORUM constant
     * @returns {Promise<string>} Minimum quorum in ETH
     */
    async MIN_QUORUM() {
        return await this.getCachedOrFetch('MIN_QUORUM', [], async () => {
            const quorum = await this.executeContractCall('MIN_QUORUM');
            return ethers.utils.formatEther(quorum);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get MIN_DEPOSIT constant
     * @returns {Promise<string>} Minimum deposit in ETH
     */
    async MIN_DEPOSIT() {
        return await this.getCachedOrFetch('MIN_DEPOSIT', [], async () => {
            const deposit = await this.executeContractCall('MIN_DEPOSIT');
            return ethers.utils.formatEther(deposit);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get INITIAL_VOTING_PERIOD constant
     * @returns {Promise<number>} Initial voting period in seconds
     */
    async INITIAL_VOTING_PERIOD() {
        return await this.getCachedOrFetch('INITIAL_VOTING_PERIOD', [], async () => {
            const period = await this.executeContractCall('INITIAL_VOTING_PERIOD');
            return parseInt(period.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get CHALLENGE_WINDOW constant
     * @returns {Promise<number>} Challenge window in seconds
     */
    async CHALLENGE_WINDOW() {
        return await this.getCachedOrFetch('CHALLENGE_WINDOW', [], async () => {
            const window = await this.executeContractCall('CHALLENGE_WINDOW');
            return parseInt(window.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get CHALLENGE_VOTING_PERIOD constant
     * @returns {Promise<number>} Challenge voting period in seconds
     */
    async CHALLENGE_VOTING_PERIOD() {
        return await this.getCachedOrFetch('CHALLENGE_VOTING_PERIOD', [], async () => {
            const period = await this.executeContractCall('CHALLENGE_VOTING_PERIOD');
            return parseInt(period.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get LAME_DUCK_PERIOD constant
     * @returns {Promise<number>} Lame duck period in seconds
     */
    async LAME_DUCK_PERIOD() {
        return await this.getCachedOrFetch('LAME_DUCK_PERIOD', [], async () => {
            const period = await this.executeContractCall('LAME_DUCK_PERIOD');
            return parseInt(period.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get all governance constants
     * @returns {Promise<Object>} All governance constants
     */
    async getGovernanceConstants() {
        return await this.getCachedOrFetch('getGovernanceConstants', [], async () => {
            const [appFee, minQuorum, minDeposit, votingPeriod, challengeWindow, challengeVotingPeriod, lameDuckPeriod] = await Promise.all([
                this.APPLICATION_FEE(),
                this.MIN_QUORUM(),
                this.MIN_DEPOSIT(),
                this.INITIAL_VOTING_PERIOD(),
                this.CHALLENGE_WINDOW(),
                this.CHALLENGE_VOTING_PERIOD(),
                this.LAME_DUCK_PERIOD()
            ]);

            return {
                applicationFee: appFee,
                minQuorum,
                minDeposit,
                initialVotingPeriod: votingPeriod,
                challengeWindow,
                challengeVotingPeriod,
                lameDuckPeriod
            };
        }, CACHE_TTL.STATIC);
    }

    // =========================
    // Public State Variables & Additional View Functions
    // =========================

    /**
     * Get application by address (public state variable accessor)
     * @param {string} subjectAddress - Factory or vault address
     * @returns {Promise<Object>} Application details
     */
    async applications(subjectAddress) {
        return await this.getCachedOrFetch('applications', [subjectAddress], async () => {
            const app = await this.executeContractCall('applications', [subjectAddress]);
            return this._parseApplication(app);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get exec token address
     * @returns {Promise<string>} Exec token contract address
     */
    async execToken() {
        return await this.getCachedOrFetch('execToken', [], async () => {
            return await this.executeContractCall('execToken');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get master registry address
     * @returns {Promise<string>} Master registry contract address
     */
    async masterRegistry() {
        return await this.getCachedOrFetch('masterRegistry', [], async () => {
            return await this.executeContractCall('masterRegistry');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get current round for subject
     * @param {string} subjectAddress - Factory or vault address
     * @returns {Promise<Object>} Current round information
     */
    async getCurrentRound(subjectAddress) {
        return await this.getCachedOrFetch('getCurrentRound', [subjectAddress], async () => {
            const round = await this.executeContractCall('getCurrentRound', [subjectAddress]);
            return {
                roundIndex: parseInt((round.roundIndex || round[0]).toString()),
                approvalVotes: ethers.utils.formatEther(round.approvalVotes || round[1]),
                rejectionVotes: ethers.utils.formatEther(round.rejectionVotes || round[2]),
                startTime: parseInt((round.startTime || round[3]).toString()),
                endTime: parseInt((round.endTime || round[4]).toString()),
                isChallenged: round.isChallenged !== undefined ? round.isChallenged : round[5],
                isFinalized: round.isFinalized !== undefined ? round.isFinalized : round[6]
            };
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get message by ID
     * @param {number} messageId - Message ID
     * @returns {Promise<Object>} Message details
     */
    async getMessage(messageId) {
        return await this.getCachedOrFetch('getMessage', [messageId], async () => {
            const msg = await this.executeContractCall('getMessage', [messageId]);
            return this._parseGovernanceMessage(msg);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get messages range
     * @param {number} startIndex - Start message ID
     * @param {number} endIndex - End message ID
     * @returns {Promise<Array>} Array of messages
     */
    async getMessagesRange(startIndex, endIndex) {
        return await this.getCachedOrFetch('getMessagesRange', [startIndex, endIndex], async () => {
            const messages = await this.executeContractCall('getMessagesRange', [startIndex, endIndex]);
            return messages.map(msg => this._parseGovernanceMessage(msg));
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get round information
     * @param {string} subjectAddress - Factory or vault address
     * @param {number} roundIndex - Round index
     * @returns {Promise<Object>} Round information
     */
    async getRound(subjectAddress, roundIndex) {
        return await this.getCachedOrFetch('getRound', [subjectAddress, roundIndex], async () => {
            const round = await this.executeContractCall('getRound', [subjectAddress, roundIndex]);
            return {
                roundIndex: parseInt((round.roundIndex || round[0]).toString()),
                approvalVotes: ethers.utils.formatEther(round.approvalVotes || round[1]),
                rejectionVotes: ethers.utils.formatEther(round.rejectionVotes || round[2]),
                startTime: parseInt((round.startTime || round[3]).toString()),
                endTime: parseInt((round.endTime || round[4]).toString()),
                isChallenged: round.isChallenged !== undefined ? round.isChallenged : round[5],
                isFinalized: round.isFinalized !== undefined ? round.isFinalized : round[6]
            };
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get voter deposit for specific round
     * @param {string} subjectAddress - Factory or vault address
     * @param {string} voterAddress - Voter address
     * @param {number} roundIndex - Round index
     * @returns {Promise<Object>} Deposit information
     */
    async getVoterDeposit(subjectAddress, voterAddress, roundIndex) {
        return await this.getCachedOrFetch('getVoterDeposit', [subjectAddress, voterAddress, roundIndex], async () => {
            const deposit = await this.executeContractCall('getVoterDeposit', [subjectAddress, voterAddress, roundIndex]);
            return {
                amount: ethers.utils.formatEther(deposit.amount || deposit[0]),
                approve: deposit.approve !== undefined ? deposit.approve : deposit[1],
                claimed: deposit.claimed !== undefined ? deposit.claimed : deposit[2]
            };
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // State-Changing Functions (Admin)
    // =========================

    /**
     * Enter lame duck period (admin only)
     * @returns {Promise<Object>} Transaction receipt
     */
    async enterLameDuck() {
        try {
            eventBus.emit('transaction:pending', {
                type: 'enterLameDuck',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'enterLameDuck',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'enterLameDuck',
                receipt,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('governance', 'lameDuck');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'enterLameDuck',
                error: this.wrapError(error, 'Failed to enter lame duck period')
            });
            throw error;
        }
    }

    /**
     * Set exec token address (admin only)
     * @param {string} tokenAddress - Exec token contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setExecToken(tokenAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setExecToken',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'setExecToken',
                [tokenAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setExecToken',
                receipt,
                tokenAddress,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('execToken');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setExecToken',
                error: this.wrapError(error, 'Failed to set exec token')
            });
            throw error;
        }
    }

    /**
     * Set master registry address (admin only)
     * @param {string} registryAddress - Master registry contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setMasterRegistry(registryAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setMasterRegistry',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'setMasterRegistry',
                [registryAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setMasterRegistry',
                receipt,
                registryAddress,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('masterRegistry');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setMasterRegistry',
                error: this.wrapError(error, 'Failed to set master registry')
            });
            throw error;
        }
    }

    /**
     * Submit application with explicit applicant (admin only)
     * @param {string} applicant - Applicant address
     * @param {Object} params - Application parameters
     * @returns {Promise<Object>} Transaction receipt
     */
    async submitApplicationWithApplicant(applicant, params) {
        try {
            const {
                contractAddress,
                contractType,
                title,
                displayTitle,
                metadataURI,
                features = [],
                message = ''
            } = params;

            // Get application fee
            const fee = await this.getApplicationFee();
            const feeWei = ethers.utils.parseEther(fee);

            eventBus.emit('transaction:pending', {
                type: 'submitApplicationWithApplicant',
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            const receipt = await this.executeContractCall(
                'submitApplicationWithApplicant',
                [applicant, contractAddress, contractType, title, displayTitle, metadataURI, features, message],
                {
                    requiresSigner: true,
                    txOptions: { value: feeWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'submitApplicationWithApplicant',
                receipt,
                applicant,
                contractAddress: this.contractAddress,
                governanceType: this.governanceType
            });

            // Invalidate cache
            contractCache.invalidateByPattern('application', 'governance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'submitApplicationWithApplicant',
                error: this.wrapError(error, 'Application submission with applicant failed')
            });
            throw error;
        }
    }

    // =========================
    // Helper Methods
    // =========================

    /**
     * Parse application from contract response
     * @private
     */
    _parseApplication(app) {
        return {
            applicant: app.applicant || app[0],
            contractAddress: app.contractAddress || app[1],
            contractType: app.contractType || app[2],
            title: app.title || app[3],
            displayTitle: app.displayTitle || app[4],
            metadataURI: app.metadataURI || app[5],
            features: app.features || app[6] || [],
            status: app.status !== undefined ? parseInt(app.status.toString()) : parseInt((app[7] || 0).toString()),
            submittedAt: app.submittedAt ? parseInt(app.submittedAt.toString()) : parseInt((app[8] || 0).toString()),
            currentRound: app.currentRound !== undefined ? parseInt(app.currentRound.toString()) : parseInt((app[9] || 0).toString()),
            approvalVotes: app.approvalVotes ? ethers.utils.formatEther(app.approvalVotes) : '0',
            rejectionVotes: app.rejectionVotes ? ethers.utils.formatEther(app.rejectionVotes) : '0'
        };
    }

    /**
     * Parse governance message from contract response
     * @private
     */
    _parseGovernanceMessage(msg) {
        return {
            sender: msg.sender || msg[0],
            subjectAddress: msg.subjectAddress || msg[1],
            message: msg.message || msg[2],
            timestamp: msg.timestamp ? parseInt(msg.timestamp.toString()) : parseInt((msg[3] || 0).toString()),
            messageType: msg.messageType !== undefined ? parseInt(msg.messageType.toString()) : parseInt((msg[4] || 0).toString())
        };
    }

    // =========================
    // Contract Metadata
    // =========================

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        const constants = await this.getGovernanceConstants();
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            governanceType: this.governanceType,
            totalMessages: await this.totalMessages(),
            ...constants
        };
    }

    /**
     * Get balance (not applicable for governance)
     * @returns {Promise<string>} Always returns '0'
     */
    async getBalance(address) {
        return '0';
    }

    /**
     * Get price (not applicable for governance)
     * @returns {Promise<number>} Always returns 0
     */
    async getPrice() {
        return 0;
    }
}

export default GovernanceAdapter;
