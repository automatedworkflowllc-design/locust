import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A DIALOG IS NEVER TALLER THAN THE WINDOW.
 *
 * Colin, 2026-09-22: "its folding under the app again, when i hit new
 * teammate, on the plus sign". Measured on 0.275 at 1120x720: the New teammate
 * dialog was 786px tall, centred, so its head sat 32px above the window and
 * "Create teammate" 18px below it (_tools/drive-new-teammate-fit.mjs). The
 * rule is shared by every dialog, so this holds them all to it.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}

describe('a dialog', () => {
  it('is capped at the window height, as a column', () => {
    const dialog = rule('.lc-dialog')
    expect(dialog).toContain('max-height: calc(100% - var(--lc-space-8))')
    expect(dialog).toContain('display: flex')
    expect(dialog).toContain('flex-direction: column')
  })

  it('starts below the title bar, which is a drag region', () => {
    expect(rule('.lc-scrim')).toContain('inset: var(--lc-titlebar-height) 0 0 0')
    expect(rule('.lc-titlebar')).toContain('height: var(--lc-titlebar-height)')
  })

  it('keeps its name and its buttons on screen, and scrolls what is between', () => {
    expect(rule('.lc-dialog__head')).toContain('flex-shrink: 0')
    expect(rule('.lc-dialog__foot')).toContain('flex-shrink: 0')
    const body = rule('.lc-dialog__body')
    expect(body).toContain('overflow-y: auto')
    expect(body).toContain('min-height: 0')
  })
})
