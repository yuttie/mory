import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import type { Plugin, Transformer } from "unified";

const myRehypeLazyLoadImages: Plugin<[], Root, Root> = (): Transformer<Root, Root> => {
    return (tree: Root) => {
        visit(tree, "element", (node: Element) => {
            if (node.tagName === "img") {
                if (!node.properties) {
                    node.properties = {};
                }
                node.properties["loading"] = "lazy";
            }
        });
    };
};

export default myRehypeLazyLoadImages;
