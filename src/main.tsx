import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App'
import ErrorFallback from './components/ErrorFallback'
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

  // Fallback: ensure the feedback widget is visible and clickable.
  // Sentry's autoInject can silently fail in bundled Vite apps / strict CSP environments.
  const ensureFeedbackWidget = () => {
    try {
      const existing = document.getElementById('sentry-feedback')
      if (existing) {
        existing.style.position = 'fixed'
        existing.style.zIndex = '100000'
        existing.style.pointerEvents = 'auto'
        console.log('[Sentry] Feedback widget found in DOM.')
        return
      }

      const feedback = Sentry.getFeedback()
      if (!feedback) {
        console.warn('[Sentry] Feedback integration not available.')
        return
      }

      console.log('[Sentry] Auto-injected widget missing — creating manually.')
      const widget = feedback.createWidget()
      widget.appendToDom()
    } catch (err) {
      console.error('[Sentry] Failed to create feedback widget:', err)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(ensureFeedbackWidget, 500))
  } else {
    setTimeout(ensureFeedbackWidget, 500)
  }
} else {
  console.warn('[Sentry] VITE_SENTRY_DSN not set — skipping Sentry init.')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <ThemeProvider>
        <App />
        <Analytics />
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
