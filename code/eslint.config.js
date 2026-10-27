import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['frontend/src/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'error', 'no-useless-assignment': 'off' } },
);
