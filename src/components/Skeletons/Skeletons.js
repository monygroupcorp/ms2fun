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

// Generic project page skeleton (used before contract type is known)
export const ProjectPageSkeleton = () =>
    h('div', { className: 'project-detail content' },
        // Header placeholder
        h('div', { style: 'padding: var(--space-6) 0;' },
            h('div', { className: 'skeleton skeleton-text short', style: 'width: 80px; margin-bottom: var(--space-2);' }),
            h('div', { className: 'skeleton skeleton-text title', style: 'width: 50%; margin-bottom: var(--space-3);' }),
            h('div', { className: 'skeleton skeleton-text medium', style: 'width: 70%;' })
        ),
        // Stats row
        h('div', { style: 'display: flex; gap: var(--space-6); padding: var(--space-4) 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); margin-bottom: var(--space-6);' },
            h('div', { className: 'skeleton skeleton-box', style: 'width: 80px; height: 40px;' }),
            h('div', { className: 'skeleton skeleton-box', style: 'width: 80px; height: 40px;' }),
            h('div', { className: 'skeleton skeleton-box', style: 'width: 80px; height: 40px;' })
        ),
        // Content area
        h('div', { style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-4);' },
            ProjectCardSkeleton(),
            ProjectCardSkeleton(),
            ProjectCardSkeleton(),
            ProjectCardSkeleton()
        )
    );

// Edition card skeleton (matches EditionCard layout)
export const EditionCardSkeleton = () =>
    h('div', { className: 'skeleton-card' },
        h('div', { className: 'skeleton skeleton-square' }),
        h('div', { style: 'padding: var(--space-3);' },
            h('div', { className: 'skeleton skeleton-text title' }),
            h('div', { className: 'skeleton skeleton-text short' }),
            h('div', { className: 'skeleton skeleton-text medium' }),
            h('div', { className: 'skeleton skeleton-text short' })
        )
    );

// ERC1155 project page skeleton (header + stats + edition grid)
export const ERC1155PageSkeleton = () =>
    h('div', { className: 'erc1155-project-page' },
        // Header
        h('header', { className: 'project-header' },
            h('div', { className: 'skeleton skeleton-text short', style: 'width: 120px; margin-bottom: var(--space-2);' }),
            h('div', { className: 'skeleton skeleton-text title', style: 'width: 60%; margin-bottom: var(--space-3);' }),
            h('div', { className: 'skeleton skeleton-text medium', style: 'width: 80%;' }),
            h('div', { className: 'skeleton skeleton-text medium', style: 'width: 50%; margin-top: var(--space-2);' })
        ),
        // Stats bar
        h('div', { className: 'stats-bar' },
            h('div', { className: 'stat' },
                h('div', { className: 'skeleton skeleton-text title', style: 'width: 40px;' }),
                h('div', { className: 'skeleton skeleton-text short', style: 'width: 60px; margin-top: var(--space-1);' })
            ),
            h('div', { className: 'stat' },
                h('div', { className: 'skeleton skeleton-text title', style: 'width: 40px;' }),
                h('div', { className: 'skeleton skeleton-text short', style: 'width: 80px; margin-top: var(--space-1);' })
            ),
            h('div', { className: 'stat' },
                h('div', { className: 'skeleton skeleton-text title', style: 'width: 60px;' }),
                h('div', { className: 'skeleton skeleton-text short', style: 'width: 80px; margin-top: var(--space-1);' })
            )
        ),
        // Tabs placeholder
        h('div', { className: 'tabs' },
            h('div', { className: 'skeleton skeleton-text short', style: 'width: 60px; height: 32px;' }),
            h('div', { className: 'skeleton skeleton-text short', style: 'width: 60px; height: 32px;' }),
            h('div', { className: 'skeleton skeleton-text short', style: 'width: 60px; height: 32px;' })
        ),
        // Edition grid
        h('div', { className: 'edition-gallery' },
            h('div', { className: 'gallery-grid' },
                EditionCardSkeleton(),
                EditionCardSkeleton(),
                EditionCardSkeleton(),
                EditionCardSkeleton()
            )
        )
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
