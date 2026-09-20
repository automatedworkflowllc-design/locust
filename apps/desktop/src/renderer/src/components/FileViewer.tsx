import type { ReactElement } from 'react'

import { AgentText } from './ThreadItems.js'
import { Icon } from './Icon.js'

/**
 * A file a teammate wrote, open beside the conversation.
 *
 * Colin, 2026-09-20: *"is there a way like what claude code has where when you
 * click a file/md it opens it over here near where our activity would be if
 * opened? would be a good QOL update."* Until now a teammate wrote you a
 * report and the app's best offer was a file manager.
 *
 * It shares the inspector's region rather than inventing one. That region
 * already knows how to sit beside the thread without covering the composer --
 * which cost a release to get right (0.187.0, at 1120x720) -- and a second
 * drawer would be a second answer to "what is this panel".
 *
 * IT RENDERS AND IT NEVER RUNS. Markdown goes through `AgentText`, the same
 * renderer every reply uses: React escapes every value, so nothing in the
 * file can become markup, and links go through the host's own outbound rules
 * rather than the browser's. Anything else is monospace in its own scroll box.
 * A file in this workspace was written by a MODEL, which is the same threat
 * model as a reply and the reason `shell.openPath` is refused in
 * `reveal-file.ts`. Do not add an "open externally" control here.
 */
export function FileViewer({
  path,
  text,
  mode,
  onClose,
  onReveal,
  onSave
}: {
  readonly path: string
  readonly text: string
  readonly mode: 'markdown' | 'code'
  readonly onClose: () => void
  /** Show it in the file manager -- the thing the pill did before this existed. */
  readonly onReveal: () => void
  readonly onSave: () => void
}): ReactElement {
  return (
    <aside className="lc-viewer" aria-label={`Viewing ${path}`}>
      <div className="lc-viewer__head">
        <Icon name="file" size={13} />
        {/*
          * The full path in the title, the name in the tab. A viewer that
          * says only `report.md` cannot tell you WHICH report.md, and the
          * pane is too narrow for the path at any useful size.
          */}
        <span className="lc-viewer__name" title={path}>
          {path.replace(/\\/g, '/').split('/').pop() ?? path}
        </span>
        <span className="lc-viewer__spacer" />
        <button type="button" className="lc-viewer__action" title="Show it in the file manager" onClick={onReveal}>
          <Icon name="folder" size={13} />
        </button>
        <button type="button" className="lc-viewer__action" title="Save a copy…" onClick={onSave}>
          <Icon name="download" size={13} />
        </button>
        <button type="button" className="lc-viewer__close" aria-label="Close the file" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="lc-viewer__scroll">
        {mode === 'markdown' ? (
          <div className="lc-viewer__prose">
            <AgentText text={text} streaming={false} />
          </div>
        ) : (
          /*
           * Its own horizontal scroll, never the pane's. A long line in a log
           * must not make the whole drawer scroll sideways -- that is the
           * rule every wide thing in this app follows.
           */
          <pre className="lc-viewer__code">{text}</pre>
        )}
      </div>
    </aside>
  )
}
