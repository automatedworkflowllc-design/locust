import type { ReactElement } from 'react'

/**
 * THE METAL COMPOSER'S OWN GLYPHS, copied from libraries.dev's metal page
 * (sites/home/src/examples/metal-examples-v2.tsx in Jakubantalik/Libraries.dev).
 *
 * Colin, 2026-09-23: "i wanted those same drop downs and chat box as well,
 * the exact thing besides the additions i told you". The app's own icon set
 * draws a smaller arrowhead and a thinner plus; these are the page's, so the
 * box reads as the one he pointed at. Decorative: every control that wears
 * one names itself.
 */

export function PlusGlyph(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function ArrowUpGlyph(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

/** A right chevron the chip's stylesheet turns downward, as the page does. */
export function ChevronGlyph(): ReactElement {
  return (
    <svg className="lc-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 11L10 8L7 5" />
    </svg>
  )
}
