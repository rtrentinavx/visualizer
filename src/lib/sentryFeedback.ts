import * as Sentry from '@sentry/react'

let cachedDialog: {
  appendToDom: () => void
  open: () => void
  close: () => void
  removeFromDom: () => void
} | null = null

/**
 * Open the Sentry User Feedback dialog.
 *
 * In Sentry v10, getFeedback().createForm() is async and returns a dialog
 * object that must be appended to the DOM and then opened.
 *
 * Falls back to a mailto: link if Sentry is not initialized.
 */
export async function openBugReport(): Promise<void> {
  try {
    const feedback = Sentry.getFeedback()
    if (!feedback) {
      throw new Error('Sentry feedback integration not available')
    }

    // Re-use an existing dialog if we already created one
    if (cachedDialog) {
      cachedDialog.open()
      return
    }

    const dialog = await feedback.createForm()
    cachedDialog = dialog
    dialog.appendToDom()
    dialog.open()
    return
  } catch (err) {
    console.warn('Sentry feedback failed, falling back to mailto:', err)

    // Fallback: open a mailto link
    window.location.href =
      'mailto:dcf-visualizer-feedback@example.com?subject=DCF%20Visualizer%20Bug%20Report&body=Describe%20the%20issue%20you%20encountered%3A%0A%0A'
  }
}

/**
 * Returns true if Sentry feedback is available.
 */
export function isSentryFeedbackAvailable(): boolean {
  try {
    return !!Sentry.getFeedback()
  } catch {
    return false
  }
}
