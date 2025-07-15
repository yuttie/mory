import js from '@eslint/js';
import ts from 'typescript-eslint';
import eslintPluginVue from 'eslint-plugin-vue';
export default ts.config(
  // Globally ignore some files
  {
    ignores: [
      'dist',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...eslintPluginVue.configs['flat/vue2-recommended'],
  // Enable TypeScript parser in *.vue files
  {
    files: ['*.vue', '**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: '@typescript-eslint/parser',
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
