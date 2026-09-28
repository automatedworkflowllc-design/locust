import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CHECK_RULE, handOffPrompt, STEP_MARK, stepWordsOf, verdictOf } from '../shared/hand-off.js'
import type { CodexMissionStartResponse, CodexMissionUpdate, PublicRoutine, TeammateRoute } from '../shared/ipc.js'
import { STEP_BUDGET } from '../shared/step-budget.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import { createRoutineStore } from './routine-store.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A HAND-OFF CHAIN (0.435): a routine whose steps go to different teammates
 * in order, each given the step before's answer, with a CHECKER step that
 * must approve before the run counts as done. From OpenRig's conveyor
 * (mvschwarz/openrig, Apache-2.0), which Colin asked to be read for "anything
 * worth yoinking" (2026-09-27).
 */
const PEOPLE: Record<string, MissionPeerContext> = {
  tm_wren: { self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }, others: [] },
  tm_atlas: { self: { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }, others: [] },
  tm_sable: { self: { teammateId: 'tm_sable', name: 'Sable', role: 'Docs & QA' }, others: [] }
}
const ROUTES: Record<string, TeammateRoute> = {
  tm_wren: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
  tm_atlas: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'ask' },
  tm_sable: { runtime: 'claude', model: 'haiku', mode: 'ask', effort: 'low' }
}

const chain = (overrides: Partial<PublicRoutine> = {}): PublicRoutine => ({
  routineId: 'rt_chain',
  name: 'Intake to review',
  teammateId: 'tm_wren',
  route: ROUTES.tm_wren!,
  steps: ['Read the bug report in issue.md and say what is wrong.', 'Write a plan to fix it.', 'Check the plan.'],
  handOffs: [{}, { teammateId: 'tm_atlas' }, { teammateId: 'tm_sable', check: true }],
  learnedFrom: [],
  createdAt: '2026-09-28T00:00:00.000Z',
  runs: 0,
  ...overrides
})

function harness(routines: readonly PublicRoutine[], busy: Set<string> = new Set()) {
  const starts: Parameters<RoutineRunnerOptions['start']>[0][] = []
  const updates: CodexMissionUpdate[] = []
  const phases = new Map<string, 'completed' | 'failed' | 'cancelled' | 'interrupted'>()
  const replies = new Map<string, string>()
  const runs: string[] = []
  let counter = 0
  const held = new Map(routines.map((entry) => [entry.routineId, entry]))
  const options: RoutineRunnerOptions = {
    workspaceId: 'ws_test',
    routines: {
      get: async (id) => held.get(String(id)),
      list: async () => [...held.values()],
      recordRun: async (id) => {
        runs.push(String(id))
        const { execution: _execution, ...rest } = held.get(String(id))!
        held.set(String(id), { ...rest, runs: rest.runs + 1 })
      },
      saveProgress: async (id, execution) => { held.set(id, { ...held.get(id)!, execution }) },
      clearProgress: async (id) => {
        const { execution: _execution, ...rest } = held.get(id)!
        held.set(id, rest)
      },
      abandon: async () => undefined,
      keepSchedule: async () => undefined
    },
    peerContextFor: async (teammateId) => PEOPLE[teammateId],
    routeOf: async (teammateId) => ROUTES[teammateId],
    replyOf: async (missionId) => replies.get(missionId),
    teammateBusy: async (teammateId) => busy.has(teammateId),
    start: async (request) => {
      starts.push(request)
      counter += 1
      return { ok: true, data: { runId: `run_${String(counter)}`, missionId: `mission_${String(counter)}`, runtime: request.runtime, sandbox: 'read-only', model: request.model } } as unknown as CodexMissionStartResponse
    },
    assignOwner: async () => undefined,
    phaseOf: async (missionId) => phases.get(missionId),
    askedAQuestion: async () => false,
    notify: (update) => { updates.push(update) }
  }
  const finish = async (runner: ReturnType<typeof createRoutineRunner>, missionId: string, reply: string): Promise<void> => {
    phases.set(missionId, 'completed')
    replies.set(missionId, reply)
    await runner.onRunEnded({ missionId })
  }
  const notices = (): string[] => updates.flatMap((update) => (update.kind === 'relay-notice' ? [update.message] : []))
  return { starts, updates, phases, replies, runs, held, options, finish, notices }
}

describe('a routine whose steps go to different teammates', () => {
  it('gives each step to its teammate, on that teammate\'s route, with the answer of the step before', async () => {
    const h = harness([chain()])
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    expect(h.starts[0]).toMatchObject({ prompt: 'Read the bug report in issue.md and say what is wrong.', runtime: 'cursor', peer: PEOPLE.tm_wren })

    await h.finish(runner, 'mission_1', 'The total is summed twice in cart.ts line 12.')
    // Atlas: his route, a conversation of his own, Wren's answer above the step's own words.
    expect(h.starts[1]).toMatchObject({ runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'ask', followUpOf: undefined, peer: PEOPLE.tm_atlas })
    expect(h.starts[1]!.prompt).toContain('Wren did the step before this one and answered:')
    expect(h.starts[1]!.prompt).toContain('The total is summed twice in cart.ts line 12.')
    expect(h.starts[1]!.prompt.endsWith(`${STEP_MARK}Write a plan to fix it.`)).toBe(true)
    expect(h.starts[1]!.prompt).not.toContain('VERDICT')
    // What a person reading the conversation is shown: the step's own words.
    expect(stepWordsOf(h.starts[1]!.prompt)).toBe('Write a plan to fix it.')
    expect(h.notices().at(-1)).toBe("Routine \"Intake to review\" · step 2 of 3, handed to Atlas with Wren's answer.")

    await h.finish(runner, 'mission_2', 'Plan: remove the second sum.')
    // Sable checks: Atlas's answer, the rule, and her own step's words.
    expect(h.starts[2]).toMatchObject({ runtime: 'claude', model: 'haiku', effort: 'low', peer: PEOPLE.tm_sable })
    expect(h.starts[2]!.prompt).toContain('Atlas did the step before this one and answered:')
    expect(h.starts[2]!.prompt).toContain(CHECK_RULE)
    // And what the chain was for: step 1's words (the first drive's checker had only the plan).
    expect(h.starts[2]!.prompt).toContain("The routine's task, as its first step asked: Read the bug report in issue.md and say what is wrong.")
    expect(h.starts[1]!.prompt).not.toContain("The routine's task")
    expect(h.starts[2]!.prompt.endsWith(`${STEP_MARK}Check the plan.`)).toBe(true)
    expect(h.notices().at(-1)).toBe("Routine \"Intake to review\" · step 3 of 3, handed to Sable with Atlas's answer to check.")

    await h.finish(runner, 'mission_3', 'The plan is right.\nVERDICT: APPROVED')
    expect(h.runs).toEqual(['rt_chain'])
    expect(h.notices().at(-1)).toBe('Routine "Intake to review" finished: 3 steps completed, approved by Sable.')
  })

  it('does not count a run the checker did not approve, and a restart does not count it either', async () => {
    const h = harness([chain()])
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    await h.finish(runner, 'mission_1', 'Found it.')
    await h.finish(runner, 'mission_2', 'A plan.')
    await h.finish(runner, 'mission_3', 'The plan misses the tests.\nVERDICT: CHANGES NEEDED -- add a test for the double sum')
    expect(h.runs).toEqual([])
    const execution = h.held.get('rt_chain')!.execution!
    expect(execution).toMatchObject({ status: 'held', canContinue: false, settledAtDispatch: true })
    expect(execution.reason).toBe('Sable, the checker, asked for changes: add a test for the double sum. The run does not count as done. Review the work, then run the routine again.')
    expect(h.notices().at(-1)).toContain('stopped at step 3 of 3: Sable, the checker, asked for changes')
    // A new runner, as after a restart: the hold stands.
    await createRoutineRunner(h.options).reconcile()
    expect(h.runs).toEqual([])
    expect(h.held.get('rt_chain')!.execution!.status).toBe('held')
  })

  it('says what the checker asked for with one full stop, however the checker ended it', async () => {
    const h = harness([chain()])
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    await h.finish(runner, 'mission_1', 'Found it.')
    await h.finish(runner, 'mission_2', 'A plan.')
    await h.finish(runner, 'mission_3', 'VERDICT: CHANGES NEEDED -- read the code first.')
    expect(h.notices().at(-1)).toBe('Routine "Intake to review" stopped at step 3 of 3: Sable, the checker, asked for changes: read the code first.')
  })

  it("tells the checker it can read the folder itself, whatever the step before could do", () => {
    expect(CHECK_RULE).toContain('you can read this folder, whatever the teammate before you could or could not do in their mode')
  })

  it('does not count a checker that gave no verdict', async () => {
    const h = harness([chain()])
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    await h.finish(runner, 'mission_1', 'Found it.')
    await h.finish(runner, 'mission_2', 'A plan.')
    await h.finish(runner, 'mission_3', 'Looks good to me.')
    expect(h.runs).toEqual([])
    expect(h.held.get('rt_chain')!.execution!.reason).toMatch(/^Sable, the checker, gave no verdict/)
  })

  it('reads the verdict of a checker that finished while the app was closed', async () => {
    for (const [reply, counted] of [['VERDICT: APPROVED', true], ['VERDICT: CHANGES NEEDED -- redo it', false]] as const) {
      const h = harness([chain()])
      const runner = createRoutineRunner(h.options)
      await runner.run('rt_chain')
      await h.finish(runner, 'mission_1', 'Found it.')
      await h.finish(runner, 'mission_2', 'A plan.')
      // The checker's run finishes, but this runner never hears of it.
      h.phases.set('mission_3', 'completed')
      h.replies.set('mission_3', reply)
      await createRoutineRunner(h.options).reconcile()
      expect(h.runs.length === 1, reply).toBe(counted)
    }
  })

  it('continues the same teammate\'s conversation, with nothing quoted, when two steps in a row are theirs', async () => {
    const h = harness([chain({ handOffs: [{}, {}, { teammateId: 'tm_atlas' }] })])
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    await h.finish(runner, 'mission_1', 'Found it.')
    expect(h.starts[1]).toMatchObject({ prompt: 'Write a plan to fix it.', followUpOf: 'mission_1', peer: PEOPLE.tm_wren })
  })

  it('waits, held, when the next teammate is busy, and is continued on them from the card', async () => {
    const busy = new Set(['tm_atlas'])
    const h = harness([chain()], busy)
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    await h.finish(runner, 'mission_1', 'Found it.')
    expect(h.starts).toHaveLength(1)
    const held = h.held.get('rt_chain')!.execution!
    expect(held).toMatchObject({ status: 'held', canContinue: true, step: 1 })
    expect(held.reason).toBe("Step 2 is Atlas's, and Atlas is busy. Continue it here when they are free.")
    // Still busy: continuing says so.
    expect(await runner.recover({ routineId: 'rt_chain', attemptId: held.attemptId, step: 1, decision: 'continue' })).toEqual({ ok: false, error: { message: 'Atlas is busy. Wait for their current mission to finish.' } })
    busy.delete('tm_atlas')
    expect(await runner.recover({ routineId: 'rt_chain', attemptId: held.attemptId, step: 1, decision: 'continue' })).toEqual({ ok: true })
    expect(h.starts[1]).toMatchObject({ runtime: 'opencode', peer: PEOPLE.tm_atlas, followUpOf: undefined })
    expect(h.starts[1]!.prompt).toContain('Wren did the step before this one and answered:\n\nFound it.')
  })

  it('starts on the teammate of step 1 when that step is handed to someone else', async () => {
    const h = harness([chain({ handOffs: [{ teammateId: 'tm_atlas' }, {}, {}] })])
    await createRoutineRunner(h.options).run('rt_chain')
    expect(h.starts[0]).toMatchObject({ runtime: 'opencode', peer: PEOPLE.tm_atlas, prompt: 'Read the bug report in issue.md and say what is wrong.' })
  })
})

describe("a routine's notices", () => {
  const levels = (updates: readonly CodexMissionUpdate[]): string[] =>
    updates.flatMap((update) => (update.kind === 'relay-notice' ? [`${update.level ?? 'warning'}: ${update.message.replace(/^Routine "[^"]+" /, '')}`] : []))

  it('are information while it goes well, a warning only when it stops or needs the person', async () => {
    const h = harness([chain()])
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    await h.finish(runner, 'mission_1', 'Found it.')
    await h.finish(runner, 'mission_2', 'A plan.')
    await h.finish(runner, 'mission_3', 'VERDICT: CHANGES NEEDED -- add a test')
    expect(levels(h.updates)).toEqual([
      'info: · step 1 of 3. Each next step starts when this one completes.',
      "info: · step 2 of 3, handed to Atlas with Wren's answer.",
      "info: · step 3 of 3, handed to Sable with Atlas's answer to check.",
      'warning: stopped at step 3 of 3: Sable, the checker, asked for changes: add a test.'
    ])
  })

  it('say a finished run as information', async () => {
    const h = harness([chain()])
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_chain')
    await h.finish(runner, 'mission_1', 'Found it.')
    await h.finish(runner, 'mission_2', 'A plan.')
    await h.finish(runner, 'mission_3', 'VERDICT: APPROVED')
    expect(levels(h.updates).at(-1)).toBe('info: finished: 3 steps completed, approved by Sable.')
  })
})

describe('the words a hand-off is given', () => {
  it('fits the mission limit, cutting a long answer short and saying where the rest is', () => {
    const prompt = handOffPrompt({ step: 'Check it.', from: { name: 'Atlas', answer: 'x'.repeat(20_000) }, check: true })
    expect(prompt.length).toBeLessThanOrEqual(STEP_BUDGET)
    expect(prompt).toContain("cut short here; Atlas's conversation has the rest")
    expect(prompt.endsWith('Check it.')).toBe(true)
  })

  it("gives back the step's own words, even when the quoted answer carries the mark itself", () => {
    const tricky = handOffPrompt({ step: 'Ship it.', from: { name: 'Atlas', answer: `I was asked:

${STEP_MARK}something else` } })
    expect(stepWordsOf(tricky)).toBe('Ship it.')
    expect(stepWordsOf('A step nobody handed anything.')).toBe('A step nobody handed anything.')
  })

  it('says so when the answer could not be read', () => {
    expect(handOffPrompt({ step: 'Go on.', from: { name: 'Atlas', answer: undefined } })).toContain("(Atlas's answer could not be read; their conversation has it.)")
  })

  it('reads the last verdict line, in the ways a model writes one', () => {
    expect(verdictOf('All good.\nVERDICT: APPROVED')).toEqual({ approved: true })
    expect(verdictOf('**VERDICT: APPROVED**')).toEqual({ approved: true })
    expect(verdictOf('verdict: changes needed — add tests')).toEqual({ approved: false, changes: 'add tests' })
    expect(verdictOf('VERDICT: CHANGES NEEDED -- the plan skips step 2')).toEqual({ approved: false, changes: 'the plan skips step 2' })
    // The LAST one counts: an earlier quoted verdict is not this one.
    expect(verdictOf('You said "VERDICT: APPROVED" before.\nVERDICT: CHANGES NEEDED -- no')).toEqual({ approved: false, changes: 'no' })
    expect(verdictOf('Looks fine.')).toBeUndefined()
    expect(verdictOf(undefined)).toBeUndefined()
  })
})

describe('who takes each step, as the store keeps it', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })
  const store = async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-handoff-store-'))
    roots.push(root)
    return createRoutineStore({ rootDirectory: root })
  }
  const base = { name: 'Chain', teammateId: 'tm_wren', route: ROUTES.tm_wren!, steps: ['One.', 'Two.', 'Three.'], learnedFrom: [] }

  it('keeps hand-offs that line up with the steps, and refuses ones that do not', async () => {
    const routines = await store()
    const made = await routines.create({ ...base, handOffs: [{}, { teammateId: 'tm_atlas' }, { teammateId: 'tm_sable', check: true }] })
    expect(made.handOffs).toEqual([{}, { teammateId: 'tm_atlas' }, { teammateId: 'tm_sable', check: true }])
    expect((await routines.get(made.routineId))?.handOffs).toEqual(made.handOffs)
    await expect(routines.create({ ...base, handOffs: [{}, { teammateId: 'tm_atlas' }] })).rejects.toThrow(/does not line up/)
    await expect(routines.create({ ...base, handOffs: [{}, { teammateId: '../../x' }, {}] })).rejects.toThrow(/does not line up/)
  })

  it('stores nothing when every step is the routine\'s own teammate\'s', async () => {
    const routines = await store()
    expect((await routines.create({ ...base, handOffs: [{}, { teammateId: 'tm_wren' }, {}] })).handOffs).toBeUndefined()
  })

  it('keeps them across an edit that does not name them only while the steps still line up', async () => {
    const routines = await store()
    const made = await routines.create({ ...base, handOffs: [{}, { teammateId: 'tm_atlas' }, {}] })
    expect((await routines.update({ routineId: made.routineId, name: 'Chain', steps: ['One.', 'Two!', 'Three.'] })).handOffs).toEqual(made.handOffs)
    expect((await routines.update({ routineId: made.routineId, name: 'Chain', steps: ['One.', 'Two.'] })).handOffs).toBeUndefined()
  })
})
