import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(js.configs.recommended, ...ts.configs.recommended, {
  files: ['**/*.ts'],
  rules: {'@typescript-eslint/no-explicit-any': 'error'}
}, {files: ['scripts/*.mjs'], languageOptions: {globals: {console: 'readonly', process: 'readonly', setInterval: 'readonly'}}},
{ignores: ['dist/**', 'node_modules/**']});
