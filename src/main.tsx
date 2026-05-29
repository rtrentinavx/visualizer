import { StrictMode, useEffect, useRef } from 'react'
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
        autoInject: false,
      }),
    ],
    tracesSampleRate: 1.0,
    tracePropagationTargets: ['localhost'],
  })
} else {
  console.warn('[Sentry] VITE_SENTRY_DSN not set — skipping Sentry init.')
}

function ReportBugButton() {
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!btnRef.current) return
    const feedback = Sentry.getFeedback()
    if (!feedback) return
    try {
      feedback.attachTo(btnRef.current, { formTitle: 'Report a Bug' })
    } catch {
      // attachTo not available — clicking the button will do nothing
    }
  }, [])

  if (!SENTRY_DSN) return null

  return (
    <button
      ref={btnRef}
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 100000,
        padding: '6px 12px',
        fontSize: 12,
        borderRadius: 6,
        border: '1px solid var(--color-border-subtle)',
        backgroundColor: 'var(--color-surface-raised)',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      Report a Bug
    </button>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <ThemeProvider>
        <App />
        <ReportBugButton />
        <Analytics />
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
