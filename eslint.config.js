// @ts-check
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  tseslint.configs.recommended,
  {
    // `prefer-optional-chain` needs type information to tell a safe
    // rewrite to `a?.b` from one that would change behaviour, so this
    // group turns on the type-aware parser for the TypeScript sources.
    // The full `recommendedTypeChecked` preset pulls in many more rules
    // than this project asks for, so only this one rule is enabled.
    files: ['packages/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/prefer-optional-chain': 'error',
    },
  },
  {
    files: ['packages/web-app/public/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'error',
    },
  },
  eslintConfigPrettier,
);
