/**
 * SPIKE: Skeleton Loading Components
 *
 * Reusable skeleton/loading components for Microact
 * Based on patterns from loading-states-demo.html
 */

import { h, Component } from '@monygroupcorp/microact';

/**
 * Base Skeleton Component
 * Creates animated gradient loading placeholder
 *
 * Usage:
 *   h(Skeleton, { width: '60%', height: '1.5em' })
 *   h(Skeleton, { variant: 'text' })
 *   h(Skeleton, { variant: 'square' })
 */
export class Skeleton extends Component {
    render() {
        const { variant, width, height, className = '' } = this.props;

        const baseClass = 'skeleton';
        const variantClass = variant ? `skeleton-${variant}` : '';
        const classes = `${baseClass} ${variantClass} ${className}`.trim();

        const style = {};
        if (width) style.width = width;
        if (height) style.height = height;

        return h('div', {
            className: classes,
            style: Object.keys(style).length > 0 ? style : undefined
        });
    }
}

/**
 * Skeleton Text Component
 * Shorthand for text skeleton lines
 *
 * Usage:
 *   h(SkeletonText, { variant: 'title' })  // 60% width, 1.5em height
 *   h(SkeletonText, { variant: 'short' })  // 40% width
 *   h(SkeletonText, { variant: 'medium' }) // 70% width
 *   h(SkeletonText, { variant: 'long' })   // 90% width
 */
export class SkeletonText extends Component {
    render() {
        const { variant = 'medium' } = this.props;
        return h(Skeleton, {
            className: `skeleton-text ${variant}`
        });
    }
}

/**
 * Skeleton Card Component
 * Full card skeleton with header (avatar + text) and body text
 *
 * Usage:
 *   h(SkeletonCard)
 *   h(SkeletonCard, { lines: 5 }) // Custom number of body lines
 */
export class SkeletonCard extends Component {
    render() {
        const { lines = 3, showAvatar = true } = this.props;

        return h('div', { className: 'skeleton-card' },
            // Header with avatar + text
            h('div', { className: 'skeleton-card-header' },
                showAvatar && h(Skeleton, { className: 'skeleton-avatar' }),
                h('div', { style: { flex: '1' } },
                    h(SkeletonText, { variant: 'title' }),
                    h(SkeletonText, { variant: 'short' })
                )
            ),

            // Body lines
            ...Array.from({ length: lines }, (_, i) => {
                const variants = ['long', 'medium', 'short'];
                const variant = variants[i % variants.length];
                return h(SkeletonText, { key: i, variant });
            })
        );
    }
}

/**
 * Skeleton Project Card
 * Skeleton for project grid cards (square image + content)
 *
 * Usage:
 *   h(SkeletonProjectCard)
 */
export class SkeletonProjectCard extends Component {
    render() {
        return h('div', { className: 'skeleton-card' },
            h(Skeleton, { className: 'skeleton-square' }),
            h('div', { style: { padding: 'var(--space-3)' } },
                h(SkeletonText, { variant: 'title' }),
                h(SkeletonText, { variant: 'short' })
            )
        );
    }
}

/**
 * Skeleton Table Row
 * Grid-based skeleton for table rows
 *
 * Usage:
 *   h(SkeletonTableRow, { columns: 4 })
 *   h(SkeletonTableRow, { columns: ['2fr', '1fr', '1fr', '1fr'] })
 */
export class SkeletonTableRow extends Component {
    render() {
        const { columns = 4 } = this.props;

        const gridColumns = Array.isArray(columns)
            ? columns.join(' ')
            : `repeat(${columns}, 1fr)`;

        return h('div', {
            className: 'skeleton-table-row',
            style: { gridTemplateColumns: gridColumns }
        },
            ...Array.from({ length: Array.isArray(columns) ? columns.length : columns }, (_, i) =>
                h(SkeletonText, { key: i })
            )
        );
    }
}

/**
 * Spinner Component
 * Rotating circle loader
 *
 * Usage:
 *   h(Spinner)
 *   h(Spinner, { size: 'large' })
 *   h(Spinner, { size: 'small' })
 *   h(Spinner, { text: 'Loading...' })
 */
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

/**
 * Dots Loader Component
 * Three pulsing dots
 *
 * Usage:
 *   h(DotsLoader)
 *   h(DotsLoader, { text: 'Loading' })
 */
export class DotsLoader extends Component {
    render() {
        const { text } = this.props;

        return h('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: text ? 'var(--space-3)' : undefined
            }
        },
            h('div', { className: 'dots-loader' },
                h('div', { className: 'dot' }),
                h('div', { className: 'dot' }),
                h('div', { className: 'dot' })
            ),
            text && h('div', { className: 'dots-loader-text' }, text)
        );
    }
}

/**
 * Progress Bar Component
 * Determinate or indeterminate progress bar
 *
 * Usage:
 *   h(ProgressBar, { value: 67, label: 'Uploading', max: 100 })
 *   h(ProgressBar, { indeterminate: true, label: 'Fetching' })
 */
export class ProgressBar extends Component {
    render() {
        const {
            value = 0,
            max = 100,
            label,
            indeterminate = false,
            showPercentage = true
        } = this.props;

        const percentage = indeterminate ? 0 : Math.round((value / max) * 100);

        return h('div', { className: 'progress-bar-wrapper' },
            (label || showPercentage) && h('div', { className: 'progress-label' },
                label && h('span', null, label),
                showPercentage && !indeterminate && h('span', null, `${percentage}%`)
            ),
            h('div', { className: 'progress-bar' },
                h('div', {
                    className: `progress-bar-fill${indeterminate ? ' indeterminate' : ''}`,
                    style: indeterminate ? undefined : { width: `${percentage}%` }
                })
            )
        );
    }
}

/**
 * Loading Message Component
 * Message box with spinner/dots and text
 *
 * Usage:
 *   h(LoadingMessage, {
 *     title: 'Connecting Wallet',
 *     message: 'Please approve the connection request',
 *     loader: 'spinner'
 *   })
 */
export class LoadingMessage extends Component {
    render() {
        const {
            title,
            message,
            loader = 'spinner' // 'spinner' | 'dots' | 'progress'
        } = this.props;

        return h('div', { className: 'loading-message' },
            loader === 'spinner' && h(Spinner, { style: { margin: '0 auto var(--space-3)' } }),
            loader === 'dots' && h(DotsLoader, {
                style: {
                    margin: '0 auto var(--space-3)',
                    justifyContent: 'center'
                }
            }),
            title && h('div', { className: 'loading-message-title' }, title),
            message && h('div', { className: 'loading-message-text' }, message)
        );
    }
}

/**
 * Pulse Component
 * Wrapper that applies pulse animation
 *
 * Usage:
 *   h(Pulse, null, h('div', null, 'Live updating'))
 */
export class Pulse extends Component {
    render() {
        return h('div', { className: 'pulse' }, this.props.children);
    }
}

// ==============================================================================
// EXAMPLE USAGE IN A ROUTE COMPONENT
// ==============================================================================

/**
 * Example: Project List Route with Loading States
 */
export class ProjectListRoute extends Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            projects: []
        };
    }

    didMount() {
        // Simulate data fetch
        setTimeout(() => {
            this.setState({
                loading: false,
                projects: [
                    { id: 1, name: 'Project Alpha', type: 'ERC404' },
                    { id: 2, name: 'Project Beta', type: 'ERC1155' }
                ]
            });
        }, 2000);
    }

    renderLoading() {
        return h('div', { className: 'projects-grid' },
            h(SkeletonProjectCard),
            h(SkeletonProjectCard),
            h(SkeletonProjectCard),
            h(SkeletonProjectCard)
        );
    }

    renderProjects() {
        return h('div', { className: 'projects-grid' },
            this.state.projects.map(project =>
                h('div', { key: project.id, className: 'project-card' },
                    h('div', { className: 'project-card-image' }, project.name[0]),
                    h('div', { className: 'project-card-content' },
                        h('h4', { className: 'project-card-title' }, project.name),
                        h('span', { className: 'badge' }, project.type)
                    )
                )
            )
        );
    }

    render() {
        return h('div', null,
            h('h1', null, 'Projects'),
            this.state.loading ? this.renderLoading() : this.renderProjects()
        );
    }
}

/**
 * SUMMARY OF SKELETON COMPONENTS:
 *
 * 1. Skeleton - Base component with gradient animation
 * 2. SkeletonText - Text line skeletons (title, short, medium, long)
 * 3. SkeletonCard - Card with avatar + text lines
 * 4. SkeletonProjectCard - Project card with square image + text
 * 5. SkeletonTableRow - Grid-based table row
 * 6. Spinner - Rotating circle loader
 * 7. DotsLoader - Three pulsing dots
 * 8. ProgressBar - Determinate/indeterminate progress
 * 9. LoadingMessage - Message box with loader + text
 * 10. Pulse - Pulse animation wrapper
 *
 * NEXT STEPS:
 * - Move these to src/components/Loading/
 * - Test in actual routes
 * - Extract CSS to src/core/components-v2.css (already exists!)
 * - Document usage patterns
 */
