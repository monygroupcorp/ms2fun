/**
 * StatusMessage - Microact Version
 *
 * Displays status messages with fade animation.
 * Can show success or error states.
 */

import { Component, h } from '../../core/microact-setup.js';

export class StatusMessage extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            message: props.message || '',
            isError: props.isError || false,
            opacity: 1
        };
    }

    /**
     * Update message with fade animation
     */
    updateMessage(message, isError = false) {
        // Fade out
        this.setState({ opacity: 0 });

        setTimeout(() => {
            this.setState({
                message,
                isError,
                opacity: 1
            });
        }, 200);
    }

    render() {
        const { message, isError, opacity } = this.state;

        const color = isError
            ? '#FF4444'
            : 'var(--status-success-color, var(--color-success, #10b981))';

        return h('div', {
            className: 'status-message',
            style: `
                color: ${color};
                opacity: ${opacity};
                transition: opacity 0.2s ease;
            `
        }, message);
    }
}

export default StatusMessage;
