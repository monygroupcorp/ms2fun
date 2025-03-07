//import { eventBus } from './EventBus.js';

export class Component {
    constructor(rootElement) {
        this.element = rootElement;
        this.state = {};
        this.mounted = false;
        this.boundEvents = new Map();
    }

    /**
     * Initialize state with default values
     * @param {Object} initialState 
     */
    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.update();
    }

    /**
     * Mount component to DOM
     * @param {HTMLElement} container 
     */
    mount(element) {
        this.element = element;
        
        // Apply styles if they exist
        if (this.constructor.styles) {
            const styleElement = document.createElement('style');
            styleElement.textContent = this.constructor.styles;
            document.head.appendChild(styleElement);
            this.styleElement = styleElement;
        }

        this.update();
        if (this.onMount) {
            this.onMount();
        }
    }

    /**
     * Remove component from DOM
     */
    unmount() {
        if (!this.mounted) return;

        // Unbind all events
        this.unbindEvents();
        
        // Remove styles if they exist
        if (this.styleElement) {
            this.styleElement.remove();
        }
        
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
        // First unbind any existing events
        this.unbindEvents();
        
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
     */
    update() {
        if (!this.element) return;
        const newContent = this.render();
        this.element.innerHTML = newContent;
        
        // Re-attach event listeners after DOM update
        if (this.setupDOMEventListeners) {
            this.setupDOMEventListeners();
        }
    }

    // Lifecycle methods (to be overridden by child classes)
    onMount() {}
    onUnmount() {}
    onUpdate(oldState) {}

    // Methods to be implemented by child classes
    render() {
        return this.template ? this.template() : '';
    }

    events() {
        return {};
    }
} 