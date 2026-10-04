import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReconciledCheckpoint } from '@teammate/mission-store'
import { afterEach, describe, expect, it } from 'vitest'

import { withAttachments } from '../shared/attachments.js'
import { MAX_PROMPT_LENGTH } from './codex-mission.js'
import { composeHandoffPrompt, MAX_HANDOFF_PROMPT_LENGTH } from './handoff.js'
import { longTaskFile, TASK_INLINE_LIMIT } from './long-task-file.js'

/*
 * A LONG CONVERSATION GOES TO ANOTHER MODEL BY FILE (0.513). Before this, a
 * task too long for the brief was clipped beside a reply and refused without
 * one: "its original request is too long to carry to another runtime" -- for
 * the conversation most likely to have hit a limit.
 */
const checkpoint = (overrides: Partial<ReconciledCheckpoint> = {}): ReconciledCheckpoint => ({
  missionId: 'mission_prior',
  epoch: 2,
  reason: 'route-switch',
  resumeSafety: 'safe',
  safetyReason: 'settled',
  createdAt: '2026-09-30T23:00:00.000Z',
  unsettledActions: [],
  settledActions: ['read README.md'],
  assistantSummary: 'I read the README and changed two files.',
  ...overrides
}) as unknown as ReconciledCheckpoint

// 12,000 characters with a sentence at the very end that must not be lost.
const LONG = `${'Build the habit tracker exactly as described. '.repeat(260)}THE LAST LINE MATTERS.`
const FILE = '.locust/attachments/conversation-mission_prior.md'

let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('a long conversation goes to another model by file', () => {
  it('a stopped run with a long task: refused before, handed over now', () => {
    expect(LONG.length).toBeGreaterThan(MAX_HANDOFF_PROMPT_LENGTH)
    expect(composeHandoffPrompt(LONG, checkpoint(), 'Codex CLI')).toBeUndefined()
    const briefing = composeHandoffPrompt(LONG, checkpoint(), 'Codex CLI', undefined, [], FILE)
    expect(briefing).toBeDefined()
    expect(briefing?.prompt).toContain(LONG.slice(0, 200))
    expect(briefing?.prompt).toContain(`The whole of it, as written, is in the file \`${FILE}\``)
    expect(briefing?.prompt).not.toContain('did not fit here')
  })

  it('beside a reply, the task is not clipped, and the reply is whole', () => {
    const reply = 'Now add a rename command. '.repeat(200)
    const briefing = composeHandoffPrompt(LONG, checkpoint(), 'Codex CLI', reply, [], FILE)
    expect(briefing?.prompt).toContain(reply.trim())
    expect(briefing?.prompt).not.toContain('did not fit here')
  })

  it('the brief and the line that hands over the file fit what a run will start with', () => {
    const reply = 'x'.repeat(6_000)
    const briefing = composeHandoffPrompt(LONG, checkpoint(), 'Codex CLI', reply, [], FILE)
    expect(briefing).toBeDefined()
    expect(withAttachments(briefing!.prompt, [FILE]).length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH)
  })

  it('a short task stays inline, as it always was', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-long-task-'))
    expect(await longTaskFile('Fix the typo in README.', root, 'mission_prior')).toBeUndefined()
    expect(await longTaskFile('x'.repeat(TASK_INLINE_LIMIT), root, 'mission_prior')).toBeUndefined()
  })

  it('a long task is written whole into .locust/attachments, kept out of git', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-long-task-'))
    await mkdir(join(root, '.git', 'info'), { recursive: true })
    const path = await longTaskFile(LONG, root, 'mission_prior')
    expect(path).toBe(FILE)
    expect(await readFile(join(root, FILE), 'utf8')).toBe(`${LONG}\n`)
    expect(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')).toContain('.locust/')
  })

  it('never writes outside .locust/attachments for an id that is not one', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-long-task-'))
    expect(await longTaskFile(LONG, root, '../escape')).toBeUndefined()
  })
})
