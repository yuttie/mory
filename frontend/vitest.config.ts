import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A config of its own rather than `vite.config.ts`'s: the suites here are plain TypeScript, so
// they need none of the app's Vue/Vuetify/visualizer plugins, and loading them would only make
// the run slower and write build artefacts as a side effect.
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        include: ['src/**/*.spec.ts'],
        environment: 'node',
    },
});
