import { describe, expect, it } from 'vitest'

import { changedPaths, MAX_UNTRACKED_LOOKED_AT, MAX_UNTRACKED_TEXTS, snapshotFolder, type FolderEntry } from './disk-observation.js'

/*
 * 0.710. A plain folder past the look's bound: Colin's Claude teammate, in his
 * .claude (over 5,000 files), was shown file-history/...@v4 "ADDED, +133" --
 * written three weeks before. The walk keeps the first 5,000 files; one file
 * early in it went during the run, every later file moved a place, and the
 * 5,001st was in the second look and not the first. These replay that with a
 * folder of names (no disk), and the run's clock.
 */
const DAY = 24 * 60 * 60 * 1000
const STARTED = Date.parse('2026-10-08T23:00:00Z')

/** A folder of `count` old files, `a/0000` on, plus whatever `extra` adds; each file's time as `times` says. */
function folder(names: () => readonly string[], times: Map<string, number>) {
  return {
    runGit: async (): Promise<string> => {
      throw new Error('not a repository')
    },
    listDirectory: async (directory: string): Promise<readonly FolderEntry[]> =>
      directory.endsWith('root') ? names().map((name) => ({ name, kind: 'file' as const })) : [],
    statOf: async (absolute: string) => {
      const name = absolute.split(/[\\/]/).at(-1) as string
      const at = times.get(name)
      return at === undefined ? undefined : { size: 10, mtimeMs: at, ctimeMs: at }
    },
    readText: async (absolute: string) => `text of ${absolute.split(/[\\/]/).at(-1) as string}`
  }
}

const many = (count: number): string[] => Array.from({ length: count }, (_, index) => `f${String(index).padStart(5, '0')}`)

describe('a folder too big to look at whole', () => {
  it('a file that only moved into view is not a change; one written during the run is', async () => {
    let names = many(MAX_UNTRACKED_LOOKED_AT + 3)
    const times = new Map(names.map((name) => [name, STARTED - 21 * DAY]))
    const seams = folder(() => names, times)
    const before = await snapshotFolder('C:/root', { ...seams, now: () => STARTED })
    expect(before?.partial).toBe(true)
    expect(before?.has(`f${String(MAX_UNTRACKED_LOOKED_AT).padStart(5, '0')}`)).toBe(false)

    // During the run: one early file goes, and the run writes one late file.
    names = names.filter((name) => name !== 'f00010')
    names.push('zz-made-by-the-run')
    times.set('zz-made-by-the-run', STARTED + 30_000)
    const after = await snapshotFolder('C:/root', { ...seams, now: () => STARTED + 60_000 })

    // f05000 shifted into view, three weeks old: not a change. And f00010's going is not claimed from a cut-off look.
    expect(changedPaths(before!, after!)).toEqual([])
    // A file the run wrote INSIDE the view is a change, and so is one at the bound's edge.
    names = names.filter((name) => name !== 'f00020')
    names.splice(5, 0, 'a-new-report')
    times.set('a-new-report', STARTED + 40_000)
    const later = await snapshotFolder('C:/root', { ...seams, now: () => STARTED + 90_000 })
    expect(changedPaths(before!, later!)).toEqual(['a-new-report'])
  })

  it('a file that crossed the text bound is compared by its time, not by how it was looked at', async () => {
    let names = many(MAX_UNTRACKED_LOOKED_AT + 1)
    const times = new Map(names.map((name) => [name, STARTED - DAY]))
    const seams = folder(() => names, times)
    const before = await snapshotFolder('C:/root', { ...seams, now: () => STARTED })
    // The first file after the text bound was a size-and-time; one early file goes, and it carries text now.
    names = names.filter((name) => name !== 'f00001')
    const after = await snapshotFolder('C:/root', { ...seams, now: () => STARTED + 5_000 })
    const crossed = `f${String(MAX_UNTRACKED_TEXTS).padStart(5, '0')}`
    expect(changedPaths(before!, after!)).not.toContain(crossed)
    expect(changedPaths(before!, after!)).toEqual([])

    // The same file, rewritten during the run: a change.
    times.set(crossed, STARTED + 2_000)
    const rewritten = await snapshotFolder('C:/root', { ...seams, now: () => STARTED + 6_000 })
    expect(changedPaths(before!, rewritten!)).toEqual([crossed])
  })

  it('a folder looked at whole still reports every new file, however old its time', async () => {
    let names = many(20)
    const times = new Map(names.map((name) => [name, STARTED - DAY]))
    const seams = folder(() => names, times)
    const before = await snapshotFolder('C:/root', { ...seams, now: () => STARTED })
    expect(before?.partial).toBeUndefined()
    // Copied in with its old time kept: the first look saw everything, so it is new.
    names = [...names, 'copied-in.xlsx']
    times.set('copied-in.xlsx', STARTED - 300 * DAY)
    const after = await snapshotFolder('C:/root', { ...seams, now: () => STARTED + 1_000 })
    expect(changedPaths(before!, after!)).toEqual(['copied-in.xlsx'])
  })
})
