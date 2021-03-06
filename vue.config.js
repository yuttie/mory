process.env.VUE_APP_NAME = require('./package.json').name;
process.env.VUE_APP_VERSION = require('./package.json').version;
process.env.VUE_APP_AUTHOR = require('./package.json').author.replace(/<[^>]+>/, '').trim();
process.env.VUE_APP_BUILD_YEAR = new Date().getFullYear();

module.exports = {
  publicPath: process.env.VUE_APP_APPLICATION_ROOT,
  transpileDependencies: [
    'vuetify',
  ],
};
