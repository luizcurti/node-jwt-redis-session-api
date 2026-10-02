const js = require('@eslint/js');
// The `typescript-eslint` meta-package ships the parser and plugin as one
// version, so they can't drift apart the way two separately-pinned
// @typescript-eslint/* packages can.
const tseslint = require('typescript-eslint');
const prettier = require('eslint-plugin-prettier');
// Turns off every stylistic rule that would fight Prettier's output; Prettier
// itself still runs as a lint rule via eslint-plugin-prettier below.
const eslintConfigPrettier = require('eslint-config-prettier');

const tsparser = tseslint.parser;

module.exports = [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '*.log',
      '.env*',
      'docker-compose.yml',
      'Dockerfile',
      '*.md',
    ],
  },
  // JavaScript files
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
      },
    },
    plugins: {
      prettier: prettier,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  // TypeScript files in src/
  {
    files: ['src/**/*.ts'],
    ignores: ['src/__tests__/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier: prettier,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'off',
      'no-useless-catch': 'error',
    },
  },
  // TypeScript test files
  {
    files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        jest: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        it: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier: prettier,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'off',
    },
  },
  eslintConfigPrettier,
];
