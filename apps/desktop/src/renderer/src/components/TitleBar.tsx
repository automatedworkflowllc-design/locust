import type { ReactElement } from 'react'

import { Icon } from './Icon.js'

/**
 * Window chrome. The design draws macOS traffic lights; this build runs on
 * Windows and owns its own window-control IPC, so the look is kept (mono
 * workspace title centered, run state at the right) and the controls are ours.
 * Per-platform chrome is worth revisiting when a mac build exists.
 */
export function TitleBar({
  workspaceName,
  runningCount
}: {
  readonly workspaceName: string
  readonly runningCount: number
}): ReactElement {
  return (
    <header className="lc-titlebar" onDoubleClick={() => window.desktop?.toggleMaximize()}>
      <span />
      <span className="lc-titlebar__title">{workspaceName}</span>
      <div className="lc-titlebar__right" onDoubleClick={(event) => event.stopPropagation()}>
        {runningCount > 0 && (
          <span className="lc-runstate">
            <span className="lc-dot is-pulsing lc-tone-lime" />
            {runningCount} running
          </span>
        )}
        <div className="lc-windowcontrols">
          <button type="button" aria-label="Minimize" onClick={() => window.desktop?.minimize()}>
            <Icon name="minimize" size={14} />
          </button>
          <button type="button" aria-label="Maximize" onClick={() => window.desktop?.toggleMaximize()}>
            <Icon name="maximize" size={12} />
          </button>
          <button type="button" className="lc-close" aria-label="Close" onClick={() => window.desktop?.close()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </header>
  )
}
