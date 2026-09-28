// Scroll sync between the editor and the viewer works through anchors: points
// where a position in the source and a position in the rendered note are known
// to meet. Between two anchors, both are interpolated linearly.

export interface ScrollAnchor {
    // 1-based source line, possibly fractional.
    line: number;
    // Pixels from the top of the rendered content.
    offset: number;
}

// Order the anchors by line and drop those that would make the offset go back
// up, so that each direction is a function of the other.
export function buildScrollMap(anchors: ScrollAnchor[]): ScrollAnchor[] {
    const map = [...anchors].sort((a, b) => a.line - b.line);
    let i = 0;
    while (i < map.length - 1) {
        if (map[i].offset > map[i + 1].offset) {
            map.splice(i + 1, 1);
        }
        else {
            ++i;
        }
    }
    return map;
}

// Interpolate `to` at `x` along `from`, or `null` outside the anchors. Where
// anchors share `x`, the last of them is the one that counts.
function interpolate(map: ScrollAnchor[], x: number, from: keyof ScrollAnchor, to: keyof ScrollAnchor): number | null {
    for (let i = 0; i < map.length - 1; ++i) {
        const a = map[i];
        const b = map[i + 1];
        if (a[from] <= x && x < b[from]) {
            return a[to] + (b[to] - a[to]) * (x - a[from]) / (b[from] - a[from]);
        }
    }
    return null;
}

export function offsetAtLine(map: ScrollAnchor[], line: number): number | null {
    return interpolate(map, line, 'line', 'offset');
}

export function lineAtOffset(map: ScrollAnchor[], offset: number): number | null {
    return interpolate(map, offset, 'offset', 'line');
}
