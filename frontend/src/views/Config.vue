<template>
  <div class="config">
    <h1>Config</h1>
    <v-alert text type="info">
      These settings are only applied to the current environment and never be saved in the repository.
    </v-alert>
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
  currentEditorTheme = localStorage.getItem('editor-theme') || 'default';
  currentEditorKeybinding = localStorage.getItem('editor-keybinding') || 'default';
  currentPrismTheme = localStorage.getItem('prism-theme') || null;

  mounted() {
    document.title = `Config | ${process.env.VUE_APP_NAME}`;
  }

  updateEditorTheme(newEditorTheme: string) {
    localStorage.setItem('editor-theme', newEditorTheme);
  }

  updateEditorKeybinding(newEditorKeybinding: string) {
    localStorage.setItem('editor-keybinding', newEditorKeybinding);
  }

  updatePrismTheme(newPrismTheme: string) {
    localStorage.setItem('prism-theme', newPrismTheme);
  }
}
</script>

<style scoped lang="scss">
.config {
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
