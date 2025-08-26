import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue2';
import { visualizer } from "rollup-plugin-visualizer";
import Components from 'unplugin-vue-components/vite';
import { VuetifyResolver } from 'unplugin-vue-components/resolvers';
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
      // Automatically import components as needed
      Components({
        resolvers: [
          VuetifyResolver(),
        ],
      }),
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
