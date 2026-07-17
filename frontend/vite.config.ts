import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { visualizer } from "rollup-plugin-visualizer";
import Components from 'unplugin-vue-components/vite';
import { name as appName, version as appVersion, author as appAuthor } from './package.json';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  process.env.VITE_APP_NAME = appName;
  process.env.VITE_APP_VERSION = appVersion;
  process.env.VITE_APP_AUTHOR = appAuthor.name;
  process.env.VITE_APP_BUILD_YEAR = String(new Date().getFullYear());

  return {
    base: env.VITE_APP_APPLICATION_ROOT,
    define: {
      // Workaround for "ReferenceError: process is not defined"
      'process.env': {},
    },
    plugins: [
      visualizer(),
      vue(),
      // Automatically import Vuetify components and directives as needed
      vuetify({ autoImport: true }),
      // Automatically import our own components as needed
      Components(),
    ],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          quietDeps: true,
          silenceDeprecations: ['slash-div'],
        },
      },
    },
    server: {
      port: 8080,
    },
    build: {
      sourcemap: true,
    },
  };
});
