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
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@xyflow/react')) return 'xyflow';
            if (id.includes('@sentry/react')) return 'sentry';
            if (id.includes('lucide-react')) return 'lucide';
            if (id.includes('react-dom') || /node_modules\/react\//.test(id)) return 'react';
            return undefined;
          },
        },
      },
    },
    test: {
      environment: 'node',
      globals: false,
      include: ['src/**/*.test.ts'],
    },
  }
})
