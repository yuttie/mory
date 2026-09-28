import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import type { Plugin, Transformer } from 'unified';

// Elements the viewer's scroll sync can anchor a source line to: a block starts
// its line at its own top. Inline elements are left out because they start
// part-way along a line, usually on a later row of their paragraph than the one
// the line starts on, and the viewer, finding several elements on one line,
// would place the line at the last of them.
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
            }
        });
    };
};

export default myRehypeEmbedLineNumbers;
