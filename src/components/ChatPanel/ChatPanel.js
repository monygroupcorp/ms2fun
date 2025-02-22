class ChatPanel {
    constructor() {
        this.messageCount = 0;
    }

    render(type = 'bulletin') {
        const panel = document.createElement('div');
        panel.className = 'chat-panel';
        
        if (type === 'bulletin') {
            panel.innerHTML = this.renderBulletin();
        } else {
            panel.innerHTML = this.renderStats();
        }

        return panel;
    }

    renderBulletin() {
        return `
            <div class="chat-header">
                <h2>EXEC INSIDER BULLETIN</h2>
            </div>
            <div class="chat-messages" id="chatMessages">
                <!-- Messages will be populated here -->
            </div>
            <div class="chat-status">
                <span>MESSAGES LOADED FROM CHAIN</span>
                <span class="message-count">0</span>
            </div>
        `;
    }

    renderStats() {
        return `
            <h2>3) SYSTEM STATUS | SYS</h2>
            <div class="stats-content">
                <p>NETWORK: <span class="status-indicator">CONNECTED</span></p>
                <p>CHAIN ID: <span>1 (ETHEREUM)</span></p>
                <p>BLOCK: <span>19,234,567</span></p>
                <p>LAST UPDATE: <span>2024-03-14 19:32</span></p>
                <p>API STATUS: <span class="status-indicator">ACTIVE</span></p>
                <p>CACHE: <span class="status-indicator">SYNCED</span></p>
                <p>TOTAL CHECKS: <span>1,234</span></p>
                <p>SUCCESS RATE: <span>99.9%</span></p>
            </div>
        `;
    }

    async loadMessages() {
        try {
            // Here you would fetch messages from your smart contract
            const messages = await this.fetchMessages();
            this.renderMessages(messages);
        } catch (error) {
            console.error('Error loading chat messages:', error);
            // Show placeholder message on error
            this.renderMessages([{
                address: '0x1234...5678',
                time: '19:32',
                content: 'First message on EXEC chain'
            }]);
        }
    }

    async fetchMessages() {
        // TODO: Implement actual contract call
        // For now, return placeholder data
        return [{
            address: '0x1234...5678',
            time: '19:32',
            content: 'First message on EXEC chain'
        }];
    }

    renderMessages(messages) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        chatMessages.innerHTML = messages.map(msg => `
            <div class="message">
                <span class="message-address">${msg.address}</span>
                <span class="message-time">${msg.time}</span>
                <p class="message-content">${msg.content}</p>
            </div>
        `).join('');

        this.updateMessageCount(messages.length);
    }

    updateMessageCount(count) {
        const countElement = document.querySelector('.message-count');
        if (countElement) {
            this.messageCount = count;
            countElement.textContent = count.toString();
        }
    }
}

export default ChatPanel; 