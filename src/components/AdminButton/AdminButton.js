/**
 * Admin Button Component
 * 
 * Conditionally renders an admin button that opens the admin dashboard modal.
 * Only visible to contract owners.
 */

import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import ownershipService from '../../services/OwnershipService.js';
import walletService from '../../services/WalletService.js';
import { AdminDashboardModal } from '../AdminDashboard/AdminDashboardModal.js';
import { ERC1155AdminModal } from '../AdminDashboard/ERC1155AdminModal.js';
import { ERC404AdminModal } from '../AdminDashboard/ERC404AdminModal.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class AdminButton extends Component {
    constructor(contractAddress, contractType = null, adapter = null, projectData = null) {
        super();
        this.contractAddress = contractAddress;
        this.contractType = contractType;
        this.adapter = adapter;
        this.projectData = projectData;
        this.modal = null;
        this.state = {
            isOwner: false,
            loading: true,
            showModal: false
        };
    }

    async onMount() {
        console.log('[AdminButton] onMount called', {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            hasAdapter: !!this.adapter
        });

        // Listen for wallet connection events to re-check ownership
        this._walletConnectedHandler = () => this.checkOwnership();
        this._walletChangedHandler = () => this.checkOwnership();
        eventBus.on('wallet:connected', this._walletConnectedHandler);
        eventBus.on('wallet:changed', this._walletChangedHandler);

        await this.checkOwnership();
    }

    async checkOwnership() {
        try {
            this.setState({ loading: true });

            const userAddress = walletService.getAddress();
            if (!userAddress) {
                console.log('[AdminButton] No user address, not owner');
                this.setState({ isOwner: false, loading: false });
                return;
            }

            // Special hardcoded check for cultexecs
            const cultexecsAddress = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';
            const isCultExecs = this.contractAddress && 
                               (this.contractAddress.toLowerCase() === cultexecsAddress.toLowerCase());

            console.log('[AdminButton] Checking ownership:', {
                contractAddress: this.contractAddress,
                userAddress: userAddress,
                isCultExecs: isCultExecs,
                hasAdapter: !!this.adapter
            });

            let isOwner = false;

            if (isCultExecs && this.adapter) {
                // For cultexecs, use adapter's checkOwnership which checks OPERATOR_NFT token 598
                console.log('[AdminButton] Using cultexecs-specific ownership check (OPERATOR_NFT token 598)');
                isOwner = await this.adapter.checkOwnership(userAddress);
                console.log('[AdminButton] Adapter ownership result:', isOwner);
                
                // If adapter check fails, try direct check with provider
                if (!isOwner) {
                    try {
                        const operatorTokenId = 598;
                        const operatorNFTAddress = '0xB24BaB1732D34cAD0A7C7035C3539aEC553bF3a0';
                        
                        // Get provider from window.ethereum
                        if (typeof window !== 'undefined' && window.ethereum) {
                            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                            const provider = new ethers.providers.Web3Provider(window.ethereum);
                            
                            const erc721ABI = [
                                {
                                    "constant": true,
                                    "inputs": [{"name": "_tokenId", "type": "uint256"}],
                                    "name": "ownerOf",
                                    "outputs": [{"name": "", "type": "address"}],
                                    "type": "function"
                                }
                            ];
                            
                            const operatorNFTContract = new ethers.Contract(
                                operatorNFTAddress,
                                erc721ABI,
                                provider
                            );
                            
                            const owner = await operatorNFTContract.ownerOf(operatorTokenId);
                            console.log(`[AdminButton] OPERATOR_NFT token ${operatorTokenId} owner:`, owner);
                            if (owner && owner.toLowerCase() === userAddress.toLowerCase()) {
                                console.log(`[AdminButton] User owns operator NFT token ${operatorTokenId}`);
                                isOwner = true;
                            }
                        }
                    } catch (error) {
                        console.warn('[AdminButton] Error checking operator NFT directly:', error);
                    }
                }
            } else if (this.adapter) {
                // For other contracts, use adapter's checkOwnership
                isOwner = await this.adapter.checkOwnership(userAddress);
            } else {
                // Otherwise use OwnershipService directly
                isOwner = await ownershipService.checkOwnership(
                    this.contractAddress,
                    userAddress,
                    this.contractType
                );
            }

            console.log('[AdminButton] Final ownership result:', isOwner);
            this.setState({ isOwner, loading: false });
        } catch (error) {
            console.error('[AdminButton] Error checking ownership:', error);
            this.setState({ isOwner: false, loading: false });
        }
    }

    render() {
        // Don't render if still loading or not owner
        if (this.state.loading || !this.state.isOwner) {
            return '';
        }

        return `
            <button class="btn btn-primary admin-button" data-ref="admin-button" title="Open Admin Dashboard">
                <span class="admin-button-icon">♚</span>
                <span class="admin-button-text">Admin</span>
            </button>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setTimeout(() => {
            this.bindEvents();
        }, 0);
    }

    bindEvents() {
        const adminButton = this.getRef('admin-button', '.admin-button');
        if (adminButton) {
            adminButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openAdminModal();
            });
        }
    }

    openAdminModal() {
        // Create modal if it doesn't exist
        if (!this.modal) {
            // Use contract-type-specific modals
            const contractTypeUpper = this.contractType?.toUpperCase() || '';
            const isERC1155 = contractTypeUpper === 'ERC1155';
            const isERC404 = contractTypeUpper === 'ERC404' || contractTypeUpper === 'ERC404BONDING';

            if (isERC1155) {
                // Load ERC1155-specific admin stylesheet
                stylesheetLoader.load('src/components/AdminDashboard/erc1155-admin.css', 'erc1155-admin-styles');

                this.modal = new ERC1155AdminModal(
                    this.contractAddress,
                    this.contractType,
                    this.adapter,
                    this.projectData
                );
            } else if (isERC404) {
                // Load ERC404-specific admin stylesheet
                stylesheetLoader.load('src/components/AdminDashboard/erc404-admin.css', 'erc404-admin-styles');

                this.modal = new ERC404AdminModal(
                    this.contractAddress,
                    this.contractType,
                    this.adapter,
                    this.projectData
                );
            } else {
                // Load generic admin dashboard stylesheet
                stylesheetLoader.load('src/components/AdminDashboard/AdminDashboard.css', 'admin-dashboard-styles');

                this.modal = new AdminDashboardModal(
                    this.contractAddress,
                    this.contractType,
                    this.adapter
                );
            }

            // Mount modal to body
            const modalContainer = document.createElement('div');
            modalContainer.id = 'admin-modal-container';
            document.body.appendChild(modalContainer);
            this.modal.mount(modalContainer);
        }

        // Open modal
        this.modal.open();
    }

    /**
     * Refresh ownership check (call when wallet changes)
     */
    async refresh() {
        await this.checkOwnership();
    }

    unmount() {
        // Cleanup wallet event listeners
        if (this._walletConnectedHandler) {
            eventBus.off('wallet:connected', this._walletConnectedHandler);
        }
        if (this._walletChangedHandler) {
            eventBus.off('wallet:changed', this._walletChangedHandler);
        }

        // Cleanup modal if it exists
        if (this.modal) {
            this.modal.close();
            if (typeof this.modal.unmount === 'function') {
                this.modal.unmount();
            }
            const container = document.getElementById('admin-modal-container');
            if (container) {
                container.remove();
            }
        }

        // Unload stylesheet based on contract type
        const contractTypeUpper = this.contractType?.toUpperCase() || '';
        const isERC1155 = contractTypeUpper === 'ERC1155';
        const isERC404 = contractTypeUpper === 'ERC404' || contractTypeUpper === 'ERC404BONDING';
        if (isERC1155) {
            stylesheetLoader.unload('erc1155-admin-styles');
        } else if (isERC404) {
            stylesheetLoader.unload('erc404-admin-styles');
        } else {
            stylesheetLoader.unload('admin-dashboard-styles');
        }

        super.unmount();
    }
}

