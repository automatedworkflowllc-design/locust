import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { ActivityCard } from './components/ActivityCard.js'
import { activityEntries, buildThread } from './missionView.js'
import type { ActivityDetail } from './missionView.js'

/**
 * A COMMAND SENT TO THE BACKGROUND SAYS WHAT BECAME OF IT.
 *
 * Colin, 2026-09-21: something went to the background and "when it finished
 * we never got the follow up reply". Measured 2026-09-22 with Claude Code in
 * print mode: it never finished. The run printed its answer, then killed the
 * command (`task_notification`, status `stopped`), and the row went on
 * saying a green `done` beside "in the background".
 *
 * Worse, the row had not been saying even that. Claude Code only states what
 * a call was for (its description) and whether it was backgrounded once the
 * call is written out, which is after the row opens, so both ride on the
 * completion -- and the thread read neither from there. Replaying a real
 * capture through the adapter and `buildThread` gave a row with the command,
 * no description and no background flag: every Claude command row since
 * 2026-09-09 had drawn its shell pipeline instead of the sentence, and the
 * 0.257.0 badge never reached one. Both had been tested at the adapter alone.
 *
 * The events below are the adapter's real output for that capture
 * (`packages/runtime-adapters/test/fixtures/claude/background-stopped-with-run.jsonl`),
 * reduced to the fields this layer reads.
 */

const CALL = 'toolu_016MCbGpcf7wkMy2eHrDb6LC'
const COMMAND = 'sleep 8 && echo finished > out.txt'
const SAID = 'Background task: sleep 8 seconds then write to out.txt'

let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`,
    runId: 'r',
    missionId: 'm',
    sequence,
    occurredAt: `2026-09-22T22:06:${String(10 + sequence).padStart(2, '0')}.000Z`,
    sourceAdapter: 'claude',
    type,
    payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

/** The call opens with its name only; its input comes later. */
const opened = (): NormalizedRuntimeEvent => event('tool.started', { itemId: CALL, toolKind: 'tool_use', name: 'Bash', phase: 'started' })
const backgrounded = (): NormalizedRuntimeEvent =>
  event('step.started', { stepKind: 'item', itemId: CALL, itemType: 'background', status: 'running', message: SAID })
/** The call returns at once, carrying what it was for and where it went. */
const returned = (): NormalizedRuntimeEvent =>
  event('tool.completed', { itemId: CALL, toolKind: 'tool_use', name: 'Bash', command: COMMAND, title: SAID, background: true, phase: 'completed' })
const ended = (status: string, type = 'step.completed'): NormalizedRuntimeEvent =>
  event(type, { stepKind: 'item', itemId: CALL, itemType: 'background', status })

function shellRow(events: readonly NormalizedRuntimeEvent[]) {
  const thread = buildThread(events, { running: false })
  const card = thread.find((item) => 'details' in item) as { readonly details: readonly ActivityDetail[] } | undefined
  const row = activityEntries(card?.details ?? []).find((entry) => entry.kind === 'shell')
  if (row?.kind !== 'shell') throw new Error('no command row')
  return row
}

describe('a background command says what became of it', () => {
  it('a Claude command row leads with what the model said it was doing', () => {
    // The part that was never on screen: the description and the flag arrive
    // on the completion, not on the start.
    const row = shellRow([opened(), returned()])
    expect(row.title).toBe(SAID)
    expect(row.command).toBe(COMMAND)
    expect(row.background).toBe(true)
  })

  it('learns the work was stopped when the run ended, after the call had closed', () => {
    const row = shellRow([opened(), backgrounded(), returned(), ended('stopped-with-run')])
    expect(row.settled).toBe(true)
    expect(row.backgroundEnded).toBe('stopped-with-run')
  })

  it('work that finished, or failed, in the background says that', () => {
    expect(shellRow([opened(), backgrounded(), returned(), ended('completed')]).backgroundEnded).toBe('completed')
    expect(shellRow([opened(), backgrounded(), returned(), ended('failed', 'step.failed')]).backgroundEnded).toBe('failed')
    // A word from a later build is still an ending, not silence.
    expect(shellRow([opened(), backgrounded(), returned(), ended('evaporated')]).backgroundEnded).toBe('ended')
  })

  it('background work does not take the live line, or end it', () => {
    /*
     * The teammate sent the work away so it could do something else. Before
     * this, the start of that work became the live line ("Background task:
     * ...") as though it were the current step, and its ending cleared
     * whatever the teammate really was doing.
     */
    const reading = event('step.started', { stepKind: 'item', itemId: 'r1', itemType: 'reasoning-free', message: 'Reading the test output' })
    const live = (events: readonly NormalizedRuntimeEvent[]) =>
      buildThread(events, { running: true }).find((item) => item.type === 'live-step') as { readonly label?: string } | undefined
    expect(live([opened(), backgrounded(), returned(), reading])?.label).toBe('Reading the test output')
    expect(live([opened(), backgrounded(), returned(), reading, ended('completed')])?.label).toBe('Reading the test output')
  })
})

describe('the row, drawn', () => {
  const draw = (details: readonly ActivityDetail[], finished: boolean): string =>
    renderToStaticMarkup(
      <ActivityCard summary="ran 1 command" details={details} runtimeName="Claude Code" workspacePath="C:/work" finished={finished} openByDefault />
    )
  const row = (over: Partial<ActivityDetail>): ActivityDetail =>
    ({ kind: 'shell', tool: 'Bash', name: COMMAND, title: SAID, background: true, settled: true, ...over }) as ActivityDetail

  it('stopped with the run: amber, and says why', () => {
    const html = draw([row({ backgroundEnded: 'stopped-with-run' })], true)
    expect(html).toContain('>stopped<')
    expect(html).toContain('when the run ended')
    expect(html).toContain('is-stalled')
    // Not the green `done` that read as finished work.
    expect(html).not.toContain('>done<')
  })

  it('still running while the run is live, and not claimed afterwards', () => {
    const live = draw([row({})], false)
    expect(live).toContain('>running<')
    expect(live).toContain('in the background')
    // Once the run is over with no word on it, nothing is claimed either way.
    const over = draw([row({})], true)
    expect(over).toContain('did not report')
    expect(over).not.toContain('>running<')
    expect(over).not.toContain('lc-sweep')
  })

  it('a described row keeps the command one press away', () => {
    /*
     * Claude reports no command output, so its rows were all the static
     * kind -- and the static row drew the description IN PLACE of the
     * command. With descriptions now arriving, every Claude row would have
     * lost the command, which is the evidence of what ran.
     */
    // The card's own header is one expander; an openable row is a second.
    const expanders = (html: string): number => (html.match(/aria-expanded=/g) ?? []).length
    const html = draw([row({ background: false })], true)
    expect(html).toContain(SAID)
    expect(expanders(html)).toBe(2)
    // No description: nothing to open onto, so it stays a plain row showing
    // the command itself (escaped, as markup is).
    const plain = draw([row({ title: undefined, background: false })], true)
    expect(plain).toContain('sleep 8 &amp;&amp; echo finished &gt; out.txt')
    expect(expanders(plain)).toBe(1)
  })
})
