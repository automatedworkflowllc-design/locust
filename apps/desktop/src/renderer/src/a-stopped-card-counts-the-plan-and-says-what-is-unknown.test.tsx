// Colin: "its counts add up (finished + cut off + never started = the plan's steps);
// FINISHED never lists the workspace folder"; "Card only (Fix plan counts and
// workspace filtering; show that an unreported OpenCode command may have been running, with one warning.)."
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { cancellationSummary } from './missionView.js'
import { CancellationCard } from './components/CancellationCard.js'

const event = (type: string, payload: Record<string, unknown>, sourceAdapter = 'opencode'): NormalizedRuntimeEvent =>
  ({ id: 'event', runId: 'run', sequence: 1, occurredAt: '2026-10-03T20:00:00Z', type, payload, sourceAdapter } as unknown as NormalizedRuntimeEvent)
const tool = (id: string, name: string): NormalizedRuntimeEvent[] => [
  event('tool.started', { itemId: id, name: 'read', command: name }),
  event('tool.completed', { itemId: id, name: 'read' })
]
const html = (events: NormalizedRuntimeEvent[], count = 0, root = 'C:/work/project'): string =>
  renderToStaticMarkup(<CancellationCard summary={cancellationSummary(events, count, root)} stoppedAt={undefined} />)

describe('a stopped card counts the plan and says what is unknown', () => {
  it('counts plan states even when unrelated tools and disk observations settled', () => {
    const events = [event('plan.updated', { plan: [
      { step: 'One', status: 'completed' }, { step: 'Two', status: 'in_progress' },
      { step: 'Three', status: 'pending' }, { step: 'Four', status: 'pending' }
    ] }), ...tool('read', 'README.md'), ...tool('disk', 'started.txt')]
    const summary = cancellationSummary(events, 4)
    expect(summary.neverStarted).toBe(2)
    expect(html(events, 4)).toContain('1 finished · 1 cut off · 2 never started (4 steps)')
  })

  it('uses the latest plan and never treats extra tool calls as completed plan steps', () => {
    const events = [event('plan.updated', { plan: ['Old'] }), event('plan.updated', { plan: [
      { step: 'One', status: 'in_progress' }, { step: 'Two', status: 'pending' }
    ] }), ...tool('a', 'a.txt'), ...tool('b', 'b.txt'), ...tool('c', 'c.txt')]
    expect(html(events, 2)).toContain('0 finished · 1 cut off · 1 never started (2 steps)')
  })

  it('shows a fully finished plan even without tool calls', () => {
    const events = [event('plan.updated', { plan: [{ step: 'Answer', status: 'completed' }] }, 'codex')]
    expect(html(events, 1)).toContain('1 finished · 0 cut off · 0 never started (1 step)')
    expect(html(events, 1)).not.toContain('Stopped before it used any tools')
    expect(html(events, 1)).not.toContain('may still finish on its own')
    expect(html(events, 1)).not.toContain('undoing a change is yours to do')
  })

  it('does not invent a plan for a stopped command without one', () => {
    expect(html(tool('command', 'pnpm test'))).not.toContain('<dt>Plan</dt>')
  })

  it('excludes the workspace root and its relative spellings without hiding a file with the same basename', () => {
    const events = ['c:\\WORK\\project\\', '.', './', 'project', 'C:/work/project', 'project/answer.txt', 'C:/other/project']
      .flatMap((name, index) => tool(String(index), name))
    expect(cancellationSummary(events, 0, 'C:/work/project').settled).toEqual(['project/answer.txt', 'C:/other/project'])
  })

  it('offers an unreported OpenCode command under Cut off with its warning once', () => {
    const card = html(tool('disk', 'started.txt'))
    expect(card).toMatch(/<dt>Cut off<\/dt><dd[^>]*>.*An unreported OpenCode command may have been running when stopped/)
    expect(card.split('may have been running when stopped').length - 1).toBe(1)
    expect(card).not.toContain('may still finish on its own')
    expect(card).not.toContain('None reported.')
  })

  it('shows the same uncertainty when OpenCode reported no completed tools', () => {
    const card = html([event('run.started', {})])
    expect(card).toContain('<dt>Cut off</dt>')
    expect(card).toContain('An unreported OpenCode command may have been running when stopped')
    expect(card).not.toContain('nothing is half-done')
  })

  it('keeps reported interrupted commands and states OpenCode uncertainty once', () => {
    const card = html([event('tool.started', { itemId: 'running', name: 'bash', command: 'pnpm test' })])
    expect(card).toContain('pnpm test')
    expect(card.split('may have been running when stopped').length - 1).toBe(1)
  })

  it('keeps the ordinary runtime warning and never invents OpenCode uncertainty for it', () => {
    const card = html([event('tool.started', { itemId: 'running', name: 'shell', command: 'pnpm test' }, 'codex')])
    expect(card).toContain('may still finish on its own')
    expect(card).not.toContain('unreported OpenCode command')
  })
})
