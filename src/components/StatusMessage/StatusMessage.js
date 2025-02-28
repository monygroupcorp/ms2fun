class StatusMessage {
    constructor(elementId) {
        console.log('StatusMessage constructor', elementId);
        this.statusEl = document.getElementById(elementId);
    }

    update(message, isError = false) {
        if (!this.statusEl) return;

        // Fade out current text
        this.statusEl.style.opacity = '0';
        
        setTimeout(() => {
            this.statusEl.textContent = message;
            this.statusEl.style.color = isError ? '#FF4444' : '#00FF00';
            // Fade in new text
            this.statusEl.style.opacity = '1';
        }, 200);
    }
}

export default StatusMessage; 