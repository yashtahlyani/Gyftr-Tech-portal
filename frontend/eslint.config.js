import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// Mirrors the CEO Office / Marketing Portal frontend/eslint.config.js so all
// the sibling codebases are held to the same bar, adapted for this repo's
// TypeScript source (the siblings are plain JS) via typescript-eslint's
// recommended flat config.
export default defineConfig([
  globalIgnores(['dist', '**/node_modules']),

  // Browser app
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Components are PascalCase by convention (e.g. `({ icon: Icon }) =>
      // <Icon/>`) — allow capitalised names to go "unused" rather than pull
      // in eslint-plugin-react for one rule. Mirrors the sibling portals'
      // no-unused-vars carve-out, ported to the TS-aware rule.
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^(_|[A-Z])',
      }],

      // Same as the sibling portals: sound advice, kept as warnings rather
      // than switched off or silently auto-fixed here.
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
]);
