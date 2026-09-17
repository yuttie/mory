import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';

export default createVuetify({
  defaults: {
    global: {
      density: "compact",
    },
    VIconBtn: {
      iconSize: "20",
      rounded: "lg",
      size: "32",
    },
    // A v-btn underneath, which has no iconSize: its icon takes the size as a nested default.
    VAppBarNavIcon: {
      rounded: "lg",
      size: "32",
      VIcon: {
        size: "20",
      },
    },
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi,
    },
  },
  theme: {
    themes: {
      light: {
        colors: {
          primary: '#1f2626',
          secondary: '#424242',
          accent: '#0099a1',
          error: '#FF5252',
          info: '#2196F3',
          success: '#4CAF50',
          warning: '#FFC107'
        },
      },
    },
  },
});
