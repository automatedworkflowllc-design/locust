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
 */
export function MathTex({ tex, display }: { readonly tex: string; readonly display: boolean }): ReactElement {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', trust: false, strict: 'ignore', maxSize: 20, maxExpand: 500 })
    } catch {
      return undefined
    }
  }, [tex, display])
  if (html === undefined) {
    const written = display ? `$$${tex}$$` : `$${tex}$`
    return display ? <pre className="lc-math lc-math--display lc-mono">{written}</pre> : <code className="lc-code">{written}</code>
  }
  return display
    ? <div className="lc-math lc-math--display" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="lc-math" dangerouslySetInnerHTML={{ __html: html }} />
}
