import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import type { Plugin, Transformer } from 'unified';

// Elements the viewer's scroll sync can anchor source lines to: a block starts
// its first line at its own top and ends its last at its own bottom. Inline
// elements are left out because they start and end part-way along a line,
// usually on other rows of their paragraph than the ones the line starts and
// ends on, and the viewer, finding several elements on one line, would place
// the line at the last of them.
const BLOCK_ELEMENTS = new Set([
    'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt',
    'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
    'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot',
    'thead', 'tr', 'ul',
]);

const myRehypeEmbedLineNumbers: Plugin<[], Root, Root> = (): Transformer<Root, Root> => {
    return (tree: Root) => {
        visit(tree, 'element', (node: Element) => {
            if (BLOCK_ELEMENTS.has(node.tagName) && node.position && node.position.start) {
                const lineNumber = node.position.start.line;
                if (!node.properties) {
                    node.properties = {};
                }
                node.properties['data-line'] = lineNumber;
                // The line after the element's last, so that the element spans
                // [data-line, data-line-end). An end at the start of a line
                // means the element ended with the line before it.
                const end = node.position.end;
                node.properties['data-line-end'] = end.column === 1 ? end.line : end.line + 1;
            }
        });
    };
};

export default myRehypeEmbedLineNumbers;
