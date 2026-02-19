/**
 * SkeletonCard - Card skeleton with avatar and text lines
 *
 * Full card skeleton for content loading states
 *
 * @example
 * h(SkeletonCard)
 * h(SkeletonCard, { lines: 5 })
 * h(SkeletonCard, { showAvatar: false })
 */

import { h, Component } from '@monygroupcorp/microact';
import { Skeleton } from './Skeleton.js';
import { SkeletonText } from './SkeletonText.js';

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

export default SkeletonCard;
