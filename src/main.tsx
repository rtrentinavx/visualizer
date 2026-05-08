import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App'
import { ThemeProvider } from './lib/ThemeContext'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: 'system',
        autoInject: true,
      }),
    ],
    tracesSampleRate: 1.0,
    tracePropagationTargets: ['localhost'],
  })
} else {
  console.warn('[Sentry] VITE_SENTRY_DSN not set — skipping Sentry init.')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <Analytics />
    </ThemeProvider>
  </StrictMode>,
)
