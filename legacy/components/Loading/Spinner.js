/**
 * Spinner - Rotating circle loader
 *
 * Simple CSS-only spinner for loading states
 *
 * @example
 * h(Spinner)
 * h(Spinner, { size: 'large' })
 * h(Spinner, { size: 'small' })
 * h(Spinner, { text: 'Loading...' })
 * h(Spinner, { centered: true, text: 'Loading projects' })
 */

import { h, Component } from '@monygroupcorp/microact';

export class Spinner extends Component {
    render() {
        const { size, text, centered = false } = this.props;
        const sizeClass = size ? ` ${size}` : '';

        const spinner = h('div', { className: `spinner${sizeClass}` });

        if (text || centered) {
            return h('div', { className: 'spinner-container' },
                spinner,
                text && h('div', { className: 'spinner-text' }, text)
            );
        }

        return spinner;
    }
}

export default Spinner;
