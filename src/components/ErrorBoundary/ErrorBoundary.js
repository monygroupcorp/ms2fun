import { Component } from '../../core/Component.js';

/**
 * ErrorBoundary - Catches errors in child components and displays fallback UI
 * 
 * Usage:
 *   const boundary = new ErrorBoundary();
 *   boundary.mount(container);
 *   boundary.wrap(childComponent);
 */
export class ErrorBoundary extends Component {
    constructor() {
        super();
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
        this._wrappedComponent = null;
        this._errorHandler = this._errorHandler.bind(this);
    }

    /**
     * Wrap a component with error boundary protection
     * @param {Component} component - Component to wrap
     * @param {HTMLElement} container - Container element for the component
     */
    wrap(component, container) {
        this._wrappedComponent = component;
        this._container = container || this.element;
        
        // Set up error handler
        if (component) {
            // Override component's error handling
            const originalOnError = component.onError;
            component.onError = (error, errorInfo) => {
                this._errorHandler(error, errorInfo);
                if (originalOnError) {
                    originalOnError.call(component, error, errorInfo);
                }
            };
        }
        
        // Mount the wrapped component
        if (component && this._container) {
            try {
                component.mount(this._container);
            } catch (error) {
                this._errorHandler(error, { component: 'mount' });
            }
        }
    }

    /**
     * Handle errors from child components
     * @private
     */
    _errorHandler(error, errorInfo = {}) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
        
        this.setState({
            hasError: true,
            error: error,
            errorInfo: errorInfo
        });
        
        // Log to console with full details
        if (error.stack) {
            console.error('[ErrorBoundary] Error stack:', error.stack);
        }
        
        // Optionally send to error tracking service
        if (window.errorTrackingService) {
            window.errorTrackingService.logError(error, {
                component: errorInfo.component || 'unknown',
                errorInfo: errorInfo
            });
        }
    }

    /**
     * Retry rendering after error
     */
    retry() {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });
        
        // Try to re-mount the wrapped component
        if (this._wrappedComponent && this._container) {
            try {
                // Unmount first if needed
                if (this._wrappedComponent.mounted) {
                    this._wrappedComponent.unmount();
                }
                this._wrappedComponent.mount(this._container);
            } catch (error) {
                this._errorHandler(error, { component: 'retry' });
            }
        }
    }

    render() {
        if (this.state.hasError) {
            const isDev = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1' ||
                         window.location.search.includes('debug=true');
            
            return `
                <div class="error-boundary">
                    <div class="error-boundary-content">
                        <h2>Something went wrong</h2>
                        <p>An error occurred while rendering this component.</p>
                        ${isDev ? `
                            <div class="error-details">
                                <h3>Error Details (Dev Mode)</h3>
                                <pre class="error-message">${this.state.error?.message || 'Unknown error'}</pre>
                                ${this.state.error?.stack ? `
                                    <details>
                                        <summary>Stack Trace</summary>
                                        <pre class="error-stack">${this.state.error.stack}</pre>
                                    </details>
                                ` : ''}
                                ${this.state.errorInfo ? `
                                    <details>
                                        <summary>Error Info</summary>
                                        <pre class="error-info">${JSON.stringify(this.state.errorInfo, null, 2)}</pre>
                                    </details>
                                ` : ''}
                            </div>
                        ` : ''}
                        <button class="error-retry-button" data-action="retry">Try Again</button>
                    </div>
                </div>
            `;
        }
        
        // Render children normally when no error
        return this.element ? this.element.innerHTML : '';
    }

    events() {
        return {
            'click .error-retry-button': () => this.retry()
        };
    }

    static get styles() {
        return `
            .error-boundary {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 200px;
                padding: 20px;
                background-color: #1a1a1a;
                border: 1px solid #ff4444;
                border-radius: 8px;
                color: #ffffff;
            }

            .error-boundary-content {
                text-align: center;
                max-width: 600px;
            }

            .error-boundary h2 {
                color: #ff4444;
                margin-bottom: 10px;
            }

            .error-boundary p {
                margin-bottom: 20px;
                color: #cccccc;
            }

            .error-details {
                text-align: left;
                margin: 20px 0;
                padding: 15px;
                background-color: #2a2a2a;
                border-radius: 4px;
                border: 1px solid #444;
            }

            .error-details h3 {
                color: #ff6666;
                margin-bottom: 10px;
                font-size: 14px;
            }

            .error-message,
            .error-stack,
            .error-info {
                background-color: #1a1a1a;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                font-size: 12px;
                line-height: 1.4;
                color: #ffaaaa;
                white-space: pre-wrap;
                word-wrap: break-word;
            }

            .error-retry-button {
                padding: 10px 20px;
                background-color: #ff4444;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                font-weight: bold;
                transition: background-color 0.2s;
            }

            .error-retry-button:hover {
                background-color: #ff6666;
            }

            .error-retry-button:active {
                background-color: #cc0000;
            }

            details {
                margin-top: 10px;
            }

            details summary {
                cursor: pointer;
                color: #ff8888;
                margin-bottom: 5px;
            }

            details summary:hover {
                color: #ffaaaa;
            }
        `;
    }
}

