import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import type { Plugin, Transformer } from 'unified';

// Someone else's markup, as a subscribed calendar's descriptions are, sends no address of the page
// it is shown in. An image there loads by itself as the description opens, and with the browser's
// default policy it told whoever wrote it where this mory is; a link followed did the same. They
// still learn when an image was loaded, as an email's tell its sender.
const myRehypeNoReferrer: Plugin<[], Root, Root> = (): Transformer<Root, Root> => {
    return (tree: Root) => {
        visit(tree, 'element', (node: Element) => {
            if (node.tagName === 'img' || node.tagName === 'a') {
                node.properties = { ...node.properties, referrerPolicy: 'no-referrer' };
            }
        });
    };
};

export default myRehypeNoReferrer;
