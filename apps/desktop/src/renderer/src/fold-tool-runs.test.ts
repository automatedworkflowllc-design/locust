import { describe, expect, it } from 'vitest'

import { foldedToolsText, foldPlainToolRuns, FOLDED_TOOL_NAMES_SHOWN } from './missionView.js'
import type { ActivityEntry } from './missionView.js'

/*
 * B1 and B2 of docs/PLAN-2026-09-13-INTERACTION.md, from grok-build's
 * `group_tool_verbs` and `collapsed_edit_blocks`: fold runs of reads into one
 * row, never hide an edit, and never truncate a list without saying so.
 *
 * A turn that read eleven files drew eleven rows of equal weight, and the one
 * edit among them looked exactly like the ten reads.
 */
const tool = (name: string, over: Partial<ActivityEntry> = {}): ActivityEntry =>
  ({ kind: 'tool', key: `k_${name}`, name, tool: 'read', settled: true, failed: false, ...over }) as ActivityEntry

const shell = (command: string): ActivityEntry =>
  ({ kind: 'shell', key: `s_${command}`, command, settled: true, failed: false } as unknown) as ActivityEntry

describe('folding a run of plain tool calls', () => {
  it('folds two or more into one row that names and counts them', () => {
    const folded = foldPlainToolRuns([tool('a.ts'), tool('b.ts'), tool('c.ts')])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.kind).toBe('tools')
    const row = folded[0]
    expect(row?.kind === 'tools' ? row.names : []).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(row?.kind === 'tools' ? row.verb : undefined).toBe('read')
  })

  it('leaves a single tool call exactly as it was', () => {
    // Folding one thing would be the same row with its name taken off.
    const one = [tool('a.ts')]
    expect(foldPlainToolRuns(one)).toEqual(one)
  })

  it('NEVER folds a command or a file change, even between reads', () => {
    const rows = [tool('a.ts'), shell('pnpm test'), tool('b.ts'), tool('c.ts')]
    const folded = foldPlainToolRuns(rows)
    expect(folded).toHaveLength(3)
    expect(folded[0]?.kind).toBe('tool')
    expect(folded[1]?.kind).toBe('shell')
    expect(folded[2]?.kind).toBe('tools')
  })

  it('NEVER folds a failed call, or one still running', () => {
    // The two a person is most likely to be looking for.
    const failed = [tool('a.ts'), tool('b.ts', { failed: true }), tool('c.ts')]
    expect(foldPlainToolRuns(failed).map((row) => row.kind)).toEqual(['tool', 'tool', 'tool'])

    const running = [tool('a.ts'), tool('b.ts', { settled: false }), tool('c.ts')]
    expect(foldPlainToolRuns(running).map((row) => row.kind)).toEqual(['tool', 'tool', 'tool'])
  })

  it('drops the shared verb when the run does not share one', () => {
    const folded = foldPlainToolRuns([tool('a.ts'), tool('b.ts', { tool: 'grep' })])
    const row = folded[0]
    expect(row?.kind === 'tools' ? row.verb : 'set').toBeUndefined()
  })
})

describe('what a folded row says', () => {
  it('leads with the shared verb and the count', () => {
    expect(foldedToolsText(['a.ts', 'b.ts'], 'read')).toBe('Read 2 files — a.ts, b.ts')
  })

  it('counts tool calls when there is no shared verb', () => {
    expect(foldedToolsText(['a.ts', 'b.ts'], undefined)).toBe('2 tool calls — a.ts, b.ts')
  })

  it('says how many it is not showing, rather than stopping silently', () => {
    const names = Array.from({ length: 11 }, (_unused, index) => `f${String(index)}.ts`)
    const said = foldedToolsText(names, 'read')
    expect(said).toContain('Read 11 files')
    expect(said).toContain(`… ${String(11 - FOLDED_TOOL_NAMES_SHOWN)} more`)
    // And the names it DOES show are the first ones, in order.
    expect(said).toContain('f0.ts, f1.ts, f2.ts')
  })

  it('adds no tail when the whole list fits', () => {
    expect(foldedToolsText(['a.ts'], 'read')).not.toContain('more')
  })
})
