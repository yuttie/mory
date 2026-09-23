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
    // `vuetify.css` gives every other icon -- keep it in step with `--mory-icon-size` -- and the
    // button repeats the height it gives every button.
    VIconBtn: {
      iconSize: "20",
      rounded: "lg",
      size: "32",
    },
    // The calendar draws its day numbers as VIconBtn too, and the defaults above are for
    // toolbars: keep those numbers the 40 px circles they were.
    VCalendar: {
      VIconBtn: {
        rounded: undefined,
        size: "default",
      },
    },
    VAppBarNavIcon: {
      rounded: "lg",
      size: "32",
    },
    // Every size is a rule in `vuetify.css`, which can name the context it holds for. What is left
    // here shapes a list item and has no CSS to write, so it repeats the metrics that file names:
    // keep these in step with its `:root` block.
    VListItem: {
      minHeight: 32,
      rounded: 4,
      prependGap: 12,
      // A v-icon-btn in a row is sized by the rule for an icon button in a slot, but its icon and
      // its corners it settles itself -- one inline, the other as a utility class -- so they are
      // said here: the icon a button's icon size, and the corners the ones the rule gives it.
      VIconBtn: {
        iconSize: "16",
        rounded: undefined,
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
