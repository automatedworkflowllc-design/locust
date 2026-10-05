import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'
import { DiffView } from './components/DiffView.js'
import { afterText, parseUnifiedDiff } from './diff.js'
import type { ActivityDetail } from './missionView.js'

/**
 * A CHANGE CAN BE COPIED, as Claude Code offers it (0.649).
 *
 * Colin, 2026-10-05, of Claude Code's copy icon on a changed file: "if its a
 * code change shouldnt it copy the code if its a file change shouldnt it copy
 * the file". An opened change copies the code as it reads after the change;
 * a changed file's row copies the whole file, read when asked.
 */
;(globalThis as { window?: unknown }).window = { desktop: { platform: 'win32' } }

const edit = [
  '--- a/src/cart.js',
  '+++ b/src/cart.js',
  '@@ -1,3 +1,3 @@',
  ' function total(items) {',
  '-  return sum(items) * 2',
  '+  return sum(items)',
  ' }',
  '@@ -10,2 +10,3 @@',
  ' export { total }',
  '+export { sum }',
  ' // end'
].join('\n')

const created = ['--- /dev/null', '+++ b/notes.md', '@@ -0,0 +1,2 @@', '+# Notes', '+First line'].join('\n')

describe('copying a change', () => {
  it('gives the code as it reads after an edit: no signs, no removed lines, parts apart', () => {
    const [file] = parseUnifiedDiff(edit)
    expect(afterText(file!)).toBe(['function total(items) {', '  return sum(items)', '}', '', 'export { total }', 'export { sum }', '// end'].join('\n'))
  })

  it('gives a new file whole, and nothing for a deleted one', () => {
    const [file] = parseUnifiedDiff(created)
    expect(afterText(file!)).toBe('# Notes\nFirst line')
    expect(afterText({ ...file!, status: 'DELETED' })).toBeUndefined()
  })

  it('offers Copy at the foot of an opened change', () => {
    const [file] = parseUnifiedDiff(edit)
    const html = renderToStaticMarkup(<DiffView file={file!} truncated={false} reported={undefined} />)
    expect(html).toContain('lc-diff__copy')
    expect(html).toContain('Copy the new code in src/cart.js')
  })

  it("offers Copy on a changed file's row, beside Open and Show", () => {
    const detail = { kind: 'edit', name: 'src/cart.js', tool: 'edit', settled: true, patch: { text: edit } } as unknown as ActivityDetail
    const html = renderToStaticMarkup(
      <ActivityCard summary="edited 1 file" details={[detail]} runtimeName="OpenCode" workspacePath="C:/work" openByDefault onOpenFile={() => undefined} />
    )
    expect(html).toContain('lc-filerow__copy')
    expect(html).toContain('Copy src/cart.js')
  })
})
