import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import type { Plugin, Transformer } from 'unified';

const myRehypeEmbedLineNumbers: Plugin<[], Root, Root> = (): Transformer<Root, Root> => {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.position && node.position.start) {
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
