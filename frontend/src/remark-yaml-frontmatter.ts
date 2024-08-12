import type { Root, Yaml } from 'mdast';
import type { VFile } from 'vfile';
import type { Plugin, Transformer } from 'unified';
import yaml from 'yaml';

/**
 * Parse YAML frontmatter, exposing the result via `file.data.matter` and any parse errors via `file.data.matterParseError`.
 *
 */
const myRemarkYamlFrontmatter: Plugin<[], Root, Root> = (): Transformer<Root, Root> => {
  return (tree: Root, file: VFile) => {
    const yamlNode: Yaml | undefined = tree.children.find((node) => node.type === 'yaml') as Yaml | undefined;

    if (yamlNode) {
      try {
        file.data.matter = yaml.parse(yamlNode.value);
        file.data.matterParseError = null;
      }
      catch (err) {
        file.data.matter = null;
        file.data.matterParseError = err;
      }
    }
    else {
      file.data.matter = null;
      file.data.matterParseError = null;
    }
  };
}

export default myRemarkYamlFrontmatter;
