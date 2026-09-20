import { useState } from 'react'
import type { ReactElement } from 'react'

import type { FileTurn } from '../missionView.js'
import { AgentText } from './ThreadItems.js'
import { DiffView } from './DiffView.js'
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
  turns = [],
  onClose,
  onReveal,
  onSave
}: {
  readonly path: string
  readonly text: string
  readonly mode: 'markdown' | 'code'
  /**
   * The turns in this conversation that changed this file, oldest first.
   *
   * Empty for a file nobody here touched -- a project file a teammate only
   * read, say -- and the strip is then absent rather than present and empty.
   */
  readonly turns?: readonly FileTurn[]
  readonly onClose: () => void
  /** Show it in the file manager -- the thing the pill did before this existed. */
  readonly onReveal: () => void
  readonly onSave: () => void
}): ReactElement {
  /** Which turn's change is being read, or undefined for the file as it is. */
  const [showing, setShowing] = useState<number>()
  const version = showing === undefined ? undefined : turns[showing]
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
      {/*
        * WHAT THIS FILE HAS BEEN THROUGH, when this conversation put it there.
        *
        * Colin asked for artifacts; this is the half of the word that is a
        * READING feature over what the ledger already keeps. Each chip is a
        * turn that changed this file, oldest on the left, and pressing one
        * shows the change that turn made.
        *
        * It says "changed in" and never "as it looked", because it is not
        * that: reverse-applying the recorded patches would build a
        * convincing document out of an incomplete record -- patches arrive
        * truncated, and some runtimes report an edit with no diff at all.
        * The label is the feature's honesty, not decoration on it.
        */}
      {turns.length > 0 && (
        <div className="lc-viewer__versions">
          <span className="lc-viewer__versionlabel lc-mono">
            CHANGED IN {turns.length} {turns.length === 1 ? 'TURN' : 'TURNS'}
          </span>
          <span className="lc-viewer__spacer" />
          {turns.map((turn, index) => (
            <button
              key={`${turn.missionId}_${String(index)}`}
              type="button"
              className={`lc-viewer__version${showing === index ? ' is-showing' : ''}`}
              /* The ask, so a version has a reason on it and not just a number. */
              title={turn.prompt}
              aria-pressed={showing === index}
              onClick={() => setShowing(showing === index ? undefined : index)}
            >
              {index + 1}
            </button>
          ))}
          <button
            type="button"
            className={`lc-viewer__version is-now${showing === undefined ? ' is-showing' : ''}`}
            title="The file as it is on disk now"
            aria-pressed={showing === undefined}
            onClick={() => setShowing(undefined)}
          >
            Now
          </button>
        </div>
      )}
      {version !== undefined ? (
        <div className="lc-viewer__scroll">
          <p className="lc-viewer__versionnote">
            What turn {String((showing ?? 0) + 1)} changed. The file itself is under <strong>Now</strong>.
          </p>
          <DiffView file={version.file} truncated={version.truncated} reported={version.reported} />
        </div>
      ) : (
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
      )}
      {/*
        * THE REASON THE OPEN BUTTON IS MISSING, said out loud.
        *
        * Design agent's ruling, 2026-09-20: the three controls are the right
        * words, and "what is absent is the reason. A person who wants to open
        * a .md and cannot will read the missing control as an oversight, not
        * a decision -- and the decision is a good one that the panel is
        * currently keeping to itself."
        *
        * It is a standing fact about how the app works rather than a message
        * about this file, so it sits at the foot of the panel and never
        * changes. It also stops Reveal looking like the safe fallback for a
        * control somebody forgot.
        */}
      <p className="lc-viewer__register">
        Locust does not open files — a teammate chose this file's name and contents. Reveal hands it to Windows.
      </p>
    </aside>
  )
}
