/**
 * FAQ - Microact Version
 *
 * Displays list of FAQ items.
 */

import { Component, h } from '../../core/microact-setup.js';
import { FAQItem } from './FAQItem.microact.js';

export class FAQ extends Component {
    constructor(props = {}) {
        super(props);
    }

    get faqs() {
        return this.props.faqs || [];
    }

    render() {
        return h('div', { className: 'faq-section' },
            h('h2', { className: 'section-title' }, 'Frequently Asked Questions'),
            h('div', { className: 'faq-list' },
                ...this.faqs.map((faq, index) =>
                    h(FAQItem, { key: faq.id || index, faq })
                )
            )
        );
    }
}

export default FAQ;
