import js from '@eslint/js';
import ts from 'typescript-eslint';
import eslintPluginVue from 'eslint-plugin-vue';
import globals from 'globals';
export default ts.config(
    // Globally ignore some files
    {
        ignores: [
            'dist',
        ],
    },
    js.configs.recommended,
    ...ts.configs.recommended,
    ...eslintPluginVue.configs['flat/recommended'],
    // Node.js build/maintenance scripts
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
            },
        },
    },
    // The service worker is plain JavaScript, so no-undef is all that checks its names, and runs in
    // a worker, which has no window or document
    {
        files: ['public/service-worker.js'],
        languageOptions: {
            globals: globals.serviceworker,
        },
    },
    // Enable TypeScript parser in *.vue files
    {
        files: ['*.vue', '**/*.vue'],
        languageOptions: {
            parserOptions: {
                parser: '@typescript-eslint/parser',
            },
        },
    },
    // Components run in the browser. typescript-eslint turns no-undef off in *.ts files, where
    // TypeScript checks names against the "dom" lib instead, but not in *.vue files.
    {
        files: ['*.vue', '**/*.vue'],
        languageOptions: {
            globals: globals.browser,
            // The libs tsconfig.json lists, for names that exist only as types, such as
            // ScrollToOptions: globals.browser lists only values
            parserOptions: {
                lib: ['esnext', 'dom', 'dom.iterable'],
            },
        },
    },
    {
        rules: {
            // Emulate TypeScript style of exempting names starting with _
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    'args': 'all',
                    'argsIgnorePattern': '^_',
                    'caughtErrors': 'all',
                    'caughtErrorsIgnorePattern': '^_',
                    'destructuredArrayIgnorePattern': '^_',
                    'varsIgnorePattern': '^_',
                    'ignoreRestSiblings': true,
                },
            ],
            'vue/v-bind-style': ['error', 'longform'],
            'vue/v-on-style': ['error', 'longform'],
            'vue/valid-v-slot': ['error', { 'allowModifiers': true }],
            'vue/multi-word-component-names': ['error', { 'ignores': ['About', 'Calendar', 'Config', 'Editor', 'Files', 'Search', 'Gravatar', 'Home', 'Note', 'Tasks']}],
            'vue/html-indent': ['warn', 4, {}],
        },
    },
);
