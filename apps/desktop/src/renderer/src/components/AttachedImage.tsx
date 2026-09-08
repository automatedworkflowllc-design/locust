import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { isImagePath } from '../../../shared/image-files.js'

/**
 * An attached image, drawn as itself.
 *
 * Colin asked for images in chat, and the measurements say they already work:
 * pointed at a path, Claude Code, Cursor and Copilot all opened a screenshot
 * and described it (`docs/ATTACHMENTS-MEASURED-2026-09-08.md`). So the model
 * side needed nothing. What was missing was the person's side -- attaching a
 * screenshot and seeing the word `shot.png`, with no way to tell which
 * screenshot it was without leaving the app.
 *
 * Three deliberate choices:
 *
 *   IT NEVER REPLACES THE NAME. The thumbnail sits with the file row rather
 *   than instead of it, because the runtime was given a PATH and the path is
 *   what any answer will refer to.
 *
 *   A FAILURE DRAWS NOTHING. Too large, unreadable, not a format we paint --
 *   every one of those leaves the row exactly as it would have been. A broken
 *   image icon would be the app reporting its own plumbing to someone who
 *   asked about a file.
 *
 *   IT ASKS ONCE. The host answers with a `data:` URL, which is held for as
 *   long as this row is mounted and no longer; nothing caches across threads,
 *   because a thread with twenty screenshots in it should not keep twenty
 *   copies alive after it is closed.
 */
export function AttachedImage({ path }: { readonly path: string }): ReactElement | null {
  const [dataUrl, setDataUrl] = useState<string>()

  useEffect(() => {
    if (!isImagePath(path)) return
    let live = true
    const bridge = window.desktop
    if (bridge === undefined) return
    void bridge
      .readWorkspaceImage(path)
      .then((answer) => {
        // `live` guards the case that matters here: a thread switched away
        // from while its images are still being read would otherwise set
        // state on a row that is gone.
        if (live && answer.ok) setDataUrl(answer.dataUrl)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [path])

  if (dataUrl === undefined) return null
  return (
    <img
      className="lc-thumb"
      src={dataUrl}
      alt={path}
      title={path}
      // The image is drawn at whatever size the CSS says; this pair keeps the
      // browser from reserving the wrong box before it loads.
      loading="lazy"
      decoding="async"
    />
  )
}
