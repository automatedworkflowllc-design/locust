import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { ApprovalRule } from '../shared/approval-rules.js'
import { createRunAlways, decide } from '../shared/who-decides.js'
import type { DecidedRequest } from '../shared/who-decides.js'
import { acpPermissionRequest, describeApproval, openCodePermissionRequest } from './approval-channel.js'
import { builtInOrConnector } from './permission-host.js'

/**
 * ONE DECISION PATH (0.616; the PRD's R8 and A2).
 *
 * Each host used to keep its own Always and answer by it before the saved
 * rules were read. Claude Code's host remembered a TOOL, so an Always on one
 * Bash card let every later command through: a rule saying no, and a command
 * that stops every python.exe, included. Every request now comes through one
 * function, in one order, and the answer says who decided.
 */
const FOLDER = 'C:/work/shop'
const rule = (effect: 'allow' | 'deny', pattern: string): ApprovalRule => ({ ruleId: `r_${effect}_${pattern}`, effect, kind: 'command', pattern, folder: FOLDER, createdAt: '2026-10-04T00:00:00.000Z' })
const NO_PUSH = rule('deny', 'git push:*')
const TESTS = rule('allow', 'npm test')
const command = (detail: string, runtime = 'claude'): DecidedRequest => ({ kind: 'command', summary: 'Run a command', detail, runtime })
const context = (rules: readonly ApprovalRule[], remembered: boolean) => ({ rules, remembered, folder: FOLDER, teammateId: 'tm_wren' })

describe('one order, whoever asks', () => {
  it('denies by a saved rule, whatever Always was given earlier in the run', () => {
    expect(decide(command('git push origin main'), context([NO_PUSH], true))).toMatchObject({ verdict: 'deny', by: 'saved-rule', rule: NO_PUSH })
    // Any simple part of a compound command, as the rules read it.
    expect(decide(command('npm run build && git push origin main'), context([NO_PUSH], true))).toMatchObject({ verdict: 'deny', by: 'saved-rule' })
  })

  it('asks again about a command that reaches other programs, though Always was given, and says why', () => {
    const decision = decide(command('taskkill /F /IM python.exe'), context([], true))
    expect(decision.verdict).toBe('ask')
    expect(decision.verdict === 'ask' ? decision.why : '').toMatch(/^Asked again, though you chose Always earlier in this run: this command stops every python\.exe/)
  })

  it('allows by an earlier Always what it covers, and says so', () => {
    expect(decide(command('echo two'), context([], true))).toEqual({ verdict: 'allow', by: 'earlier-always' })
    // Every command it runs, as the card said: a compound one with no part a rule forbids.
    expect(decide(command('npm run build && npm test'), context([NO_PUSH], true))).toEqual({ verdict: 'allow', by: 'earlier-always' })
    // A file change and a connector call are not commands and reach nothing.
    expect(decide({ kind: 'file-change', summary: 'Change 1 file', detail: 'src/app.ts', runtime: 'claude' }, context([], true))).toEqual({ verdict: 'allow', by: 'earlier-always' })
  })

  it('credits a saved rule that allows over an Always that would have', () => {
    expect(decide(command('npm test'), context([TESTS], true))).toMatchObject({ verdict: 'allow', by: 'saved-rule', rule: TESTS })
  })

  it('never governs a question: the person answers it, Always or not', () => {
    expect(decide({ kind: 'question', summary: 'Answer a question', detail: 'Which branch?' }, context([TESTS, NO_PUSH], true))).toEqual({ verdict: 'ask' })
  })

  it('asks when nothing decides, with the rules\' own reason when they have one', () => {
    expect(decide(command('ls'), context([], false))).toEqual({ verdict: 'ask' })
    expect(decide(command('npm test; rm -rf build'), context([TESTS], false))).toMatchObject({ verdict: 'ask', why: expect.stringContaining('more than one simple command') })
  })
})

describe('the same action gets the same verdict on every path', () => {
  const COMMAND = 'git push origin main'
  // The one command, as each host raises it.
  const raised: Readonly<Record<string, DecidedRequest>> = {
    'Claude Code (permission host)': { ...builtInOrConnector('Bash', { command: COMMAND }, FOLDER), runtime: 'claude' },
    'Codex (app-server)': { ...describeApproval({ id: 1, method: 'item/commandExecution/requestApproval', params: { command: COMMAND, cwd: FOLDER } })!, runtime: 'codex' },
    'OpenCode (serve)': { ...describeApproval(openCodePermissionRequest({ permission: 'bash', patterns: [COMMAND], always: ['git push *'], metadata: { command: COMMAND } }, FOLDER))!, runtime: 'opencode' },
    'Copilot (ACP)': { ...describeApproval(acpPermissionRequest({ toolCallId: 't1', title: 'Push', kind: 'execute', command: COMMAND, paths: [], diff: undefined, options: [] }, FOLDER))!, runtime: 'copilot' }
  }

  for (const [path, request] of Object.entries(raised)) {
    it(`${path}: denied by the rule, Always or not; allowed by an allowing rule; by an Always; else asked`, () => {
      expect(decide(request, context([NO_PUSH], true))).toMatchObject({ verdict: 'deny', by: 'saved-rule' })
      expect(decide(request, context([NO_PUSH], false))).toMatchObject({ verdict: 'deny', by: 'saved-rule' })
      expect(decide(request, context([rule('allow', COMMAND)], false))).toMatchObject({ verdict: 'allow', by: 'saved-rule' })
      expect(decide(request, context([], true))).toEqual({ verdict: 'allow', by: 'earlier-always' })
      expect(decide(request, context([], false))).toEqual({ verdict: 'ask' })
    })
  }
})

describe('what an Always remembers, and where', () => {
  it('is a key the host puts on the request: a tool, an exact command, OpenCode\'s own patterns; none from Codex', () => {
    const opencode = openCodePermissionRequest({ permission: 'bash', patterns: ['echo SERVED'], always: ['echo *'], metadata: { command: 'echo SERVED' } }, FOLDER)
    expect((opencode.params as Record<string, unknown>).locustAlwaysKey).toBe('opencode:bash:echo *')
    const acp = acpPermissionRequest({ toolCallId: 't1', title: 'Test', kind: 'execute', command: 'npm test', paths: [], diff: undefined, options: [] }, FOLDER)
    expect(acp.params).toMatchObject({ locustAlwaysKey: 'acp:execute:npm test', locustCard: { alwaysCovers: 'this same command again' } })
    // No patterns at all: nothing to remember it by, so it is asked again.
    const bare = openCodePermissionRequest({ permission: 'bash', patterns: [], metadata: {} }, FOLDER)
    expect((bare.params as Record<string, unknown>).locustAlwaysKey).toBeUndefined()
  })

  it('is kept per run, by the main process, bounded', () => {
    const always = createRunAlways(2, 2)
    always.add('run_a', 'claude:Bash')
    expect(always.has('run_a', 'claude:Bash')).toBe(true)
    expect(always.has('run_b', 'claude:Bash')).toBe(false)
    always.add('run_a', 'claude:Edit')
    always.add('run_a', 'claude:Write')
    expect(always.has('run_a', 'claude:Write')).toBe(false)
    always.remove('run_a', 'claude:Edit')
    expect(always.has('run_a', 'claude:Edit')).toBe(false)
    always.add('run_b', 'x')
    always.add('run_c', 'y')
    expect(always.has('run_a', 'claude:Bash')).toBe(false)
    expect(always.has('run_c', 'y')).toBe(true)
  })

  it('is decided in main before any card, and remembered there before the answer is released', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const raise = source.slice(source.indexOf('const raiseApproval = '), source.indexOf('const showApproval = '))
    expect(raise.indexOf('answerByDecision(request)')).toBeGreaterThan(-1)
    expect(raise.indexOf('answerByDecision(request)')).toBeLessThan(raise.indexOf('showApproval('))
    const handler = source.slice(source.indexOf('ipcMain.handle(MISSION_APPROVAL_DECIDE_CHANNEL'))
    expect(handler.indexOf('runAlways.add(')).toBeGreaterThan(-1)
    expect(handler.indexOf('runAlways.add(')).toBeLessThan(handler.indexOf('answerApproval(enforced.answer'))
    // Neither host answers an Always by itself any more.
    const host = readFileSync(fileURLToPath(new URL('./permission-host.ts', import.meta.url)), 'utf8')
    expect(host).not.toMatch(/always\.has\(|always\.add\(/)
  })
})
