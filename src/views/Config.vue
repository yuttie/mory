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
      label="Use Simple Editor"
    ></v-checkbox>
    <v-checkbox
      v-model="currentLockScroll"
      label="Lock Scroll by Default"
    ></v-checkbox>
    <v-text-field
      v-model="currentEditorFontFamily"
      label="Editor Font Family"
    >
    </v-text-field>
    <v-slider
      v-model="currentEditorFontSize"
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
      v-model="currentEditorTheme"
      label="Editor Theme"
      item-text="name"
      item-value="value"
    >
    </v-select>
    <v-select
      v-bind:items="editorKeybindings"
      v-model="currentEditorKeybinding"
      label="Editor Keybinding"
      item-text="name"
      item-value="value"
    >
    </v-select>
    <v-select
      v-bind:items="prismThemes"
      v-model="currentPrismTheme"
      label="Code Block Syntax Highlight Theme"
      item-text="name"
      item-value="value"
    >
    </v-select>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineProps, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';
import { useVuetify } from '@/composables/vuetify';

import * as api from '@/api';
import { loadConfigValue, saveConfigValue } from '@/config';
import YAML from 'yaml';

// Reactive states
const editorThemes = ref([
  { name: 'Default',                 value: 'default'                 },
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
]);
const editorKeybindings = ref([
  { name: 'Default',                                    value: 'default'      },
  { name: 'Emacs',                                      value: 'emacs'        },
  { name: 'Sublime',                                    value: 'sublime'      },
  { name: 'Vim',                                        value: 'vim'          },
  { name: 'Vim (with Emacs-like insert mode mappings)', value: 'vim-modified' },
  { name: 'VSCode',                                     value: 'vscode'       },
]);
const prismThemes = ref([
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
]);
const currentUseSimpleEditor = ref(loadConfigValue('use-simple-editor', false));
const currentLockScroll = ref(loadConfigValue('lock-scroll', false));
const currentEditorFontFamily = ref(loadConfigValue('editor-font-family', 'Menlo, monospace'));
const currentEditorFontSize = ref(loadConfigValue('editor-font-size', 14));
const currentEditorTheme = ref(loadConfigValue('editor-theme', 'default'));
const currentEditorKeybinding = ref(loadConfigValue('editor-keybinding', 'default'));
const currentPrismTheme = ref(loadConfigValue('prism-theme', null));

// Lifecycle hooks
onMounted(() => {
  document.title = `Config | ${process.env.VUE_APP_NAME}`;
});

// Methods
async function loadDefault() {
  const res = await api.getNote('.mory/default_config.yaml');
  const config = YAML.parse(res.data);
  currentUseSimpleEditor.value = config.useSimpleEditor;
  currentLockScroll.value = config.lockScroll;
  currentEditorFontFamily.value = config.editorFontFamily;
  currentEditorFontSize.value = config.editorFontSize;
  currentEditorTheme.value = config.editorTheme;
  currentEditorKeybinding.value = config.editorKeybinding;
  currentPrismTheme.value = config.prismTheme;
}

function saveAsDefault() {
  const config = {
    useSimpleEditor: currentUseSimpleEditor.value,
    lockScroll: currentLockScroll.value,
    editorFontFamily: currentEditorFontFamily.value,
    editorFontSize: currentEditorFontSize.value,
    editorTheme: currentEditorTheme.value,
    editorKeybinding: currentEditorKeybinding.value,
    prismTheme: currentPrismTheme.value,
  };
  api.addNote('.mory/default_config.yaml', YAML.stringify(config));
}

// Watchers
watch(currentUseSimpleEditor, (newUseSimpleEditor: boolean) => {
  saveConfigValue('use-simple-editor', newUseSimpleEditor);
});

watch(currentLockScroll, (newLockScroll: boolean) => {
  saveConfigValue('lock-scroll', newLockScroll);
});

watch(currentEditorFontFamily, (newEditorFontFamily: string) => {
  saveConfigValue('editor-font-family', newEditorFontFamily);
});

watch(currentEditorFontSize, (newEditorFontSize: number) => {
  saveConfigValue('editor-font-size', newEditorFontSize);
});

watch(currentEditorTheme, (newEditorTheme: string) => {
  saveConfigValue('editor-theme', newEditorTheme);
});

watch(currentEditorKeybinding, (newEditorKeybinding: string) => {
  saveConfigValue('editor-keybinding', newEditorKeybinding);
});

watch(currentPrismTheme, (newPrismTheme: string) => {
  saveConfigValue('prism-theme', newPrismTheme);
});

// Expose properties
defineExpose({
  loadDefault,
  saveAsDefault,
});
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
