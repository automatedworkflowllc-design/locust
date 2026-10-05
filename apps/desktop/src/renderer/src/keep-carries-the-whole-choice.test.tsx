import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicCompare } from '../../shared/compare.js'
import type { PublicModel } from '../../shared/ipc.js'
import { CompareView } from './components/CompareView.js'
import type { CompareColumnView } from './components/CompareView.js'
import { keptSentence, routeAfterKeep } from './status.js'

/**
 * KEEP CARRIES THE WHOLE CHOICE (0.622). Arena round 2's reveal: the bar said
 * "You kept Sonnet 5.5 · High; the conversation carries on with it" over a
 * chat box that said Medium. Keeping a column carries its model AND its
 * effort; the mode is the chat box's own, and the bar names it.
 */
const model = (id: string, supportedEfforts: readonly string[], defaultEffort?: string): PublicModel => ({
  id,
  runtime: 'claude',
  displayName: id,
  description: '',
  supportedEfforts,
  ...(defaultEffort === undefined ? {} : { defaultEffort })
}) as PublicModel

const APP = import.meta.glob('./App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const models = [model('sonnet', ['low', 'medium', 'high'], 'medium'), model('haiku', [])]

describe('keeping a column', () => {
  it('sets the effort the kept column ran at', () => {
    const kept = routeAfterKeep({ runtime: 'claude', model: 'sonnet', effort: 'high' }, models)
    expect(kept).toEqual({ runtime: 'claude', model: 'sonnet', effort: 'high' })
  })

  it('lands on the model\'s own default when the column ran at a level it does not offer', () => {
    expect(routeAfterKeep({ runtime: 'claude', model: 'sonnet', effort: 'ultra' }, models).effort).toBe('medium')
  })

  it('leaves the effort unset for a model with no levels', () => {
    expect(routeAfterKeep({ runtime: 'claude', model: 'haiku', effort: 'high' }, models).effort).toBeUndefined()
    expect(routeAfterKeep({ runtime: 'claude', model: 'haiku' }, models).effort).toBeUndefined()
  })

  it('has no mode in what it carries', () => {
    expect(Object.keys(routeAfterKeep({ runtime: 'claude', model: 'sonnet', effort: 'high' }, models)).sort()).toEqual(['effort', 'model', 'runtime'])
  })

  it('puts the mode the person had back after opening the kept conversation', () => {
    // Opening the kept mission reads its recorded mode back into the chat box
    // (followRouteOf): for a column that ran in Auto, that is Auto, on the real
    // folder. keepCompareColumn must restore the mode held when Keep was pressed.
    const source = APP['./App.tsx'] ?? ''
    expect(source.length).toBeGreaterThan(0)
    const start = source.indexOf('const keepCompareColumn')
    const body = source.slice(start, source.indexOf('const judgeCompare', start))
    expect(body).toContain('const modeBeforeKeep = mode')
    expect(body).toContain('setMode(modeBeforeKeep)')
    expect(body.indexOf('openMission(newest)')).toBeLessThan(body.indexOf('setMode(modeBeforeKeep)'))
    expect(body.match(/setMode\(/g)).toHaveLength(1)
  })
})

describe('the bar after Keep', () => {
  it('names the mode the conversation is in', () => {
    expect(keptSentence('Sonnet 5.5 · High', 'accept-edits')).toBe('You kept Sonnet 5.5 · High; the conversation carries on with it in Edit.')
    expect(keptSentence('Sonnet 5.5 · High', 'ask')).toBe('You kept Sonnet 5.5 · High; the conversation carries on with it in Ask.')
  })

  it('says so when the comparison ran in Auto and the conversation does not', () => {
    expect(keptSentence('Sonnet 5.5 · High', 'accept-edits', 'auto')).toBe(
      'You kept Sonnet 5.5 · High; the conversation carries on with it in Edit, not in Auto as the comparison did, in copies of your folder.'
    )
    expect(keptSentence('X', 'ask', 'auto')).toContain('in Ask, not in Auto')
  })

  it('does not apologise when the modes agree, and promises nothing when the mode is not known', () => {
    expect(keptSentence('X', 'auto', 'auto')).toBe('You kept X; the conversation carries on with it in Auto.')
    expect(keptSentence('X', undefined)).toBe('You kept X; the conversation carries on with it.')
  })

  it('is what the comparison view draws', () => {
    const compare: PublicCompare = {
      compareId: 'cmp_1',
      prompt: 'name three prime numbers',
      createdAt: '2026-10-05T04:00:00.000Z',
      changes: true,
      slots: [
        { slot: 'a', route: { runtime: 'claude', model: 'haiku', effort: 'low', label: 'Haiku 4.5 · Low', mode: 'auto' }, missionIds: ['m_a'] },
        { slot: 'b', route: { runtime: 'claude', model: 'haiku', effort: 'high', label: 'Haiku 4.5 · High', mode: 'auto' }, missionIds: ['m_b'] }
      ],
      kept: { slot: 'b', at: '2026-10-05T04:05:00.000Z' }
    }
    const columns: CompareColumnView[] = (['a', 'b'] as const).map((slot) => ({
      slot,
      name: slot === 'a' ? 'Haiku 4.5 · Low' : 'Haiku 4.5 · High',
      runtime: 'claude',
      runtimeName: 'Claude Code',
      turns: [{ missionId: `m_${slot}`, items: [], running: false }],
      running: false,
      keepable: true,
      retryable: false,
      answer: '2, 3, 5.',
      state: 'done'
    }))
    const html = renderToStaticMarkup(
      <CompareView compare={compare} changeLines={{}} prompts={[compare.prompt]} columns={columns} owner={undefined} workspacePath={undefined} keeping={false} conversationMode="accept-edits" retrying={undefined} onKeep={() => undefined} onRetry={() => undefined} onBack={undefined} />
    )
    expect(html).toContain('You kept Haiku 4.5 · High; the conversation carries on with it in Edit, not in Auto as the comparison did, in copies of your folder.')
  })
})
