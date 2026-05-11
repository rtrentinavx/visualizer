/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  return {
    plugins: [
      react(),
      tailwindcss(),
      env.VITE_SENTRY_AUTH_TOKEN && env.VITE_SENTRY_ORG && env.VITE_SENTRY_PROJECT
        ? sentryVitePlugin({
            authToken: env.VITE_SENTRY_AUTH_TOKEN,
            org: env.VITE_SENTRY_ORG,
            project: env.VITE_SENTRY_PROJECT,
          })
        : null,
    ].filter(Boolean),
    build: {
      sourcemap: true,
    },
    test: {
      environment: 'node',
      globals: false,
      include: ['src/**/*.test.ts'],
    },
  }
})
