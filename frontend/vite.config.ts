import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { visualizer } from "rollup-plugin-visualizer";
import Components from 'unplugin-vue-components/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  process.env.VITE_APP_NAME = pkg.name;
  process.env.VITE_APP_VERSION = pkg.version;
  process.env.VITE_APP_AUTHOR = pkg.author.name;
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
    optimizeDeps: {
      // The scan that bundles dependencies at startup reads the scripts of the files it reaches,
      // never what plugins add as they compile a template. So our own components, which
      // `Components()` imports, are entries themselves, for what they import (entries replace the
      // default, hence index.html), and the components and directives `vuetify({ autoImport:
      // true })` imports are included outright. A dependency a page meets first is bundled then,
      // and reloads the page: on a fresh cache, as in CI, under a test.
      entries: ['index.html', 'src/**/*.vue'],
      include: ['vuetify/components/*', 'vuetify/directives'],
    },
    server: {
      port: 8080,
    },
    build: {
      sourcemap: true,
    },
  };
});
