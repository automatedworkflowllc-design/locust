import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import {
  changedPaths,
  observedEditEvents,
  parsePorcelain,
  snapshotWorkspace,
  unreportedPaths
} from './disk-observation.js'

const NUL = String.fromCharCode(0)

function toolEvent(type: 'tool.started' | 'tool.completed', name: string, command?: string): NormalizedRuntimeEvent {
  return {
    id: `e-${name}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence: 1,
    type,
    occurredAt: '2026-09-05T00:00:00.000Z',
    sourceAdapter: 'opencode',
    payload: {
      itemId: `i-${name}`,
      toolKind: 'tool',
      name,
      ...(command === undefined ? {} : { command }),
      phase: type === 'tool.started' ? 'started' : 'completed',
      evidence: { redacted: true }
    }
  } as unknown as NormalizedRuntimeEvent
}

describe('reading git status', () => {
  it('parses the NUL-separated porcelain form, including a rename with its source', () => {
    const output = ` M src/notes.ts${NUL}?? scratch/new.md${NUL}R  old.ts${NUL}new.ts${NUL}`
    const snapshot = parsePorcelain(output)
    expect([...snapshot.entries()]).toEqual([
      ['src/notes.ts', ' M'],
      ['scratch/new.md', '??'],
      ['old.ts', 'R ']
    ])
  })

  it('is nothing at all when git cannot answer -- outside a repository, or with no git', async () => {
    const snapshot = await snapshotWorkspace('C:/work/pebble', {
      runGit: async () => {
        throw new Error('fatal: not a git repository')
      }
    })
    expect(snapshot).toBeUndefined()
  })

  it('asks for untracked files one by one, so a new file inside a new folder is a path, not a folder', async () => {
    const asked: string[][] = []
    await snapshotWorkspace('C:/work/pebble', {
      runGit: async (args) => {
        asked.push([...args])
        return ''
      }
    })
    expect(asked[0]).toEqual(['status', '--porcelain', '-z', '--untracked-files=all'])
  })
})

describe('what changed between two looks', () => {
  it('names a file that became dirty, one that changed kind, and one that was cleaned', () => {
    const before = parsePorcelain(`?? a.txt${NUL} M b.ts${NUL}`)
    const after = parsePorcelain(`?? a.txt${NUL}A  b.ts${NUL} M c.ts${NUL}`)
    expect(changedPaths(before, after)).toEqual(['b.ts', 'c.ts'])
    // Dirty before, gone after: reverted or committed, still a change.
    expect(changedPaths(parsePorcelain(` M z.ts${NUL}`), parsePorcelain(''))).toEqual(['z.ts'])
  })

  it('is empty when nothing moved', () => {
    const same = parsePorcelain(` M b.ts${NUL}`)
    expect(changedPaths(same, same)).toEqual([])
  })
})

describe('which changes the runtime never mentioned', () => {
  // The 2026-09-05 case: OpenCode's stream said `task` and `read notes.ts`,
  // and notes.ts changed. A read is not an edit, but the runtime DID name the
  // file, so the observation would only repeat a row that exists; the
  // unreported edit is the one it never said a word about.
  it('keeps a changed path no tool named, and drops one a tool did name', () => {
    const events = [toolEvent('tool.started', 'task'), toolEvent('tool.started', 'read', 'src/notes.ts')]
    expect(unreportedPaths(['src/notes.ts', 'src/other.ts'], events)).toEqual(['src/other.ts'])
  })

  it('matches on the file name, whatever the runtime wrote before it, case-blind', () => {
    const events = [toolEvent('tool.completed', 'Edit', 'C:\\Work\\Pebble\\SRC\\NOTES.TS')]
    expect(unreportedPaths(['src/notes.ts'], events)).toEqual([])
  })
})

describe('the rows the observation adds', () => {
  it('is a started/completed pair per path, contiguous in sequence, labelled as observed', () => {
    const events = observedEditEvents({
      runId: 'run_1',
      missionId: 'mission_1',
      sourceAdapter: 'opencode',
      nextSequence: 12,
      paths: ['src/notes.ts', 'README.md'],
      at: '2026-09-05T01:00:00.000Z'
    })
    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [12, 'tool.started'],
      [13, 'tool.completed'],
      [14, 'tool.started'],
      [15, 'tool.completed']
    ])
    const first = events[0]!
    expect(first.sourceAdapter).toBe('opencode')
    expect(first.id).toBe('run_1:disk:12')
    expect(first.payload).toMatchObject({
      itemId: 'disk-observed-1',
      name: 'edit',
      command: 'src/notes.ts',
      status: 'observed on disk',
      phase: 'started'
    })
    expect(events[1]!.payload).toMatchObject({ itemId: 'disk-observed-1', phase: 'completed' })
    expect(events[3]!.payload).toMatchObject({ itemId: 'disk-observed-2', command: 'README.md' })
  })

  it('adds nothing for nothing', () => {
    expect(
      observedEditEvents({
        runId: 'run_1',
        missionId: 'mission_1',
        sourceAdapter: 'codex',
        nextSequence: 1,
        paths: [],
        at: '2026-09-05T01:00:00.000Z'
      })
    ).toEqual([])
  })
})
