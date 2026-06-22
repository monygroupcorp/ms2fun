import { Component } from '../../core/Component.js';
import { FAQItem } from './FAQItem.js';

/**
 * FAQ component - Displays list of FAQ items
 */
export class FAQ extends Component {
    constructor(faqs) {
        super();
        this.faqs = faqs;
    }

    render() {
        return `
            <div class="faq-section">
                <h2 class="section-title">Frequently Asked Questions</h2>
                <div class="faq-list" data-ref="faq-list">
                    <!-- FAQ items will be mounted here -->
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setTimeout(() => {
            this.setupFAQItems();
        }, 0);
    }

    setupFAQItems() {
        const faqList = this.getRef('faq-list', '.faq-list');
        if (!faqList) return;

        // Clear existing items
        faqList.innerHTML = '';

        // Mount each FAQ item
        this.faqs.forEach((faq, index) => {
            const faqItem = new FAQItem(faq);
            const itemContainer = document.createElement('div');
            faqList.appendChild(itemContainer);
            faqItem.mount(itemContainer);
            this.createChild(`faq-${index}`, faqItem);
        });
    }
}

