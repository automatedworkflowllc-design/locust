import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { BootScreen } from './components/BootScreen.js'
import { applyDiscoveryEvent, bootView, emptyBoot, phaseAt } from './bootView.js'
import type { BootState } from './bootView.js'

/**
 * The loading window.
 *
 * Its own window, shown before the app and closing when the runtimes have
 * answered — the ordinary shape of an application splash, and what Colin
 * asked for: *"have just that monitor screen be the loading screen and once
 * its done, THEN go to our app with its normal splash with all runtimes
 * should be connected."*
 *
 * It renders the same `BootScreen` the pane used, so there is one boot
 * screen in this codebase rather than two that drift. What is different is
 * only what surrounds it: nothing. No sidebar, no composer, no workspace —
 * so nothing is being covered up, which was the whole objection to a
 * takeover when the app was already on screen.
 *
 * When the sequence ends it tells the host, which shows the app window it
 * has been holding ready and closes this one.
 */
export function SplashApp(): ReactElement {
  const [boot, setBoot] = useState<BootState>(emptyBoot)
  const [now, setNow] = useState(() => Date.now())
  const finished = useRef(false)

  useEffect(() => {
    const bridge = window.desktop
    if (bridge === undefined) return
    // The backlog first, then whatever happens next: the host records its
    // log from the moment the sweep starts, and this window mounts after.
    void bridge
      .discoveryLog()
      .then((events) => setBoot((held) => events.reduce(applyDiscoveryEvent, held)))
      .catch(() => undefined)
    return bridge.onDiscoveryEvent((event) => {
      setBoot((held) => applyDiscoveryEvent(held, event))
    })
  }, [])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(tick)
  }, [])

  const phase = boot.finished === undefined ? (boot.phase === 'idle' ? 'idle' : 'probing') : phaseAt(boot.finished.at, now)

  /*
   * Said ONCE, and never from inside render.
   *
   * A splash that reported itself done twice would close a window that had
   * already gone; one that never reported would hold the app behind it
   * forever, which is the worse of the two, so the host also shows the app
   * if this window is closed by hand.
   */
  useEffect(() => {
    if (phase !== 'gone' || finished.current) return
    finished.current = true
    window.desktop?.splashDone()
  }, [phase])

  return (
    <div className="lc-splash">
      <BootScreen
        view={bootView(boot, phase, now)}
        tube="full"
        // Clicking the loading screen ends it early rather than doing
        // nothing: the runtimes carry on answering in the app behind it.
        onSkip={() => {
          if (finished.current) return
          finished.current = true
          window.desktop?.splashDone()
        }}
      />
    </div>
  )
}
