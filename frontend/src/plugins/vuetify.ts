import 'vuetify/styles';
// After Vuetify's styles, which declare the layer order its overrides layer relies on.
import './vuetify.css';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';

export default createVuetify({
  defaults: {
    global: {
      density: "compact",
    },
    // A v-icon-btn puts even a named icon size through a table of its own and passes the number
    // it lands on as an inline size, which no rule can reach. So this one repeats what
    // `vuetify.css` gives every other icon -- keep it in step with `--mory-icon-size`.
    VIconBtn: {
      iconSize: "20",
    },
    VListItem: {
      // Without this, Vuetify stamps a `rounded-0` on every row, and a utility class outranks the
      // layer `vuetify.css` writes in. `true` only says "not squared off"; the radius itself is
      // the rule there.
      rounded: true,
      // A v-icon-btn in a row is sized by the rule for an icon button in a slot, but its icon
      // it passes inline, which no rule reaches: that one is said here, as a button's icon size.
      VIconBtn: {
        iconSize: "16",
      },
    },
    VBtnToggle: {
        variant: "outlined",
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
