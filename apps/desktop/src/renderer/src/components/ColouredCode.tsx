import { Fragment, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { colourCode, colouredAlready } from '../codeColors.js'
import type { ColouredToken } from '../codeColors.js'

/**
 * A code block's text, coloured once its grammar has loaded (codeColors.ts).
 * Drawn plain first and while it is still being written, so text never
 * changes shape under the person reading it: only its colour arrives.
 */
export function ColouredCode({ code, language, live = false }: { readonly code: string; readonly language?: string; readonly live?: boolean }): ReactElement {
  const [lines, setLines] = useState<readonly (readonly ColouredToken[])[] | undefined>(() => (live ? undefined : colouredAlready(code, language)))
  useEffect(() => {
    if (live) {
      setLines(undefined)
      return
    }
    const already = colouredAlready(code, language)
    setLines(already)
    if (already !== undefined) return
    let shown = true
    void colourCode(code, language).then((coloured) => {
      if (shown && coloured !== undefined) setLines(coloured)
    })
    return () => {
      shown = false
    }
  }, [code, language, live])
  if (lines === undefined) return <code>{code}</code>
  return (
    <code className="lc-code__coloured">
      {lines.map((line, at) => (
        <Fragment key={at}>
          {at > 0 && '\n'}
          {line.map((token, index) =>
            token.color === undefined ? (
              <Fragment key={index}>{token.content}</Fragment>
            ) : (
              <span key={index} style={{ color: token.color }}>
                {token.content}
              </span>
            )
          )}
        </Fragment>
      ))}
    </code>
  )
}
