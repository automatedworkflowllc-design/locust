import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createTeammateStore, MAX_MISSION_TITLE_LENGTH, MAX_MISSION_TITLES } from './teammate-store.js'

/*
 * What stops a hang, not what the work is allowed to cost. Every rename is a
 * write and an fsync, and on this disk an fsync has been seen to take anywhere
 * from 3 ms to 10 s depending on who else is writing; a limit set to what the
 * tests cost on a quiet machine fails them for somebody else's I/O. (The two
 * cap tests, when they filled the roster a rename at a time under a 60 s
 * limit, timed out in 6 of the 11 recorded runs the gate logs of 10-03 and
 * 10-04 still show from before this was changed.)
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * A conversation can be given a name, and the ledger never learns about it.
 *
 * Colin, 2026-09-15: *"do we have the ability to rename missions?"* — no, and
 * the flatten had just made that matter more than it used to. A row in the
 * new sidebar carries no teammate heading above it and no route beside it, so
 * the title is the whole identifier, and it was derived from the first line
 * of whatever was typed. *"quick one — what does LOCUST.md actually get used
 * for"* is a fine thing to type and a poor thing to find a week later.
 *
 * WHERE THE NAME LIVES, AND WHY NOT THE LEDGER.
 *
 * The ledger is an append-only record of what was actually asked and what
 * actually happened. A title someone changed afterwards is neither, and
 * writing it there would be editing history to make a list easier to read.
 * It lives in the roster file beside `missionOwners` — the other
 * per-conversation fact the ledger does not own — so the prompt survives
 * every rename, and clearing a name is just renaming to nothing.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })))
})

const store = async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-rename-'))
  roots.push(root)
  return { store: createTeammateStore({ rootDirectory: root }), root }
}

describe('naming a conversation', () => {
  it('keeps the name', async () => {
    const { store: teammates } = await store()
    await teammates.renameMission('m_1', 'LOCUST.md — what it is for')
    expect((await teammates.missionTitles()).m_1).toBe('LOCUST.md — what it is for')
  })

  it('does not touch the mission ledger', async () => {
    /*
     * Asserted by absence: the store writes one file and it is not the
     * ledger. The drive checked the other half on a real profile -- the
     * mission's `.jsonl` still contained the original prompt after a rename.
     */
    const { store: teammates, root } = await store()
    await writeFile(join(root, 'mission-ledger-marker'), 'untouched', 'utf8')
    await teammates.renameMission('m_1', 'Something else')
    expect(await readFile(join(root, 'mission-ledger-marker'), 'utf8')).toBe('untouched')
  })

  it('trims, because a name that is only spaces is not a name', async () => {
    const { store: teammates } = await store()
    await teammates.renameMission('m_1', '   Release notes   ')
    expect((await teammates.missionTitles()).m_1).toBe('Release notes')
  })

  it('clears with an empty name, which is how you get the typed words back', async () => {
    // Nothing was overwritten to lose: the first line of the prompt is still
    // in the ledger, so clearing is a real undo rather than a second edit.
    const { store: teammates } = await store()
    await teammates.renameMission('m_1', 'Named')
    await teammates.renameMission('m_1', '')
    expect((await teammates.missionTitles()).m_1).toBeUndefined()
  })

  it('treats blank as empty', async () => {
    const { store: teammates } = await store()
    await teammates.renameMission('m_1', 'Named')
    await teammates.renameMission('m_1', '    ')
    expect((await teammates.missionTitles()).m_1).toBeUndefined()
  })

  it('clearing a name that was never set is not an error', async () => {
    const { store: teammates } = await store()
    await expect(teammates.renameMission('m_never', '')).resolves.toBeUndefined()
  })

  it('refuses an id that is not one', async () => {
    const { store: teammates } = await store()
    await expect(teammates.renameMission('../escape', 'x')).rejects.toThrow()
  })
})

describe('bounds, because this file has a size cliff', () => {
  /*
   * Past `MAX_FILE_BYTES` the roster reads as EMPTY and the next write saves
   * that empty file over the real one -- so unbounded growth here does not
   * degrade, it deletes somebody's whole team. Titles are far bigger than
   * assignments (a sentence rather than two ids), so they are bounded
   * tighter and on length as well as count.
   */
  it('caps how long one name may be', async () => {
    const { store: teammates } = await store()
    await teammates.renameMission('m_1', 'x'.repeat(MAX_MISSION_TITLE_LENGTH + 500))
    expect((await teammates.missionTitles()).m_1?.length).toBe(MAX_MISSION_TITLE_LENGTH)
  })

  /*
   * A roster one name short of full, laid down in ONE write.
   *
   * These two tests used to fill it the way a person would, a rename at a
   * time: a thousand writes, each of them an fsync, in a row. Alone that is
   * eight seconds; in the gate, beside the other workers writing to the same
   * disk, it was 12 to 55 seconds, and past 60 it is a timeout that says
   * nothing about the cap. What the cap is about is the LAST place, so the
   * fixture is sized to that: everything before it is laid down at once, and
   * the last place -- and the one after it -- go through the store's own
   * write, which is the code that makes the decision. The names are the
   * longest allowed, so a full roster here is also the largest this file can
   * ever be, which the cliff above is the reason for.
   */
  const almostFull = async (root: string, title: string) => {
    const missionTitles = Object.fromEntries(Array.from({ length: MAX_MISSION_TITLES - 1 }, (_, index) => [`m_${String(index)}`, title]))
    await writeFile(
      join(root, 'teammates.json'),
      `${JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {}, missionTitles }, null, 2)}\n`,
      'utf8'
    )
  }

  it('caps how many conversations may carry one', async () => {
    const { store: teammates, root } = await store()
    const longest = 'x'.repeat(MAX_MISSION_TITLE_LENGTH)
    await almostFull(root, longest)
    // The last place is there to be taken, and the roster -- every name at its
    // longest -- still reads: past MAX_FILE_BYTES it would not.
    await teammates.renameMission('m_last', longest)
    expect(Object.keys(await teammates.missionTitles())).toHaveLength(MAX_MISSION_TITLES)
    await expect(teammates.renameMission('m_one_too_many', 'nope')).rejects.toThrow()
  })

  it('still lets an existing one be renamed at the cap', async () => {
    // The bound is on ADDING a conversation to the set, not on editing one
    // already in it -- otherwise hitting the cap would freeze every name.
    const { store: teammates, root } = await store()
    await almostFull(root, 'first')
    await teammates.renameMission('m_last', 'first')
    // Really at the cap: a pass here means something only if the roster is full.
    expect(Object.keys(await teammates.missionTitles())).toHaveLength(MAX_MISSION_TITLES)
    await expect(teammates.renameMission('m_0', 'second')).resolves.toBeUndefined()
    expect((await teammates.missionTitles()).m_0).toBe('second')
  })
})

describe('the file is read as untrusted, like everything else in it', () => {
  it('drops a title that is not a string', async () => {
    const { store: teammates, root } = await store()
    await writeFile(
      join(root, 'teammates.json'),
      JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {}, missionTitles: { m_1: 42, m_2: 'fine' } }),
      'utf8'
    )
    const titles = await teammates.missionTitles()
    expect(titles.m_1).toBeUndefined()
    expect(titles.m_2).toBe('fine')
  })

  it('drops one whose id could not be an id', async () => {
    const { store: teammates, root } = await store()
    await writeFile(
      join(root, 'teammates.json'),
      JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {}, missionTitles: { '../../etc': 'no', m_ok: 'yes' } }),
      'utf8'
    )
    const titles = await teammates.missionTitles()
    expect(titles['../../etc']).toBeUndefined()
    expect(titles.m_ok).toBe('yes')
  })

  it('survives the field being absent, which every file written before today is', async () => {
    const { store: teammates, root } = await store()
    await writeFile(
      join(root, 'teammates.json'),
      JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {} }),
      'utf8'
    )
    expect(await teammates.missionTitles()).toEqual({})
  })
})

describe('a name that was saved is read back', () => {
  /*
   * THE BUG THIS EXISTS FOR, shipped in 0.141.0 and found by Colin the same
   * day: "i renamed some of my missions and the name didnt save."
   *
   * It saved. It was never read. `missionTitles` travels on the roster
   * response beside `missionOwners`, and of the seven places that apply a
   * roster read, I taught ONE of them about titles -- a refresh path -- and
   * missed the read that runs at startup. So a chosen name was written to
   * disk correctly, survived until the window reloaded, and then the row
   * went back to the first line of the prompt.
   *
   * The drive that passed had asked `listTeammates()` whether the title came
   * back and had never restarted the app, which is the only place the
   * difference shows. The reload is the test.
   *
   * So the guard is structural rather than behavioural: the two maps arrive
   * together and must be applied together, everywhere, or one of them is a
   * setting that quietly does not persist.
   */
  const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')
  const count = (needle: RegExp): number => (APP.match(needle) ?? []).length

  it('never applies ownership from a roster read without applying titles too', () => {
    /*
     * Counting the two calls and comparing totals is the obvious test and
     * the wrong one -- it went red at 9 against 7, because the rename's own
     * recovery path reads titles alone and legitimately has no ownership
     * counterpart. Equal counts was never the invariant.
     *
     * The invariant is directional: wherever a WHOLE roster read is applied,
     * both maps must come off it. So find each ownership application and
     * require a titles application within the next few lines.
     */
    const lines = APP.split(String.fromCharCode(10))
    const missed: string[] = []
    lines.forEach((line, index) => {
      if (!/setMissionOwners\((?:response|roster|listed)\.data\.missionOwners\)/.test(line)) return
      const near = lines.slice(index, index + 4).join(' ')
      // 0.729: the titles come off it through rememberRosterNames(x.data), which takes the pins too.
      if (!near.includes('.data.missionTitles') && !/rememberRosterNames\(\w+\.data\)/.test(near)) missed.push(`App.tsx:${String(index + 1)}: ${line.trim()}`)
    })
    expect(missed).toEqual([])
  })

  it('reads them in the load that runs at startup, not only on a refresh', () => {
    // The specific miss. `listTeammates` on mount is the only read that
    // happens before anyone can look at a row.
    const mount = APP.slice(APP.indexOf('.listTeammates()'), APP.indexOf('.listTeammates()') + 1600)
    expect(mount).toMatch(/setMissionTitles|rememberRosterNames/)
  })
})
