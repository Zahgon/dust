import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['coverage/**', 'node_modules/**', 'completions/**', 'man-page/**', 'eslint.config.js'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'off',
    },
  },
  {
    // The generated width table is data, not code.
    files: ['src/deps/unicodeWidthTable.ts'],
    rules: {},
  },
);
