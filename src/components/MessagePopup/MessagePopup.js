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
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .message-popup {
                background: #ffffff;
                border-radius: 8px;
                padding: 15px 20px;
                min-width: 300px;
                max-width: 400px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                animation: slideIn 0.3s ease;
                border-left: 4px solid #2196F3;
            }

            .message-popup.error {
                border-left-color: #f44336;
            }

            .message-popup.success {
                border-left-color: #4CAF50;
            }

            .message-popup.warning {
                border-left-color: #ff9800;
            }

            .message-content {
                flex-grow: 1;
                margin-right: 10px;
            }

            .message-title {
                font-weight: bold;
                margin-bottom: 5px;
            }

            .message-text {
                font-size: 14px;
                color: #666;
            }

            .close-button {
                background: none;
                border: none;
                color: #999;
                cursor: pointer;
                font-size: 20px;
                padding: 0;
                line-height: 1;
            }

            .close-button:hover {
                color: #666;
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
        console.log('MessagePopup.show called with:', {
            options,
            stack: new Error().stack // This will show us the call stack
        });

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
        console.log('MessagePopup.error called with:', {
            message,
            title,
            stack: new Error().stack
        });
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