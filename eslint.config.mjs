import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.expo/**', 'apps/mobile/ios/**', 'apps/mobile/android/**', '**/*.config.js', '**/babel.config.js', '**/metro.config.js', 'packages/evals/reports/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // C-07: client mail is never sent. Forbid any `.send(` call on a mail adapter.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='send'][callee.object.property.name='mail']",
          message: 'C-07: MailAdapter has no send. Create drafts only.',
        },
        {
          selector: "CallExpression[callee.property.name='send'][callee.object.name=/[mM]ail/]",
          message: 'C-07: MailAdapter has no send. Create drafts only.',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs', 'packages/db/scripts/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
);
