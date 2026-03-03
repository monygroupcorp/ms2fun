/**
 * Skeleton loading components
 * From: docs/examples/loading-states-demo.html
 */

import { h } from '@monygroupcorp/microact';

// Project card skeleton (matches demo NFT grid skeleton)
export const ProjectCardSkeleton = () =>
    h('div', { className: 'skeleton-card' },
        h('div', { className: 'skeleton skeleton-square' }),
        h('div', { style: 'padding: var(--space-3);' },
            h('div', { className: 'skeleton skeleton-text title' }),
            h('div', { className: 'skeleton skeleton-text short' }),
            h('div', { className: 'skeleton skeleton-text medium' }),
            h('div', { className: 'skeleton skeleton-text short' })
        )
    );

// Activity item skeleton
export const ActivityItemSkeleton = () =>
    h('div', { className: 'skeleton-card', style: 'padding: var(--space-2);' },
        h('div', { className: 'skeleton skeleton-text medium' })
    );

// Featured banner skeleton
export const FeaturedBannerSkeleton = () =>
    h('div', {
        className: 'skeleton-card',
        style: 'min-height: 400px; margin-top: var(--space-6); padding: 0; position: relative;'
    },
        h('div', { className: 'skeleton skeleton-square', style: 'height: 400px; margin: 0;' }),
        h('div', { style: 'position: absolute; bottom: 0; left: 0; right: 0; padding: var(--space-4);' },
            h('div', { className: 'skeleton skeleton-text short', style: 'width: 100px; margin-bottom: var(--space-2);' }),
            h('div', { className: 'skeleton skeleton-text title', style: 'width: 300px; margin-bottom: var(--space-2);' }),
            h('div', { className: 'skeleton skeleton-text short', style: 'width: 150px;' })
        )
    );
