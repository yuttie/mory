module.exports = {
  root: true,
  env: {
    node: true
  },
  'extends': [
    'plugin:vue/essential',
    'eslint:recommended',
    '@vue/typescript/recommended'
  ],
  parserOptions: {
    ecmaVersion: 2020
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    'vue/valid-v-slot': ['error', { 'allowModifiers': true }],
    'vue/multi-word-component-names': ['error', { 'ignores': ['About', 'Calendar', 'Config', 'Editor', 'Find', 'Gravatar']}],
  }
}
