import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default [
  { ignores: ['dist/', '.astro/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['*.js', 'tests/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Injected at build time via vite `define` (see astro.config.mjs).
    files: ['src/**/*.astro', 'src/**/*.ts'],
    languageOptions: { globals: { __LAST_COMMIT__: 'readonly' } },
  },
  {
    files: ['src/scripts/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
