/**
 * SkeletonProjectCard - Project card skeleton
 *
 * Skeleton for project grid cards (square image + content)
 *
 * @example
 * h(SkeletonProjectCard)
 */

import { h, Component } from '@monygroupcorp/microact';
import { Skeleton } from './Skeleton.js';
import { SkeletonText } from './SkeletonText.js';

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

export default SkeletonProjectCard;
