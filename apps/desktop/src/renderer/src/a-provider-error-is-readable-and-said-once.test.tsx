import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { providerErrorSentence } from '@teammate/runtime-adapters'
import { buildThread, errorAlreadyShown, failureMessage } from './missionView.js'
import { Thread } from './components/Thread.js'

const modelError = '{"type":"error","error":{"message":"model \'gpt-6.1-sol\' is not enabled in rustponsesapi","type":"invalid_request_error","param":null,"code":null},"status":400}'
const examples = [
  [modelError, 'OpenAI refused the model gpt-6.1-sol: it is not enabled here right now. Pick another model and send again.'],
  ['{"error":{"message":"Too many requests"},"status":429}', 'OpenAI rate limited this request. Wait a while, or pick another model and send again.'],
  ['{"message":"Service unavailable","status":503}', 'OpenAI is overloaded or unavailable right now. Try again later, or pick another model.'],
  ['{"error":{"message":"Unauthorized"},"status":401}', "OpenAI refused this request because of sign-in or access permissions. Check the agent's sign-in and model access, then send again."],
  ['The connection closed before the answer finished.', 'The connection closed before the answer finished.']
] as const

const recorded = (message: string, runtime: MissionRuntimeId = 'codex'): NormalizedRuntimeEvent[] => [
  { id: 'error', runId: 'run-error', sequence: 1, occurredAt: '2026-10-05T12:00:00.000Z', sourceAdapter: runtime, type: 'adapter.diagnostic',
    payload: { level: 'error', code: `${runtime}.runtime_error`, message, terminal: false, evidence: { raw: message, redacted: false } } },
  { id: 'failed', runId: 'run-error', sequence: 2, occurredAt: '2026-10-05T12:00:01.000Z', sourceAdapter: runtime, type: 'run.failed',
    payload: { kind: 'process-failed', message, runtimeTerminal: 'failed', process: {
      exitCode: 1, signal: null, stderr: '', stderrTruncated: false, recordCount: 1,
      inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0,
      forcedTerminationAttempted: false, terminationUnconfirmed: false,
      startedAt: '2026-10-05T12:00:00.000Z', finishedAt: '2026-10-05T12:00:01.000Z'
    } } }
]

const render = (events: NormalizedRuntimeEvent[], error: string): string => renderToStaticMarkup(
  <Thread prompt="Summarize the turns" onOpenPeerRun={() => undefined} earlierTurns={[]} events={events}
    running={false} restoredMission={undefined} error={error} errorIsPersistence={false} startedAt={undefined}
    approvals={[]} onDecide={() => undefined} onAnswerQuestion={() => undefined} decidingIds={[]} cancelled={false}
    handoff={undefined} peers={{ self: undefined, teammates: [], messages: [], notices: [] }} />
)

describe('a provider error is readable and said once', () => {
  it.each(examples)('shows the recorded error %s once in a failed turn', (raw, expected) => {
    const events = recorded(raw)
    const before = JSON.stringify(events)
    const items = buildThread(events, { running: false })
    expect(items.filter((item) => item.type === 'diagnostic')).toHaveLength(1)
    expect(items.find((item) => item.type === 'diagnostic')).toMatchObject({ level: 'error', message: expected })
    const html = render(events, raw)
    const escaped = renderToStaticMarkup(<span>{expected}</span>).slice(6, -7)
    expect(html.split(escaped)).toHaveLength(2)
    expect(html).not.toContain('The run could not continue')
    expect(html).not.toContain('rustponsesapi')
    expect(JSON.stringify(events)).toBe(before)
  })

  it('keeps a failed turn readable when its diagnostic was never recorded', () => {
    const events = recorded(modelError).slice(1)
    const html = render(events, modelError)
    expect(html.split(examples[0][1])).toHaveLength(2)
    expect(html).not.toContain('rustponsesapi')
  })

  it('does not repeat a final rate-limit failure as a temporary warning', () => {
    const raw = examples[1][0]
    const events = recorded(raw)
    events.unshift({ id: 'limit', sequence: 0, runId: 'run-error', occurredAt: '2026-10-05T12:00:00.000Z',
      sourceAdapter: 'codex', type: 'route.limit_detected', payload: {
        kind: 'temporary-rate-limit', message: raw, evidence: { raw, redacted: false }
      } })
    const html = render(events, raw)
    expect(html.split(examples[1][1])).toHaveLength(2)
    expect(buildThread(events, { running: false }).filter((item) => item.type === 'limit')).toHaveLength(0)
  })

  it('formats restored errors for each runtime without inventing its upstream provider', () => {
    for (const runtime of ['claude', 'cursor', 'antigravity', 'copilot', 'opencode'] as const) {
      const raw = examples[1][0]
      const expected = providerErrorSentence(raw, runtime)
      const items = buildThread(recorded(raw, runtime), { running: false })
      expect(items.find((item) => item.type === 'diagnostic')).toMatchObject({ message: expected })
      expect(errorAlreadyShown(items, expected)).toBe(true)
      expect(failureMessage({ message: raw }, runtime)).toBe(expected)
    }
  })

  it('reads a JSON stderr cause without appending the raw body to a readable error', () => {
    expect(failureMessage({ message: 'The process could not finish.', process: { stderr: examples[2][0] } }, 'codex')).toBe(examples[2][1])
    expect(failureMessage({ message: modelError, process: { stderr: modelError } }, 'codex')).toBe(examples[0][1])
  })

  it('keeps a distinct failure card and does not let a warning hide the failure', () => {
    expect(errorAlreadyShown([{ key: 'warning', type: 'diagnostic', level: 'warning', message: 'The process died' }], 'The process died')).toBe(false)
    expect(errorAlreadyShown([{ key: 'other', type: 'diagnostic', level: 'error', message: 'Another failure' }], 'The process died')).toBe(false)
  })
})
