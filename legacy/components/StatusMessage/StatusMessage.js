class StatusMessage {
    constructor(elementId) {
        this.statusEl = document.getElementById(elementId);
    }

    update(message, isError = false) {
        if (!this.statusEl) return;

        // Fade out current text
        this.statusEl.style.opacity = '0';
        
        setTimeout(() => {
            this.statusEl.textContent = message;
            // Use CSS variable that changes based on page context
            this.statusEl.style.color = isError 
                ? '#FF4444' 
                : 'var(--status-success-color, var(--color-success, #10b981))';
            // Fade in new text
            this.statusEl.style.opacity = '1';
        }, 200);
    }
}

export default StatusMessage; 