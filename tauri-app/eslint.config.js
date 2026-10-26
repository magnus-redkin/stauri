import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Настройка парсера для Svelte-файлов (Svelte 5 + TypeScript)
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    // Настройка для файлов .svelte.ts (руны Svelte 5)
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parser: ts.parser,
    },
  },
  {
    // Запрет console.log в исходном коде
    files: ['src/**/*.{js,ts,svelte}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Отключаем правило для компонентов shadcn (они используют <a href>)
    files: ['src/lib/components/ui/**/*.svelte'],
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
  {
    ignores: ['build/', 'dist/', '.svelte-kit/', 'node_modules/', 'src-tauri/'],
  },
];
