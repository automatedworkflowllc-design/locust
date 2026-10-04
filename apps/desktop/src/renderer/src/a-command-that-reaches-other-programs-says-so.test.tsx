import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MissionApprovalRequest } from '../../shared/ipc.js'
import { ActivityCard } from './components/ActivityCard.js'
import { ApprovalCard } from './components/ApprovalCard.js'
import { ApprovalRuleContext } from './approvalRuleContext.js'
import type { CardRule } from './approvalRuleContext.js'
import type { ActivityDetail } from './missionView.js'

/**
 * A COMMAND THAT REACHES OTHER PROGRAMS SAYS SO (0.578).
 *
 * The arena run, 2026-10-03: Opus ran `taskkill //F //IM python.exe`, which
 * stops every Python program on the computer, not only the one it started.
 * The row said `exit 0`. Asked in Approve each, the card would have said
 * "Run a command". Both now say what it reaches; the matcher itself is
 * tested in shared/a-command-that-reaches-other-programs-is-named.test.ts.
 */

const ARENA = 'taskkill //F //IM python.exe'
const SAID = 'Stops every python.exe on this computer, not only the ones this run started.'

const asked = (detail: string): MissionApprovalRequest => ({
  approvalId: 'ap_1',
  runId: 'run_1',
  missionId: 'mission_1',
  kind: 'command',
  summary: 'Run a command',
  detail,
  cwd: 'C:\\work',
  requestedAt: '2026-10-03T22:00:00.000Z',
  runtime: 'claude'
})
const card = (detail: string): string =>
  renderToStaticMarkup(<ApprovalCard request={asked(detail)} onDecide={() => undefined} onAnswer={() => undefined} busy={false} />)

const fold = (command: string, over: Partial<ActivityDetail> = {}): string =>
  renderToStaticMarkup(
    <ActivityCard
      summary="ran 1 command"
      details={[{ kind: 'shell', tool: 'Bash', name: command, settled: true, exitCode: 0, ...over } as ActivityDetail]}
      runtimeName="Claude Code"
      workspacePath="C:/work"
      finished
      openByDefault
    />
  )

describe('the approval card', () => {
  it('says what the command reaches before it runs', () => {
    const html = card(ARENA)
    expect(html).toContain('<dt>Reaches</dt>')
    expect(html).toContain(SAID)
  })

  it('has no such row for a command that acts on its own work', () => {
    expect(card('taskkill /F /PID 1234')).not.toContain('Reaches')
    expect(card('python -m pytest -q')).not.toContain('Reaches')
  })
})

/*
 * ASKED EACH TIME (0.579). OpenCode answered the live drive's card with
 * "taskkill *" as its Always: every taskkill for the rest of the run, from a
 * card about one. Neither Always nor a saved rule is offered for a command
 * that reaches beyond its run.
 */
describe('a card for a command that reaches beyond its run', () => {
  const RULE: CardRule = { allowSentence: 'Wren may run it without asking.', denySentence: 'Wren may never run it.', save: async () => undefined }
  const offered = (detail: string, alwaysCovers?: string): string =>
    renderToStaticMarkup(
      <ApprovalRuleContext.Provider value={() => RULE}>
        <ApprovalCard request={{ ...asked(detail), ...(alwaysCovers === undefined ? {} : { alwaysCovers }) }} onDecide={() => undefined} onAnswer={() => undefined} busy={false} />
      </ApprovalRuleContext.Provider>
    )

  it('offers neither Always nor a saved rule, and says why', () => {
    const html = offered(ARENA, 'anything matching “taskkill *”')
    expect(html).toContain('Approve once')
    expect(html).toContain('Deny')
    expect(html).not.toContain('Always allow this session')
    expect(html).not.toContain('don&rsquo;t ask again')
    expect(html).not.toContain('don’t ask again')
    expect(html).not.toContain('taskkill *')
    expect(html).toContain('asked about every time')
  })

  it('still offers both on an ordinary command (control)', () => {
    const html = offered('python -m pytest -q', 'anything matching “python *”')
    expect(html).toContain('Always allow this session')
    expect(html).toMatch(/don(&rsquo;|’)t ask again/)
    expect(html).toContain('python *')
  })
})

describe('the command row', () => {
  it('says what the command reached after it ran', () => {
    const html = fold(ARENA)
    expect(html).toContain('stops every python.exe')
    expect(html).toContain(`title="${SAID}"`)
    expect(html).toContain('data-reach="every-process-named"')
  })

  it('says nothing more about a command that acts on its own work', () => {
    expect(fold('kill 1234')).not.toContain('is-reach')
    expect(fold('echo "taskkill /IM python.exe"')).not.toContain('is-reach')
  })

  it('says nothing about a command that was refused, since it never ran', () => {
    const refused = fold(ARENA, { status: 'refused', output: 'Ask mode does not run commands.' } as Partial<ActivityDetail>)
    expect(refused).toContain('refused')
    expect(refused).not.toContain('is-reach')
    // Control: the same command, declined on its card, is just as unrun.
    expect(fold(ARENA, { status: 'declined' } as Partial<ActivityDetail>)).not.toContain('is-reach')
  })
})
