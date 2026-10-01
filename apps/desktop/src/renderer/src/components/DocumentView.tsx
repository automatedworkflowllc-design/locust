import type { ReactElement } from 'react'

import type { DocumentBlock, OfficeDocument } from '../../../shared/office-document.js'

/**
 * A Word or PowerPoint file as a reading view (0.517): its headings,
 * paragraphs, list items and tables, and for a deck each slide under its
 * number and title. Every word is a React text node -- escaped, never parsed
 * as Markdown or HTML -- because a model wrote the file
 * (shared/office-document.ts).
 */
export function DocumentView({ document }: { readonly document: OfficeDocument }): ReactElement {
  const empty = document.blocks.length === 0
  return (
    <div className={`lc-docview${document.kind === 'slides' ? ' is-slides' : ''}`}>
      <p className="lc-docview__note lc-mono">
        {document.kind === 'slides'
          ? 'The words on each slide, in order. Pictures and layout are not shown.'
          : 'The words in this document. Pictures and layout are not shown.'}
      </p>
      {empty && <p className="lc-para lc-docview__p">{document.kind === 'slides' ? 'This deck has no words on its slides.' : 'This document has no words in it.'}</p>}
      {document.blocks.map((block, index) => (
        <Block key={String(index)} block={block} />
      ))}
      {document.more > 0 && (
        <p className="lc-docview__note lc-mono">{`${String(document.more)} more parts are not shown here.`}</p>
      )}
    </div>
  )
}

function Block({ block }: { readonly block: DocumentBlock }): ReactElement {
  if (block.kind === 'slide') {
    return (
      <h3 className="lc-docview__slide">
        <span className="lc-docview__slidenum lc-mono">{`Slide ${String(block.number)}`}</span>
        {block.title !== undefined && <span>{block.title}</span>}
      </h3>
    )
  }
  if (block.kind === 'heading') {
    // The reply's own heading sizes (ThreadItems): a document reads like the rest of the app.
    if (block.level === 1) return <h3 className="lc-heading lc-heading--1">{block.text}</h3>
    if (block.level === 2) return <h4 className="lc-heading lc-heading--2">{block.text}</h4>
    return <h5 className="lc-heading lc-heading--3">{block.text}</h5>
  }
  if (block.kind === 'item') {
    return (
      <p className="lc-para lc-docview__item" style={{ paddingInlineStart: `${String(14 + block.depth * 18)}px` }}>
        {block.text}
      </p>
    )
  }
  if (block.kind === 'table') {
    const [head, ...rest] = block.rows
    return (
      <div className="lc-tablewrap">
        <table className="lc-table">
          {head !== undefined && (
            <thead>
              <tr>{head.map((cell, index) => <th key={String(index)}>{cell}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {rest.map((row, rowIndex) => (
              <tr key={String(rowIndex)}>{row.map((cell, index) => <td key={String(index)}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <p className="lc-para lc-docview__p">{block.text}</p>
}
