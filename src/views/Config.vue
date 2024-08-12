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
      v-bind:items="highlightjsThemes"
      v-model="currentHighlightjsTheme"
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
const highlightjsThemes = ref([
  { name: 'A11y Dark',                 value: 'a11y-dark'                 },
  { name: 'A11y Light',                value: 'a11y-light'                },
  { name: 'Agate',                     value: 'agate'                     },
  { name: 'An Old Hope',               value: 'an-old-hope'               },
  { name: 'Androidstudio',             value: 'androidstudio'             },
  { name: 'Arduino Light',             value: 'arduino-light'             },
  { name: 'Arta',                      value: 'arta'                      },
  { name: 'Ascetic',                   value: 'ascetic'                   },
  { name: 'Atelier Cave Dark',         value: 'atelier-cave-dark'         },
  { name: 'Atelier Cave Light',        value: 'atelier-cave-light'        },
  { name: 'Atelier Dune Dark',         value: 'atelier-dune-dark'         },
  { name: 'Atelier Dune Light',        value: 'atelier-dune-light'        },
  { name: 'Atelier Estuary Dark',      value: 'atelier-estuary-dark'      },
  { name: 'Atelier Estuary Light',     value: 'atelier-estuary-light'     },
  { name: 'Atelier Forest Dark',       value: 'atelier-forest-dark'       },
  { name: 'Atelier Forest Light',      value: 'atelier-forest-light'      },
  { name: 'Atelier Heath Dark',        value: 'atelier-heath-dark'        },
  { name: 'Atelier Heath Light',       value: 'atelier-heath-light'       },
  { name: 'Atelier Lakeside Dark',     value: 'atelier-lakeside-dark'     },
  { name: 'Atelier Lakeside Light',    value: 'atelier-lakeside-light'    },
  { name: 'Atelier Plateau Dark',      value: 'atelier-plateau-dark'      },
  { name: 'Atelier Plateau Light',     value: 'atelier-plateau-light'     },
  { name: 'Atelier Savanna Dark',      value: 'atelier-savanna-dark'      },
  { name: 'Atelier Savanna Light',     value: 'atelier-savanna-light'     },
  { name: 'Atelier Seaside Dark',      value: 'atelier-seaside-dark'      },
  { name: 'Atelier Seaside Light',     value: 'atelier-seaside-light'     },
  { name: 'Atelier Sulphurpool Dark',  value: 'atelier-sulphurpool-dark'  },
  { name: 'Atelier Sulphurpool Light', value: 'atelier-sulphurpool-light' },
  { name: 'Atom One Dark Reasonable',  value: 'atom-one-dark-reasonable'  },
  { name: 'Atom One Dark',             value: 'atom-one-dark'             },
  { name: 'Atom One Light',            value: 'atom-one-light'            },
  { name: 'Brown Paper',               value: 'brown-paper'               },
  { name: 'Codepen Embed',             value: 'codepen-embed'             },
  { name: 'Color Brewer',              value: 'color-brewer'              },
  { name: 'Darcula',                   value: 'darcula'                   },
  { name: 'Dark',                      value: 'dark'                      },
  { name: 'Default',                   value: 'default'                   },
  { name: 'Docco',                     value: 'docco'                     },
  { name: 'Dracula',                   value: 'dracula'                   },
  { name: 'Far',                       value: 'far'                       },
  { name: 'Foundation',                value: 'foundation'                },
  { name: 'Github Gist',               value: 'github-gist'               },
  { name: 'Github',                    value: 'github'                    },
  { name: 'Gml',                       value: 'gml'                       },
  { name: 'Googlecode',                value: 'googlecode'                },
  { name: 'Gradient Dark',             value: 'gradient-dark'             },
  { name: 'Gradient Light',            value: 'gradient-light'            },
  { name: 'Grayscale',                 value: 'grayscale'                 },
  { name: 'Gruvbox Dark',              value: 'gruvbox-dark'              },
  { name: 'Gruvbox Light',             value: 'gruvbox-light'             },
  { name: 'Hopscotch',                 value: 'hopscotch'                 },
  { name: 'Hybrid',                    value: 'hybrid'                    },
  { name: 'Idea',                      value: 'idea'                      },
  { name: 'Ir Black',                  value: 'ir-black'                  },
  { name: 'Isbl Editor Dark',          value: 'isbl-editor-dark'          },
  { name: 'Isbl Editor Light',         value: 'isbl-editor-light'         },
  { name: 'Kimbie.dark',               value: 'kimbie.dark'               },
  { name: 'Kimbie.light',              value: 'kimbie.light'              },
  { name: 'Lightfair',                 value: 'lightfair'                 },
  { name: 'Lioshi',                    value: 'lioshi'                    },
  { name: 'Magula',                    value: 'magula'                    },
  { name: 'Mono Blue',                 value: 'mono-blue'                 },
  { name: 'Monokai Sublime',           value: 'monokai-sublime'           },
  { name: 'Monokai',                   value: 'monokai'                   },
  { name: 'Night Owl',                 value: 'night-owl'                 },
  { name: 'Nnfx Dark',                 value: 'nnfx-dark'                 },
  { name: 'Nnfx',                      value: 'nnfx'                      },
  { name: 'Nord',                      value: 'nord'                      },
  { name: 'Obsidian',                  value: 'obsidian'                  },
  { name: 'Ocean',                     value: 'ocean'                     },
  { name: 'Paraiso Dark',              value: 'paraiso-dark'              },
  { name: 'Paraiso Light',             value: 'paraiso-light'             },
  { name: 'Pojoaque',                  value: 'pojoaque'                  },
  { name: 'Purebasic',                 value: 'purebasic'                 },
  { name: 'Qtcreator_dark',            value: 'qtcreator_dark'            },
  { name: 'Qtcreator_light',           value: 'qtcreator_light'           },
  { name: 'Railscasts',                value: 'railscasts'                },
  { name: 'Rainbow',                   value: 'rainbow'                   },
  { name: 'Routeros',                  value: 'routeros'                  },
  { name: 'School Book',               value: 'school-book'               },
  { name: 'Shades of Purple',          value: 'shades-of-purple'          },
  { name: 'Solarized Dark',            value: 'solarized-dark'            },
  { name: 'Solarized Light',           value: 'solarized-light'           },
  { name: 'Srcery',                    value: 'srcery'                    },
  { name: 'Stackoverflow Dark',        value: 'stackoverflow-dark'        },
  { name: 'Stackoverflow Light',       value: 'stackoverflow-light'       },
  { name: 'Sunburst',                  value: 'sunburst'                  },
  { name: 'Tomorrow Night Blue',       value: 'tomorrow-night-blue'       },
  { name: 'Tomorrow Night Bright',     value: 'tomorrow-night-bright'     },
  { name: 'Tomorrow Night Eighties',   value: 'tomorrow-night-eighties'   },
  { name: 'Tomorrow Night',            value: 'tomorrow-night'            },
  { name: 'Tomorrow',                  value: 'tomorrow'                  },
  { name: 'Vs',                        value: 'vs'                        },
  { name: 'Vs2015',                    value: 'vs2015'                    },
  { name: 'Xcode',                     value: 'xcode'                     },
  { name: 'Xt256',                     value: 'xt256'                     },
  { name: 'Zenburn',                   value: 'zenburn'                   },
]);
const currentUseSimpleEditor = ref(loadConfigValue('use-simple-editor', false));
const currentLockScroll = ref(loadConfigValue('lock-scroll', false));
const currentEditorFontFamily = ref(loadConfigValue('editor-font-family', 'Menlo, monospace'));
const currentEditorFontSize = ref(loadConfigValue('editor-font-size', 14));
const currentEditorTheme = ref(loadConfigValue('editor-theme', 'default'));
const currentEditorKeybinding = ref(loadConfigValue('editor-keybinding', 'default'));
const currentHighlightjsTheme = ref(loadConfigValue('highlightjs-theme', 'default'));

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
  currentHighlightjsTheme.value = config.highlightjsTheme;
}

function saveAsDefault() {
  const config = {
    useSimpleEditor: currentUseSimpleEditor.value,
    lockScroll: currentLockScroll.value,
    editorFontFamily: currentEditorFontFamily.value,
    editorFontSize: currentEditorFontSize.value,
    editorTheme: currentEditorTheme.value,
    editorKeybinding: currentEditorKeybinding.value,
    highlightjsTheme: currentHighlightjsTheme.value,
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

watch(currentHighlightjsTheme, (newHighlightjsTheme: string) => {
  saveConfigValue('highlightjs-theme', newHighlightjsTheme);
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
