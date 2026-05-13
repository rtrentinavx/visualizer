import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Playwright e2e suite — non-React node code. The React-hooks plugin
  // false-positives on Playwright's `use` fixture parameter (it looks like a
  // hook name to the rule). Disable React-specific rules here.
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/react-compiler': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
