import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { isImagePath } from '../../../shared/image-files.js'
import type { WorkspaceImageResponse } from '../../../shared/ipc.js'

/** One request per mount/path; a late answer from a closed thread is discarded. */
export function requestAttachedImage(path: string, folder: string | undefined, read: ((path: string, folder?: string) => Promise<WorkspaceImageResponse>) | undefined, accept: (image: Extract<WorkspaceImageResponse, { ok: true }>) => void): () => void {
  let live = true
  if (isImagePath(path) && read !== undefined) {
    void read(path, folder).then((answer) => { if (live && answer.ok) accept(answer) }).catch(() => undefined)
  }
  return () => { live = false }
}

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
export function AttachedImage({ path, folder, render }: {
  readonly path: string
  readonly folder?: string | undefined
  readonly render?: (dataUrl: string, absolutePath: string) => ReactElement
}): ReactElement | null {
  const key = `${folder ?? ''}\n${path}`
  const [image, setImage] = useState<{ key: string; dataUrl: string; path: string }>()

  useEffect(() => {
    return requestAttachedImage(path, folder, window.desktop?.readWorkspaceImage, (answer) => setImage({ key, dataUrl: answer.dataUrl, path: answer.path }))
  }, [path, folder])

  if (image === undefined || image.key !== key) return null
  if (render !== undefined) return render(image.dataUrl, image.path)
  return (
    <img
      className="lc-thumb"
      src={image.dataUrl}
      alt={path}
      title={path}
      // The image is drawn at whatever size the CSS says; this pair keeps the
      // browser from reserving the wrong box before it loads.
      loading="lazy"
      decoding="async"
      onError={() => setImage(undefined)}
    />
  )
}
