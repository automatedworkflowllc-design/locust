import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { pdfPictureOf } from '../pdfPages.js'

/**
 * A PDF'S PAGES IN THE VIEWER (0.714): the pictures Locust drew of it, one
 * under another, each as printed. Read, never run -- a picture of a page
 * executes nothing, which is why the viewer can show a PDF at all (the
 * viewer's rule: Locust never launches a file). Pages past the ones drawn
 * are said, not left out silently.
 */
export function PdfPages({ name, pages, pictures, folder }: {
  readonly name: string
  readonly pages: number
  readonly pictures: readonly string[]
  readonly folder: string | undefined
}): ReactElement {
  const [drawn, setDrawn] = useState<readonly (string | undefined)[]>([])
  useEffect(() => {
    let live = true
    setDrawn([])
    void (async () => {
      // In order, so page 1 is there first and the rest follow it down.
      for (const [index, picture] of pictures.entries()) {
        const url = await pdfPictureOf(picture, folder)
        if (!live) return
        setDrawn((held) => {
          const next = [...held]
          next[index] = url
          return next
        })
      }
    })()
    return () => {
      live = false
    }
  }, [pictures, folder])
  return (
    <div className="lc-pdfpages">
      {pictures.map((picture, index) => (
        <figure className="lc-pdfpages__page" key={picture}>
          {drawn[index] === undefined ? (
            <span className="lc-pdfpages__waiting" aria-label={`Page ${String(index + 1)}, being drawn`} />
          ) : (
            <img src={drawn[index]} alt={`${name}, page ${String(index + 1)}`} />
          )}
          <figcaption className="lc-pdfpages__number">{`${String(index + 1)} of ${String(pages)}`}</figcaption>
        </figure>
      ))}
      {pages > pictures.length && (
        <p className="lc-pdfpages__more">
          {`Locust drew the first ${String(pictures.length)} of its ${String(pages)} pages. Show it in the file manager to read the rest in your PDF app.`}
        </p>
      )}
    </div>
  )
}
