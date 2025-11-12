/**
 * Admin Dashboard Modal Component
 * 
 * Modal wrapper for AdminDashboard component.
 * Handles open/close state and overlay.
 */

import { Component } from '../../core/Component.js';
import { AdminDashboard } from './AdminDashboard.js';

export class AdminDashboardModal extends Component {
    constructor(contractAddress, contractType, adapter) {
        super();
        this.contractAddress = contractAddress;
        this.contractType = contractType;
        this.adapter = adapter;
        this.state = {
            isOpen: false
        };
    }

    open() {
        this.setState({ isOpen: true });
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.setState({ isOpen: false });
        // Restore body scroll
        document.body.style.overflow = '';
    }

    render() {
        if (!this.state.isOpen) {
            return '';
        }

        return `
            <div class="admin-modal-overlay" data-ref="overlay">
                <div class="admin-modal-container" data-ref="modal-container">
                    <div class="admin-modal-header">
                        <h2>Admin Dashboard</h2>
                        <button class="admin-modal-close" data-ref="close-button" aria-label="Close">
                            ×
                        </button>
                    </div>
                    <div class="admin-modal-content" data-ref="content">
                        <!-- AdminDashboard will be mounted here -->
                    </div>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setTimeout(() => {
            this.setupChildComponents();
            this.bindEvents();
        }, 0);
    }

    setupChildComponents() {
        if (!this.state.isOpen) {
            return;
        }

        const contentContainer = this.getRef('content', '.admin-modal-content');
        if (contentContainer) {
            const dashboard = new AdminDashboard(
                this.contractAddress,
                this.contractType,
                this.adapter
            );
            const dashboardElement = document.createElement('div');
            contentContainer.appendChild(dashboardElement);
            dashboard.mount(dashboardElement);
            this.createChild('dashboard', dashboard);
        }
    }

    bindEvents() {
        const overlay = this.getRef('overlay', '.admin-modal-overlay');
        const closeButton = this.getRef('close-button', '.admin-modal-close');
        const modalContainer = this.getRef('modal-container', '.admin-modal-container');

        // Close on overlay click
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.close();
                }
            });
        }

        // Close on close button click
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                this.close();
            });
        }

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape' && this.state.isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', handleEscape);
        this.cleanupFunctions = this.cleanupFunctions || [];
        this.cleanupFunctions.push(() => {
            document.removeEventListener('keydown', handleEscape);
        });

        // Prevent modal container clicks from closing modal
        if (modalContainer) {
            modalContainer.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    onStateUpdate(oldState, newState) {
        // When modal opens, setup child components
        if (!oldState.isOpen && newState.isOpen) {
            this.setTimeout(() => {
                this.setupChildComponents();
            }, 0);
        }

        // When modal closes, cleanup
        if (oldState.isOpen && !newState.isOpen) {
            const dashboard = this.getChild('dashboard');
            if (dashboard && typeof dashboard.unmount === 'function') {
                dashboard.unmount();
            }
        }
    }

    unmount() {
        // Cleanup event listeners
        if (this.cleanupFunctions) {
            for (const cleanup of this.cleanupFunctions) {
                cleanup();
            }
        }

        // Restore body scroll
        document.body.style.overflow = '';

        super.unmount();
    }
}

