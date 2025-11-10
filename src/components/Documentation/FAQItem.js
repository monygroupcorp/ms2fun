import { Component } from '../../core/Component.js';

/**
 * FAQItem component - Individual FAQ question/answer item
 */
export class FAQItem extends Component {
    constructor(faq) {
        super();
        this.faq = faq;
        this.state = {
            expanded: false
        };
    }

    render() {
        const { question, answer } = this.faq;
        const expanded = this.state.expanded;
        
        return `
            <div class="faq-item ${expanded ? 'expanded' : ''}" data-faq-id="${this.faq.id}">
                <button class="faq-question" data-ref="faq-toggle">
                    <span class="faq-question-text">${this.escapeHtml(question)}</span>
                    <span class="faq-icon">${expanded ? '−' : '+'}</span>
                </button>
                <div class="faq-answer-wrapper">
                    <div class="faq-answer">
                        ${this.sanitizeHTML(answer)}
                    </div>
                </div>
            </div>
        `;
    }

    events() {
        return {
            'click .faq-question': (e) => {
                e.preventDefault();
                this.setState({ expanded: !this.state.expanded });
            }
        };
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    sanitizeHTML(html) {
        if (!html) return '';
        // Basic HTML sanitization - allow common tags
        const allowedTags = ['p', 'strong', 'em', 'u', 'br', 'a', 'ul', 'ol', 'li'];
        const div = document.createElement('div');
        div.innerHTML = html;
        
        // Remove script tags and other dangerous elements
        const scripts = div.querySelectorAll('script, iframe, object, embed');
        scripts.forEach(el => el.remove());
        
        return div.innerHTML;
    }
}

