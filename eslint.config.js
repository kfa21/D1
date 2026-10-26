// ESLint flat config — tsc --noEmit already owns types and the project has no
// style guide, so only real code-quality rules are on: correctness (js
// recommended) plus typescript-eslint's recommended set, with the rules that
// would just fire noise on this codebase relaxed.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // the codebase deliberately uses loose records for spec/patch objects
      '@typescript-eslint/no-explicit-any': 'off',
      // TS itself flags unused locals (and noUnusedLocals is off by preference)
      '@typescript-eslint/no-unused-vars': 'off',
      // empty catch is used intentionally (corrupted storage, parse guards)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // React component files export by default; no-undef is handled by tsc
      'no-undef': 'off',
    },
  },
  {
    // tests build fixtures with loose shapes on purpose
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
);
