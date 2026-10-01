import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { judgeMissionIds } from '../shared/compare.js'
import { ANSWER_CHARS, judgePrompt } from './compare-judge.js'
import { createCompareStore } from './compare-store.js'

/**
 * A JUDGE READS THE ANSWERS BLIND (0.520), after Artificial Analysis's
 * Optima. The person asks for a judge's view once the answers are in; the
 * judge sees letters, never the models, and never keeps one itself.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('what a judge is asked', () => {
  const prompt = judgePrompt({
    ask: 'Summarize the vendor quotes',
    answers: [{ letter: 'A', text: 'HubSpot is cheapest.' }, { letter: 'B', text: 'Pipedrive, for its API.' }],
    criteria: 'Names a price for five seats'
  })

  it('carries the ask, each answer under its letter, and the person\'s words', () => {
    expect(prompt).toContain('The request was:\n\nSummarize the vendor quotes')
    expect(prompt).toContain('Answer A:\n\nHubSpot is cheapest.')
    expect(prompt).toContain('Answer B:\n\nPipedrive, for its API.')
    expect(prompt).toContain('The person says a good answer does this:\n\nNames a price for five seats')
    expect(prompt).toContain('against what the person said a good answer does')
  })

  it('asks for a view, never an action, and never for the models\' names', () => {
    expect(prompt).toContain('Do not use any tools and do not change any files')
    expect(prompt).toContain('Do not guess which model wrote which.')
  })

  it('leaves the criteria out when there are none, and cuts a long answer saying so', () => {
    const bare = judgePrompt({ ask: 'Q', answers: [{ letter: 'A', text: 'x'.repeat(ANSWER_CHARS + 50) }, { letter: 'B', text: 'y' }] })
    expect(bare).not.toContain('The person says')
    expect(bare).toContain('[This answer continues; the rest is not shown here.]')
    expect(bare).not.toContain('x'.repeat(ANSWER_CHARS + 1))
  })
})

describe('a judge, remembered with its comparison', () => {
  it('keeps its route, its runs newest last and the person\'s words, and its runs are never conversations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-judge-'))
    roots.push(root)
    const store = createCompareStore({ rootDirectory: root })
    const compare = await store.create({ prompt: 'Q', routes: [{ runtime: 'opencode', model: 'a-free' }, { runtime: 'opencode', model: 'b-free' }] })
    await store.judge(compare.compareId, { runtime: 'codex', model: 'account-default', label: 'Codex' }, 'mission_judge_1', 'Short')
    const judged = await store.judge(compare.compareId, { runtime: 'codex', model: 'account-default', label: 'Codex' }, 'mission_judge_2')
    expect(judged.judge).toEqual({ route: { runtime: 'codex', model: 'account-default', label: 'Codex' }, missionIds: ['mission_judge_1', 'mission_judge_2'] })
    const reread = await createCompareStore({ rootDirectory: root }).get(compare.compareId)
    expect(reread?.judge?.missionIds).toEqual(['mission_judge_1', 'mission_judge_2'])
    expect([...judgeMissionIds([reread!])]).toEqual(['mission_judge_1', 'mission_judge_2'])
  })
})
