import type { Root, Yaml } from 'mdast';
import type { VFile } from 'vfile';
import type { Plugin, Transformer } from 'unified';
import yaml from 'yaml';
import * as TOML from '@iarna/toml';

// Define Toml interface since it may not be exported from mdast
interface Toml {
  type: 'toml';
  value: string;
  position?: any;
}

/**
 * Parse frontmatter (YAML or TOML), exposing the result via `file.data.matter` and any parse errors via `file.data.matterParseError`.
 */
const myRemarkFrontmatterParser: Plugin<[], Root, Root> = (): Transformer<Root, Root> => {
  return (tree: Root, file: VFile) => {
    const frontmatterNode: Yaml | Toml | undefined = tree.children.find((node) => 
      node.type === 'yaml' || node.type === 'toml'
    ) as Yaml | Toml | undefined;

    if (frontmatterNode) {
      try {
        if (frontmatterNode.type === 'yaml') {
          file.data.matter = yaml.parse((frontmatterNode as Yaml).value);
        } else if (frontmatterNode.type === 'toml') {
          file.data.matter = TOML.parse((frontmatterNode as Toml).value);
        }
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

export default myRemarkFrontmatterParser;