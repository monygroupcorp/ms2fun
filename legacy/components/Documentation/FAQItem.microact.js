/**
 * FAQItem - Microact Version
 *
 * Individual FAQ question/answer item with accordion toggle.
 */

import { Component, h } from '../../core/microact-setup.js';

export class FAQItem extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            expanded: false
        };
    }

    get faq() {
        return this.props.faq || {};
    }

    handleToggle(e) {
        e.preventDefault();
        this.setState({ expanded: !this.state.expanded });
    }

    sanitizeHTML(html) {
        if (!html) return '';
        const allowedTags = ['p', 'strong', 'em', 'u', 'br', 'a', 'ul', 'ol', 'li'];
        const div = document.createElement('div');
        div.innerHTML = html;

        // Remove script tags and dangerous elements
        const scripts = div.querySelectorAll('script, iframe, object, embed');
        scripts.forEach(el => el.remove());

        return div.innerHTML;
    }

    render() {
        const { question, answer, id } = this.faq;
        const { expanded } = this.state;

        return h('div', {
            className: `faq-item ${expanded ? 'expanded' : ''}`,
            'data-faq-id': id
        },
            h('button', {
                className: 'faq-question',
                onClick: this.bind(this.handleToggle)
            },
                h('span', { className: 'faq-question-text' }, question),
                h('span', { className: 'faq-icon' }, expanded ? '−' : '+')
            ),
            h('div', { className: 'faq-answer-wrapper' },
                h('div', {
                    className: 'faq-answer',
                    innerHTML: this.sanitizeHTML(answer)
                })
            )
        );
    }
}

export default FAQItem;
