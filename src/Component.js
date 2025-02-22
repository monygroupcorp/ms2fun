import { eventBus } from './eventBus.js';

export class Component {
    constructor(props = {}) {
        this.props = props;
        this.state = {};
        this.mounted = false;
        this.element = null;
        this.boundEvents = new Map();
    }

    /**
     * Initialize state with default values
     * @param {Object} initialState 
     */
    setState(newState) {
        const oldState = { ...this.state };
        this.state = { ...this.state, ...newState };
        
        if (this.mounted) {
            this.update(oldState);
        }
    }

    /**
     * Mount component to DOM
     * @param {HTMLElement} container 
     */
    mount(container) {
        if (this.mounted) return;

        // Create element from template
        const template = document.createElement('template');
        template.innerHTML = this.render().trim();
        this.element = template.content.firstElementChild;

        // Add to DOM
        container.appendChild(this.element);
        
        // Bind events
        this.bindEvents();
        
        // Call lifecycle method
        this.mounted = true;
        this.onMount();
    }

    /**
     * Remove component from DOM
     */
    unmount() {
        if (!this.mounted) return;

        // Unbind all events
        this.unbindEvents();
        
        // Remove element
        this.element.remove();
        this.element = null;
        
        // Call lifecycle method
        this.mounted = false;
        this.onUnmount();
    }

    /**
     * Bind DOM events based on this.events()
     */
    bindEvents() {
        const events = this.events();
        if (!events) return;

        for (const [eventSelector, handler] of Object.entries(events)) {
            const [eventName, selector] = eventSelector.split(' ');
            const boundHandler = handler.bind(this);
            
            if (selector) {
                // Delegated event
                const eventHandler = (e) => {
                    if (e.target.matches(selector)) {
                        boundHandler(e);
                    }
                };
                this.element.addEventListener(eventName, eventHandler);
                this.boundEvents.set(eventSelector, eventHandler);
            } else {
                // Direct event
                this.element.addEventListener(eventName, boundHandler);
                this.boundEvents.set(eventSelector, boundHandler);
            }
        }
    }

    /**
     * Unbind all DOM events
     */
    unbindEvents() {
        for (const [eventSelector, handler] of this.boundEvents.entries()) {
            const [eventName] = eventSelector.split(' ');
            this.element.removeEventListener(eventName, handler);
        }
        this.boundEvents.clear();
    }

    /**
     * Update component after state change
     * @param {Object} oldState 
     */
    update(oldState) {
        // Re-render
        const newHtml = this.render();
        const template = document.createElement('template');
        template.innerHTML = newHtml.trim();
        const newElement = template.content.firstElementChild;

        // Replace old element
        this.element.replaceWith(newElement);
        this.element = newElement;

        // Rebind events
        this.unbindEvents();
        this.bindEvents();

        // Call lifecycle method
        this.onUpdate(oldState);
    }

    // Lifecycle methods (to be overridden by child classes)
    onMount() {}
    onUnmount() {}
    onUpdate(oldState) {}

    // Methods to be implemented by child classes
    render() {
        throw new Error('Component must implement render()');
    }

    events() {
        return {};
    }
} 