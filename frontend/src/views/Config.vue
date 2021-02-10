<template>
  <div class="config">
    <h1>Config</h1>
    <v-alert text type="info">
      These settings are only applied to the current environment and never be saved in the repository.
    </v-alert>
    <v-select
      v-bind:items="themes"
      v-bind:value="currentTheme"
      v-on:change="updateTheme"
      label="Theme"
      item-text="name"
      item-value="value"
    >
    </v-select>
    <v-select
      v-bind:items="keybindings"
      v-bind:value="currentKeybinding"
      v-on:change="updateKeybinding"
      label="Keybinding"
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
  themes = [
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
  keybindings = [
    { name: 'Default', value: 'default' },
    { name: 'Vim', value: 'vim' },
    { name: 'Vim (with Emacs-like insert mode mappings)', value: 'vim-modified' },
  ];
  currentTheme = localStorage.getItem('theme') || 'default';
  currentKeybinding = localStorage.getItem('keybinding') || 'default';

  mounted() {
    document.title = `Config | ${process.env.VUE_APP_NAME}`;
  }

  updateTheme(newTheme: string) {
    localStorage.setItem('theme', newTheme);
  }

  updateKeybinding(newKeybinding: string) {
    localStorage.setItem('keybinding', newKeybinding);
  }
}
</script>

<style scoped lang="scss">
.config {
  padding: 50px 1em;

  display: flex;
  flex-direction: column;
  align-items: center;

  &::before, &::after {
    content: '';
    flex-grow: 1;
  }
}
</style>
