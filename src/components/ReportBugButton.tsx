import { useEffect, useRef } from 'react'
import * as Sentry from '@sentry/react'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN

export default function ReportBugButton() {
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!btnRef.current) return
    const feedback = Sentry.getFeedback()
    if (!feedback) return
    try {
      feedback.attachTo(btnRef.current, { formTitle: 'Report a Bug' })
    } catch {
      // attachTo not available
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
