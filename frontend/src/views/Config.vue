<template>
  <div id="config">
    <h1>Config</h1>
    <v-btn
      v-on:click="loadDefault"
      class="mt-4 mb-2"
    >Load default</v-btn>
    <v-btn
      v-on:click="saveAsDefault"
      class="mt-2 mb-4"
    >Save as default</v-btn>
    <v-alert text type="info">
      The following settings are only applied to the current browser and never be saved in the repository unless saved as default.
    </v-alert>
    <v-checkbox
      v-model="currentUseSimpleEditor"
      v-on:change="updateUseSimpleEditor"
      label="Use Simple Editor"
    ></v-checkbox>
    <v-checkbox
      v-model="currentLockScroll"
      v-on:change="updateLockScroll"
      label="Lock Scroll by Default"
    ></v-checkbox>
    <v-text-field
      v-model="currentEditorFontFamily"
      v-on:change="updateEditorFontFamily"
      label="Editor Font Family"
    >
    </v-text-field>
    <v-slider
      v-model="currentEditorFontSize"
      v-on:change="updateEditorFontSize"
      label="Editor Font Size"
      min="1"
      max="100"
      thumb-label
    >
      <template v-slot:append>
        <v-text-field
          v-model="currentEditorFontSize"
          type="number"
          class="mt-0 pt-0"
          style="width: 4em"
          suffix="px"
          readonly
        ></v-text-field>
      </template>
    </v-slider>
    <v-select
      v-bind:items="editorThemes"
      v-bind:value="currentEditorTheme"
      v-on:change="updateEditorTheme"
      label="Editor Theme"
      item-text="name"
      item-value="value"
    >
    </v-select>
    <v-select
      v-bind:items="editorKeybindings"
      v-bind:value="currentEditorKeybinding"
      v-on:change="updateEditorKeybinding"
      label="Editor Keybinding"
      item-text="name"
      item-value="value"
    >
    </v-select>
    <v-select
      v-bind:items="prismThemes"
      v-bind:value="currentPrismTheme"
      v-on:change="updatePrismTheme"
      label="Code Block Syntax Highlight Theme"
      item-text="name"
      item-value="value"
    >
    </v-select>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';

import * as api from '@/api';
import YAML from 'yaml';

function loadConfigValue(key: string, default_: any): any {
  const value = localStorage.getItem(key);
  if (value === null) {
    return default_;
  }
  else {
    return JSON.parse(value);
  }
}

function saveConfigValue(key: string, value: any) {
  localStorage.setItem(key, JSON.stringify(value));
}

@Component
export default class Config extends Vue {
  editorThemes = [
    { name: 'Default',                 value: 'default'                },
    { name: 'Ambiance',                value: 'ambiance'                },
    { name: 'Chaos',                   value: 'chaos'                   },
    { name: 'Chrome',                  value: 'chrome'                  },
    { name: 'Clouds',                  value: 'clouds'                  },
    { name: 'Clouds Midnight',         value: 'clouds_midnight'         },
    { name: 'Cobalt',                  value: 'cobalt'                  },
    { name: 'Crimson Editor',          value: 'crimson_editor'          },
    { name: 'Dawn',                    value: 'dawn'                    },
    { name: 'Dracula',                 value: 'dracula'                 },
    { name: 'Dreamweaver',             value: 'dreamweaver'             },
    { name: 'Eclipse',                 value: 'eclipse'                 },
    { name: 'Github',                  value: 'github'                  },
    { name: 'Gob',                     value: 'gob'                     },
    { name: 'Gruvbox',                 value: 'gruvbox'                 },
    { name: 'Idle Fingers',            value: 'idle_fingers'            },
    { name: 'Iplastic',                value: 'iplastic'                },
    { name: 'Katzenmilch',             value: 'katzenmilch'             },
    { name: 'Kr Theme',                value: 'kr_theme'                },
    { name: 'Kuroir',                  value: 'kuroir'                  },
    { name: 'Merbivore',               value: 'merbivore'               },
    { name: 'Merbivore Soft',          value: 'merbivore_soft'          },
    { name: 'Mono Industrial',         value: 'mono_industrial'         },
    { name: 'Monokai',                 value: 'monokai'                 },
    { name: 'Nord Dark',               value: 'nord_dark'               },
    { name: 'Pastel on Dark',          value: 'pastel_on_dark'          },
    { name: 'Solarized Dark',          value: 'solarized_dark'          },
    { name: 'Solarized Light',         value: 'solarized_light'         },
    { name: 'Sqlserver',               value: 'sqlserver'               },
    { name: 'Terminal',                value: 'terminal'                },
    { name: 'Textmate',                value: 'textmate'                },
    { name: 'Tomorrow',                value: 'tomorrow'                },
    { name: 'Tomorrow Night',          value: 'tomorrow_night'          },
    { name: 'Tomorrow Night Blue',     value: 'tomorrow_night_blue'     },
    { name: 'Tomorrow Night Bright',   value: 'tomorrow_night_bright'   },
    { name: 'Tomorrow Night Eighties', value: 'tomorrow_night_eighties' },
    { name: 'Twilight',                value: 'twilight'                },
    { name: 'Vibrant Ink',             value: 'vibrant_ink'             },
    { name: 'Xcode',                   value: 'xcode'                   },
  ];
  editorKeybindings = [
    { name: 'Default',                                    value: 'default'      },
    { name: 'Emacs',                                      value: 'emacs'        },
    { name: 'Sublime',                                    value: 'sublime'      },
    { name: 'Vim',                                        value: 'vim'          },
    { name: 'Vim (with Emacs-like insert mode mappings)', value: 'vim-modified' },
    { name: 'VSCode',                                     value: 'vscode'       },
  ];
  prismThemes = [
    { name: '(None)',                           value: null,                              },
    { name: 'A11y Dark',                        value: 'a11y-dark'                        },
    { name: 'Atom Dark',                        value: 'atom-dark'                        },
    { name: 'Base16 Atelier Sulphurpool Light', value: 'base16-atelier-sulphurpool-light' },
    { name: 'Cb',                               value: 'cb'                               },
    { name: 'Coldark Cold',                     value: 'coldark-cold'                     },
    { name: 'Coldark Dark',                     value: 'coldark-dark'                     },
    { name: 'Coy without Shadows',              value: 'coy-without-shadows'              },
    { name: 'Darcula',                          value: 'darcula'                          },
    { name: 'Dracula',                          value: 'dracula'                          },
    { name: 'Duotone Dark',                     value: 'duotone-dark'                     },
    { name: 'Duotone Earth',                    value: 'duotone-earth'                    },
    { name: 'Duotone Forest',                   value: 'duotone-forest'                   },
    { name: 'Duotone Light',                    value: 'duotone-light'                    },
    { name: 'Duotone Sea',                      value: 'duotone-sea'                      },
    { name: 'Duotone Space',                    value: 'duotone-space'                    },
    { name: 'Ghcolors',                         value: 'ghcolors'                         },
    { name: 'Hopscotch',                        value: 'hopscotch'                        },
    { name: 'Material Dark',                    value: 'material-dark'                    },
    { name: 'Material Light',                   value: 'material-light'                   },
    { name: 'Material Oceanic',                 value: 'material-oceanic'                 },
    { name: 'Nord',                             value: 'nord'                             },
    { name: 'Pojoaque',                         value: 'pojoaque'                         },
    { name: 'Shades of Purple',                 value: 'shades-of-purple'                 },
    { name: 'Synthwave84',                      value: 'synthwave84'                      },
    { name: 'Vs',                               value: 'vs'                               },
    { name: 'Vsc Dark Plus',                    value: 'vsc-dark-plus'                    },
    { name: 'Xonokai',                          value: 'xonokai'                          },
  ];
  currentUseSimpleEditor = loadConfigValue('use-simple-editor', false);
  currentLockScroll = loadConfigValue('lock-scroll', false);
  currentEditorFontFamily = loadConfigValue('editor-font-family', 'Menlo, monospace');
  currentEditorFontSize = loadConfigValue('editor-font-size', 14);
  currentEditorTheme = loadConfigValue('editor-theme', 'default');
  currentEditorKeybinding = loadConfigValue('editor-keybinding', 'default');
  currentPrismTheme = loadConfigValue('prism-theme', null);

  mounted() {
    document.title = `Config | ${process.env.VUE_APP_NAME}`;
  }

  updateUseSimpleEditor(newUseSimpleEditor: boolean) {
    saveConfigValue('use-simple-editor', newUseSimpleEditor);
  }

  updateLockScroll(newLockScroll: boolean) {
    saveConfigValue('lock-scroll', newLockScroll);
  }

  updateEditorFontFamily(newEditorFontFamily: string) {
    saveConfigValue('editor-font-family', newEditorFontFamily);
  }

  updateEditorFontSize(newEditorFontSize: number) {
    saveConfigValue('editor-font-size', newEditorFontSize);
  }

  updateEditorTheme(newEditorTheme: string) {
    saveConfigValue('editor-theme', newEditorTheme);
  }

  updateEditorKeybinding(newEditorKeybinding: string) {
    saveConfigValue('editor-keybinding', newEditorKeybinding);
  }

  updatePrismTheme(newPrismTheme: string) {
    saveConfigValue('prism-theme', newPrismTheme);
  }

  async loadDefault() {
    const res = await api.getNote('.mory/default_config.yaml');
    const config = YAML.parse(res.data);
    this.currentUseSimpleEditor = config.useSimpleEditor;
    this.currentLockScroll = config.lockScroll;
    this.currentEditorFontFamily = config.editorFontFamily;
    this.currentEditorFontSize = config.editorFontSize;
    this.currentEditorTheme = config.editorTheme;
    this.currentEditorKeybinding = config.editorKeybinding;
    this.currentPrismTheme = config.prismTheme;
    // Save to local storage
    this.updateUseSimpleEditor(this.currentUseSimpleEditor);
    this.updateLockScroll(this.currentLockScroll);
    this.updateEditorFontFamily(this.currentEditorFontFamily);
    this.updateEditorFontSize(this.currentEditorFontSize);
    this.updateEditorTheme(this.currentEditorTheme);
    this.updateEditorKeybinding(this.currentEditorKeybinding);
    this.updatePrismTheme(this.currentPrismTheme);
  }

  saveAsDefault() {
    const config = {
      useSimpleEditor: this.currentUseSimpleEditor,
      lockScroll: this.currentLockScroll,
      editorFontFamily: this.currentEditorFontFamily,
      editorFontSize: this.currentEditorFontSize,
      editorTheme: this.currentEditorTheme,
      editorKeybinding: this.currentEditorKeybinding,
      prismTheme: this.currentPrismTheme,
    };
    api.addNote('.mory/default_config.yaml', YAML.stringify(config));
  }
}
</script>

<style scoped lang="scss">
#config {
  padding: 50px 1em;

  display: flex;
  flex-direction: column;
  align-items: center;

  & > * {
    width: 480px;
    max-width: 100%;
  }

  &::before, &::after {
    content: '';
    flex-grow: 1;
  }
}
</style>
