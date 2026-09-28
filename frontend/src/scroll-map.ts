// Scroll sync between the editor and the viewer works through anchors: points
// where a position in the source and a position in the rendered note are known
// to meet. Between two anchors, both are interpolated linearly.

export interface ScrollAnchor {
    // 1-based source line, possibly fractional.
    line: number;
    // Pixels from the top of the rendered content.
    offset: number;
}

// Order the anchors by line and keep the most that also run down the note in
// order, so that each direction is a function of the other.
//
// Most elements are drawn in the order of their lines, but not all: a footnote
// is drawn at the end of the note, and its line is wherever it was defined.
// Dropping each anchor that comes back up from the one before it would keep the
// footnote and drop everything after its definition instead, so keep the
// longest run whose offsets never decrease.
export function buildScrollMap(anchors: ScrollAnchor[]): ScrollAnchor[] {
    const sorted = [...anchors].sort((a, b) => a.line - b.line || a.offset - b.offset);

    // `tails[k]` is the anchor that ends the lowest-reaching run of `k + 1`
    // anchors found so far, and `previous` links each anchor to the one before
    // it in its run.
    const tails: number[] = [];
    const previous: number[] = [];
    for (let i = 0; i < sorted.length; ++i) {
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (sorted[tails[middle]].offset <= sorted[i].offset) {
                low = middle + 1;
            }
            else {
                high = middle;
            }
        }
        previous[i] = low > 0 ? tails[low - 1] : -1;
        tails[low] = i;
    }

    const map: ScrollAnchor[] = [];
    for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) {
        map.push(sorted[i]);
    }
    return map.reverse();
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
