import { Component } from 'react'
import type { ErrorInfo, ReactElement, ReactNode } from 'react'

/**
 * WHAT THE WINDOW SHOWS IF DRAWING IT FAILS (0.543, the 0.536 code review
 * UI-01).
 *
 * Nothing caught a render that threw, so one malformed record anywhere in the
 * window left it blank, with nothing to press. Every conversation is on disk
 * and a reload draws it again, so the screen says that and offers the reload.
 * What threw goes to the console for whoever is looking, never onto the page.
 */
export class WindowFallback extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Locust could not draw the window', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return <WindowFailed />
  }
}

function WindowFailed(): ReactElement {
  return (
    <main className="lc-windowfailed" role="alert">
      <h1 className="lc-windowfailed__title">Locust could not draw this window</h1>
      <p className="lc-windowfailed__body">
        Your conversations and teammates are saved. Reloading draws the window again.
      </p>
      <button type="button" className="lc-windowfailed__reload" onClick={() => window.location.reload()}>
        Reload the window
      </button>
    </main>
  )
}
