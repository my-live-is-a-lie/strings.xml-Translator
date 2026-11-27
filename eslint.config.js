import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'android/**', 'public/**', 'scripts/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: false }],
      // A warning, not an error, so a long file never fails CI. It flags new files that grow past the limit.
      'max-lines': ['warn', { max: 1500 }],
    },
  },
  {
    // Files that were already past the limit when the rule was added. Remove an entry once its file is split.
    files: ['src/components/TranslationEditor.tsx', 'src/utils/placeholderCheck.ts', 'src/utils/translator.ts'],
    rules: { 'max-lines': 'off' },
  },
);
