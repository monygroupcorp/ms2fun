import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';

export default class PortfolioModal extends Component {
    constructor() {
        super();
        this.handleClose = this.handleClose.bind(this);
    }

    mount(container) {
        super.mount(container);
        this.setupDOMEventListeners();
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

    render() {
        return `
            <div class="portfolio-modal-overlay">
                <div class="portfolio-modal">
                    <button class="portfolio-modal-close">&times;</button>
                    <div class="portfolio-modal-content">
                        <h2>Your Portfolio</h2>
                        <div class="portfolio-content">
                            <!-- Portfolio content will go here -->
                        </div>
                    </div>
                </div>
            </div>
        `;
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
            }

            .portfolio-modal {
                background-color: #fff;
                border-radius: 8px;
                padding: 24px;
                position: relative;
                width: 90%;
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto;
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
            }

            .portfolio-modal h2 {
                margin: 0;
                padding-bottom: 16px;
                border-bottom: 1px solid #eee;
            }

            .portfolio-content {
                padding: 16px 0;
            }
        `;
    }
}