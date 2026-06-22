class MessagePopup {
    constructor() {
        this.container = null;
        this.initialize();
    }

    initialize() {
        // Create container for messages if it doesn't exist
        if (!document.getElementById('message-popup-container')) {
            this.container = document.createElement('div');
            this.container.id = 'message-popup-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('message-popup-container');
        }

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #message-popup-container {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .message-popup {
                background: var(--bg-primary, #fff);
                border: 2px solid var(--border-primary, #000);
                border-radius: 0;
                padding: 12px 16px;
                min-width: 280px;
                max-width: 380px;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                animation: slideIn 0.2s ease;
                font-family: var(--font-primary, 'Helvetica Neue', sans-serif);
            }

            .message-popup.error {
                border-color: #ff0000;
            }

            .message-popup.success {
                border-color: var(--border-primary, #000);
            }

            .message-popup.warning {
                border-color: var(--border-primary, #000);
            }

            .message-content {
                flex-grow: 1;
                margin-right: 12px;
            }

            .message-title {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                margin-bottom: 4px;
                color: var(--text-primary, #000);
            }

            .message-popup.error .message-title {
                color: #ff0000;
            }

            .message-text {
                font-size: 13px;
                color: var(--text-secondary, #666);
                line-height: 1.4;
            }

            .close-button {
                background: none;
                border: none;
                color: var(--text-tertiary, #999);
                cursor: pointer;
                font-size: 18px;
                padding: 0;
                line-height: 1;
                flex-shrink: 0;
            }

            .close-button:hover {
                color: var(--text-primary, #000);
            }

            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes fadeOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    show(options) {
        const {
            title = '',
            message = '',
            type = 'info', // 'info', 'error', 'success', 'warning'
            duration = 5000 // Duration in ms, 0 for no auto-close
        } = options;

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = `message-popup ${type}`;
        
        // Handle different message types
        let messageContent;
        if (typeof message === 'string') {
            // If it's a string, use it directly
            messageContent = message;
        } else if (message instanceof Error) {
            // If it's an Error object
            messageContent = message.message || 'An error occurred';
        } else if (message instanceof HTMLElement) {
            // If it's an HTML element
            messageContent = message.outerHTML;
        } else if (typeof message === 'object') {
            // For objects, convert to string representation
            try {
                messageContent = JSON.stringify(message, null, 2);
            } catch (e) {
                messageContent = 'Error displaying message object';
            }
        } else {
            // Fallback
            messageContent = String(message);
        }
        
        messageElement.innerHTML = `
            <div class="message-content">
                ${title ? `<div class="message-title">${title}</div>` : ''}
                <div class="message-text">${messageContent}</div>
            </div>
            <button class="close-button">×</button>
        `;

        // Add to container
        this.container.appendChild(messageElement);

        // Setup close button
        const closeButton = messageElement.querySelector('.close-button');
        closeButton.addEventListener('click', () => this.close(messageElement));

        // Auto close if duration is set
        if (duration > 0) {
            setTimeout(() => {
                if (messageElement.parentNode) {
                    this.close(messageElement);
                }
            }, duration);
        }

        return messageElement;
    }

    close(messageElement) {
        messageElement.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.parentNode.removeChild(messageElement);
            }
        }, 300);
    }

    // Helper methods for common message types
    error(message, title = 'Error') {
        return this.show({ title, message, type: 'error' });
    }

    success(message, title = 'Success') {
        return this.show({ title, message, type: 'success' });
    }

    warning(message, title = 'Warning') {
        return this.show({ title, message, type: 'warning' });
    }

    info(message, title = 'Info') {
        return this.show({ title, message, type: 'info' });
    }
}

export default MessagePopup; 