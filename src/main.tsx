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
        triggerLabel: 'Report a Bug',
        triggerAriaLabel: 'Report a bug',
        showBranding: true,
        isEmailRequired: false,
        isNameRequired: false,
      }),
    ],
    tracesSampleRate: 1.0,
    tracePropagationTargets: ['localhost'],
  })

  // Ensure the feedback widget is visible.
  // Sentry's autoInject should create it during init, but in some environments
  // (bundled Vite apps, strict CSP, etc.) it can fail silently.
  // This fallback creates the widget manually if the auto-injected one is missing.
  const ensureFeedbackWidget = () => {
    try {
      const existing = document.getElementById('sentry-feedback')
      if (existing) {
        // Widget host exists — make sure it is visible
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
      const widget = feedback.createWidget({
        triggerLabel: 'Report a Bug',
        triggerAriaLabel: 'Report a bug',
      })
      widget.show()
    } catch (err) {
      console.error('[Sentry] Failed to create feedback widget:', err)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(ensureFeedbackWidget, 500))
  } else {
    setTimeout(ensureFeedbackWidget, 500)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <Analytics />
    </ThemeProvider>
  </StrictMode>,
)
