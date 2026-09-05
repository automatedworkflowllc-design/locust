import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MAX_ROUTINES, MAX_STEPS, createRoutineStore, parsedFile, validRoutineName, validSteps } from './routine-store.js'

const roots: string[] = []
async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'locust-routines-'))
  roots.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const ROUTE = { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' } as const
const fresh = (overrides: Record<string, unknown> = {}) => ({
  name: 'Nightly tidy',
  teammateId: 'tm_wren',
  route: ROUTE,
  steps: ['Read status.ts and summarise it.', 'List every file, one per line.'],
  learnedFrom: ['mission_1', 'mission_2'],
  ...overrides
})

describe('what a routine may hold', () => {
  it('a name is one line of printable text, bounded', () => {
    expect(validRoutineName('Nightly tidy')).toBe(true)
    expect(validRoutineName('  spaced  ')).toBe(true)
    expect(validRoutineName('')).toBe(false)
    expect(validRoutineName('a'.repeat(81))).toBe(false)
    expect(validRoutineName('two\nlines')).toBe(false)
    expect(validRoutineName(42)).toBe(false)
  })

  it("steps are the person's words: newlines allowed, empties and control bytes refused, count bounded", () => {
    expect(validSteps(['one', 'two\nlines\tindented'])).toBe(true)
    expect(validSteps([])).toBe(false)
    expect(validSteps(['ok', '   '])).toBe(false)
    expect(validSteps([`bell${String.fromCharCode(7)}`])).toBe(false)
    expect(validSteps(Array.from({ length: MAX_STEPS + 1 }, () => 'step'))).toBe(false)
    expect(validSteps('not a list')).toBe(false)
  })
})

describe('the routine store', () => {
  it('creates, lists, gets, corrects, counts runs and removes', async () => {
    const store = createRoutineStore({ rootDirectory: await root() })
    const routine = await store.create(fresh())
    expect(routine.routineId).toMatch(/^rt_[0-9a-f]{24}$/)
    expect(routine.runs).toBe(0)
    expect(routine.lastRunAt).toBeUndefined()
    expect(await store.list()).toEqual([routine])
    expect(await store.get(routine.routineId)).toEqual(routine)

    const corrected = await store.update({ routineId: routine.routineId, name: 'Nightly tidy (v2)', steps: ['Only this now.'] })
    expect(corrected.steps).toEqual(['Only this now.'])
    // Who it belongs to, what it replays on, and where it came from are not
    // the person's to lose by editing a name and some steps. Asserting the
    // whole rest of the record, not a field at a time: a mutation that moved
    // the routine to another teammate survived a test that checked only the
    // route and provenance (mutation sweep, 2026-09-05).
    expect(corrected).toEqual({
      ...routine,
      name: 'Nightly tidy (v2)',
      steps: ['Only this now.']
    })

    await store.recordRun(routine.routineId)
    const ran = await store.get(routine.routineId)
    expect(ran?.runs).toBe(1)
    expect(typeof ran?.lastRunAt).toBe('string')

    await store.remove(routine.routineId)
    expect(await store.list()).toEqual([])
  })

  it('refuses what would not round-trip, by name', async () => {
    const store = createRoutineStore({ rootDirectory: await root() })
    await expect(store.create(fresh({ name: '' }))).rejects.toThrow(/name/)
    await expect(store.create(fresh({ steps: [] }))).rejects.toThrow(/steps/)
    await expect(store.create(fresh({ route: { runtime: 'cursor', model: 'x', mode: 'yolo' } }))).rejects.toThrow(/route/)
    await expect(store.create(fresh({ teammateId: '../etc' }))).rejects.toThrow(/Teammate id/)
    await expect(store.create(fresh({ learnedFrom: ['fine', 'not fine/../'] }))).rejects.toThrow(/provenance/)
    await expect(store.update({ routineId: 'rt_missing', name: 'x', steps: ['y'] })).rejects.toThrow(/not found/)
  })

  it('is bounded', async () => {
    const store = createRoutineStore({ rootDirectory: await root() })
    for (let index = 0; index < MAX_ROUTINES; index += 1) await store.create(fresh({ name: `r${String(index)}` }))
    await expect(store.create(fresh())).rejects.toThrow(/Too many/)
  })

  it('drops every routine of a teammate who is gone, and only theirs', async () => {
    const store = createRoutineStore({ rootDirectory: await root() })
    await store.create(fresh({ teammateId: 'tm_wren' }))
    const kept = await store.create(fresh({ teammateId: 'tm_booty', name: 'Booty routine' }))
    await store.removeForTeammate('tm_wren')
    expect(await store.list()).toEqual([kept])
  })

  it('writes a file a fresh store reads back identically', async () => {
    const directory = await root()
    const routine = await createRoutineStore({ rootDirectory: directory }).create(fresh())
    const again = createRoutineStore({ rootDirectory: directory })
    expect(await again.list()).toEqual([routine])
    const text = await readFile(join(directory, 'routines.json'), 'utf8')
    expect(JSON.parse(text).schemaVersion).toBe(1)
  })

  it('treats a damaged or foreign file as empty rather than repairing it', async () => {
    expect(parsedFile('not json').routines).toEqual([])
    expect(parsedFile(JSON.stringify({ schemaVersion: 2, routines: [] })).routines).toEqual([])
    const bad = JSON.stringify({
      schemaVersion: 1,
      routines: [
        { ...fresh(), routineId: 'rt_ok', createdAt: '2026-09-05T00:00:00.000Z', runs: 0 },
        { ...fresh(), routineId: 'rt_ok', createdAt: '2026-09-05T00:00:00.000Z', runs: 0 },
        { ...fresh({ steps: [] }), routineId: 'rt_bad', createdAt: '2026-09-05T00:00:00.000Z', runs: 0 },
        { ...fresh(), routineId: 'rt_neg', createdAt: '2026-09-05T00:00:00.000Z', runs: -1 }
      ]
    })
    // One valid entry survives; its duplicate, the empty-steps one and the
    // negative run count do not.
    expect(parsedFile(bad).routines.map((routine) => routine.routineId)).toEqual(['rt_ok'])
    const directory = await root()
    await writeFile(join(directory, 'routines.json'), '{{{', 'utf8')
    expect(await createRoutineStore({ rootDirectory: directory }).list()).toEqual([])
  })
})

describe('a routine that runs on its own', () => {
  it('keeps a schedule, corrects it, clears it with null, and leaves it alone when unmentioned', async () => {
    const store = createRoutineStore({ rootDirectory: await root() })
    const made = await store.create(fresh({ schedule: { kind: 'every', hours: 4 } }))
    expect(made.schedule).toEqual({ kind: 'every', hours: 4 })
    const daily = await store.update({ routineId: made.routineId, name: made.name, steps: made.steps, schedule: { kind: 'daily', at: '07:30' } })
    expect(daily.schedule).toEqual({ kind: 'daily', at: '07:30' })
    const same = await store.update({ routineId: made.routineId, name: 'Renamed', steps: made.steps })
    expect(same.schedule).toEqual({ kind: 'daily', at: '07:30' })
    const cleared = await store.update({ routineId: made.routineId, name: 'Renamed', steps: made.steps, schedule: null })
    expect(cleared.schedule).toBeUndefined()
    expect((await store.get(made.routineId))?.schedule).toBeUndefined()
  })

  it('refuses a schedule it cannot keep, and drops a malformed one from disk without dropping the routine', async () => {
    const directory = await root()
    const store = createRoutineStore({ rootDirectory: directory })
    await expect(store.create(fresh({ schedule: { kind: 'every', hours: 0 } }))).rejects.toThrow(/schedule/)
    const made = await store.create(fresh())
    await expect(store.update({ routineId: made.routineId, name: made.name, steps: made.steps, schedule: { kind: 'daily', at: '25:00' } })).rejects.toThrow(/schedule/)
    const raw = JSON.parse(await readFile(join(directory, 'routines.json'), 'utf8'))
    raw.routines[0].schedule = { kind: 'weekly' }
    await writeFile(join(directory, 'routines.json'), JSON.stringify(raw), 'utf8')
    const back = await createRoutineStore({ rootDirectory: directory }).get(made.routineId)
    expect(back?.name).toBe('Nightly tidy')
    expect(back?.schedule).toBeUndefined()
  })
})
