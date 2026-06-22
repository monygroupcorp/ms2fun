/**
 * Address Avatar Generator
 *
 * Generates minimalist geometric SVG engravings from Ethereum addresses.
 * Creates unique monochromatic patterns that look like engraved plaques.
 */

/**
 * Generate a geometric engraving SVG from an Ethereum address
 * @param {string} address - Ethereum address (0x...)
 * @param {number} size - SVG size in pixels (default 36)
 * @returns {string} SVG markup string
 */
export function generateAddressAvatar(address, size = 36) {
    if (!address || typeof address !== 'string') {
        return generateFallbackAvatar(size);
    }

    // Normalize address (remove 0x, lowercase)
    const normalized = address.toLowerCase().replace('0x', '');

    if (normalized.length < 40) {
        return generateFallbackAvatar(size);
    }

    // Extract values from address bytes
    const values = [];
    for (let i = 0; i < 20; i++) {
        values.push(parseInt(normalized.substring(i * 2, i * 2 + 2), 16));
    }

    // Monochromatic engraving colors - gold tones for light, silver for dark
    // These will be overridden by CSS currentColor in dark mode
    const strokeColor = '#8b7a6b';      // Stone shadow - engraved line color
    const strokeLight = '#b8a082';      // Lighter stroke for depth

    // Generate geometric engraving pattern
    const pattern = generateEngravingPattern(values, size, strokeColor, strokeLight);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${pattern}</svg>`.replace(/\s+/g, ' ').trim();
}

/**
 * Generate geometric engraving pattern based on address values
 */
function generateEngravingPattern(values, size, stroke, strokeLight) {
    const elements = [];
    const center = size / 2;
    const padding = 4;
    const innerSize = size - (padding * 2);

    // Pattern type determined by first byte
    const patternType = values[0] % 6;

    // Stroke width varies slightly by address
    const strokeWidth = 1.2 + (values[1] % 3) * 0.2;

    switch (patternType) {
        case 0:
            // Concentric geometric - nested shapes
            elements.push(...generateConcentricPattern(values, center, innerSize, stroke, strokeWidth));
            break;

        case 1:
            // Radial lines - spoke pattern
            elements.push(...generateRadialPattern(values, center, innerSize, stroke, strokeWidth));
            break;

        case 2:
            // Grid/lattice pattern
            elements.push(...generateGridPattern(values, size, padding, stroke, strokeWidth));
            break;

        case 3:
            // Angular/chevron pattern
            elements.push(...generateChevronPattern(values, size, padding, stroke, strokeWidth));
            break;

        case 4:
            // Curved arcs
            elements.push(...generateArcPattern(values, center, innerSize, stroke, strokeWidth));
            break;

        case 5:
            // Abstract sigil/monogram
            elements.push(...generateSigilPattern(values, center, innerSize, stroke, strokeWidth));
            break;
    }

    return elements.join('');
}

/**
 * Concentric nested shapes
 */
function generateConcentricPattern(values, center, innerSize, stroke, strokeWidth) {
    const elements = [];
    const shapeType = values[2] % 3; // circle, square, diamond

    const radii = [
        innerSize * 0.4,
        innerSize * 0.25,
        innerSize * 0.12
    ];

    radii.forEach((r, i) => {
        if (i > 0 && values[3 + i] % 3 === 0) return; // Skip some layers

        if (shapeType === 0) {
            // Circles
            elements.push(`<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${0.9 - i * 0.15}"/>`);
        } else if (shapeType === 1) {
            // Squares
            const half = r * 0.85;
            elements.push(`<rect x="${center - half}" y="${center - half}" width="${half * 2}" height="${half * 2}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${0.9 - i * 0.15}"/>`);
        } else {
            // Diamonds
            const half = r;
            elements.push(`<polygon points="${center},${center - half} ${center + half},${center} ${center},${center + half} ${center - half},${center}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${0.9 - i * 0.15}"/>`);
        }
    });

    // Center dot
    if (values[6] % 2 === 0) {
        elements.push(`<circle cx="${center}" cy="${center}" r="${strokeWidth}" fill="${stroke}" opacity="0.8"/>`);
    }

    return elements;
}

/**
 * Radial spoke pattern
 */
function generateRadialPattern(values, center, innerSize, stroke, strokeWidth) {
    const elements = [];
    const numSpokes = 4 + (values[2] % 5); // 4-8 spokes
    const innerRadius = innerSize * 0.1;
    const outerRadius = innerSize * 0.42;

    for (let i = 0; i < numSpokes; i++) {
        const angle = (i / numSpokes) * Math.PI * 2 - Math.PI / 2;
        const skip = values[3 + (i % 10)] % 4 === 0;

        if (!skip) {
            const x1 = center + Math.cos(angle) * innerRadius;
            const y1 = center + Math.sin(angle) * innerRadius;
            const x2 = center + Math.cos(angle) * outerRadius;
            const y2 = center + Math.sin(angle) * outerRadius;

            elements.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.85"/>`);
        }
    }

    // Center circle
    elements.push(`<circle cx="${center}" cy="${center}" r="${innerRadius}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="0.9"/>`);

    return elements;
}

/**
 * Grid/lattice pattern
 */
function generateGridPattern(values, size, padding, stroke, strokeWidth) {
    const elements = [];
    const gridSize = 3 + (values[2] % 2); // 3x3 or 4x4
    const cellSize = (size - padding * 2) / gridSize;
    const offset = padding;

    // Horizontal lines
    for (let i = 0; i <= gridSize; i++) {
        if (values[3 + i] % 3 !== 0) { // Skip some lines
            const y = offset + i * cellSize;
            elements.push(`<line x1="${offset}" y1="${y}" x2="${size - offset}" y2="${y}" stroke="${stroke}" stroke-width="${strokeWidth * 0.8}" opacity="0.7"/>`);
        }
    }

    // Vertical lines
    for (let i = 0; i <= gridSize; i++) {
        if (values[8 + i] % 3 !== 0) {
            const x = offset + i * cellSize;
            elements.push(`<line x1="${x}" y1="${offset}" x2="${x}" y2="${size - offset}" stroke="${stroke}" stroke-width="${strokeWidth * 0.8}" opacity="0.7"/>`);
        }
    }

    // Accent dots at intersections
    const dotCount = values[15] % 4 + 1;
    for (let i = 0; i < dotCount; i++) {
        const gx = values[16 + i] % gridSize;
        const gy = values[17 + i] % gridSize;
        const x = offset + gx * cellSize + cellSize / 2;
        const y = offset + gy * cellSize + cellSize / 2;
        elements.push(`<circle cx="${x}" cy="${y}" r="${strokeWidth}" fill="${stroke}" opacity="0.9"/>`);
    }

    return elements;
}

/**
 * Chevron/angular pattern
 */
function generateChevronPattern(values, size, padding, stroke, strokeWidth) {
    const elements = [];
    const center = size / 2;
    const numChevrons = 2 + (values[2] % 3);
    const direction = values[3] % 2 === 0 ? 1 : -1; // Up or down

    for (let i = 0; i < numChevrons; i++) {
        const offset = 4 + i * 6;
        const width = (size - padding * 2) * (0.8 - i * 0.15);
        const y = center + (direction * (i * 5 - 5));

        const x1 = center - width / 2;
        const x2 = center;
        const x3 = center + width / 2;
        const yPeak = y - direction * 4;

        if (values[4 + i] % 3 !== 0) {
            elements.push(`<polyline points="${x1},${y} ${x2},${yPeak} ${x3},${y}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${0.9 - i * 0.15}"/>`);
        }
    }

    // Accent line
    if (values[10] % 2 === 0) {
        elements.push(`<line x1="${padding + 4}" y1="${center}" x2="${size - padding - 4}" y2="${center}" stroke="${stroke}" stroke-width="${strokeWidth * 0.6}" opacity="0.5"/>`);
    }

    return elements;
}

/**
 * Curved arc pattern
 */
function generateArcPattern(values, center, innerSize, stroke, strokeWidth) {
    const elements = [];
    const numArcs = 2 + (values[2] % 3);
    const radius = innerSize * 0.35;

    for (let i = 0; i < numArcs; i++) {
        const startAngle = (values[3 + i] / 255) * Math.PI * 2;
        const arcLength = (0.3 + (values[6 + i] / 255) * 0.5) * Math.PI;
        const endAngle = startAngle + arcLength;

        const x1 = center + Math.cos(startAngle) * radius;
        const y1 = center + Math.sin(startAngle) * radius;
        const x2 = center + Math.cos(endAngle) * radius;
        const y2 = center + Math.sin(endAngle) * radius;

        const largeArc = arcLength > Math.PI ? 1 : 0;

        elements.push(`<path d="M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="${0.9 - i * 0.1}"/>`);
    }

    // Center accent
    if (values[12] % 2 === 0) {
        elements.push(`<circle cx="${center}" cy="${center}" r="${strokeWidth * 1.5}" fill="${stroke}" opacity="0.8"/>`);
    }

    return elements;
}

/**
 * Abstract sigil/monogram pattern
 */
function generateSigilPattern(values, center, innerSize, stroke, strokeWidth) {
    const elements = [];
    const scale = innerSize * 0.4;

    // Generate 2-4 connected line segments
    const numSegments = 2 + (values[2] % 3);
    const points = [];

    // Start point
    points.push({
        x: center + ((values[3] / 255) - 0.5) * scale,
        y: center + ((values[4] / 255) - 0.5) * scale
    });

    // Generate path points
    for (let i = 0; i < numSegments; i++) {
        points.push({
            x: center + ((values[5 + i * 2] / 255) - 0.5) * scale,
            y: center + ((values[6 + i * 2] / 255) - 0.5) * scale
        });
    }

    // Draw connected path
    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x} ${points[i].y}`;
    }

    elements.push(`<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`);

    // Add accent marks at endpoints
    elements.push(`<circle cx="${points[0].x}" cy="${points[0].y}" r="${strokeWidth}" fill="${stroke}" opacity="0.8"/>`);
    elements.push(`<circle cx="${points[points.length - 1].x}" cy="${points[points.length - 1].y}" r="${strokeWidth}" fill="${stroke}" opacity="0.8"/>`);

    return elements;
}

/**
 * Generate a fallback avatar for invalid addresses
 */
function generateFallbackAvatar(size) {
    const center = size / 2;
    const stroke = '#8b7a6b';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${center}" cy="${center}" r="${size * 0.3}" fill="none" stroke="${stroke}" stroke-width="1.5" opacity="0.5"/></svg>`.replace(/\s+/g, ' ').trim();
}

export default generateAddressAvatar;
