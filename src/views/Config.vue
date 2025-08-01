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
      menu-props="auto"
      label="Editor Theme"
      item-text="name"
      item-value="value"
    >
    </v-select>
    <v-select
      v-bind:items="editorKeybindings"
      v-model="currentEditorKeybinding"
      menu-props="auto"
      label="Editor Keybinding"
      item-text="name"
      item-value="value"
    >
    </v-select>
    <v-select
      v-bind:items="highlightjsThemes"
      v-model="currentHighlightjsTheme"
      menu-props="auto"
      label="Code Block Syntax Highlight Theme"
      item-text="name"
      item-value="value"
    >
    </v-select>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted } from 'vue';

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
  { name: 'A11y Dark',                            value: 'a11y-dark'                           },
  { name: 'A11y Light',                           value: 'a11y-light'                          },
  { name: 'Agate',                                value: 'agate'                               },
  { name: 'Androidstudio',                        value: 'androidstudio'                       },
  { name: 'An Old Hope',                          value: 'an-old-hope'                         },
  { name: 'Arduino Light',                        value: 'arduino-light'                       },
  { name: 'Arta',                                 value: 'arta'                                },
  { name: 'Ascetic',                              value: 'ascetic'                             },
  { name: 'Atom One Dark',                        value: 'atom-one-dark'                       },
  { name: 'Atom One Dark Reasonable',             value: 'atom-one-dark-reasonable'            },
  { name: 'Atom One Light',                       value: 'atom-one-light'                      },
  { name: 'Base16/3024',                          value: 'base16/3024'                         },
  { name: 'Base16/Apathy',                        value: 'base16/apathy'                       },
  { name: 'Base16/Apprentice',                    value: 'base16/apprentice'                   },
  { name: 'Base16/Ashes',                         value: 'base16/ashes'                        },
  { name: 'Base16/Atelier Cave Light',            value: 'base16/atelier-cave-light'           },
  { name: 'Base16/Atelier Cave',                  value: 'base16/atelier-cave'                 },
  { name: 'Base16/Atelier Dune Light',            value: 'base16/atelier-dune-light'           },
  { name: 'Base16/Atelier Dune',                  value: 'base16/atelier-dune'                 },
  { name: 'Base16/Atelier Estuary Light',         value: 'base16/atelier-estuary-light'        },
  { name: 'Base16/Atelier Estuary',               value: 'base16/atelier-estuary'              },
  { name: 'Base16/Atelier Forest Light',          value: 'base16/atelier-forest-light'         },
  { name: 'Base16/Atelier Forest',                value: 'base16/atelier-forest'               },
  { name: 'Base16/Atelier Heath Light',           value: 'base16/atelier-heath-light'          },
  { name: 'Base16/Atelier Heath',                 value: 'base16/atelier-heath'                },
  { name: 'Base16/Atelier Lakeside Light',        value: 'base16/atelier-lakeside-light'       },
  { name: 'Base16/Atelier Lakeside',              value: 'base16/atelier-lakeside'             },
  { name: 'Base16/Atelier Plateau Light',         value: 'base16/atelier-plateau-light'        },
  { name: 'Base16/Atelier Plateau',               value: 'base16/atelier-plateau'              },
  { name: 'Base16/Atelier Savanna Light',         value: 'base16/atelier-savanna-light'        },
  { name: 'Base16/Atelier Savanna',               value: 'base16/atelier-savanna'              },
  { name: 'Base16/Atelier Seaside Light',         value: 'base16/atelier-seaside-light'        },
  { name: 'Base16/Atelier Seaside',               value: 'base16/atelier-seaside'              },
  { name: 'Base16/Atelier Sulphurpool Light',     value: 'base16/atelier-sulphurpool-light'    },
  { name: 'Base16/Atelier Sulphurpool',           value: 'base16/atelier-sulphurpool'          },
  { name: 'Base16/Atlas',                         value: 'base16/atlas'                        },
  { name: 'Base16/Bespin',                        value: 'base16/bespin'                       },
  { name: 'Base16/Black Metal Bathory',           value: 'base16/black-metal-bathory'          },
  { name: 'Base16/Black Metal Burzum',            value: 'base16/black-metal-burzum'           },
  { name: 'Base16/Black Metal Dark Funeral',      value: 'base16/black-metal-dark-funeral'     },
  { name: 'Base16/Black Metal Gorgoroth',         value: 'base16/black-metal-gorgoroth'        },
  { name: 'Base16/Black Metal Immortal',          value: 'base16/black-metal-immortal'         },
  { name: 'Base16/Black Metal Khold',             value: 'base16/black-metal-khold'            },
  { name: 'Base16/Black Metal Marduk',            value: 'base16/black-metal-marduk'           },
  { name: 'Base16/Black Metal Mayhem',            value: 'base16/black-metal-mayhem'           },
  { name: 'Base16/Black Metal',                   value: 'base16/black-metal'                  },
  { name: 'Base16/Black Metal Nile',              value: 'base16/black-metal-nile'             },
  { name: 'Base16/Black Metal Venom',             value: 'base16/black-metal-venom'            },
  { name: 'Base16/Brewer',                        value: 'base16/brewer'                       },
  { name: 'Base16/Bright',                        value: 'base16/bright'                       },
  { name: 'Base16/Brogrammer',                    value: 'base16/brogrammer'                   },
  { name: 'Base16/Brush Trees Dark',              value: 'base16/brush-trees-dark'             },
  { name: 'Base16/Brush Trees',                   value: 'base16/brush-trees'                  },
  { name: 'Base16/Chalk',                         value: 'base16/chalk'                        },
  { name: 'Base16/Circus',                        value: 'base16/circus'                       },
  { name: 'Base16/Classic Dark',                  value: 'base16/classic-dark'                 },
  { name: 'Base16/Classic Light',                 value: 'base16/classic-light'                },
  { name: 'Base16/Codeschool',                    value: 'base16/codeschool'                   },
  { name: 'Base16/Colors',                        value: 'base16/colors'                       },
  { name: 'Base16/Cupcake',                       value: 'base16/cupcake'                      },
  { name: 'Base16/Cupertino',                     value: 'base16/cupertino'                    },
  { name: 'Base16/Danqing',                       value: 'base16/danqing'                      },
  { name: 'Base16/Darcula',                       value: 'base16/darcula'                      },
  { name: 'Base16/Darkmoss',                      value: 'base16/darkmoss'                     },
  { name: 'Base16/Darktooth',                     value: 'base16/darktooth'                    },
  { name: 'Base16/Dark Violet',                   value: 'base16/dark-violet'                  },
  { name: 'Base16/Decaf',                         value: 'base16/decaf'                        },
  { name: 'Base16/Default Dark',                  value: 'base16/default-dark'                 },
  { name: 'Base16/Default Light',                 value: 'base16/default-light'                },
  { name: 'Base16/Dirtysea',                      value: 'base16/dirtysea'                     },
  { name: 'Base16/Dracula',                       value: 'base16/dracula'                      },
  { name: 'Base16/Edge Dark',                     value: 'base16/edge-dark'                    },
  { name: 'Base16/Edge Light',                    value: 'base16/edge-light'                   },
  { name: 'Base16/Eighties',                      value: 'base16/eighties'                     },
  { name: 'Base16/Embers',                        value: 'base16/embers'                       },
  { name: 'Base16/Equilibrium Dark',              value: 'base16/equilibrium-dark'             },
  { name: 'Base16/Equilibrium Gray Dark',         value: 'base16/equilibrium-gray-dark'        },
  { name: 'Base16/Equilibrium Gray Light',        value: 'base16/equilibrium-gray-light'       },
  { name: 'Base16/Equilibrium Light',             value: 'base16/equilibrium-light'            },
  { name: 'Base16/Espresso',                      value: 'base16/espresso'                     },
  { name: 'Base16/Eva Dim',                       value: 'base16/eva-dim'                      },
  { name: 'Base16/Eva',                           value: 'base16/eva'                          },
  { name: 'Base16/Flat',                          value: 'base16/flat'                         },
  { name: 'Base16/Framer',                        value: 'base16/framer'                       },
  { name: 'Base16/Fruit Soda',                    value: 'base16/fruit-soda'                   },
  { name: 'Base16/Gigavolt',                      value: 'base16/gigavolt'                     },
  { name: 'Base16/Github',                        value: 'base16/github'                       },
  { name: 'Base16/Google Dark',                   value: 'base16/google-dark'                  },
  { name: 'Base16/Google Light',                  value: 'base16/google-light'                 },
  { name: 'Base16/Grayscale Dark',                value: 'base16/grayscale-dark'               },
  { name: 'Base16/Grayscale Light',               value: 'base16/grayscale-light'              },
  { name: 'Base16/Green Screen',                  value: 'base16/green-screen'                 },
  { name: 'Base16/Gruvbox Dark Hard',             value: 'base16/gruvbox-dark-hard'            },
  { name: 'Base16/Gruvbox Dark Medium',           value: 'base16/gruvbox-dark-medium'          },
  { name: 'Base16/Gruvbox Dark Pale',             value: 'base16/gruvbox-dark-pale'            },
  { name: 'Base16/Gruvbox Dark Soft',             value: 'base16/gruvbox-dark-soft'            },
  { name: 'Base16/Gruvbox Light Hard',            value: 'base16/gruvbox-light-hard'           },
  { name: 'Base16/Gruvbox Light Medium',          value: 'base16/gruvbox-light-medium'         },
  { name: 'Base16/Gruvbox Light Soft',            value: 'base16/gruvbox-light-soft'           },
  { name: 'Base16/Hardcore',                      value: 'base16/hardcore'                     },
  { name: 'Base16/Harmonic16 Dark',               value: 'base16/harmonic16-dark'              },
  { name: 'Base16/Harmonic16 Light',              value: 'base16/harmonic16-light'             },
  { name: 'Base16/Heetch Dark',                   value: 'base16/heetch-dark'                  },
  { name: 'Base16/Heetch Light',                  value: 'base16/heetch-light'                 },
  { name: 'Base16/Helios',                        value: 'base16/helios'                       },
  { name: 'Base16/Hopscotch',                     value: 'base16/hopscotch'                    },
  { name: 'Base16/Horizon Dark',                  value: 'base16/horizon-dark'                 },
  { name: 'Base16/Horizon Light',                 value: 'base16/horizon-light'                },
  { name: 'Base16/Humanoid Dark',                 value: 'base16/humanoid-dark'                },
  { name: 'Base16/Humanoid Light',                value: 'base16/humanoid-light'               },
  { name: 'Base16/Ia Dark',                       value: 'base16/ia-dark'                      },
  { name: 'Base16/Ia Light',                      value: 'base16/ia-light'                     },
  { name: 'Base16/Icy Dark',                      value: 'base16/icy-dark'                     },
  { name: 'Base16/Ir Black',                      value: 'base16/ir-black'                     },
  { name: 'Base16/Isotope',                       value: 'base16/isotope'                      },
  { name: 'Base16/Kimber',                        value: 'base16/kimber'                       },
  { name: 'Base16/London Tube',                   value: 'base16/london-tube'                  },
  { name: 'Base16/Macintosh',                     value: 'base16/macintosh'                    },
  { name: 'Base16/Marrakesh',                     value: 'base16/marrakesh'                    },
  { name: 'Base16/Material Darker',               value: 'base16/material-darker'              },
  { name: 'Base16/Material Lighter',              value: 'base16/material-lighter'             },
  { name: 'Base16/Material',                      value: 'base16/material'                     },
  { name: 'Base16/Material Palenight',            value: 'base16/material-palenight'           },
  { name: 'Base16/Material Vivid',                value: 'base16/material-vivid'               },
  { name: 'Base16/Materia',                       value: 'base16/materia'                      },
  { name: 'Base16/Mellow Purple',                 value: 'base16/mellow-purple'                },
  { name: 'Base16/Mexico Light',                  value: 'base16/mexico-light'                 },
  { name: 'Base16/Mocha',                         value: 'base16/mocha'                        },
  { name: 'Base16/Monokai',                       value: 'base16/monokai'                      },
  { name: 'Base16/Nebula',                        value: 'base16/nebula'                       },
  { name: 'Base16/Nord',                          value: 'base16/nord'                         },
  { name: 'Base16/Nova',                          value: 'base16/nova'                         },
  { name: 'Base16/Oceanicnext',                   value: 'base16/oceanicnext'                  },
  { name: 'Base16/Ocean',                         value: 'base16/ocean'                        },
  { name: 'Base16/Onedark',                       value: 'base16/onedark'                      },
  { name: 'Base16/One Light',                     value: 'base16/one-light'                    },
  { name: 'Base16/Outrun Dark',                   value: 'base16/outrun-dark'                  },
  { name: 'Base16/Papercolor Dark',               value: 'base16/papercolor-dark'              },
  { name: 'Base16/Papercolor Light',              value: 'base16/papercolor-light'             },
  { name: 'Base16/Paraiso',                       value: 'base16/paraiso'                      },
  { name: 'Base16/Pasque',                        value: 'base16/pasque'                       },
  { name: 'Base16/Phd',                           value: 'base16/phd'                          },
  { name: 'Base16/Pico',                          value: 'base16/pico'                         },
  { name: 'Base16/Pop',                           value: 'base16/pop'                          },
  { name: 'Base16/Porple',                        value: 'base16/porple'                       },
  { name: 'Base16/Qualia',                        value: 'base16/qualia'                       },
  { name: 'Base16/Railscasts',                    value: 'base16/railscasts'                   },
  { name: 'Base16/Rebecca',                       value: 'base16/rebecca'                      },
  { name: 'Base16/Ros Pine Dawn',                 value: 'base16/ros-pine-dawn'                },
  { name: 'Base16/Ros Pine',                      value: 'base16/ros-pine'                     },
  { name: 'Base16/Ros Pine Moon',                 value: 'base16/ros-pine-moon'                },
  { name: 'Base16/Sagelight',                     value: 'base16/sagelight'                    },
  { name: 'Base16/Sandcastle',                    value: 'base16/sandcastle'                   },
  { name: 'Base16/Seti Ui',                       value: 'base16/seti-ui'                      },
  { name: 'Base16/Shapeshifter',                  value: 'base16/shapeshifter'                 },
  { name: 'Base16/Silk Dark',                     value: 'base16/silk-dark'                    },
  { name: 'Base16/Silk Light',                    value: 'base16/silk-light'                   },
  { name: 'Base16/Snazzy',                        value: 'base16/snazzy'                       },
  { name: 'Base16/Solar Flare Light',             value: 'base16/solar-flare-light'            },
  { name: 'Base16/Solar Flare',                   value: 'base16/solar-flare'                  },
  { name: 'Base16/Solarized Dark',                value: 'base16/solarized-dark'               },
  { name: 'Base16/Solarized Light',               value: 'base16/solarized-light'              },
  { name: 'Base16/Spacemacs',                     value: 'base16/spacemacs'                    },
  { name: 'Base16/Summercamp',                    value: 'base16/summercamp'                   },
  { name: 'Base16/Summerfruit Dark',              value: 'base16/summerfruit-dark'             },
  { name: 'Base16/Summerfruit Light',             value: 'base16/summerfruit-light'            },
  { name: 'Base16/Synth Midnight Terminal Dark',  value: 'base16/synth-midnight-terminal-dark' },
  { name: 'Base16/Synth Midnight Terminal Light', value: 'base16/synth-midnight-terminal-light'},
  { name: 'Base16/Tango',                         value: 'base16/tango'                        },
  { name: 'Base16/Tender',                        value: 'base16/tender'                       },
  { name: 'Base16/Tomorrow',                      value: 'base16/tomorrow'                     },
  { name: 'Base16/Tomorrow Night',                value: 'base16/tomorrow-night'               },
  { name: 'Base16/Twilight',                      value: 'base16/twilight'                     },
  { name: 'Base16/Unikitty Dark',                 value: 'base16/unikitty-dark'                },
  { name: 'Base16/Unikitty Light',                value: 'base16/unikitty-light'               },
  { name: 'Base16/Vulcan',                        value: 'base16/vulcan'                       },
  { name: 'Base16/Windows 10 Light',              value: 'base16/windows-10-light'             },
  { name: 'Base16/Windows 10',                    value: 'base16/windows-10'                   },
  { name: 'Base16/Windows 95 Light',              value: 'base16/windows-95-light'             },
  { name: 'Base16/Windows 95',                    value: 'base16/windows-95'                   },
  { name: 'Base16/Windows High Contrast Light',   value: 'base16/windows-high-contrast-light'  },
  { name: 'Base16/Windows High Contrast',         value: 'base16/windows-high-contrast'        },
  { name: 'Base16/Windows Nt Light',              value: 'base16/windows-nt-light'             },
  { name: 'Base16/Windows Nt',                    value: 'base16/windows-nt'                   },
  { name: 'Base16/Woodland',                      value: 'base16/woodland'                     },
  { name: 'Base16/Xcode Dusk',                    value: 'base16/xcode-dusk'                   },
  { name: 'Base16/Zenburn',                       value: 'base16/zenburn'                      },
  { name: 'Brown Paper',                          value: 'brown-paper'                         },
  { name: 'Codepen Embed',                        value: 'codepen-embed'                       },
  { name: 'Color Brewer',                         value: 'color-brewer'                        },
  { name: 'Dark',                                 value: 'dark'                                },
  { name: 'Default',                              value: 'default'                             },
  { name: 'Devibeans',                            value: 'devibeans'                           },
  { name: 'Docco',                                value: 'docco'                               },
  { name: 'Far',                                  value: 'far'                                 },
  { name: 'Felipec',                              value: 'felipec'                             },
  { name: 'Foundation',                           value: 'foundation'                          },
  { name: 'Github Dark Dimmed',                   value: 'github-dark-dimmed'                  },
  { name: 'Github Dark',                          value: 'github-dark'                         },
  { name: 'Github',                               value: 'github'                              },
  { name: 'Gml',                                  value: 'gml'                                 },
  { name: 'Googlecode',                           value: 'googlecode'                          },
  { name: 'Gradient Dark',                        value: 'gradient-dark'                       },
  { name: 'Gradient Light',                       value: 'gradient-light'                      },
  { name: 'Grayscale',                            value: 'grayscale'                           },
  { name: 'Hybrid',                               value: 'hybrid'                              },
  { name: 'Idea',                                 value: 'idea'                                },
  { name: 'Intellij Light',                       value: 'intellij-light'                      },
  { name: 'Ir Black',                             value: 'ir-black'                            },
  { name: 'Isbl Editor Dark',                     value: 'isbl-editor-dark'                    },
  { name: 'Isbl Editor Light',                    value: 'isbl-editor-light'                   },
  { name: 'Kimbie Dark',                          value: 'kimbie-dark'                         },
  { name: 'Kimbie Light',                         value: 'kimbie-light'                        },
  { name: 'Lightfair',                            value: 'lightfair'                           },
  { name: 'Lioshi',                               value: 'lioshi'                              },
  { name: 'Magula',                               value: 'magula'                              },
  { name: 'Mono Blue',                            value: 'mono-blue'                           },
  { name: 'Monokai',                              value: 'monokai'                             },
  { name: 'Monokai Sublime',                      value: 'monokai-sublime'                     },
  { name: 'Night Owl',                            value: 'night-owl'                           },
  { name: 'Nnfx Dark',                            value: 'nnfx-dark'                           },
  { name: 'Nnfx Light',                           value: 'nnfx-light'                          },
  { name: 'Nord',                                 value: 'nord'                                },
  { name: 'Obsidian',                             value: 'obsidian'                            },
  { name: 'Panda Syntax Dark',                    value: 'panda-syntax-dark'                   },
  { name: 'Panda Syntax Light',                   value: 'panda-syntax-light'                  },
  { name: 'Paraiso Dark',                         value: 'paraiso-dark'                        },
  { name: 'Paraiso Light',                        value: 'paraiso-light'                       },
  { name: 'Pojoaque',                             value: 'pojoaque'                            },
  { name: 'Purebasic',                            value: 'purebasic'                           },
  { name: 'Qtcreator Dark',                       value: 'qtcreator-dark'                      },
  { name: 'Qtcreator Light',                      value: 'qtcreator-light'                     },
  { name: 'Rainbow',                              value: 'rainbow'                             },
  { name: 'Routeros',                             value: 'routeros'                            },
  { name: 'School Book',                          value: 'school-book'                         },
  { name: 'Shades of Purple',                     value: 'shades-of-purple'                    },
  { name: 'Srcery',                               value: 'srcery'                              },
  { name: 'Stackoverflow Dark',                   value: 'stackoverflow-dark'                  },
  { name: 'Stackoverflow Light',                  value: 'stackoverflow-light'                 },
  { name: 'Sunburst',                             value: 'sunburst'                            },
  { name: 'Tokyo Night Dark',                     value: 'tokyo-night-dark'                    },
  { name: 'Tokyo Night Light',                    value: 'tokyo-night-light'                   },
  { name: 'Tomorrow Night Blue',                  value: 'tomorrow-night-blue'                 },
  { name: 'Tomorrow Night Bright',                value: 'tomorrow-night-bright'               },
  { name: 'Vs2015',                               value: 'vs2015'                              },
  { name: 'Vs',                                   value: 'vs'                                  },
  { name: 'Xcode',                                value: 'xcode'                               },
  { name: 'Xt256',                                value: 'xt256'                               },
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
  document.title = `Config | ${import.meta.env.VITE_APP_NAME}`;
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
