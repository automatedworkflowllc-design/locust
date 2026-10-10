import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { pdfMeta, pdfPagesOf, pdfPictureOf } from '../pdfPages.js'

/**
 * A PDF YOU ATTACHED, AS A CARD (0.714).
 *
 * It was a monospace chip holding the path Locust copied it to --
 * `.locust/attachments/Homework 5.pdf` -- where Codex's own app, in the same
 * tester's photo, showed the file as a file. The card is the file's first
 * page, its name and how many pages it has, from the pictures Locust drew for
 * the agent; pressing it opens every page in the viewer beside the
 * conversation. While the pictures are being drawn it says "PDF" and nothing
 * it does not know yet.
 */
export function PdfTile({ path, folder, onOpen }: { readonly path: string; readonly folder: string | undefined; readonly onOpen: () => void }): ReactElement {
  const [count, setCount] = useState<number>()
  const [thumb, setThumb] = useState<string>()
  useEffect(() => {
    let live = true
    void pdfPagesOf(path, folder).then((answer) => {
      if (!live || !answer.ok) return
      setCount(answer.pages)
      const first = answer.pictures[0]
      if (first !== undefined) void pdfPictureOf(first, folder).then((url) => {
        if (live && url !== undefined) setThumb(url)
      })
    })
    return () => {
      live = false
    }
  }, [path, folder])
  const name = path.replace(/\\/g, '/').split('/').pop() ?? path
  return (
    <button type="button" className="lc-pdftile" title={`Open ${name}`} onClick={onOpen}>
      <span className={`lc-pdftile__page${thumb === undefined ? ' is-waiting' : ''}`} aria-hidden="true">
        {thumb === undefined ? <span className="lc-pdftile__badge">PDF</span> : <img src={thumb} alt="" />}
      </span>
      <span className="lc-pdftile__text">
        <span className="lc-pdftile__name">{name}</span>
        <span className="lc-pdftile__meta">{pdfMeta(count)}</span>
      </span>
    </button>
  )
}
