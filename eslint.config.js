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
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
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
      'vue/valid-v-slot': ['error', { 'allowModifiers': true }],
      'vue/multi-word-component-names': ['error', { 'ignores': ['About', 'Calendar', 'Config', 'Editor', 'Find', 'Gravatar', 'Home', 'Note', 'Tasks']}],
    },
  },
);
