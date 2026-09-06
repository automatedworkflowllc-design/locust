import type { ActivityDetail } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicPeerMessage, PublicRecoveredMission } from '../../shared/ipc.js'
import { describe, expect, it } from 'vitest'

import {
  activityCounts,
  activityEntries,
  activitySummary,
  assistantMessages,
  buildSignalRail,
  buildThread,
  editToolName,
  cancellationSummary,
  conversationTurns,
  decisionStanding,
  errorAlreadyShown,
  turnPromptLine,
  peerRunFor,
  defaultOpenEntry,
  failureMessage,
  peerExchangeStartsOpen,
  peerGroups,
  peerSnippet,
  railLabel,
  recentlyUsedRoutes,
  relativePath,
  usageWindowLabel,
  usageWindowSentence,
  usagePercent,
  activityTrace,
  durationText,
  traceOutcome,
  relayedTitle,
  resolvedModelNames,
  resumableSessionOf,
  rootMission,
  shellCommandText,
  startedLabel,
  stitchedHandoff,
  threadMarkers,
  threadPeerCards,
  typedPrompt
} from './missionView.js'

const NOW = '2026-08-31T16:00:00.000Z'
let sequence = 0

function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: NOW,
    sourceAdapter: 'codex',
    type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

function startedEvent(runtimeThreadId?: string): NormalizedRuntimeEvent {
  const started = event('run.started', { runtimeThreadId: runtimeThreadId ?? '' })
  return runtimeThreadId === undefined
    ? started
    : ({ ...started, runtimeThreadId } as unknown as NormalizedRuntimeEvent)
}

function toolStart(itemId: string, name: string, command?: string): NormalizedRuntimeEvent {
  return event('tool.started', {
    itemId,
    toolKind: 'command_execution',
    name,
    phase: 'started',
    ...(command === undefined ? {} : { command })
  })
}

function toolDone(itemId: string): NormalizedRuntimeEvent {
  return event('tool.completed', {
    itemId,
    toolKind: 'command_execution',
    name: 'shell',
    phase: 'completed'
  })
}

function delta(itemId: string, text: string, operation: 'append' | 'replace', final = false): NormalizedRuntimeEvent {
  return event('message.delta', { itemId, operation, text, final })
}

describe('assistant text', () => {
  it('rebuilds an appended stream instead of keeping the last fragment', () => {
    const messages = assistantMessages([
      delta('a', 'Adapter parity ', 'append'),
      delta('a', 'holds for ', 'append'),
      delta('a', 'invoice.paid.', 'append', true)
    ])
    expect(messages).toEqual([{ itemId: 'a', text: 'Adapter parity holds for invoice.paid.', final: true }])
  })

  it('honors a replace as a replace', () => {
    const messages = assistantMessages([
      delta('a', 'partial', 'append'),
      delta('a', 'the whole answer', 'replace', true)
    ])
    expect(messages[0]?.text).toBe('the whole answer')
  })

  it('keeps separate messages separate and in order', () => {
    const messages = assistantMessages([
      delta('a', 'first', 'append', true),
      delta('b', 'second', 'append', true)
    ])
    expect(messages.map((m) => m.text)).toEqual(['first', 'second'])
  })
})

describe('how a path is written in a row', () => {
  const WS = String.raw`C:\Users\x\projects\streaks`

  it('drops the workspace, because the row is one line and the filename is the point', () => {
    expect(relativePath(String.raw`C:\Users\x\projects\streaks\src\streak.js`, WS)).toBe('src/streak.js')
  })

  it('matches case-insensitively, the way Windows does', () => {
    expect(relativePath(String.raw`c:\users\x\projects\streaks\src\cli.js`, WS)).toBe('src/cli.js')
  })

  it('keeps a path outside the workspace whole, because there the location is the information', () => {
    const outside = String.raw`C:\Users\x\other\thing.js`
    expect(relativePath(outside, WS)).toBe(outside)
  })

  it('changes nothing when the workspace is unknown', () => {
    const path = String.raw`C:\Users\x\projects\streaks\src\streak.js`
    expect(relativePath(path, undefined)).toBe(path)
    expect(relativePath(path, '')).toBe(path)
  })

  it('leaves a path that is already relative alone', () => {
    expect(relativePath('src/streak.js', WS)).toBe('src/streak.js')
  })

  it("drops a teammate's own-branch tree too, because the tree is the same project", () => {
    expect(relativePath(String.raw`C:\Users\x\projects\streaks\.locust\worktrees\tm_abc123\src\streak.js`, WS)).toBe('src/streak.js')
    expect(relativePath('.locust/worktrees/tm_abc123/README.md', WS)).toBe('README.md')
  })

  it('keeps the tree root itself, since there is nothing shorter that is true', () => {
    expect(relativePath(String.raw`C:\Users\x\projects\streaks\.locust\worktrees\tm_abc123`, WS)).toBe('.locust/worktrees/tm_abc123')
  })
})

describe('when a mission says it began', () => {
  const now = new Date('2026-09-03T14:00:00')

  it('shows the bare time for a mission started today', () => {
    // The locale decides 24-hour or AM/PM; what matters is that no date rides
    // along on a mission from today.
    const label = startedLabel('2026-09-03T09:15:00', now)
    expect(label).toContain('09:15')
    expect(label).not.toMatch(/Sep|\d{4}/)
  })

  it('carries the date once the mission is not from today', () => {
    // `started 12:25 AM` with no date is unambiguous only while the app stays
    // open; the next morning a mission from last night reads as recent.
    const label = startedLabel('2026-09-02T23:25:00', now)
    expect(label).toContain('Sep')
    expect(label).toContain('2')
  })

  it('adds the year only when the mission is from another one', () => {
    expect(startedLabel('2025-12-31T23:59:00', now)).toContain('2025')
    expect(startedLabel('2026-09-01T10:00:00', now)).not.toContain('2026')
  })

  it('says nothing for a timestamp it cannot read', () => {
    expect(startedLabel('not a date', now)).toBeUndefined()
  })
})

describe('which tool names mean a file was touched (0.35.2 QA)', () => {
  it('does not count a to-do list or a sub-agent writer as a file', () => {
    // OpenCode's `todowrite` is the model's own to-do list and is offered
    // even to read-only runs; Copilot's `write_agent` starts a helper. Both
    // matched a bare `write` and the fold reported a changed file on a run
    // that changed nothing.
    expect(editToolName('todowrite')).toBe(false)
    expect(editToolName('write_agent')).toBe(false)
    expect(editToolName('todoread')).toBe(false)
  })

  it('counts a removal, which Cursor calls delete', () => {
    // The same mistake from the other side: a run that deleted a file
    // reported a tool call and no file.
    expect(editToolName('delete')).toBe(true)
    expect(editToolName('deleteFile')).toBe(true)
  })

  it('still counts the ordinary ones', () => {
    for (const name of ['write', 'Write', 'edit', 'apply_patch', 'file_change', 'create_file', 'rename']) {
      expect(editToolName(name)).toBe(true)
    }
    for (const name of ['read', 'grep', 'glob', 'shell', 'web_search']) {
      expect(editToolName(name)).toBe(false)
    }
  })
})

describe('what the fold counts as a changed file (0.35.0 QA)', () => {
  // Ported from the 0.35.0 targeted QA's own regression file. Three of its
  // four cases failed on 0.35.1; each is paired here with the control that
  // stops the fix from being "always answer one".
  const patchFor = (path: string) => ({
    text: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-draft\n+final\n`,
    added: 1,
    removed: 1,
    truncated: false
  })
  const filesText = (details: readonly ActivityDetail[]): string | undefined =>
    activityTrace(details, [], 'completed').find((segment) => segment.key === 'files')?.text

  it('counts one Copilot multiline patch as one changed file', () => {
    expect(
      filesText([
        {
          kind: 'edit',
          name: '*** Begin Patch\n*** Update File: notes.ts\n@@\n-draft\n+final\n*** End Patch',
          settled: true,
          patch: patchFor('notes.ts')
        }
      ])
    ).toBe('1 file')
  })

  it('counts two edits to the same path once', () => {
    const detail: ActivityDetail = { kind: 'edit', name: 'notes.ts', settled: true, patch: patchFor('notes.ts') }
    expect(filesText([detail, detail])).toBe('1 file')
  })

  it('still counts two edits to two paths as two', () => {
    expect(
      filesText([
        { kind: 'edit', name: 'notes.ts', settled: true, patch: patchFor('notes.ts') },
        { kind: 'edit', name: 'other.ts', settled: true, patch: patchFor('other.ts') }
      ])
    ).toBe('2 files')
  })

  it('does not count a refused write as a changed file', () => {
    expect(filesText([{ kind: 'edit', name: 'blocked.txt', settled: true, failed: true }])).toBeUndefined()
  })

  it('still counts the writes that landed beside a refused one', () => {
    expect(
      filesText([
        { kind: 'edit', name: 'blocked.txt', settled: true, failed: true },
        { kind: 'edit', name: 'notes.ts', settled: true, patch: patchFor('notes.ts') }
      ])
    ).toBe('1 file')
  })
})

describe('the words a person typed, across a route switch (0.35.0 QA)', () => {
  const mission = (fields: Record<string, unknown>): PublicRecoveredMission =>
    ({ peerMessages: [], ...fields }) as unknown as PublicRecoveredMission

  it('keeps the new instruction a handoff was started for', () => {
    // `main/handoff.ts` appends the person's next words LAST, as its own
    // section; walking back past it showed the original task instead.
    const first = mission({ missionId: 'first', prompt: 'Create a module and test it' })
    const next = mission({
      missionId: 'next',
      prompt: 'Another agent started this task.\n\nThe person now asks:\n\nRun its tests without editing.',
      continuesFrom: { missionId: 'first', checkpointEpoch: 1, reason: 'route-switch' }
    })
    expect(typedPrompt(next, new Map([['first', first], ['next', next]]))).toBe('Run its tests without editing.')
  })

  it("leaves a person's own words alone, even when they contain the marker", () => {
    // Someone working on this codebase types the sentence, and the mission
    // was titled with whatever followed it (QA, 2026-09-06). A mission a
    // person typed is their words already, whatever it happens to contain.
    const typed = mission({
      missionId: 'typed',
      prompt: 'Rename the string "The person now asks:" in handoff.ts and update both readers.'
    })
    expect(typedPrompt(typed, new Map([['typed', typed]]))).toBe(
      'Rename the string "The person now asks:" in handoff.ts and update both readers.'
    )
  })

  it('does not read the marker out of a briefing that quotes the original task', () => {
    // A rescue quotes the task it is continuing. When the task itself held
    // the sentence, the match landed inside the quote and the briefing's own
    // sections were shown as the person's words.
    const first = mission({
      missionId: 'first',
      prompt: 'Rename the string "The person now asks:" in handoff.ts and update both readers.'
    })
    const rescue = mission({
      missionId: 'rescue',
      prompt:
        'Another agent started this task:\n\nRename the string "The person now asks:" in handoff.ts and update both readers.\n\nThese actions reported finishing before the stop: none.',
      continuesFrom: { missionId: 'first', checkpointEpoch: 1, reason: 'route-switch' }
    })
    expect(typedPrompt(rescue, new Map([['first', first], ['rescue', rescue]]))).toBe(
      'Rename the string "The person now asks:" in handoff.ts and update both readers.'
    )
  })

  it('still shows the original words when the switch carried no new instruction', () => {
    // The rescue case: a route switch with nothing new to say must not start
    // showing the host's briefing, which is what this walk-back exists for.
    const first = mission({ missionId: 'first', prompt: 'Create a module and test it' })
    const next = mission({
      missionId: 'next',
      prompt: 'Another agent started this task. Continue from its checkpoint.',
      continuesFrom: { missionId: 'first', checkpointEpoch: 1, reason: 'route-switch' }
    })
    expect(typedPrompt(next, new Map([['first', first], ['next', next]]))).toBe('Create a module and test it')
  })
})

describe('a turn whose whole answer was a message to a teammate', () => {
  // Those messages are drawn beside the thread, not inside it, so from in
  // here the turn looked like one that said nothing -- and the warning landed
  // directly above the message it had just sent (Colin, 2026-09-06: "the this
  // turn ended with a reply intended?").
  const finished = [event('run.completed', {})]

  it('is not reported as a turn that said nothing', () => {
    const thread = buildThread(finished, { running: false, latestTurn: true, spokeToPeers: true })
    expect(thread.some((item) => item.type === 'diagnostic')).toBe(false)
  })

  it('still says so when the runtime really wrote nothing at all', () => {
    const thread = buildThread(finished, { running: false, latestTurn: true, spokeToPeers: false })
    const said = thread.find((item) => item.type === 'diagnostic')
    expect(said?.type === 'diagnostic' && said.message).toMatch(/ended without a reply/)
  })
})

describe('a row a runtime names only when the tool finishes', () => {
  it('takes the target from the completion when the start had none', () => {
    // Claude streams a tool's input after the call opens, so the row read
    // `Read` with no file until this arrived.
    const thread = buildThread(
      [
        event('tool.started', { itemId: 't1', toolKind: 'tool_use', name: 'Read', phase: 'started' }),
        event('tool.completed', { itemId: 't1', toolKind: 'tool_use', name: 'Read', command: 'src/cli.js', phase: 'completed' })
      ],
      { running: false }
    )
    const activity = thread.find((item) => item.type === 'activity')
    expect(activity?.type === 'activity' && activity.details[0]?.name).toBe('src/cli.js')
    expect(activity?.type === 'activity' && activity.details[0]?.tool).toBe('Read')
  })

  it('leaves a row the start already named alone', () => {
    const thread = buildThread(
      [
        event('tool.started', { itemId: 't1', toolKind: 'command_execution', name: 'shell', command: 'npm test', phase: 'started' }),
        event('tool.completed', { itemId: 't1', toolKind: 'command_execution', name: 'shell', command: 'something else', phase: 'completed' })
      ],
      { running: false }
    )
    const activity = thread.find((item) => item.type === 'activity')
    expect(activity?.type === 'activity' && activity.details[0]?.name).toBe('npm test')
  })
})

describe('the command a shell row shows', () => {
  const PS = String.raw`"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"`

  it('shows what ran, not the host that ran it', () => {
    // The row is one line wide. With the host in front, every command read as
    // the same truncated path and the actual work was cut off.
    expect(shellCommandText(`${PS} -Command "npm test"`)).toBe('npm test')
    expect(shellCommandText(`${PS} -NoProfile -NonInteractive -Command 'node --test'`)).toBe('node --test')
  })

  it('keeps a command that was never wrapped', () => {
    expect(shellCommandText('pnpm build')).toBe('pnpm build')
    expect(shellCommandText('git diff -- src/streak.js')).toBe('git diff -- src/streak.js')
  })

  it('unwraps a cmd.exe host too', () => {
    expect(shellCommandText(String.raw`C:\Windows\System32\cmd.exe /d /s /c "npm run build"`)).toBe('npm run build')
  })

  it('undoes the quote doubling the host introduced', () => {
    expect(shellCommandText(`${PS} -Command "rg -n ""streak"" src"`)).toBe('rg -n "streak" src')
  })
})

describe('what a failure card says', () => {
  const nl = String.fromCharCode(10)

  it("shows the runtime's own last word, because the host's sentence names only the shape", () => {
    // Measured 2026-09-03: this exact pair cost two runs that read on screen
    // as the same shrug.
    expect(
      failureMessage({
        message: 'Codex invocation did not complete successfully',
        process: { stderr: 'Not inside a trusted directory and --skip-git-repo-check was not specified.' + nl }
      })
    ).toBe(
      "Codex invocation did not complete successfully The runtime's own last word was: Not inside a trusted directory and --skip-git-repo-check was not specified."
    )
  })

  it('says capacity exhaustion in English rather than passing the jargon through alone', () => {
    const said = failureMessage({
      message: 'Cursor Agent ended without a terminal result record.',
      process: { stderr: 'RetriableError: [resource_exhausted] Error' + nl }
    })
    expect(said).toContain('out of capacity right now')
    // The runtime's own text still rides along: a person reporting this
    // upstream needs the words upstream uses.
    expect(said).toContain('resource_exhausted')
  })

  it('adds nothing when the runtime said nothing', () => {
    expect(failureMessage({ message: 'Codex CLI is not ready.' })).toBe('Codex CLI is not ready.')
    expect(failureMessage({ message: 'Codex CLI is not ready.', process: { stderr: '   ' + nl } })).toBe(
      'Codex CLI is not ready.'
    )
  })

  it('strips the terminal colour codes a runtime writes around its own words', () => {
    // Colin, 2026-09-05: OpenCode's refusal reached the card as three boxes
    // before the sentence a person needs to read. ESC is built from its code
    // so an editor eating an invisible character cannot break this quietly.
    const esc = String.fromCharCode(27)
    const message = failureMessage({
      message: 'OpenCode ended without a step that reported it had stopped.',
      process: {
        stderr: esc + '[93m' + esc + '[1m! ' + esc + '[0mpermission requested: external_directory; auto-rejecting'
      }
    })
    expect(message).toBe(
      "OpenCode ended without a step that reported it had stopped. The runtime's own last word was: ! permission requested: external_directory; auto-rejecting"
    )
    expect(message).not.toContain(esc)
    expect(message).not.toContain('[93m')
  })

  it('still finds the last SPEAKING line when the final one is only colour codes', () => {
    const esc = String.fromCharCode(27)
    expect(
      failureMessage({
        message: 'Codex stopped.',
        process: { stderr: 'the disk is full' + String.fromCharCode(10) + esc + '[0m' + esc + '[2K' }
      })
    ).toBe("Codex stopped. The runtime's own last word was: the disk is full")
  })

})

describe("a runtime's own helper", () => {
  it("is its own row: what it was asked, and whether it reported back", () => {
    const thread = buildThread(
      [
        event('tool.started', { itemId: 't1', toolKind: 'tool_use', name: 'Task', command: 'Search the tests for flaky cases', phase: 'started' }),
        event('tool.completed', { itemId: 't1', toolKind: 'tool_use', name: 'Task', command: 'Search the tests for flaky cases', phase: 'completed' }),
        event('tool.started', { itemId: 't2', toolKind: 'task', name: 'task', command: 'Summarise README', phase: 'started' })
      ],
      { running: true }
    )
    const activity = thread.find((item) => item.type === 'activity')
    expect(activity?.type === 'activity' && activity.details.map((d) => d.kind)).toEqual(['helper', 'helper'])
    const entries = activity?.type === 'activity' ? activityEntries(activity.details) : []
    expect(entries.map((e) => (e.kind === 'helper' ? [e.description, e.settled] : e.kind))).toEqual([
      ['Search the tests for flaky cases', true],
      ['Summarise README', false]
    ])
    expect(activity?.type === 'activity' && activity.summary).toBe('asked 2 subagents')
  })

  it('a helper the runtime never named is said to be unnamed, not drawn as a path', () => {
    const entries = activityEntries([{ kind: 'helper', name: 'Task', tool: 'Task', settled: true }])
    expect(entries).toEqual([{ kind: 'helper', key: 'helper_0', description: 'a subagent, unnamed', settled: true, failed: false }])
  })
})

describe('collapsed activity', () => {
  it('counts edits and commands separately from their tool events', () => {
    expect(
      activitySummary([
        { kind: 'edit', name: 'apply_patch', settled: true },
        { kind: 'edit', name: 'apply_patch', settled: true },
        { kind: 'shell', name: 'pnpm test', settled: true }
      ])
    ).toBe('Edited 2 files · ran 1 command')
  })

  it('counts files, not edit calls: one Codex file_change can name several', () => {
    expect(activitySummary([{ kind: 'edit', name: 'C:/w/README.md' + String.fromCharCode(10) + 'C:/w/src/prices.ts', settled: true }])).toBe('Edited 2 files')
  })

  it('draws one row per file a runtime named without a diff, never one row named after the tool', () => {
    const rows = activityEntries([
      // The real shape: the paths arrive as the tool's command and become the
      // detail's name, while the tool stays the literal 'file_change'.
      { kind: 'edit', name: 'C:/w/README.md' + String.fromCharCode(10) + 'C:/w/src/prices.ts', tool: 'file_change', settled: true }
    ])
    expect(rows.map((row) => [row.kind, 'name' in row ? row.name : ''])).toEqual([
      ['unreported', 'C:/w/README.md'],
      ['unreported', 'C:/w/src/prices.ts']
    ])
  })

  it('singularizes honestly', () => {
    expect(activitySummary([{ kind: 'edit', name: 'x', settled: true }])).toBe('Edited 1 file')
    // A refused write edited nothing; it is a call, and its row says failed.
    expect(activitySummary([{ kind: 'edit', name: 'C:/Users/x/.claude/plans/p.md', settled: true, failed: true }])).toBe('1 tool call')
  })

  it('says so when there was no tool activity', () => {
    expect(activitySummary([])).toBe('No tool activity')
  })

  it('classifies a patch command as an edit and a test run as a command', () => {
    const thread = buildThread(
      [toolStart('t1', 'shell', 'apply_patch <<EOF'), toolStart('t2', 'shell', 'pnpm test')],
      { running: true }
    )
    const activity = thread.find((item) => item.type === 'activity')
    expect(activity).toMatchObject({ summary: 'Edited 1 file · ran 1 command' })
  })
})

describe('thread composition', () => {
  it('shows a caret only while text is genuinely still arriving', () => {
    const streaming = buildThread([delta('a', 'partial', 'append')], { running: true })
    const finished = buildThread([delta('a', 'done', 'append', true)], { running: true })
    const stopped = buildThread([delta('a', 'partial', 'append')], { running: false })
    expect(streaming.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: true })
    // Final means the provider is done with this message even if the run is not.
    expect(finished.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: false })
    expect(stopped.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: false })
  })

  it('drops the live step once it completes', () => {
    const running = buildThread([event('step.started', { stepKind: 'turn', message: 'Running the billing suite' })], {
      running: true
    })
    const done = buildThread(
      [
        event('step.started', { stepKind: 'turn', message: 'Running the billing suite' }),
        event('step.completed', { stepKind: 'turn' })
      ],
      { running: true }
    )
    expect(running.find((i) => i.type === 'live-step')).toMatchObject({ label: 'Running the billing suite' })
    // The NAMED step goes the moment it completes -- a finished step must
    // never sit there looking live. What replaces it is a generic waiting
    // line, because the run is still up: `liveActivityOf` calls that state
    // "working", and the thread has to say the same thing the face does.
    expect(done.find((i) => i.type === 'live-step')).toMatchObject({ label: 'Working', waiting: true })
  })

  it('shows a line the moment a run starts, before any event arrives', () => {
    // The gap this closes: pressing Enter drew nothing at all until the
    // runtime's first event, which for a CLI that has to launch a process is
    // seconds of blank page (Colin, twice: "the input to working/thinking lag
    // still feels clunky").
    const justSent = buildThread([], { running: true, startedAt: '2026-09-04T21:47:00.000Z' })
    expect(justSent.find((i) => i.type === 'live-step')).toMatchObject({
      label: 'Starting',
      waiting: true,
      startedAt: '2026-09-04T21:47:00.000Z'
    })
  })

  it('says nothing above an approval the run is stopped on', () => {
    // A run awaiting a decision is still `running`. A "Working" line directly
    // above the card asking the question would contradict the header, which
    // resolves the same teammate to "waiting on you".
    const items = buildThread([], {
      running: true,
      startedAt: '2026-09-04T21:47:00.000Z',
      awaitingDecision: true
    })
    expect(items.some((i) => i.type === 'live-step')).toBe(false)
  })

  it('draws no live line once the run is over', () => {
    expect(buildThread([], { running: false, startedAt: '2026-09-04T21:47:00.000Z' })).toEqual([])
  })

  it('does not put a waiting line under a message that is still streaming', () => {
    // Text arriving IS the teammate doing something visible; a "Working" line
    // under it would say the opposite of what the reader can see.
    const items = buildThread([delta('a', 'half a sen', 'append')], { running: true, startedAt: '2026-09-04T21:47:00.000Z' })
    expect(items.some((i) => i.type === 'live-step')).toBe(false)
  })

  it('never shows a live step for a run that is not running', () => {
    const thread = buildThread([event('step.started', { stepKind: 'turn', message: 'Working' })], { running: false })
    expect(thread.some((i) => i.type === 'live-step')).toBe(false)
  })

  it('surfaces provider limits and diagnostics as their own items', () => {
    const thread = buildThread(
      [
        // Work has begun, so a notice here is about the mission, not the setup.
        toolStart('t1', 'shell', 'pnpm test'),
        event('route.limit_detected', { kind: 'temporary-rate-limit', message: 'Slow down' }),
        event('adapter.diagnostic', { level: 'warning', code: 'x', message: 'Heads up', terminal: false })
      ],
      { running: true }
    )
    expect(thread.find((i) => i.type === 'limit')).toMatchObject({ kind: 'temporary-rate-limit' })
    expect(thread.find((i) => i.type === 'diagnostic')).toMatchObject({ level: 'warning' })
  })

  it('finds the run a peer message was delivered into, so the exchange can be opened', () => {
    // Colin, 2026-09-04: a relayed run should be reachable "from the exchange
    // card in the thread the person is actually in". The same messageId is
    // `posted` on the run that wrote it and `received` on the run it reached.
    const link = (messageId: string, direction: 'received' | 'posted'): PublicPeerMessage => ({
      messageId,
      direction,
      from: { teammateId: 'tm_booty', name: 'Booty' },
      to: { teammateId: 'tm_wren', name: 'Wren' },
      text: 'How is your day?',
      at: NOW
    })
    const asked = { missionId: 'mission_booty', peerMessages: [link('wm_1', 'posted')] } as unknown as PublicRecoveredMission
    const answered = { missionId: 'mission_wren', peerMessages: [link('wm_1', 'received')] } as unknown as PublicRecoveredMission
    const unrelated = { missionId: 'mission_other', peerMessages: [link('wm_2', 'received')] } as unknown as PublicRecoveredMission

    expect(peerRunFor('wm_1', [asked, answered, unrelated])?.missionId).toBe('mission_wren')
    // Not the run that WROTE it -- that is the thread you are already in.
    expect(peerRunFor('wm_1', [asked])).toBeUndefined()
    // Still waiting for that teammate's next run is a real state, not an error.
    expect(peerRunFor('wm_3', [asked, answered])).toBeUndefined()
    expect(peerRunFor('', [asked, answered])).toBeUndefined()
  })

  it('never draws a turn the HOST briefed as the person\'s own words', () => {
    // MEASURED 2026-09-05, Colin's screenshot: the whole relay briefing --
    // "end with one <locust-share to=\"Wren\"> block... Do not use a
    // <locust-ask> block here" -- sat in the thread in the place a person's
    // message goes, as the most prominent text on screen.
    const briefing =
      'Wren (Code & Migrations) replied to you; it is quoted below. Do what it asks... end with one <locust-share to="Wren"> block holding your reply.'
    const received: PublicPeerMessage = {
      messageId: 'wm_1',
      direction: 'received',
      from: { teammateId: 'tm_wren', name: 'Wren' },
      to: { teammateId: 'tm_booty', name: 'Booty' },
      text: "Day's going well on my side.",
      at: '2026-09-05T00:00:00.000Z'
    }
    expect(
      turnPromptLine({ prompt: briefing, startedBy: { kind: 'relay', hop: 2 }, peerMessages: [received] })
    ).toBe("Wren asked: Day's going well on my side.")

    // The record no longer holds the message: draw NOTHING rather than the
    // briefing. The peer card beside it still says who wrote to whom.
    expect(turnPromptLine({ prompt: briefing, startedBy: { kind: 'relay', hop: 2 }, peerMessages: [] })).toBeUndefined()
    expect(turnPromptLine({ prompt: 'resumed briefing', startedBy: { kind: 'resume', epoch: 2 } })).toBeUndefined()

    // A person's words are theirs, and so are a routine's steps -- they were
    // typed by the person in the conversation the routine was saved from.
    expect(turnPromptLine({ prompt: 'read status.ts' })).toBe('read status.ts')
    expect(
      turnPromptLine({ prompt: 'read status.ts', startedBy: { kind: 'routine', routineId: 'rt_1', step: 2 } })
    ).toBe('read status.ts')
  })

  it('says so when a turn finished and wrote nothing back', () => {
    // MEASURED 2026-09-05 while Colin watched a live test: a follow-up on
    // Cursor completed cleanly, spent tokens, recorded reasoning, and emitted
    // no assistant text. The thread drew the person's message and then blank
    // space under a header saying `completed`.
    const silent = buildThread([event('run.started', {}), event('run.completed', { process: {} })], { running: false })
    expect(silent.filter((item) => item.type === 'diagnostic').map((item) => item.message)).toEqual([
      'This turn ended without a reply: the runtime finished and wrote nothing back. Nothing was changed. Sending it again usually works.'
    ])

    // A turn that answered says nothing of the kind...
    const answered = buildThread([delta('a', 'ALPHA', 'append', true), event('run.completed', { process: {} })], { running: false })
    expect(answered.some((item) => item.type === 'diagnostic')).toBe(false)
    // ...nor does one that did work without narrating it...
    const worked = buildThread(
      [toolStart('t1', 'shell', 'pnpm test'), toolDone('t1'), event('run.completed', { process: {} })],
      { running: false }
    )
    expect(worked.some((item) => item.type === 'diagnostic')).toBe(false)
    // ...and a run still going has not finished saying anything yet.
    expect(buildThread([event('run.started', {})], { running: true }).some((item) => item.type === 'diagnostic')).toBe(false)
  })

  it('says a quota failure once, not as a card and again as a red line', () => {
    // MEASURED user session 1, 2026-09-05: one Codex quota failure drew the
    // limit card, the runtime's error line and the run's failure card, all
    // carrying "You've hit your usage limit...".
    const said = "You've hit your usage limit. Upgrade to Pro or try again at Sep 7th, 2026 1:57 AM."
    const thread = buildThread(
      [
        toolStart('t1', 'shell', 'pnpm test'),
        event('route.limit_detected', { kind: 'quota-exhausted', message: said }),
        event('adapter.diagnostic', { level: 'error', code: 'codex.runtime_error', message: said, terminal: true }),
        event('adapter.diagnostic', { level: 'warning', code: 'x', message: 'Something else', terminal: false })
      ],
      { running: false }
    )
    expect(thread.filter((i) => i.type === 'limit')).toHaveLength(1)
    expect(thread.filter((i) => i.type === 'diagnostic').map((i) => i.message)).toEqual(['Something else'])
    // The run-level card would be the third copy; a slow-down warning must
    // never hide a real failure reason, so only an ending limit counts.
    expect(errorAlreadyShown(thread, `The run could not continue. ${said}`)).toBe(true)
    expect(errorAlreadyShown(thread, 'The process died')).toBe(false)
    const warned = buildThread([event('route.limit_detected', { kind: 'temporary-rate-limit', message: said })], { running: false })
    expect(errorAlreadyShown(warned, said)).toBe(false)
  })

  it('does not invent an activity card when nothing ran', () => {
    expect(buildThread([delta('a', 'hi', 'append', true)], { running: false }).some((i) => i.type === 'activity'))
      .toBe(false)
  })
})

describe('cancellation summary', () => {
  it('separates what finished from what was cut off mid-flight', () => {
    const summary = cancellationSummary(
      [toolStart('t1', 'shell', 'pnpm build'), toolDone('t1'), toolStart('t2', 'shell', 'pnpm test')],
      4
    )
    expect(summary.settled).toEqual(['pnpm build'])
    expect(summary.interrupted).toEqual(['pnpm test'])
    expect(summary.neverStarted).toBe(2)
  })

  it('never reports a negative count when more ran than were planned', () => {
    const summary = cancellationSummary([toolStart('t1', 'shell', 'a'), toolDone('t1')], 0)
    expect(summary.neverStarted).toBe(0)
  })
})

describe('signal rail', () => {
  it('shows newest first', () => {
    const rows = buildSignalRail(
      [event('run.started', { runtimeThreadId: 't' }), toolStart('t1', 'shell', 'pnpm test')],
      { running: true }
    )
    expect(rows[0]?.name).toMatch(/^tool\./)
    expect(rows[1]?.name).toMatch(/^runtime\.started/)
  })

  it('marks a tool live only while it is open AND the run is going', () => {
    const open = [toolStart('t1', 'shell', 'pnpm test')]
    const closed = [toolStart('t1', 'shell', 'pnpm test'), toolDone('t1')]
    expect(buildSignalRail(open, { running: true }).find((r) => r.name.startsWith('tool.'))?.live).toBe(true)
    // The same open tool in a run that has stopped is not live -- a pulsing dot
    // on a dead run is the shell asserting something is happening when nothing
    // is.
    expect(buildSignalRail(open, { running: false })[0]?.live).toBe(false)
    expect(buildSignalRail(closed, { running: true }).find((r) => r.name.includes('completed'))?.live).toBe(false)
  })

  it('colours by meaning, not decoration', () => {
    const rows = buildSignalRail(
      [
        event('route.limit_detected', { kind: 'temporary-rate-limit', message: 'slow down' }),
        event('run.failed', { kind: 'process-failed', message: 'died', runtimeTerminal: 'failed', process: {} }),
        event('run.completed', { process: {} })
      ],
      { running: false }
    )
    expect(rows.find((r) => r.name.includes('limit_detected'))?.tone).toBe('amber')
    expect(rows.find((r) => r.name.includes('run.failed'))?.tone).toBe('red')
    expect(rows.find((r) => r.name === 'run.completed')?.tone).toBe('blue')
  })

  it('says nothing about events it does not understand', () => {
    expect(buildSignalRail([event('nonsense.event', {})], { running: true })).toEqual([])
  })
})

describe('rail labels', () => {
  it('collapses whitespace and bounds a long command', () => {
    const long = `tool.shell · "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Get-Content -Raw -LiteralPath .\package.json"`
    const label = railLabel(long)
    expect(label.length).toBeLessThanOrEqual(72)
    expect(label.endsWith('\u2026')).toBe(true)
  })

  it('leaves a short label exactly as it is', () => {
    expect(railLabel('tool.shell · pnpm test')).toBe('tool.shell · pnpm test')
  })

  it('does not let a multi-line command become multiple rail lines', () => {
    expect(railLabel('a\nb\n  c')).toBe('a b c')
  })
})

describe('peer messages in the thread', () => {
  it('hides a share block from the agent bubble, keeping the prose', () => {
    const events = [
      {
        id: 'e1',
        runId: 'run_1',
        missionId: 'mission_1',
        sequence: 1,
        type: 'message.delta',
        occurredAt: '2026-09-01T15:00:00.000Z',
        sourceAdapter: 'codex',
        payload: {
          itemId: 'answer',
          operation: 'replace',
          text: 'The gate is pnpm check.\n\n<locust-share to="Atlas">\npnpm check runs everything.\n</locust-share>',
          final: true,
          evidence: { redacted: true }
        }
      }
    ] as unknown as NormalizedRuntimeEvent[]
    const items = buildThread(events, { running: false })
    expect(items).toEqual([{ key: 'msg_answer', type: 'agent-message', text: 'The gate is pnpm check.', streaming: false }])
  })

  it('groups an exchange by the other party and marks whether anything was received', () => {
    const groups = peerGroups([
      {
        messageId: 'wm_2',
        direction: 'posted',
        from: { teammateId: 'tm_wren', name: 'Wren' },
        to: { teammateId: 'tm_atlas', name: 'Atlas' },
        text: 'Noted as a claim.',
        at: '2026-09-01T15:05:00.000Z'
      },
      {
        messageId: 'wm_1',
        direction: 'received',
        from: { teammateId: 'tm_atlas', name: 'Atlas' },
        to: { teammateId: 'tm_wren', name: 'Wren' },
        text: 'Dispute events changed shape.',
        at: '2026-09-01T15:00:00.000Z'
      },
      {
        messageId: 'wm_3',
        direction: 'posted',
        from: { teammateId: 'tm_wren', name: 'Wren' },
        to: { teammateId: 'tm_nova', name: 'Nova' },
        text: 'Docs are stale.',
        at: '2026-09-01T15:06:00.000Z'
      }
    ])
    expect(groups.map((group) => group.peer.name)).toEqual(['Atlas', 'Nova'])
    expect(groups[0]?.messages.map((message) => message.messageId)).toEqual(['wm_1', 'wm_2'])
    expect(groups[0]?.received).toBe(true)
    expect(groups[1]?.received).toBe(false)
  })
})

describe('reopening a handed-off mission', () => {
  function mission(overrides: Partial<PublicRecoveredMission>): PublicRecoveredMission {
    return {
      missionId: 'mission_1',
      runId: 'run_1',
      workspaceId: 'ws_test',
      prompt: 'Inspect the workspace.',
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: null,
      createdAt: '2026-09-01T15:00:00.000Z',
      lastUpdatedAt: '2026-09-01T15:00:00.000Z',
      phase: 'completed',
      events: [],
      eventCount: 0,
      eventsTruncated: false,
      integrityIssueCount: 0,
      sandbox: 'read-only',
      checkpoints: [],
      peerMessages: [],
      ...overrides
    }
  }
  const first = mission({
    missionId: 'mission_1',
    runtime: 'codex',
    checkpoints: [
      {
        epoch: 1,
        reason: 'route-switch',
        resumeSafety: 'approval-required',
        safetyReason: 'one action never reported back',
        createdAt: '2026-09-01T15:01:00.000Z',
        unsettledActions: [{ itemId: 'tool_1', name: 'shell' }]
      }
    ]
  })
  const second = mission({
    missionId: 'mission_2',
    runtime: 'claude',
    prompt: 'You are continuing work that another agent (Codex) started...',
    createdAt: '2026-09-01T15:02:00.000Z',
    continuesFrom: { missionId: 'mission_1', checkpointEpoch: 1, reason: 'route-switch' as const }
  })
  const byId = new Map([
    ['mission_1', first],
    ['mission_2', second]
  ])

  it('shows the words the person typed, not the briefing the host wrote', () => {
    expect(rootMission(second, byId).prompt).toBe('Inspect the workspace.')
    expect(rootMission(first, byId)).toBe(first)
  })

  it('rebuilds the divider from the route-switch checkpoint it resumed from', () => {
    const stitched = stitchedHandoff(second, byId)
    expect(stitched).toMatchObject({ from: 'codex', to: 'claude', unsettledCount: 1, omittedBriefing: [] })
    expect(stitchedHandoff(first, byId)).toBeUndefined()
  })

  it('stops walking a chain whose earlier mission is missing, and a cyclic one', () => {
    const orphan = mission({ missionId: 'mission_3', continuesFrom: { missionId: 'mission_gone', checkpointEpoch: 1, reason: 'route-switch' as const } })
    expect(rootMission(orphan, new Map([['mission_3', orphan]]))).toBe(orphan)
    expect(stitchedHandoff(orphan, new Map([['mission_3', orphan]]))).toBeUndefined()
    const a = mission({ missionId: 'a', continuesFrom: { missionId: 'b', checkpointEpoch: 1, reason: 'route-switch' as const } })
    const b = mission({ missionId: 'b', continuesFrom: { missionId: 'a', checkpointEpoch: 1, reason: 'route-switch' as const } })
    expect(rootMission(a, new Map([['a', a], ['b', b]]))).toBeDefined()
  })
})

describe('the running step', () => {
  function stepEvent(stepKind: 'turn' | 'reasoning' | 'item'): NormalizedRuntimeEvent {
    return {
      id: `e_${stepKind}`,
      runId: 'run_1',
      missionId: 'mission_1',
      sequence: 1,
      type: 'step.started',
      occurredAt: '2026-09-01T15:00:00.000Z',
      sourceAdapter: 'codex',
      payload: { stepKind, evidence: { redacted: true } }
    } as unknown as NormalizedRuntimeEvent
  }

  it('carries the step kind, so thought and action draw differently', () => {
    const thinking = buildThread([stepEvent('reasoning')], { running: true }).find((item) => item.type === 'live-step')
    const acting = buildThread([stepEvent('turn')], { running: true }).find((item) => item.type === 'live-step')
    expect(thinking).toMatchObject({ type: 'live-step', kind: 'reasoning', label: 'Thinking' })
    expect(acting).toMatchObject({ type: 'live-step', kind: 'turn', label: 'Working' })
  })
})

describe('runtime notices in the thread', () => {
  const at = '2026-09-01T15:00:00.000Z'
  function notice(id: string, sequence: number): NormalizedRuntimeEvent {
    return {
      id,
      runId: 'run_1',
      missionId: 'mission_1',
      sequence,
      type: 'adapter.diagnostic',
      occurredAt: at,
      sourceAdapter: 'codex',
      payload: { level: 'warning', code: 'codex.item_error', message: 'Skill descriptions were shortened.', terminal: false, evidence: { redacted: true } }
    } as unknown as NormalizedRuntimeEvent
  }
  const step = {
    id: 's1',
    runId: 'run_1',
    missionId: 'mission_1',
    sequence: 2,
    type: 'step.started',
    occurredAt: at,
    sourceAdapter: 'codex',
    payload: { stepKind: 'turn', evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent

  it('keeps a notice raised before any work out of the thread, as setup talk', () => {
    expect(buildThread([notice('d1', 1), step], { running: false }).some((item) => item.type === 'diagnostic')).toBe(false)
    // Codex's real shape: the turn opens, THEN the setup notice arrives, and
    // only after that does anything run. The turn opening is not work.
    expect(buildThread([step, notice('d1', 3)], { running: false }).some((item) => item.type === 'diagnostic')).toBe(false)
  })

  it('shows a run in trouble even before any tool has run', () => {
    // MEASURED 2026-09-03: against a dead endpoint Codex retries five times
    // over several minutes, reporting `Reconnecting... 2/5` each time. Those
    // arrive before the first tool, so the gate above dropped every one and
    // the mission sat reading "running" with an empty thread.
    const reconnect = {
      id: 'd9',
      runId: 'run_1',
      missionId: 'mission_1',
      sequence: 1,
      type: 'adapter.diagnostic',
      occurredAt: at,
      sourceAdapter: 'codex',
      payload: {
        level: 'error',
        code: 'codex.runtime_error',
        message: 'Reconnecting... 2/5',
        terminal: false,
        evidence: { redacted: true }
      }
    } as unknown as NormalizedRuntimeEvent
    const items = buildThread([step, reconnect], { running: true })
    expect(items.some((item) => item.type === 'diagnostic' && /Reconnecting/.test(item.message))).toBe(true)
  })

  it('shows a notice raised while the work was under way', () => {
    const items = buildThread([step, toolStart('t1', 'shell', 'pnpm test'), notice('d2', 4)], { running: false })
    expect(items.some((item) => item.type === 'diagnostic')).toBe(true)
  })
})

describe('what a model alias resolved to', () => {
  function ranOn(missionId: string, model: string, resolved: string | undefined, createdAt: string) {
    return {
      missionId,
      runId: `run_${missionId}`,
      workspaceId: 'ws_test',
      prompt: 'x',
      runtime: 'claude' as const,
      model,
      requestedRouteId: 'claude',
      resolvedRouteId: 'claude-account:default',
      cliVersion: null,
      createdAt,
      lastUpdatedAt: createdAt,
      phase: 'completed' as const,
      events: [
        {
          id: `e_${missionId}`,
          runId: `run_${missionId}`,
      workspaceId: 'ws_test',
          missionId,
          sequence: 1,
          type: 'run.started',
          occurredAt: createdAt,
          sourceAdapter: 'claude',
          payload: {
            runtimeThreadId: 'thread',
            evidence: { redacted: true, raw: resolved === undefined ? {} : { model: resolved } }
          }
        }
      ] as unknown as NormalizedRuntimeEvent[],
      eventCount: 1,
      eventsTruncated: false,
      integrityIssueCount: 0,
      sandbox: 'read-only' as const,
      checkpoints: [],
      peerMessages: []
    }
  }

  it('learns the real name the runtime reported for an alias', () => {
    const resolved = resolvedModelNames([ranOn('m1', 'fable', 'claude-fable-5-1', '2026-09-01T10:00:00.000Z')])
    expect(resolved.get('claude:fable')).toBe('claude-fable-5-1')
  })

  it('prefers the newest mission, so a new release replaces an old name', () => {
    // Newest FIRST, which is the order history arrives in. Listed the other
    // way round, plain last-write-wins would land on the right answer by
    // accident and the comparison this pins would not be doing any work.
    const resolved = resolvedModelNames([
      ranOn('new', 'fable', 'claude-fable-5-1', '2026-09-01T10:00:00.000Z'),
      ranOn('old', 'fable', 'claude-fable-5', '2026-08-01T10:00:00.000Z')
    ])
    expect(resolved.get('claude:fable')).toBe('claude-fable-5-1')
  })

  it('says nothing about an alias nobody has run, or one that taught it nothing', () => {
    expect(resolvedModelNames([]).size).toBe(0)
    expect(resolvedModelNames([ranOn('m1', 'fable', undefined, '2026-09-01T10:00:00.000Z')]).size).toBe(0)
    // `fable -> fable` is not a resolution, it is the same word back.
    expect(resolvedModelNames([ranOn('m2', 'fable', 'fable', '2026-09-01T10:00:00.000Z')]).size).toBe(0)
  })
})

describe('a conversation across turns', () => {
  function turn(
    missionId: string,
    prompt: string,
    continuesFrom?: { missionId: string; reason: 'follow-up' | 'route-switch' }
  ): PublicRecoveredMission {
    return {
      missionId,
      runId: `run_${missionId}`,
      workspaceId: 'ws_test',
      prompt,
      runtime: 'claude',
      model: 'sonnet',
      requestedRouteId: 'claude',
      resolvedRouteId: 'claude-account:default',
      cliVersion: null,
      createdAt: '2026-09-02T10:00:00.000Z',
      lastUpdatedAt: '2026-09-02T10:00:00.000Z',
      phase: 'completed',
      events: [],
      eventCount: 0,
      eventsTruncated: false,
      integrityIssueCount: 0,
      sandbox: 'read-only',
      checkpoints: [],
      peerMessages: [],
      ...(continuesFrom === undefined
        ? {}
        : { continuesFrom: { ...continuesFrom, checkpointEpoch: 1 } })
    }
  }

  const first = turn('m1', 'check the google stock price')
  const second = turn('m2', 'cant you look it up for me?', { missionId: 'm1', reason: 'follow-up' })
  const third = turn('m3', 'what about yesterday?', { missionId: 'm2', reason: 'follow-up' })
  const byId = new Map([first, second, third].map((mission) => [mission.missionId, mission] as const))

  it('walks a reply back to every earlier turn, oldest first', () => {
    expect(conversationTurns(third, byId).map((entry) => entry.prompt)).toEqual([
      'check the google stock price',
      'cant you look it up for me?',
      'what about yesterday?'
    ])
  })

  it('is just itself for a first turn', () => {
    expect(conversationTurns(first, byId).map((entry) => entry.missionId)).toEqual(['m1'])
  })

  it('does not walk a route switch, which is a handoff and keeps its divider', () => {
    const handed = turn('m4', 'briefing text', { missionId: 'm1', reason: 'route-switch' })
    const withHandoff = new Map([...byId, ['m4', handed] as const])
    expect(conversationTurns(handed, withHandoff).map((entry) => entry.missionId)).toEqual(['m4'])
  })

  it('stops at a missing or cyclic link rather than spinning', () => {
    const orphan = turn('m9', 'reply', { missionId: 'gone', reason: 'follow-up' })
    expect(conversationTurns(orphan, new Map([['m9', orphan]])).map((e) => e.missionId)).toEqual(['m9'])
    const a = turn('a', 'a', { missionId: 'b', reason: 'follow-up' })
    const b = turn('b', 'b', { missionId: 'a', reason: 'follow-up' })
    const cyclic = new Map([['a', a], ['b', b]] as const)
    expect(conversationTurns(a, cyclic).length).toBeLessThanOrEqual(2)
  })

  it('draws no handoff divider across an ordinary reply', () => {
    expect(stitchedHandoff(second, byId)).toBeUndefined()
  })
})

describe('whether a finished run can be replied to', () => {
  it('names the session a reply would resume', () => {
    expect(resumableSessionOf([startedEvent('thread-7'), event('run.completed', {})])).toBe('thread-7')
  })

  it('has nothing to resume when the run failed before its runtime started', () => {
    // What a start failure looks like: the host recorded the failure and the
    // runtime never opened a session. A reply here would be refused by the
    // host, so the shell must send it as a new mission instead.
    expect(resumableSessionOf([event('run.failed', { kind: 'process-failed', message: 'Codex CLI is not ready.' })]))
      .toBeUndefined()
    expect(resumableSessionOf([])).toBeUndefined()
  })

  it('ignores an empty session id rather than treating it as one', () => {
    expect(resumableSessionOf([startedEvent()])).toBeUndefined()
  })
})

describe('which words a turn shows', () => {
  const mission = (
    missionId: string,
    prompt: string,
    continuesFrom?: { readonly missionId: string; readonly reason: 'route-switch' | 'follow-up' }
  ): PublicRecoveredMission => ({
    missionId,
    runId: `run_${missionId}`,
      workspaceId: 'ws_test',
    prompt,
    runtime: 'codex',
    model: 'account-default',
    resolvedRouteId: 'codex-account:default',
    cliVersion: null,
    sandbox: 'read-only',
    phase: 'completed',
    createdAt: NOW,
    lastUpdatedAt: NOW,
    integrityIssueCount: 0,
    events: [],
    peerMessages: [],
    ...(continuesFrom === undefined
      ? {}
      : { continuesFrom: { ...continuesFrom, checkpointEpoch: 1 } })
  } as unknown as PublicRecoveredMission)

  const index = (missions: readonly PublicRecoveredMission[]) =>
    new Map(missions.map((held) => [held.missionId, held]))

  it('shows a reply the words that were typed for it, not the opening line', () => {
    const first = mission('m1', 'Audit the config')
    const reply = mission('m2', 'Now fix the two you found', { missionId: 'm1', reason: 'follow-up' })
    expect(typedPrompt(reply, index([first, reply]))).toBe('Now fix the two you found')
  })

  it('shows a handed-over mission the words a person typed, not the briefing written for it', () => {
    const first = mission('m1', 'Audit the config')
    const handed = mission('m2', 'You are continuing a mission…', { missionId: 'm1', reason: 'route-switch' })
    expect(typedPrompt(handed, index([first, handed]))).toBe('Audit the config')
  })

  it('reaches back through a handoff but stops at the reply above it', () => {
    // A → handed over → B → replied to → C. C's own words are C's.
    const a = mission('m1', 'Audit the config')
    const b = mission('m2', 'You are continuing a mission…', { missionId: 'm1', reason: 'route-switch' })
    const c = mission('m3', 'Now fix the two you found', { missionId: 'm2', reason: 'follow-up' })
    const byId = index([a, b, c])
    expect(typedPrompt(c, byId)).toBe('Now fix the two you found')
    expect(typedPrompt(b, byId)).toBe('Audit the config')
  })

  it('keeps the mission own words when the one it continues is gone', () => {
    const orphan = mission('m2', 'You are continuing a mission…', { missionId: 'm_missing', reason: 'route-switch' })
    expect(typedPrompt(orphan, index([orphan]))).toBe('You are continuing a mission…')
  })
})

describe('the routes this person has actually run', () => {
  const ran = (missionId: string, runtime: string, model: string, lastUpdatedAt: string) => ({
    missionId,
    runId: `run_${missionId}`,
      workspaceId: 'ws_test',
    prompt: 'x',
    runtime,
    model,
    resolvedRouteId: `${runtime}-account:default`,
    cliVersion: null,
    sandbox: 'read-only',
    phase: 'completed',
    createdAt: lastUpdatedAt,
    lastUpdatedAt,
    integrityIssueCount: 0,
    events: [],
    peerMessages: []
  } as unknown as PublicRecoveredMission)

  it('lists each route once, newest first', () => {
    const routes = recentlyUsedRoutes([
      ran('m1', 'codex', 'gpt-5', '2026-09-01T00:00:00.000Z'),
      ran('m2', 'cursor', 'composer-2.5', '2026-09-02T00:00:00.000Z'),
      ran('m3', 'codex', 'gpt-5', '2026-09-03T00:00:00.000Z')
    ])
    expect(routes).toEqual(['codex:gpt-5', 'cursor:composer-2.5'])
  })

  it('says nothing when nothing has been run', () => {
    expect(recentlyUsedRoutes([])).toEqual([])
  })
})

describe('the activity card reads the change, not a receipt of it', () => {
  const PATCH = [
    '--- a/src/billing.ts',
    '+++ b/src/billing.ts',
    '@@ -12,2 +12,3 @@ handle()',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const c = 4;',
    ''
  ].join('\n')

  function edited(patch: { text: string; added: number; removed: number; truncated: boolean }) {
    return [
      { kind: 'edit', name: 'apply_patch', settled: true, patch }
    ]
  }

  it('turns one patch into a row per file it touched', () => {
    const two = `${PATCH}--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n`
    const entries = activityEntries(edited({ text: two, added: 3, removed: 2, truncated: false }))
    expect(entries.map((entry) => (entry.kind === 'file' ? entry.file.path : entry.kind))).toEqual([
      'src/billing.ts',
      'README.md'
    ])
  })

  it('sums the card total from the rows it will actually draw', () => {
    // The runtime's own header claims far more than the recorded text holds.
    // The card shows what the diff below it can show, or the two disagree.
    const entries = activityEntries(edited({ text: PATCH, added: 900, removed: 900, truncated: true }))
    expect(activityCounts(edited({ text: PATCH, added: 900, removed: 900, truncated: true }))).toEqual({
      added: 2,
      removed: 1
    })
    expect(entries[0]?.kind === 'file' ? entries[0].counts : undefined).toEqual({ added: 2, removed: 1 })
  })

  it('keeps the runtime total beside a truncated single-file patch, and withholds it across several', () => {
    const one = activityEntries(edited({ text: PATCH, added: 900, removed: 900, truncated: true }))[0]
    expect(one?.kind === 'file' ? one.reported : undefined).toEqual({ added: 900, removed: 900 })
    const many = activityEntries(
      edited({ text: `${PATCH}--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n`, added: 900, removed: 900, truncated: true })
    )[0]
    expect(many?.kind === 'file' ? many.reported : 'missing').toBeUndefined()
  })

  it('keeps an edit whose runtime reported no patch, as a row that says so', () => {
    const entries = activityEntries([{ kind: 'edit', name: 'apply_patch', settled: true }])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe('unreported')
  })

  it('names the tool on a row whose target is the same path it edited', () => {
    const entries = activityEntries([
      { kind: 'tool', name: 'src/billing.ts', tool: 'read', settled: true },
      { kind: 'tool', name: 'grep', tool: 'grep', settled: true }
    ])
    expect(entries[0]).toMatchObject({ kind: 'tool', name: 'src/billing.ts', tool: 'read' })
    // A tool whose name IS its target says it once, not twice.
    expect(entries[1]).toMatchObject({ tool: undefined })
  })

  it('carries a command row with its exit result', () => {
    const entries = activityEntries([
      { kind: 'shell', name: 'pnpm test', settled: true, failed: true, exitCode: 1 }
    ])
    expect(entries[0]).toMatchObject({ kind: 'shell', command: 'pnpm test', failed: true, exitCode: 1 })
  })

  it('opens the first file, unless opening it would bury everything after it', () => {
    const small = activityEntries(edited({ text: PATCH, added: 2, removed: 1, truncated: false }))
    expect(defaultOpenEntry(small)).toBe(small[0]?.key)
    const huge = [
      '--- a/big.ts',
      '+++ b/big.ts',
      `@@ -1 +1,400 @@`,
      ...Array.from({ length: 400 }, (_, i) => `+line ${String(i)}`)
    ].join('\n')
    const big = activityEntries(edited({ text: huge, added: 400, removed: 0, truncated: false }))
    expect(big[0]?.kind === 'file' ? big[0].large : false).toBe(true)
    expect(defaultOpenEntry(big)).toBeUndefined()
  })

  it('attaches a completion patch to the tool that opened, and names the runtime that reported it', () => {
    const thread = buildThread(
      [
        event('tool.started', { itemId: 't1', toolKind: 'file_change', name: 'apply_patch', phase: 'started' }),
        event('tool.completed', {
          itemId: 't1',
          toolKind: 'file_change',
          name: 'apply_patch',
          phase: 'completed',
          patch: { text: PATCH, added: 2, removed: 1, truncated: false }
        })
      ],
      { running: false }
    )
    const card = thread.find((item) => item.type === 'activity')
    expect(card?.type === 'activity' ? card.reportedBy : undefined).toBe('codex')
    expect(card?.type === 'activity' ? activityCounts(card.details) : undefined).toEqual({ added: 2, removed: 1 })
  })
})

describe('marking time in a long conversation', () => {
  function turn(minute: number, count = 1) {
    return Array.from({ length: count }, (_, index) =>
      event('step.completed', { itemId: `s${String(minute)}_${String(index)}`, stepKind: 'turn' })
    ).map((each, index) => ({
      ...each,
      occurredAt: new Date(Date.UTC(2026, 7, 31, 16, minute + index)).toISOString()
    })) as unknown as import('@teammate/runtime-adapters').NormalizedRuntimeEvent[]
  }

  it('says nothing when turns follow each other closely', () => {
    expect(threadMarkers([turn(0), turn(1)])).toEqual([])
  })

  it('marks a gap, with the elapsed mission time and how long the wait was', () => {
    const markers = threadMarkers([turn(0), turn(40)])
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ beforeTurn: 1, minutesIn: 40, note: 'waited 40 min' })
  })

  it('measures elapsed time from the mission first event, not the previous turn', () => {
    const markers = threadMarkers([turn(0), turn(10), turn(30)])
    expect(markers.map((marker) => marker.minutesIn)).toEqual([10, 30])
  })
})

describe('both halves of a teammate exchange are drawn', () => {
  const message = (
    direction: 'received' | 'posted',
    who: string,
    text: string,
    at: string
  ): PublicPeerMessage => ({
    messageId: `m_${text.slice(0, 6)}_${direction}`,
    direction,
    from: direction === 'posted' ? { teammateId: 'booty', name: 'Booty' } : { teammateId: 'wren', name: 'Wren' },
    to: direction === 'posted' ? { teammateId: 'wren', name: who } : { teammateId: 'booty', name: 'Booty' },
    text,
    at
  })

  // Turn 1: Booty asks Wren. Turn 2: Wren's answer comes back.
  const turns = [
    [message('posted', 'Wren', 'Write me a soliloquy.', '2026-09-04T21:47:00.000Z')],
    [message('received', 'Booty', 'O silent hall of half-built code...', '2026-09-04T21:48:00.000Z')]
  ]

  it('draws the message an earlier turn SENT, not only the reply', () => {
    // The bug Colin caught: the thread showed Wren's soliloquy and never
    // showed Booty asking for it, so it read as though Wren answered him.
    const cards = threadPeerCards(turns)
    const sent = cards.flatMap((card) => card.group.messages).filter((held) => held.direction === 'posted')
    expect(sent.map((held) => held.text)).toEqual(['Write me a soliloquy.'])
  })

  it('keeps every turn of a long conversation, not just the last two', () => {
    // Guards the shape of the fix: a version that kept only the newest turns
    // would pass the test above and still lose the start of the exchange.
    const many = Array.from({ length: 6 }, (_unused, index) =>
      [message('posted', 'Wren', `ask ${String(index)}`, `2026-09-04T21:${String(40 + index)}:00.000Z`)]
    )
    const texts = threadPeerCards(many).flatMap((card) => card.group.messages).map((held) => held.text)
    expect(texts).toEqual(['ask 0', 'ask 1', 'ask 2', 'ask 3', 'ask 4', 'ask 5'])
  })

  it('files each card against the turn it happened on', () => {
    const cards = threadPeerCards(turns)
    expect(cards.map((card) => card.turnIndex)).toEqual([0, 1])
  })

  it('puts what a turn sent after its work and what it was handed before it', () => {
    const cards = threadPeerCards(turns)
    expect(cards[0]?.placement).toBe('after-work')
    expect(cards[1]?.placement).toBe('before-work')
  })

  it('gives the same peer a distinct key on each turn', () => {
    // One key per peer would collapse two turns of an exchange into one card.
    const keys = threadPeerCards(turns).map((card) => card.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('reading an exchange without hunting for it', () => {
  it('opens a short exchange in place', () => {
    // An ask and an answer is the common case and the one that went unread.
    expect(peerExchangeStartsOpen(1)).toBe(true)
    expect(peerExchangeStartsOpen(2)).toBe(true)
  })

  it('leaves a long back-and-forth collapsed', () => {
    // The reason the card collapses at all: a colleague's long aside must not
    // read as the mission's own work.
    expect(peerExchangeStartsOpen(3)).toBe(false)
    expect(peerExchangeStartsOpen(9)).toBe(false)
  })

  it('has nothing to open when there are no messages', () => {
    expect(peerExchangeStartsOpen(0)).toBe(false)
  })

  it('previews what a collapsed exchange said', () => {
    expect(peerSnippet('Write me a soliloquy.')).toBe('Write me a soliloquy.')
  })

  it('flattens a multi-line message to one line', () => {
    expect(peerSnippet('first line\n\n  second line')).toBe('first line second line')
  })

  it('cuts a long message rather than letting the card wrap', () => {
    const snippet = peerSnippet('x'.repeat(200), 20)
    expect(snippet).toHaveLength(20)
    expect(snippet?.endsWith('…')).toBe(true)
  })

  it('previews nothing for a message the workroom no longer holds', () => {
    expect(peerSnippet(null)).toBeUndefined()
    expect(peerSnippet('   ')).toBeUndefined()
  })
})

describe('a run the host started for a teammate', () => {
  const relayed = (over: Partial<PublicRecoveredMission> = {}): PublicRecoveredMission =>
    ({
      missionId: 'm_relay',
      runId: 'run_relay',
      workspaceId: 'ws_test',
      runtime: 'claude',
      model: 'sonnet',
      resolvedRouteId: 'claude:sonnet',
      cliVersion: null,
      sandbox: 'read-only',
      phase: 'completed',
      createdAt: NOW,
      lastUpdatedAt: NOW,
      integrityIssueCount: 0,
      events: [],
      prompt:
        'Wren (Code & Migrations) sent you a message; it is quoted below with anything else waiting for you. Do what it asks if that is within your role and this workspace. Write back only if that helps finish the work: end with one <locust-share to="Wren"> block holding your reply.',
      startedBy: { kind: 'relay', hop: 1 },
      peerMessages: [
        {
          messageId: 'msg_1',
          direction: 'received',
          from: { teammateId: 'tm_wren', name: 'Wren' },
          to: { teammateId: 'tm_booty', name: 'Booty' },
          text: 'Please reply with the passphrase\n  PEBBLE-9993.',
          at: '2026-09-04T21:47:00.000Z'
        }
      ],
      ...over
    }) as PublicRecoveredMission

  it('is named by the message that caused it, never by the host briefing', () => {
    // The briefing is instructions to a runtime. It was appearing as the NAME
    // of a mission beside conversations a person actually started.
    expect(relayedTitle(relayed())).toBe('Wren asked: Please reply with the passphrase PEBBLE-9993.')
  })

  it('leaves a mission a person started alone', () => {
    expect(relayedTitle({ ...relayed(), startedBy: undefined } as PublicRecoveredMission)).toBeUndefined()
  })

  it('shows the briefing rather than inventing a title when the message is gone', () => {
    // A message the workroom no longer holds reads as null. The briefing is at
    // least true; a made-up title is not.
    const gone = relayed({
      peerMessages: [{ ...relayed().peerMessages[0]!, text: null }]
    })
    expect(relayedTitle(gone)).toBeUndefined()
  })

  it('ignores what the run SENT and names it by what it was asked', () => {
    const sentOnly = relayed({
      peerMessages: [{ ...relayed().peerMessages[0]!, direction: 'posted' }]
    })
    expect(relayedTitle(sentOnly)).toBeUndefined()
  })

  it('keeps the title to one line', () => {
    expect(relayedTitle(relayed())).not.toContain('\n')
  })

  it('does not let typedPrompt hand back the briefing either', () => {
    const title = typedPrompt(relayed(), new Map())
    expect(title).toBe('Wren asked: Please reply with the passphrase PEBBLE-9993.')
    expect(title).not.toContain('locust-share')
  })
})

describe('a question the run ended on', () => {
  const ASK = [
    'Here is what I found.',
    '',
    '<locust-ask>',
    'Keep the two callers on v2, or migrate them now?',
    '- Keep them on v2 :: Smaller change',
    '- Migrate all callers now :: Touches 4 more files',
    '</locust-ask>'
  ].join('\n')

  const finished = (text: string): readonly NormalizedRuntimeEvent[] => [delta('a', text, 'append', true)]

  it('becomes a card on the turn a person can answer', () => {
    const items = buildThread(finished(ASK), { running: false, latestTurn: true })
    const card = items.find((item) => item.type === 'decision')
    expect(card?.type === 'decision' && card.request.options).toHaveLength(2)
  })

  it('is not offered on an earlier turn, where the answer already exists', () => {
    // On an earlier turn the answer IS the next turn's prompt, a few lines
    // below. Offering buttons there invites answering the same fork twice.
    expect(buildThread(finished(ASK), { running: false }).some((i) => i.type === 'decision')).toBe(false)
  })

  it('is not offered while the run is still going', () => {
    // A block still streaming may not have its closing tag yet, and a run that
    // has not stopped has not asked.
    expect(buildThread(finished(ASK), { running: true, latestTurn: true }).some((i) => i.type === 'decision')).toBe(false)
  })

  it('is taken out of the reply bubble, so it is never asked twice', () => {
    const items = buildThread(finished(ASK), { running: false, latestTurn: true })
    const message = items.find((item) => item.type === 'agent-message')
    expect(message?.type === 'agent-message' && message.text).toBe('Here is what I found.')
  })

  it('leaves an ordinary finished run with no card', () => {
    expect(buildThread(finished('Done, two files changed.'), { running: false, latestTurn: true })
      .some((i) => i.type === 'decision')).toBe(false)
  })

  it('reads the LAST final message, not an earlier one', () => {
    // A run can answer, then ask. The question it stopped on is the last one.
    const items = buildThread(
      [delta('a', 'First pass done.', 'append', true), delta('b', ASK, 'append', true)],
      { running: false, latestTurn: true }
    )
    expect(items.some((i) => i.type === 'decision')).toBe(true)
  })
})

describe('what the decision card may say about the workspace', () => {
  it('claims nothing changed only when the run could not write', () => {
    // A guarantee from the sandbox, not an observation.
    expect(decisionStanding({ sandbox: 'read-only', events: [] })).toContain('nothing was changed')
  })

  it('says work is kept when a patch actually came back', () => {
    const wrote = [event('tool.completed', { itemId: 't1', toolKind: 'edit', name: 'apply', phase: 'completed', patch: 'diff' })]
    expect(decisionStanding({ sandbox: 'workspace-write', events: wrote })).toContain('work already done is kept')
  })

  it('never claims nothing changed for a run that was allowed to write', () => {
    // Nothing was OBSERVED, which is not the same as nothing happening: a
    // runtime need not report every write. So it states the permission.
    const said = decisionStanding({ sandbox: 'workspace-write', events: [] })
    expect(said).not.toContain('nothing was changed')
    expect(said).toContain('could edit files')
  })

  it('does not claim nothing changed when the mode is unknown', () => {
    expect(decisionStanding({ sandbox: undefined, events: [] })).not.toContain('nothing was changed')
  })
})

describe('the waiting line’s clock', () => {
  it('counts from the start of the turn, so it climbs instead of looping', () => {
    // Colin watched one count to 10 and start over, repeatedly, which reads as
    // a stuck loop rather than a run making progress. Clocking from the last
    // event did that: a runtime reporting every few seconds reset it every few
    // seconds.
    const items = buildThread(
      [
        event('run.started', {}),
        event('adapter.diagnostic', { level: 'info', message: 'something later' })
      ],
      { running: true, latestTurn: true, startedAt: '2026-09-05T10:00:00.000Z' }
    )
    const line = items.find((item) => item.type === 'live-step')
    expect(line?.type === 'live-step' && line.startedAt).toBe('2026-09-05T10:00:00.000Z')
  })

  it('falls back to the first event when the turn start is unknown', () => {
    // A restored mission has no send time in hand; the first event is still
    // the earliest moment the app can honestly count from.
    const items = buildThread([event('run.started', {})], { running: true, latestTurn: true })
    const line = items.find((item) => item.type === 'live-step')
    expect(line?.type === 'live-step' && line.startedAt).toBe(NOW)
  })
})

describe("the host's disk observation of a path the runtime named", () => {
  it('attaches the patch to the row the runtime drew, and draws a row only for a path it never named', () => {
    const patch = { text: '--- /dev/null\n+++ b/NOTES.md\n@@ -0,0 +1,2 @@\n+# Notes\n+First entry.\n', added: 2, removed: 0, truncated: false }
    const thread = buildThread(
      [
        event('tool.started', { itemId: 'fc', toolKind: 'file_change', name: 'file_change', command: 'NOTES.md', phase: 'started' }),
        event('tool.completed', { itemId: 'fc', toolKind: 'file_change', name: 'file_change', command: 'NOTES.md', phase: 'completed' }),
        event('tool.started', { itemId: 'disk-observed-1', toolKind: 'observed_edit', name: 'edit', command: 'NOTES.md', status: 'reported by the runtime, read from disk', phase: 'started' }),
        event('tool.completed', { itemId: 'disk-observed-1', toolKind: 'observed_edit', name: 'edit', command: 'NOTES.md', status: 'reported by the runtime, read from disk', phase: 'completed', patch }),
        event('tool.started', { itemId: 'disk-observed-2', toolKind: 'observed_edit', name: 'edit', command: 'other.txt', status: 'observed on disk', phase: 'started' }),
        event('tool.completed', { itemId: 'disk-observed-2', toolKind: 'observed_edit', name: 'edit', command: 'other.txt', status: 'observed on disk', phase: 'completed' })
      ],
      { running: false }
    )
    const activity = thread.find((item) => item.type === 'activity')
    const details = activity?.type === 'activity' ? activity.details : []
    const notes = details.filter((detail) => /NOTES/.test(detail.name))
    expect(notes).toHaveLength(1)
    expect(notes[0]?.patch?.added).toBe(2)
    expect(details.some((detail) => /other\.txt/.test(detail.name))).toBe(true)
    expect(activity?.type === 'activity' && activity.summary).toBe('Edited 2 files')
  })
})

describe('a usage window, as a person reads it', () => {
  it('turns ISO reset instants into clock times and leaves the words alone', () => {
    const label = usageWindowLabel('5-hour window 67% used · resets 2026-09-06T02:10:00.000Z · 7-day window 53% used')
    expect(label).not.toContain('2026-09-06T')
    expect(label).toMatch(/^5-hour window 67% used · resets .+ · 7-day window 53% used$/)
    expect(usageWindowLabel('nothing to convert')).toBe('nothing to convert')
  })
})

describe('the trace line for a finished turn (SURFACES-0.22)', () => {
  const at = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString()
  const base = { runId: 'run_1', missionId: 'mission_1', sourceAdapter: 'claude' as const }
  const ev = (seq: number, type: string, payload: Record<string, unknown>, s: number) => ({ ...base, id: `e${String(seq)}`, sequence: seq, occurredAt: at(s), type, payload: { evidence: { redacted: true }, ...payload } }) as never
  const joined = (segments: readonly { text: string }[]) => segments.map((seg) => seg.text).join(' · ')

  it('leads with the duration and ends with the exceptions; a zero segment is absent', () => {
    const events = [
      ev(1, 'run.started', { runtimeThreadId: 't' }, 0),
      ev(2, 'step.started', { stepKind: 'reasoning', itemId: 'r1' }, 1),
      ev(3, 'step.completed', { stepKind: 'reasoning', itemId: 'r1' }, 8),
      ev(4, 'tool.started', { itemId: 'a', toolKind: 'tool_use', name: 'Agent', command: 'Count lines', phase: 'started' }, 9),
      ev(5, 'tool.completed', { itemId: 'a', toolKind: 'tool_use', name: 'Agent', command: 'Count lines', phase: 'completed', status: 'Explore', output: '3' }, 20),
      ev(6, 'tool.started', { itemId: 'b', toolKind: 'tool_use', name: 'Read', command: 'README.md', phase: 'started' }, 21),
      ev(7, 'tool.completed', { itemId: 'b', toolKind: 'tool_use', name: 'Read', command: 'README.md', phase: 'completed' }, 22),
      ev(8, 'adapter.diagnostic', { code: 'claude.notification', level: 'warning', terminal: false, message: 'Stop hook error occurred' }, 40),
      ev(9, 'run.completed', { runtimeThreadId: 't', process: {} }, 41)
    ]
    const thread = buildThread(events, { running: false })
    const activity = thread.find((item) => item.type === 'activity')
    const details = activity?.type === 'activity' ? activity.details : []
    const segments = activityTrace(details, events, traceOutcome(events, false))
    expect(joined(segments)).toBe('41s · thought 7s · asked 1 subagent · 1 tool call · 1 notice')
    expect(segments.find((seg) => seg.key === 'subagents')?.tone).toBeUndefined()
  })

  it('says a subagent did not report, in amber, only once the turn is over', () => {
    const events = [
      ev(1, 'run.started', { runtimeThreadId: 't' }, 0),
      ev(2, 'tool.started', { itemId: 'a', toolKind: 'tool_use', name: 'Agent', command: 'Search', phase: 'started' }, 1),
      ev(3, 'run.cancelled', { process: {} }, 30)
    ]
    const live = buildThread(events.slice(0, 2), { running: true })
    const liveDetails = live.find((item) => item.type === 'activity')
    expect(joined(activityTrace(liveDetails?.type === 'activity' ? liveDetails.details : [], events.slice(0, 2), 'running'))).toBe('1s · asked 1 subagent')
    const over = buildThread(events, { running: false })
    const details = over.find((item) => item.type === 'activity')
    const segments = activityTrace(details?.type === 'activity' ? details.details : [], events, traceOutcome(events, false))
    expect(joined(segments)).toBe('stopped at 30s · nothing was changed · asked 1 subagent · it did not report')
    expect(segments.find((seg) => seg.key === 'subagents')?.tone).toBe('amber')
  })

  it('has the duration as its floor, and words a stop honestly', () => {
    expect(joined(activityTrace([], [ev(1, 'run.started', { runtimeThreadId: 't' }, 0), ev(2, 'run.completed', { runtimeThreadId: 't', process: {} }, 275)], 'completed'))).toBe('4m 35s')
    expect(durationText(3_960_000)).toBe('1h 06m')
    expect(traceOutcome([ev(1, 'run.failed', { message: 'x' }, 0)], false)).toBe('failed')
  })
})

describe('utilisation, in the words of the spec', () => {
  it('reads the fullest window and words the sentence', () => {
    const said = '5-hour window 67% used · resets 2026-09-06T02:10:00.000Z · 7-day window 53% used · resets 2026-09-07T07:00:00.000Z'
    expect(usagePercent(said)).toBe(67)
    expect(usageWindowSentence(said)).toMatch(/^67% of the 5-hour window used, resets .+ · 53% of the 7-day window, resets .+$/)
    expect(usagePercent('nothing')).toBeUndefined()
  })
})

describe('the model an alias turned out to mean (0.35.2)', () => {
  // Colin, 2026-09-06: "in model list they are just listed as sonnet, fable,
  // and opus". The picker had always been willing to show the real name; it
  // was reading the START record, which for Claude Code repeats the alias it
  // was given, so it never learned one however many runs had happened.
  const mission = (fields: Record<string, unknown>) =>
    ({ peerMessages: [], createdAt: '2026-09-06T05:00:00.000Z', ...fields }) as never

  const completed = (resolvedModel?: string) => ({
    type: 'run.completed',
    occurredAt: '2026-09-06T05:00:09.000Z',
    payload: { ...(resolvedModel === undefined ? {} : { resolvedModel }) }
  })

  it('learns it from the result, which is the only record that states it', () => {
    const names = resolvedModelNames([
      mission({
        missionId: 'm1',
        runtime: 'claude',
        model: 'sonnet',
        events: [completed('claude-sonnet-5')]
      })
    ])
    expect(names.get('claude:sonnet')).toBe('claude-sonnet-5')
  })

  it('learns nothing from a run that never named one', () => {
    const names = resolvedModelNames([
      mission({ missionId: 'm1', runtime: 'claude', model: 'sonnet', events: [completed()] })
    ])
    expect(names.get('claude:sonnet')).toBeUndefined()
  })
})
