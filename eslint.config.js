import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import {config, configs as tseslintConfigs} from 'typescript-eslint';

export default config(
  {
    ignores: ['lib/**', 'node_modules/**', 'coverage/**']
  },
  js.configs.recommended,
  tseslintConfigs.recommended,
  prettier,
  {
    languageOptions: {
      globals: globals.node
    },
    rules: {
      'prettier/prettier': 'error',
      'no-duplicate-imports': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', {prefer: 'type-imports'}],
      '@typescript-eslint/no-unused-vars': ['error', {ignoreRestSiblings: true, args: 'none'}],
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
