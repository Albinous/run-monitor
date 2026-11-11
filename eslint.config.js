import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, unicorn.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `_name` marks a parameter that is unused on purpose
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // --- unicorn: recommended rules, with three deliberate adjustments ---
      // React components are PascalCase by convention (RunList.tsx), everything else camelCase (sortRuns.ts)
      'unicorn/filename-case': ['error', { cases: { camelCase: true, pascalCase: true } }],
      // short names only where they are a universal convention: loop indices, canvas context, React props/refs
      'unicorn/prevent-abbreviations': [
        'error',
        {
          allowList: {
            i: true,
            j: true,
            ctx: true,
            Ctx: true,
            props: true,
            Props: true,
            ref: true,
            env: true,
            args: true,
          },
        },
      ],
      // null deliberately means "no value" here (no cursor, empty run has no last step); React and the DOM use it too
      'unicorn/no-null': 'off',
    },
  },
  {
    // the benchmark script prints its results
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  // must be last: turns off style rules that Prettier is responsible for
  prettier,
);
