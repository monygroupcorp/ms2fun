import { Component } from '../../Component.js';

export class Counter extends Component {
    constructor(props) {
        super(props);
        this.state = {
            count: 0
        };
    }

    render() {
        return `
            <div class="counter">
                <h2>Counter: ${this.state.count}</h2>
                <button class="increment">Increment</button>
                <button class="decrement">Decrement</button>
            </div>
        `;
    }

    events() {
        return {
            'click .increment': () => {
                this.setState({ count: this.state.count + 1 });
            },
            'click .decrement': () => {
                this.setState({ count: this.state.count - 1 });
            }
        };
    }

    onMount() {
        console.log('Counter mounted');
        // Subscribe to any events
        this.unsubscribe = eventBus.on('reset-counter', () => {
            this.setState({ count: 0 });
        });
    }

    onUnmount() {
        console.log('Counter unmounted');
        // Cleanup subscriptions
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }

    onUpdate(oldState) {
        console.log('Counter updated', {
            oldCount: oldState.count,
            newCount: this.state.count
        });
    }
} 