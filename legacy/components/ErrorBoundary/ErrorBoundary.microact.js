/**
 * ErrorBoundary - Microact Version
 *
 * Catches errors in child components and displays fallback UI.
 * Can wrap other components to provide error recovery.
 */

import { Component, h } from '../../core/microact-setup.js';

export class ErrorBoundary extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    /**
     * Catch an error and display fallback UI
     * @param {Error} error
     * @param {Object} errorInfo
     */
    catchError(error, errorInfo = {}) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);

        this.setState({
            hasError: true,
            error,
            errorInfo
        });

        if (error.stack) {
            console.error('[ErrorBoundary] Error stack:', error.stack);
        }

        // Optional error tracking
        if (window.errorTrackingService) {
            window.errorTrackingService.logError(error, {
                component: errorInfo.component || 'unknown',
                errorInfo
            });
        }
    }

    handleRetry() {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });

        const { onRetry } = this.props;
        if (onRetry) {
            try {
                onRetry();
            } catch (error) {
                this.catchError(error, { component: 'retry' });
            }
        }
    }

    isDevMode() {
        return window.location.hostname === 'localhost' ||
               window.location.hostname === '127.0.0.1' ||
               window.location.search.includes('debug=true');
    }

    render() {
        const { hasError, error, errorInfo } = this.state;
        const { children } = this.props;

        if (hasError) {
            const isDev = this.isDevMode();

            return h('div', { className: 'error-boundary' },
                h('div', { className: 'error-boundary-content' },
                    h('h2', null, 'Something went wrong'),
                    h('p', null, 'An error occurred while rendering this component.'),

                    isDev && h('div', { className: 'error-details' },
                        h('h3', null, 'Error Details (Dev Mode)'),
                        h('pre', { className: 'error-message' }, error?.message || 'Unknown error'),

                        error?.stack && h('details', null,
                            h('summary', null, 'Stack Trace'),
                            h('pre', { className: 'error-stack' }, error.stack)
                        ),

                        errorInfo && h('details', null,
                            h('summary', null, 'Error Info'),
                            h('pre', { className: 'error-info' }, JSON.stringify(errorInfo, null, 2))
                        )
                    ),

                    h('button', {
                        className: 'error-retry-button',
                        onClick: this.bind(this.handleRetry)
                    }, 'Try Again')
                )
            );
        }

        // Render children when no error
        if (children) {
            return children;
        }

        return h('div', { className: 'error-boundary-wrapper' });
    }
}

export default ErrorBoundary;
