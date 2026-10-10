import { useMemo } from 'react'
import type { ReactElement } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * MATH, DRAWN (a tester's math homework, 2026-09-29).
 *
 * A reply of linear algebra reached the thread as raw LaTeX -- `$c_1=y$`,
 * `$$\begin{pmatrix}...$$` -- because nothing drew it. KaTeX (MIT) draws it,
 * on this machine, with its fonts bundled: no network. `trust: false`, so
 * nothing in a model's TeX can make a link, a class or an image. What KaTeX
 * cannot read is shown as the TeX it is, never dropped.
 *
 * `inText`: drawn inside a run of prose -- a paragraph, a list item, a table
 * cell -- where a block element may not go. A displayed equation there is a
 * span drawn as a block (0.713), so a `<p>` never holds a `<div>`.
 */
export function MathTex({ tex, display, inText = false }: { readonly tex: string; readonly display: boolean; readonly inText?: boolean }): ReactElement {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', trust: false, strict: 'ignore', maxSize: 20, maxExpand: 500 })
    } catch {
      return undefined
    }
  }, [tex, display])
  if (html === undefined) {
    const written = display ? `$$${tex}$$` : `$${tex}$`
    return display && !inText ? <pre className="lc-math lc-math--display lc-mono">{written}</pre> : <code className="lc-code">{written}</code>
  }
  if (display && inText) return <span className="lc-math lc-math--display lc-math--intext" dangerouslySetInnerHTML={{ __html: html }} />
  return display
    ? <div className="lc-math lc-math--display" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="lc-math" dangerouslySetInnerHTML={{ __html: html }} />
}
