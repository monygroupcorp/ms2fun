/**
 * SkeletonText - Text line skeleton component
 *
 * Shorthand for common text skeleton patterns
 *
 * @example
 * h(SkeletonText, { variant: 'title' })  // 60% width, 1.5em height
 * h(SkeletonText, { variant: 'short' })  // 40% width
 * h(SkeletonText, { variant: 'medium' }) // 70% width
 * h(SkeletonText, { variant: 'long' })   // 90% width
 */

import { h, Component } from '@monygroupcorp/microact';
import { Skeleton } from './Skeleton.js';

export class SkeletonText extends Component {
    render() {
        const { variant = 'medium' } = this.props;
        return h(Skeleton, {
            className: `skeleton-text ${variant}`
        });
    }
}

export default SkeletonText;
