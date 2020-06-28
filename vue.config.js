process.env.VUE_APP_NAME = require('./package.json').name;
process.env.VUE_APP_VERSION = require('./package.json').version;
process.env.VUE_APP_AUTHOR = require('./package.json').author.replace(/<[^>]+>/, '').trim();
process.env.VUE_APP_BUILD_YEAR = new Date().getFullYear();

module.exports = {
  publicPath: process.env.VUE_APP_APPLICATION_ROOT,
  css: {
    loaderOptions: {
      sass: {
        prependData: '@import "@/custom.scss";',
      },
    },
  },
  pwa: {
    themeColor: '#5e83ae',
    iconPaths: {
      favicon32: null,
      favicon16: null,
      appleTouchIcon: null,
      maskIcon: null,
      msTileImage: null,
    },
    manifestOptions: {
      icons: [
        {
          'src': './img/icons/android-chrome-512x512.png',
          'sizes': '512x512',
          'type': 'image/png'
        },
      ],
    },
  },
};
