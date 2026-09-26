import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import {
  changedPaths,
  observedEditEvents,
  observedPatches,
  parsePorcelain,
  statusOf,
  textOf,
  snapshotWorkspace,
  unreportedPaths,
  MAX_UNTRACKED_TEXTS
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

  it('looks at the folder itself when git cannot answer, and is nothing when that cannot be read either', async () => {
    // Outside a repository, or with no git: the plain folder is walked
    // instead (0.365, a-plain-folder-is-watched-too). A folder that is not
    // there gives no observation at all.
    const snapshot = await snapshotWorkspace('C:/work/pebble-not-here-0365', {
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
  // and notes.ts changed. A read is not an edit: the thread draws it as a
  // read, so the change it sat beside appeared nowhere until 0.364 -- when a
  // command that only MENTIONED monthly_budget.xlsx hid a whole new workbook
  // the same way (Research & money drive, packaged 0.363).
  it('keeps a changed path only a read or a command named, and drops one an edit named', () => {
    const events = [
      toolEvent('tool.started', 'task'),
      toolEvent('tool.started', 'read', 'src/notes.ts'),
      toolEvent('tool.started', 'bash', "python3 -c \"import openpyxl; wb.save('monthly_budget.xlsx')\""),
      toolEvent('tool.started', 'write', 'src/written.ts')
    ]
    expect(unreportedPaths(['src/notes.ts', 'src/other.ts', 'monthly_budget.xlsx', 'src/written.ts'], events)).toEqual([
      'src/notes.ts',
      'src/other.ts',
      'monthly_budget.xlsx'
    ])
  })

  it('counts a command whose own words are an edit as reporting it', () => {
    expect(unreportedPaths(['notes.md'], [toolEvent('tool.started', 'bash', "sed -i 's/a/b/' notes.md")])).toEqual([])
    expect(unreportedPaths(['notes.md'], [toolEvent('tool.started', 'bash', "sed -n '1,4p' notes.md")])).toEqual(['notes.md'])
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

describe('the change behind a changed path', () => {
  const after = new Map([['NOTES.md', '??'], ['src/app.ts', ' M'], ['pic.png', '??'], ['staged.ts', 'M ']])

  it('turns a new untracked text file into an add, from its own contents', async () => {
    const patches = await observedPatches('C:\\w', after, ['NOTES.md'], {
      readText: async (absolute) => (absolute.endsWith('NOTES.md') ? '# Notes\nFirst entry.\n' : undefined),
      runGit: async () => { throw new Error('git must not be asked about an untracked file') }
    })
    const patch = patches.get('NOTES.md')
    expect(patch?.added).toBe(2)
    expect(patch?.removed).toBe(0)
    expect(patch?.text).toContain('+# Notes')
    expect(patch?.text).toContain('+First entry.')
  })

  it("asks git for a tracked file's diff, and the index when the working tree is clean", async () => {
    const asked: string[][] = []
    const patches = await observedPatches('C:\\w', after, ['src/app.ts', 'staged.ts'], {
      readText: async () => undefined,
      runGit: async (args) => {
        asked.push([...args])
        if (args.includes('--cached')) return args.includes('staged.ts') ? 'diff --git a/staged.ts b/staged.ts\n--- a/staged.ts\n+++ b/staged.ts\n@@ -1 +1 @@\n-old\n+new\n' : ''
        return args.includes('src/app.ts') ? 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n a\n+b\n c\n' : ''
      }
    })
    expect(patches.get('src/app.ts')?.added).toBe(1)
    expect(patches.get('staged.ts')?.text).toContain('+new')
    expect(asked.some((args) => args.includes('--cached') && args.includes('staged.ts'))).toBe(true)
  })

  it('gives no patch for a file it cannot read as text, and the row keeps its path', async () => {
    const patches = await observedPatches('C:\\w', after, ['pic.png'], { readText: async () => undefined, runGit: async () => '' })
    expect(patches.has('pic.png')).toBe(false)
  })

  it('never throws: a git that fails for one path costs only that path', async () => {
    const patches = await observedPatches('C:\\w', after, ['src/app.ts', 'NOTES.md'], {
      readText: async () => 'x\n',
      runGit: async () => { throw new Error('boom') }
    })
    expect(patches.has('src/app.ts')).toBe(false)
    expect(patches.get('NOTES.md')?.added).toBe(1)
  })

  it('carries the patch on the completed event, and says when the runtime had named the path', () => {
    const events = observedEditEvents({
      runId: 'run_1', missionId: 'mission_1', sourceAdapter: 'codex', nextSequence: 10,
      paths: ['NOTES.md', 'other.txt'], at: '2026-09-05T00:00:00.000Z',
      patches: new Map([['NOTES.md', { text: '--- /dev/null\n+++ b/NOTES.md\n@@ -0,0 +1 @@\n+hi\n', added: 1, removed: 0, truncated: false }]]),
      reported: new Set(['NOTES.md'])
    })
    const completed = events.filter((event) => event.type === 'tool.completed').map((event) => event.payload as { command: string; status: string; patch?: { added: number } })
    expect(completed[0]).toMatchObject({ command: 'NOTES.md', status: 'reported by the runtime, read from disk' })
    expect(completed[0]?.patch?.added).toBe(1)
    expect(completed[1]).toMatchObject({ command: 'other.txt', status: 'observed on disk' })
    expect(completed[1]?.patch).toBeUndefined()
  })
})

describe('an untracked file that changed while it stayed untracked', () => {
  const MARK = String.fromCharCode(1)

  it('carries its text on the snapshot, so a later edit is a change the snapshot can see', async () => {
    const snap = await snapshotWorkspace('C:\\w', {
      runGit: async () => `?? NOTES.md${NUL} M src/app.ts${NUL}`,
      readText: async (absolute) => (absolute.endsWith('NOTES.md') ? '# Notes\n' : undefined)
    })
    expect(statusOf(snap?.get('NOTES.md'))).toBe('??')
    expect(textOf(snap?.get('NOTES.md'))).toBe('# Notes\n')
    expect(snap?.get('src/app.ts')).toBe(' M')
    const later = new Map(snap!)
    later.set('NOTES.md', '??' + MARK + '# Notes\nSecond entry.\n')
    expect(changedPaths(snap!, later)).toEqual(['NOTES.md'])
    expect(changedPaths(snap!, new Map(snap!))).toEqual([])
  })

  it('diffs the earlier text against the later one, headed with the path a person knows', async () => {
    const before = new Map([['NOTES.md', '??' + MARK + '# Notes\nFirst entry.\n']])
    const after = new Map([['NOTES.md', '??' + MARK + '# Notes\nFirst entry.\nSecond entry.\n']])
    const patches = await observedPatches('C:\\w', after, ['NOTES.md'], {
      readText: async () => undefined,
      runGit: async (args) => {
        if (!args.includes('--no-index')) throw new Error('expected a --no-index diff')
        // git exits 1 when the two differ; the runner hands the output back on the error.
        throw Object.assign(new Error('exit 1'), { stdout: 'diff --git a/tmp/a b/tmp/b\nindex 1..2 100644\n--- a/tmp/a\n+++ b/tmp/b\n@@ -1,2 +1,3 @@\n # Notes\n First entry.\n+Second entry.\n' })
      }
    }, before)
    const patch = patches.get('NOTES.md')
    expect(patch?.added).toBe(1)
    expect(patch?.removed).toBe(0)
    expect(patch?.text.startsWith('--- a/NOTES.md\n+++ b/NOTES.md\n@@')).toBe(true)
    expect(patch?.text).toContain('+Second entry.')
  })
})

/*
 * M18 (the code review): every untracked file was read whole, twice a run,
 * the 64 KB cap checked after the read, with no bound on how many. Measured
 * on 10,001 untracked files and one 200 MB file: 1.9 s and 78 MB carried
 * before; 0.5 s and 3.2 MB after.
 */
describe('a snapshot of a folder with a great many untracked files', () => {
  const statusOfAll = (count: number): string =>
    Array.from({ length: count }, (_, n) => `?? file${String(n)}.txt`).join(String.fromCharCode(0)) + String.fromCharCode(0)

  it('never reads a file past the cap, and still sees it change', async () => {
    const reads: string[] = []
    const look = (size: number) => snapshotWorkspace('C:/w', {
      runGit: async () => `?? data.csv${String.fromCharCode(0)}`,
      statOf: async () => ({ size, mtimeMs: 1000 }),
      readText: async (absolute) => { reads.push(absolute); return 'x' }
    })
    const before = await look(200 * 1024 * 1024)
    const after = await look(200 * 1024 * 1024 + 10)
    expect(reads).toEqual([])
    expect(statusOf(before?.get('data.csv'))).toBe('??')
    expect(textOf(before?.get('data.csv'))).toBeUndefined()
    expect(changedPaths(before!, after!)).toEqual(['data.csv'])
  })

  it('carries the text of only so many files, and a size for the rest', async () => {
    let reads = 0
    const snapshot = await snapshotWorkspace('C:/w', {
      runGit: async () => statusOfAll(MAX_UNTRACKED_TEXTS + 50),
      statOf: async () => ({ size: 10, mtimeMs: 1 }),
      readText: async () => { reads += 1; return 'hello' }
    })
    expect(reads).toBe(MAX_UNTRACKED_TEXTS)
    expect(textOf(snapshot?.get('file0.txt'))).toBe('hello')
    expect(textOf(snapshot?.get(`file${String(MAX_UNTRACKED_TEXTS + 10)}.txt`))).toBeUndefined()
    expect(statusOf(snapshot?.get(`file${String(MAX_UNTRACKED_TEXTS + 10)}.txt`))).toBe('??')
  })

  it('draws no patch for a file it saw only by size, rather than calling it new', async () => {
    const entry = (text: string) => new Map([['big.log', text]])
    const before = entry(`??${String.fromCharCode(2)}100:1`)
    const after = entry(`??${String.fromCharCode(1)}now small`)
    const patches = await observedPatches('C:/w', after, ['big.log'], { runGit: async () => '', readText: async () => undefined }, before)
    expect(patches.size).toBe(0)
  })
})
