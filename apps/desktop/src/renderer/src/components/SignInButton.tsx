import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { signInCommand } from '../../../shared/runtime-install.js'
import { SIGN_IN_OPENED_EVENT } from '../signInEvents.js'

/**
 * SIGN IN, as a button.
 *
 * The row used to print `run muse login` and stop. Colin, 2026-09-22: signed
 * in to Meta in his browser, told to sign in again, with no idea where. A CLI
 * cannot borrow the browser's session, so the sign-in itself stays; the
 * terminal hunt goes. Pressing this opens the runtime's own sign-in in a
 * window of its own, and the row turns ready by itself once Locust is back
 * in front and asks again.
 *
 * The command stays reachable: it is the button's title, and it is what the
 * row falls back to when the window cannot be opened.
 */
export function SignInButton({ runtime }: { readonly runtime: string }): ReactElement | null {
  const [state, setState] = useState<'idle' | 'opening' | 'opened' | { readonly failed: string }>('idle')
  const command = signInCommand(runtime)
  // Back in front means the window was dealt with, one way or the other. If
  // it signed in, discovery's own focus re-probe turns the row READY and this
  // button goes with it; if it was closed unfinished, the row must offer the
  // button again rather than keep pointing at a window that is gone.
  useEffect(() => {
    if (state !== 'opened') return
    const back = (): void => setState('idle')
    const armed = window.setTimeout(() => window.addEventListener('focus', back), 1000)
    return () => {
      window.clearTimeout(armed)
      window.removeEventListener('focus', back)
    }
  }, [state])
  if (command === undefined) return null
  if (state === 'opened') {
    return <span className="lc-runtimecell__signin">Finish in the window that opened.</span>
  }
  if (typeof state === 'object') {
    return (
      <span className="lc-runtimecell__signin" title={state.failed}>
        <span className="lc-mono">{command}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      className="lc-runtimecell__install"
      title={`Opens a window that runs: ${command.replace(/^run /, '')}`}
      disabled={state === 'opening'}
      onClick={() => {
        const bridge = window.desktop
        if (!bridge) return
        setState('opening')
        void bridge
          .signInRuntime(runtime)
          .then((response) => {
            setState(response.ok ? 'opened' : { failed: `${response.what} ${response.next}` })
            // The window asks again the moment the person comes back to it.
            if (response.ok) window.dispatchEvent(new Event(SIGN_IN_OPENED_EVENT))
          })
          .catch(() => setState({ failed: 'The sign-in window could not be opened. Run the command shown in a terminal.' }))
      }}
    >
      Sign in
    </button>
  )
}
