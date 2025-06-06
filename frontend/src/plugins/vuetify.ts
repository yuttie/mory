import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import { Touch } from 'vuetify/lib/directives';

Vue.use(Vuetify, {
  // We need this because unplugin-vue-components's "auto import for directives" feature requires Babel for Vue 2, and we don't want to install Babel.
  directives: {
    Touch,
  },
});

export default new Vuetify({
  icons: {
    iconfont: 'mdiSvg',
  },
  theme: {
    options: {
      customProperties: true,
    },
    themes: {
      light: {
        primary: '#29C4CC',
        secondary: '#424242',
        accent: '#82B1FF',
        error: '#FF5252',
        info: '#2196F3',
        success: '#4CAF50',
        warning: '#FFC107'
      },
    },
  },
});
