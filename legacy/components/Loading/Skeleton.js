/**
 * Skeleton - Base loading placeholder component
 *
 * Creates animated gradient loading effect
 *
 * @example
 * h(Skeleton, { width: '60%', height: '1.5em' })
 * h(Skeleton, { variant: 'text' })
 * h(Skeleton, { variant: 'square' })
 */

import { h, Component } from '@monygroupcorp/microact';

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

export default Skeleton;
